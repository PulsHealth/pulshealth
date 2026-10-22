# Repair historical medication labels and identities

Older app builds wrote medication object descriptions such as
`<HKHealthConceptIdentifier: 0x…>` instead of useful labels. Raw sample inserts
are intentionally insert-only, so normal sync cannot repair existing rows.
This operator tool explicitly repairs matching events from a fresh on-device
NDJSON export. It never deletes events or resets sync anchors.

Requirements: Python 3, `psql`, a receiver with the nullable `medication_id`
column, and a fresh NDJSON export from an app build with medication identity
support. Export Medication Doses for the intended history window after granting
the required medication access. A server export of old data cannot reconstruct
missing identities. The tool cannot infer identities from labels or memory
addresses, and unavailable/unauthorized doses remain unrepaired.

1. Back up the database using the receiver's documented backup procedure.
2. Set libpq connection variables privately (`PGHOST`, `PGPORT`, `PGDATABASE`,
   `PGUSER`, and `PGPASSFILE`). Use a trusted connection and an operator role
   authorized for the intended user's rows, with SELECT and UPDATE permission
   on `public.medication_dose_events`. The normal API and ingest roles are not
   repair operators. Do not put a connection URL/password in command arguments.
3. Keep the export and resulting plan outside the repository. The export has no
   user identity: verify it belongs to the UUID you supply. Plan an explicit
   `[start-ms, end-ms)` epoch-millisecond window:

   ```sh
   python3 tools/repair-medications/repair.py \
     --export /private/path/medication-doses.ndjson \
     --user <user-uuid> --start-ms <start-ms> --end-ms <end-ms> \
     --plan /private/path/medication-repair.json
   ```

   This is the default dry run: it only reads the database and creates a new
   mode-0600 plan file. It refuses to overwrite an existing plan. Stdout shows
   counts only; the file contains sensitive sample identifiers, names and IDs.
4. Review that private JSON file. Every change carries its exact sample UUID,
   timestamp (`start_us`, integer epoch microseconds), original values and replacements. Fractional
   milliseconds from the export are normalized exactly as ingest does (float64
   seconds, rounded nanoseconds, then truncated microseconds); matching never
   rounds to a nearby millisecond or event. Check the user/window and
   proposed associations against the on-device export. Valid names and existing
   IDs are preserved; only missing/malformed names and missing IDs are eligible.
   IDs must be UUIDs, compared without regard to letter case. A conflicting existing
   identity aborts planning. Review can remove unwanted
   entries, but do not edit identities or other values to force a match.
5. Apply that reviewed file explicitly:

   ```sh
   python3 tools/repair-medications/repair.py --apply /private/path/medication-repair.json
   ```

   The tool locks exact user/UUID/timestamp matches and checks both original
   medication fields. A disappeared or changed row aborts the whole transaction.
   It changes only `medication` and `medication_id`. Reapplying a nonempty plan
   normally aborts because its original values no longer match. Re-plan after
   changes instead of editing the old `before` values. A connection failure
   during commit can leave the outcome unknown: read/re-plan before retrying.
6. Verify the affected rows privately, and run the same planning command with a
   new plan path; it should produce zero changes for the reviewed rows. Retain
   the reviewed plan with the backup for your private audit, then remove export
   copies according to your health-data retention preference.

Database diagnostics are suppressed because they can repeat sensitive values.
On failure, check the connection, migration, role, reviewed originals and export
privately; a failed apply never justifies a blanket re-sync or destructive reset.
No production database is touched by the test suite:

```sh
python3 -m unittest discover -s tools/repair-medications -p 'test_*.py'
```

The real PostgreSQL test skips unless explicitly enabled. On a **scratch**
database already initialized through `server/db/migrate.sh`, set the libpq
variables above and `PULS_MEDICATION_REPAIR_INTEGRATION_TESTS=1`, then run the
same command. It writes synthetic fixtures under randomly generated users,
checks read-only planning, exact fractional timestamp/user matching, apply,
preservation of valid/unrelated fields, repeat planning and transaction rollback
after drift, then removes only those fixtures. CI runs this opt-in test against
its migrated throwaway TimescaleDB. `medication_dose_events` is an ordinary
table, so compressed hypertable fixtures do not apply to this repair.
