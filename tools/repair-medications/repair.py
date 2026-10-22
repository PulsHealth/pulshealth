#!/usr/bin/env python3
"""Plan, review, then explicitly repair medication labels and identities."""

import argparse
import csv
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid


BROKEN = re.compile(r"^<HKHealthConceptIdentifier:.*>$")


def missing_name(value):
    return value is None or not value.strip() or bool(BROKEN.fullmatch(value))


def identifier(value):
    if not isinstance(value, str):
        raise ValueError("Expected UUID string")
    return str(uuid.UUID(value))


def millis(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 253402300799999:
        raise ValueError("Expected nonnegative epoch milliseconds")
    return value


def source_microseconds(value):
    # Match ingest msToTime: float64 division, round nanoseconds, truncate to us.
    frac, seconds = math.modf(millis(value) / 1000.0)
    return int(seconds) * 1_000_000 + math.floor(frac * 1e9 + 0.5) // 1000


def validate_scope(scope):
    scope["user"] = identifier(scope["user"])
    if millis(scope["start"]) >= millis(scope["end"]):
        raise ValueError("Start must precede exclusive end")


def read_export(path, scope):
    samples = {}
    with path.open() as source:
        for line in source:
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("Expected NDJSON object")
            if row.get("kind") != "medicationDose":
                continue
            start = millis(row["start"])
            if not scope["start"] <= start < scope["end"]:
                continue
            key = (identifier(row["uuid"]), source_microseconds(start))
            dose = row["medicationDose"]
            if not isinstance(dose, dict):
                raise ValueError("Expected medication dose object")
            values = {"medication": dose.get("medication"), "medication_id": dose.get("medicationID")}
            for value in values.values():
                if value is not None and not isinstance(value, str):
                    raise ValueError("Medication values must be strings or null")
            if values["medication_id"]:
                values["medication_id"] = identifier(values["medication_id"])
            if key in samples and samples[key] != values:
                raise ValueError("Conflicting duplicate export sample")
            samples[key] = values
    return samples


def build_changes(rows, samples):
    changes = []
    for row in rows:
        key = (identifier(row["uuid"]), row["start_us"])
        current = samples.get(key)
        if current is None:
            continue
        old = {name: row[name] for name in ("medication", "medication_id")}
        new = dict(old)
        incoming_id = current["medication_id"]
        if old["medication_id"] and incoming_id and identifier(old["medication_id"]) != identifier(incoming_id):
            raise ValueError("Medication identity conflict; no plan written")
        if missing_name(old["medication"]) and not missing_name(current["medication"]):
            new["medication"] = current["medication"]
        if not old["medication_id"] and incoming_id:
            new["medication_id"] = incoming_id
        if old != new:
            changes.append({"uuid": key[0], "start_us": key[1], "before": old, "after": new})
    return changes


def validate_plan(plan):
    if not isinstance(plan, dict) or not isinstance(plan.get("changes"), list):
        raise ValueError("Expected repair plan object")
    if plan["version"] != 1:
        raise ValueError("Unsupported plan version")
    validate_scope(plan)
    keys = set()
    for row in plan["changes"]:
        key = (identifier(row["uuid"]), row["start_us"])
        if type(key[1]) is not int or key in keys or not plan["start"] * 1000 <= key[1] < plan["end"] * 1000:
            raise ValueError("Duplicate or out-of-scope repair")
        keys.add(key)
        before, after = row["before"], row["after"]
        for values in (before, after):
            if not isinstance(values, dict) or set(values) != {"medication", "medication_id"}:
                raise ValueError("Unexpected repair fields")
            if any(v is not None and not isinstance(v, str) for v in values.values()):
                raise ValueError("Invalid medication values")
        if after["medication_id"]:
            identifier(after["medication_id"])
        if before["medication"] != after["medication"] and (
            not missing_name(before["medication"]) or missing_name(after["medication"])
        ):
            raise ValueError("Repair may only replace missing or malformed names")
        if before["medication_id"] != after["medication_id"] and (
            before["medication_id"] or not after["medication_id"]
        ):
            raise ValueError("Repair may only fill a missing identity")


def payload_sql(payload):
    # COPY's CSV decoder handles quotes/backslashes; JSON never contains raw newlines.
    data = io.StringIO()
    csv.writer(data, lineterminator="\n", quoting=csv.QUOTE_ALL).writerow([json.dumps(payload)])
    return "CREATE TEMP TABLE repair_input (value jsonb);\nCOPY repair_input FROM STDIN CSV;\n" + data.getvalue() + "\\.\n"


SCOPE = """
m.user_id = (p.value->>'user')::uuid
AND m.start_ts >= to_timestamp((p.value->>'start')::numeric / 1000)
AND m.start_ts < to_timestamp((p.value->>'end')::numeric / 1000)
"""


def query_sql(scope):
    return payload_sql(scope) + "BEGIN READ ONLY;\n" + """
SELECT jsonb_build_object('uuid', m.uuid, 'start_us', (extract(epoch FROM m.start_ts)*1000000)::bigint,
                         'medication', m.medication, 'medication_id', m.medication_id)
FROM public.medication_dose_events m CROSS JOIN repair_input p WHERE """ + SCOPE + ";\nROLLBACK;\n"


def window_sql(plan):
    start, end = millis(plan["start"]), millis(plan["end"])
    return (f"m.start_ts >= to_timestamp({start!r}::numeric / 1000) "
            f"AND m.start_ts < to_timestamp({end!r}::numeric / 1000)")


def apply_sql(plan):
    window = window_sql(plan)
    return "BEGIN;\nSET LOCAL lock_timeout = '5s';\n" + payload_sql(plan) + """
CREATE TEMP TABLE repair_changes AS
SELECT r.*, (p.value->>'user')::uuid AS user_id
FROM repair_input p CROSS JOIN LATERAL jsonb_to_recordset(p.value->'changes')
 AS r(uuid uuid, start_us bigint, before jsonb, after jsonb);
-- Lock every exact reviewed record before checking either original value.
SELECT 1 FROM public.medication_dose_events m JOIN repair_changes r
 ON m.uuid = r.uuid AND m.start_ts = (TIMESTAMPTZ 'epoch' + (r.start_us / 1000000) * interval '1 second' + (r.start_us % 1000000) * interval '1 microsecond')
 AND m.user_id = r.user_id AND {window} FOR UPDATE OF m;
DO $guard$
BEGIN
 IF (SELECT count(*) FROM public.medication_dose_events m JOIN repair_changes r
 ON m.uuid = r.uuid AND m.start_ts = (TIMESTAMPTZ 'epoch' + (r.start_us / 1000000) * interval '1 second' + (r.start_us % 1000000) * interval '1 microsecond')
 AND m.user_id = r.user_id
 AND {window}
 AND m.medication IS NOT DISTINCT FROM (r.before->>'medication')
 AND m.medication_id IS NOT DISTINCT FROM (r.before->>'medication_id'))
 <> (SELECT count(*) FROM repair_changes) THEN
 RAISE EXCEPTION 'Reviewed rows changed or disappeared; transaction rolled back';
 END IF;
END $guard$;
UPDATE public.medication_dose_events m
SET medication = r.after->>'medication', medication_id = r.after->>'medication_id'
FROM repair_changes r
WHERE m.uuid = r.uuid AND m.start_ts = (TIMESTAMPTZ 'epoch' + (r.start_us / 1000000) * interval '1 second' + (r.start_us % 1000000) * interval '1 microsecond')
 AND m.user_id = r.user_id AND {window};
COMMIT;
""".format(window=window)


def psql(sql):
    # libpq reads PGHOST/PGDATABASE/PGUSER/PGPASSFILE, never a credential argument.
    result = subprocess.run(["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                            input=sql, text=True, capture_output=True, check=False)
    if result.returncode:
        # Database diagnostics may repeat health values or connection credentials.
        raise ValueError("Database operation failed; no health values logged. Check schema, role and connection privately")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path)
    parser.add_argument("--user")
    parser.add_argument("--start-ms", type=int)
    parser.add_argument("--end-ms", type=int)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--apply", type=Path, help="Apply an already reviewed plan (writes database)")
    args = parser.parse_args()
    try:
        if args.apply:
            if any(v is not None for v in (args.export, args.user, args.start_ms, args.end_ms, args.plan)):
                raise ValueError("--apply accepts only the reviewed plan path")
            plan = json.loads(args.apply.read_text())
            validate_plan(plan)
            psql(apply_sql(plan))
            print(f"Applied {len(plan['changes'])} reviewed repairs")
        else:
            if any(v is None for v in (args.export, args.user, args.start_ms, args.end_ms, args.plan)):
                raise ValueError("Planning requires --export, --user, --start-ms, --end-ms and --plan")
            scope = {"version": 1, "user": args.user, "start": args.start_ms, "end": args.end_ms}
            validate_scope(scope)
            samples = read_export(args.export, scope)
            rows = [json.loads(line) for line in psql(query_sql(scope)).splitlines() if line]
            scope["changes"] = build_changes(rows, samples)
            validate_plan(scope)
            fd = os.open(args.plan, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as output:
                json.dump(scope, output, indent=2)
                output.write("\n")
            print(f"Planned {len(scope['changes'])} repairs; database unchanged. Review the private plan before --apply")
    except (ValueError, KeyError, TypeError, OSError):
        # Inputs can contain health data; do not print exception values.
        print("Repair stopped. Check arguments, private input files, identities, schema and database connection.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
