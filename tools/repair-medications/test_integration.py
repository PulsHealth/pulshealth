"""Explicit opt-in only: mutates synthetic fixtures in an already migrated scratch DB."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

TOOL = Path(__file__).with_name("repair.py")
spec = importlib.util.spec_from_file_location("repair_integration", TOOL)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


@unittest.skipUnless(os.environ.get("PULS_MEDICATION_REPAIR_INTEGRATION_TESTS") == "1",
                     "Set PULS_MEDICATION_REPAIR_INTEGRATION_TESTS=1 for a migrated scratch database")
class RepairDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for variable in ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER"):
            if not os.environ.get(variable):
                raise RuntimeError("Explicit integration opt-in requires libpq connection variables")
        if not shutil.which("psql"):
            raise RuntimeError("Explicit integration opt-in requires psql")

    def setUp(self):
        self.user, self.other = str(uuid.uuid4()), str(uuid.uuid4())
        self.samples = [str(uuid.uuid4()) for _ in range(4)]
        self.identity = str(uuid.uuid4())
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.directory = Path(self.scratch.name)
        self.addCleanup(self.clean_fixtures)
        repair.psql(f"INSERT INTO public.users (id) VALUES ('{self.user}'), ('{self.other}');")
        for index, sample in enumerate(self.samples):
            user = self.other if index == 2 else self.user
            label = "Keep existing name" if index == 1 else "<HKHealthConceptIdentifier: 0xabc>"
            microseconds = 124 if index == 3 else 123
            repair.psql(f"""INSERT INTO public.medication_dose_events
                (uuid, user_id, start_ts, end_ts, medication, status, dose_quantity, dose_unit, metadata)
                VALUES ('{sample}', '{user}', '2024-06-10 09:46:40.000{microseconds:03d}+00',
                    '2024-06-10 09:46:40.000{microseconds:03d}+00', '{label}', 'taken', 7,
                    'mg', '{{"fixture":true}}');""")
        self.export = self.directory / "export.ndjson"
        self.label = "Synthetic 'quoted' name\n\\.\n\"CSV quotes\""
        self.export.write_text("".join(json.dumps({
            "uuid": sample, "kind": "medicationDose", "start": 1718012800000.123,
            "medicationDose": {"medication": self.label, "medicationID": self.identity},
        }) + "\n" for sample in self.samples))

    def clean_fixtures(self):
        repair.psql(f"""BEGIN;
            DELETE FROM public.medication_dose_events WHERE user_id IN ('{self.user}', '{self.other}');
            DELETE FROM public.users WHERE id IN ('{self.user}', '{self.other}'); COMMIT;""")

    def snapshot(self):
        return json.loads(repair.psql(f"""SELECT jsonb_agg(to_jsonb(m) ORDER BY uuid)
            FROM public.medication_dose_events m WHERE user_id IN ('{self.user}', '{self.other}');"""))

    def cli(self, *arguments, expected=0):
        result = subprocess.run([sys.executable, str(TOOL), *map(str, arguments)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        self.assertNotIn(self.label, result.stdout + result.stderr)
        return result

    def plan(self, name):
        path = self.directory / name
        self.cli("--export", self.export, "--user", self.user,
                 "--start-ms", 1718012800000, "--end-ms", 1718012801000, "--plan", path)
        return path, json.loads(path.read_text())

    def test_plan_apply_exact_scope_and_drift_rollback(self):
        before = self.snapshot()
        path, plan = self.plan("review.json")
        self.assertEqual(self.snapshot(), before, "Planning must leave the database unchanged")
        self.assertEqual({row["uuid"] for row in plan["changes"]}, set(self.samples[:2]))
        self.assertEqual({row["start_us"] for row in plan["changes"]}, {1718012800000123})
        self.cli("--apply", path)
        after = self.snapshot()
        old_by_id = {row["uuid"]: row for row in before}
        new_by_id = {row["uuid"]: row for row in after}
        for index, sample in enumerate(self.samples):
            old, new = old_by_id[sample], new_by_id[sample]
            if index >= 2:
                self.assertEqual(new, old, "Other user and neighboring microsecond must stay unchanged")
                continue
            self.assertEqual(new["medication_id"], self.identity)
            self.assertEqual(new["medication"], "Keep existing name" if index == 1 else self.label)
            for field in old.keys() - {"medication", "medication_id"}:
                self.assertEqual(new[field], old[field])
        _, second = self.plan("after.json")
        self.assertEqual(second["changes"], [])
        self.cli("--apply", path, expected=1)
        self.assertEqual(self.snapshot(), after)

        # Create another concrete plan, then drift one row. Neither may be updated.
        repair.psql(f"""UPDATE public.medication_dose_events SET medication_id = NULL,
            medication = CASE WHEN uuid = '{self.samples[0]}' THEN '<HKHealthConceptIdentifier: 0xabc>'
                              ELSE 'Keep existing name' END
            WHERE user_id = '{self.user}' AND uuid IN ('{self.samples[0]}', '{self.samples[1]}');""")
        drift_path, drift_plan = self.plan("before-drift.json")
        self.assertEqual(len(drift_plan["changes"]), 2)
        repair.psql(f"""UPDATE public.medication_dose_events SET medication = 'Concurrent edit'
            WHERE user_id = '{self.user}' AND uuid = '{self.samples[1]}';""")
        drifted = self.snapshot()
        self.cli("--apply", drift_path, expected=1)
        self.assertEqual(self.snapshot(), drifted, "One drifted row must roll back the entire repair")


if __name__ == "__main__":
    unittest.main()
