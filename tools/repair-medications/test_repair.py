import copy
import importlib.util
import json
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("repair", Path(__file__).with_name("repair.py"))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)

USER = "11111111-1111-4111-8111-111111111111"
SAMPLE = "22222222-2222-4222-8222-222222222222"


class RepairTests(unittest.TestCase):
    def setUp(self):
        self.scope = {"version": 1, "user": USER, "start": 1000, "end": 2000}
        self.row = {"uuid": SAMPLE, "start_us": 1500000,
                    "medication": "<HKHealthConceptIdentifier: 0xabc>", "medication_id": None}
        self.samples = {(SAMPLE, 1500000): {"medication": "Example", "medication_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}

    def plan(self):
        return dict(self.scope, changes=repair.build_changes([self.row], self.samples))

    def test_repairs_only_matching_sample_and_only_eligible_columns(self):
        plan = self.plan()
        repair.validate_plan(plan)
        self.assertEqual(plan["changes"][0]["after"], self.samples[(SAMPLE, 1500000)])
        self.row["start_us"] = 1500001
        self.assertEqual(repair.build_changes([self.row], self.samples), [])

    def test_preserves_valid_name_and_existing_identity(self):
        self.row.update(medication="Original", medication_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        self.assertEqual(repair.build_changes([self.row], self.samples), [])
        self.row["medication_id"] = None
        self.assertEqual(self.plan()["changes"][0]["after"]["medication"], "Original")

    def test_conflicting_identity_aborts_whole_plan(self):
        self.row["medication_id"] = "different"
        with self.assertRaises(ValueError):
            self.plan()

    def test_existing_uuid_case_does_not_create_false_conflict(self):
        self.row["medication_id"] = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"
        self.assertEqual(self.plan()["changes"][0]["after"]["medication_id"], self.row["medication_id"])

    def test_non_uuid_replacement_identity_rejected(self):
        plan = self.plan()
        plan["changes"][0]["after"]["medication_id"] = "not-a-uuid"
        with self.assertRaises(ValueError):
            repair.validate_plan(plan)

    def test_fractional_export_matches_ingest_microsecond_precision_exactly(self):
        # Ingest rounds nanoseconds, then truncates to microseconds; never round milliseconds.
        start = 1718000000000.123
        micros = repair.source_microseconds(start)
        self.assertEqual(micros, 1718000000000123)
        self.row["start_us"] = micros
        self.samples = {(SAMPLE, micros): self.samples[(SAMPLE, 1500000)]}
        self.assertEqual(len(repair.build_changes([self.row], self.samples)), 1)
        self.row["start_us"] += 1
        self.assertEqual(repair.build_changes([self.row], self.samples), [])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "export.ndjson"
            path.write_text(json.dumps({"kind": "medicationDose", "uuid": SAMPLE, "start": start,
                                       "medicationDose": {"medicationID": "not-a-uuid"}}))
            with self.assertRaises(ValueError):
                repair.read_export(path, {"start": 1718000000000, "end": 1718000000001})

    def test_unresolved_export_does_not_erase_name_or_identity(self):
        self.samples[(SAMPLE, 1500000)] = {"medication": None, "medication_id": None}
        self.assertEqual(self.plan()["changes"], [])

    def test_edited_plan_cannot_overwrite_good_name_or_identity(self):
        for field, value in (("medication", "Good name"), ("medication_id", "existing")):
            plan = self.plan()
            plan["changes"][0]["before"][field] = value
            with self.assertRaises(ValueError):
                repair.validate_plan(plan)

    def test_duplicate_and_out_of_scope_plan_rejected(self):
        plan = self.plan()
        plan["changes"].append(copy.deepcopy(plan["changes"][0]))
        with self.assertRaises(ValueError):
            repair.validate_plan(plan)
        plan = self.plan()
        plan["changes"][0]["start_us"] = 2000000
        with self.assertRaises(ValueError):
            repair.validate_plan(plan)

    def test_export_boundaries_and_conflicting_duplicate(self):
        def sample(start, name="Example"):
            return json.dumps({"kind": "medicationDose", "uuid": SAMPLE, "start": start,
                               "medicationDose": {"medication": name}}) + "\n"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "export.ndjson"
            path.write_text(sample(999) + sample(1000) + sample(2000))
            self.assertEqual(list(repair.read_export(path, self.scope)), [(SAMPLE, 1000000)])
            path.write_text(sample(1500) + sample(1500, "Conflicting"))
            with self.assertRaises(ValueError):
                repair.read_export(path, self.scope)

    def test_payload_uses_copy_csv_and_does_not_interpolate_sql(self):
        plan = self.plan()
        hostile = "name'); DROP TABLE users;--\n\\.\n\"quoted\""
        plan["changes"][0]["after"]["medication"] = hostile
        sql = repair.payload_sql(plan)
        import csv
        import io
        encoded = sql.split("COPY repair_input FROM STDIN CSV;\n", 1)[1].rsplit("\\.\n", 1)[0]
        self.assertEqual(json.loads(next(csv.reader(io.StringIO(encoded)))[0]), plan)

    def test_apply_locks_and_checks_both_originals_before_update(self):
        sql = repair.apply_sql(self.plan())
        self.assertLess(sql.index("FOR UPDATE"), sql.index("RAISE EXCEPTION"))
        self.assertLess(sql.index("RAISE EXCEPTION"), sql.index("UPDATE public"))
        self.assertIn("m.medication IS NOT DISTINCT FROM", sql)
        self.assertIn("m.medication_id IS NOT DISTINCT FROM", sql)
        self.assertIn("m.start_ts = (TIMESTAMPTZ", sql)
        self.assertIn("m.user_id = r.user_id", sql)
        self.assertEqual(sql.count("m.start_ts >= to_timestamp(1000::numeric / 1000)"), 3)
        readonly = repair.query_sql(self.scope)
        self.assertLess(readonly.index("CREATE TEMP TABLE"), readonly.index("BEGIN READ ONLY"))
        self.assertLess(readonly.index("COPY repair_input"), readonly.index("BEGIN READ ONLY"))

    def test_psql_credentials_and_health_values_not_in_argv(self):
        with patch.object(repair.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = ""
            repair.psql(repair.apply_sql(self.plan()))
            argv = run.call_args.args[0]
            self.assertNotIn("Example", str(argv))
            self.assertEqual(argv, ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"])

    def test_default_cli_is_read_only_and_plan_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            export = Path(directory) / "export.ndjson"
            plan = Path(directory) / "plan.json"
            export.write_text(json.dumps({"kind": "medicationDose", "uuid": SAMPLE, "start": 1500,
                                          "medicationDose": {"medication": "Example"}}) + "\n")
            argv = ["repair.py", "--export", str(export), "--user", USER, "--start-ms", "1000",
                    "--end-ms", "2000", "--plan", str(plan)]
            output = io.StringIO()
            with patch.object(repair.sys, "argv", argv), patch.object(repair, "psql") as database, \
                    patch.object(repair.sys, "stdout", output):
                database.return_value = json.dumps(self.row) + "\n"
                self.assertEqual(repair.main(), 0)
                self.assertIn("BEGIN READ ONLY", database.call_args.args[0])
                self.assertNotIn("UPDATE public", database.call_args.args[0])
                self.assertEqual(os.stat(plan).st_mode & 0o777, 0o600)
                self.assertNotIn("Example", output.getvalue())
                with patch.object(repair.sys, "stderr", io.StringIO()):
                    self.assertEqual(repair.main(), 1)  # Never overwrite a reviewed plan.

    def test_database_failure_does_not_repeat_sensitive_diagnostics(self):
        with patch.object(repair.subprocess, "run") as run:
            run.return_value.returncode = 1
            run.return_value.stderr = "private health value and password"
            with self.assertRaises(ValueError) as error:
                repair.psql("SELECT 1")
            self.assertNotIn("private health value", str(error.exception))


if __name__ == "__main__":
    unittest.main()
