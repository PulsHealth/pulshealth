#!/usr/bin/env bash
# test-restore.sh — the restore drill, scripted: backup.sh → restore.sh on a
# running stack, proving every row survives. CI's stack smoke test runs it on
# synthetic data after `scripts/bootstrap.sh --build`; on any other machine:
#
#   scripts/bootstrap.sh --build && server/backup/test-restore.sh --scratch --build
#
# THIS DESTROYS THE STACK'S DATABASE (twice) and leaves a synthetic data set in
# it. --scratch is required to say the stack holds nothing you want; never
# point it at an install with real data. --build restores onto images built
# from the checkout (as restore.sh --build), for a stack started that way.
#
# What it checks:
#   0. restore.sh still encodes the TimescaleDB restore rules: the old schemas
#      dropped and the extension reinstalled before timescaledb_pre_restore(),
#      a single-threaded pg_restore, timescaledb_post_restore() after it.
#   1. Seeds ~20k quantity samples over six months, runs the columnstore
#      policies (compressing every chunk older than 30 days) and refreshes the quantity_rollups continuous
#      aggregate, so the dump carries compressed chunks and a materialization.
#   2. Takes a dump with the backup service (`make backup`).
#   3. A file that is not a dump is refused before anything is touched.
#   4. Restores into the live, since-modified database (the drop-public path).
#   5. Restores again into a wiped volume (the fresh-database path).
#   After each restore: the row count of every table in public and auth, the
#   compressed-chunk count, the continuous aggregate, metric_daily, the
#   extension version and schema_migrations are identical to the moment of
#   the dump; restore mode is off; migrate applied nothing; the product API
#   reads (api_reader's grants are back) and ingest writes (ingest's are).
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
server_dir=$root/server
env_file=$server_dir/.env

scratch=0 build=0
for arg in "$@"; do
  case $arg in
    --scratch) scratch=1 ;;
    --build) build=1 ;;
    *) echo "usage: $0 --scratch [--build]" >&2; exit 2 ;;
  esac
done
[[ $scratch == 1 ]] || { echo "refusing to run without --scratch: this destroys the stack's database" >&2; exit 2; }
[[ -f $env_file ]] || { echo "$env_file does not exist; run scripts/bootstrap.sh first" >&2; exit 2; }

fail() { echo "FAIL: $*" >&2; exit 1; }
group() { if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::group::$*"; else echo "== $*"; fi; }
endgroup() { if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::endgroup::"; fi; }
env_get() { sed -n "s/^$1=//p" "$env_file" | tail -n 1; }
# The synthetic samples' type: a real catalog type, so the product API serves
# it like any other. Step counts the corpus may carry are counted with them.
drill_type=HKQuantityTypeIdentifierStepCount

compose_files=(-f "$server_dir/docker-compose.yml")
[[ $build == 0 ]] || compose_files+=(-f "$server_dir/compose.build.yml")
compose() { docker compose --project-directory "$server_dir" "${compose_files[@]}" "$@"; }
backup_compose() { docker compose --project-directory "$server_dir" --profile backup -f "$server_dir/docker-compose.yml" "$@"; }
restore_flags=(--yes)
[[ $build == 0 ]] || restore_flags+=(--build)
restore() { "$server_dir/backup/restore.sh" "${restore_flags[@]}" "$@"; }
sql() { compose exec -T db psql -X -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c "$1"; }

wait_healthy() {
  local states
  for _ in $(seq 1 90); do
    states=$(compose ps --format '{{.Service}} {{.State}} {{.Health}}')
    if [[ -n $states ]] && ! grep -qvE ' running( healthy)? *$' <<<"$states"; then
      return 0
    fi
    sleep 2
  done
  echo "$states" >&2
  fail "services did not become healthy"
}

# Everything a restore must bring back, one line per fact.
snapshot() {
  sql "
    SELECT table_schema || '.' || table_name || ' rows=' ||
           (xpath('/row/c/text()', query_to_xml(
              format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
    FROM information_schema.tables
    WHERE table_schema IN ('public', 'auth') AND table_type = 'BASE TABLE'
    ORDER BY 1"
  sql "SELECT 'quantity_rollups rows=' || count(*) || ' sum=' || coalesce(round(sum(sum_value)::numeric, 3), 0) FROM quantity_rollups"
  sql "SELECT 'metric_daily rows=' || count(*) FROM metric_daily"
  sql "SELECT 'compressed chunks=' || count(*) FILTER (WHERE is_compressed) || ' of ' || count(*) FROM timescaledb_information.chunks"
  sql "SELECT 'hypertables=' || string_agg(hypertable_name, ',' ORDER BY hypertable_name) FROM timescaledb_information.hypertables"
  sql "SELECT 'continuous aggregates=' || string_agg(view_name, ',' ORDER BY view_name) FROM timescaledb_information.continuous_aggregates"
  sql "SELECT 'drill samples=' || count(*) || ' sum=' || round(sum(value)::numeric, 3) FROM quantity_samples q JOIN sample_types t USING (type_id) WHERE t.identifier = '$drill_type'"
  sql "SELECT 'extension timescaledb=' || extversion FROM pg_extension WHERE extname = 'timescaledb'"
  sql "SELECT 'schema_migrations=' || md5(string_agg(filename || ':' || coalesce(checksum, ''), ',' ORDER BY filename)) FROM schema_migrations"
}

check_restored() { # check_restored <label>
  wait_healthy
  local after
  after=$(snapshot)
  if [[ $after != "$before" ]]; then
    diff <(echo "$before") <(echo "$after") || true
    fail "$1: the restored database differs from the dump"
  fi
  echo "$1: $(wc -l <<<"$after" | tr -d ' ') facts identical, e.g. $(grep -m1 '^drill samples' <<<"$after")"
  [[ $(sql "SHOW timescaledb.restoring") == off ]] || fail "$1: timescaledb.restoring is still on"
  # The schema came from the dump, so migrate only re-ran the role and zone
  # scripts (which put back what --no-privileges skipped).
  local done_line
  done_line=$(compose logs --no-color migrate | grep -E 'migrate: done on ' | tail -n 1)
  echo "${done_line#*| }"
  grep -qE ': 0 applied, 0 rerun, [0-9]+ skipped' <<<"$done_line" \
    || { compose logs --no-color migrate | tail -n 20; fail "$1: migrate applied files after a restore"; }
  # api_reader's grants: the product API reads the restored rows.
  local body
  body=$(curl -fsS -H "Authorization: Bearer $(env_get PULS_API_TOKEN)" \
    "http://127.0.0.1:8081/v1/samples?type=$drill_type&start=$(( ($(date +%s) - 10 * 86400) * 1000 ))&end=$(( $(date +%s) * 1000 ))") \
    || fail "$1: the product API could not read after the restore"
  [[ $(jq '.samples | length' <<<"$body") -ge 1 ]] || fail "$1: the product API returned no drill samples: $body"
  # ingest's grants: a new sample is accepted.
  local batch uuid now resp
  batch=$(uuidgen | tr '[:upper:]' '[:lower:]'); uuid=$(uuidgen | tr '[:upper:]' '[:lower:]'); now=$(( $(date +%s) * 1000 ))
  resp=$(printf '%s\n%s\n' \
    "{\"batchID\":\"$batch\",\"deviceID\":\"restore-test\",\"type\":\"HKQuantityTypeIdentifierHeartRate\",\"reason\":\"manual\",\"exportedAt\":$now,\"schemaVersion\":1,\"clientVersion\":\"restore-test\",\"sampleCount\":1,\"deletionCount\":0}" \
    "{\"uuid\":\"$uuid\",\"type\":\"HKQuantityTypeIdentifierHeartRate\",\"kind\":\"quantity\",\"start\":$now,\"end\":$now,\"value\":61,\"unit\":\"count/min\"}" \
    | curl -fsS -X POST http://127.0.0.1:8080/v1/batches \
        -H "Authorization: Bearer $(env_get PULS_TOKEN)" -H "Content-Type: application/x-ndjson" \
        -H "X-Puls-Protocol: 1" -H "X-Batch-ID: $batch" --data-binary @-) \
    || fail "$1: ingest refused a batch after the restore"
  [[ $(jq '.accepted' <<<"$resp") == 1 ]] || fail "$1: ingest did not accept the new sample: $resp"
  echo "$1: product API reads, ingest writes"
}

group "0. restore.sh encodes the TimescaleDB restore rules"
rs=$server_dir/backup/restore.sh
# line <text>: the first line of code (not comment) carrying <text>.
line() { awk -v want="$1" '!/^[[:space:]]*#/ && index($0, want) { print NR; exit }' "$rs"; }
l_web=$(line 'DROP SCHEMA IF EXISTS web CASCADE')
l_auth=$(line 'DROP SCHEMA IF EXISTS auth CASCADE')
l_drop=$(line 'DROP SCHEMA IF EXISTS public CASCADE')
l_ext=$(line 'CREATE EXTENSION IF NOT EXISTS timescaledb')
l_pre=$(line 'SELECT timescaledb_pre_restore()')
l_restore=$(line 'pg_restore --no-owner')
l_post=$(line 'SELECT timescaledb_post_restore()')
for v in l_web l_auth l_drop l_ext l_pre l_restore l_post; do
  [[ -n ${!v} ]] || fail "restore.sh: step $v not found"
done
(( l_web < l_drop && l_auth < l_drop && l_drop < l_ext && l_ext < l_pre && l_pre < l_restore && l_restore < l_post )) \
  || fail "restore.sh: steps out of order (web $l_web, auth $l_auth, drop public $l_drop, extension $l_ext, pre_restore $l_pre, pg_restore $l_restore, post_restore $l_post)"
if grep -E '^[^#]*pg_restore' "$rs" | grep -qE '(^|[[:space:]])(-j|--jobs)'; then
  fail "restore.sh: pg_restore must never run in parallel (-j/--jobs)"
fi
echo "drop web/auth/public → extension → pre_restore → single-threaded pg_restore → post_restore"
endgroup

group "1. seed synthetic data: compressed chunks and a continuous aggregate"
wait_healthy
sql "INSERT INTO sample_types (identifier, kind, unit) VALUES ('$drill_type', 'quantity', 'count')
     ON CONFLICT (identifier) DO NOTHING" >/dev/null
sql "INSERT INTO quantity_samples (uuid, type_id, start_ts, end_ts, value)
     SELECT gen_random_uuid(), t.type_id, ts, ts + interval '1 minute', (g % 97) + 0.25
     FROM sample_types t, generate_series(1, 20000) g,
          LATERAL (SELECT now() - g * interval '13 minutes' - interval '1 hour' AS ts) s
     WHERE t.identifier = '$drill_type'" >/dev/null
# Run every columnstore policy now (quantity_samples, and the corpus's old
# workout_series_points chunk), as their schedule would. Otherwise the job
# compresses a chunk right after a restore restarts the background workers,
# and the compressed-chunk count differs for a reason that is not the restore.
for job in $(sql "SELECT job_id FROM timescaledb_information.jobs WHERE proc_name = 'policy_compression'"); do
  sql "CALL run_job($job)" >/dev/null
done
sql "CALL refresh_continuous_aggregate('quantity_rollups', NULL, NULL)" >/dev/null
[[ $(sql "SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'quantity_samples' AND is_compressed") -ge 2 ]] \
  || fail "the seed produced fewer than two compressed chunks"
before=$(snapshot)
echo "$before" | grep -vE ' rows=0$'
endgroup

group "2. take a dump with the backup service"
backup_compose run --rm -T backup once
dump=$(backup_compose run --rm -T backup list | grep -oE 'puls-[0-9TZ]+\.dump' | sort | tail -n 1)
[[ -n $dump ]] || fail "the backup service wrote no dump"
echo "dump: $dump"
endgroup

group "3. a file that is not a dump is refused before anything is touched"
work=$(mktemp -d "${TMPDIR:-/tmp}/puls-restore-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
head -c 4096 /dev/urandom >"$work/not-a-dump.dump"
if out=$(restore "$work/not-a-dump.dump" 2>&1); then
  echo "$out"; fail "restore.sh accepted a file that is not a dump"
fi
grep -qF 'could not be read as a pg_dump custom-format archive' <<<"$out" || { echo "$out"; fail "unexpected refusal"; }
[[ $(snapshot) == "$before" ]] || fail "a refused restore changed the database"
wait_healthy
echo "refused, database and services untouched"
endgroup

group "4. restore over the live, since-modified database"
sql "DELETE FROM quantity_samples WHERE start_ts > now() - interval '1 day'" >/dev/null
sql "INSERT INTO users (id) VALUES (gen_random_uuid())" >/dev/null
[[ $(snapshot) != "$before" ]] || fail "the modification changed nothing"
restore "$dump"
check_restored "restore over a live database"
endgroup

group "5. restore into a wiped volume"
compose down
docker volume rm pulshealth_db_data
restore "$dump"
check_restored "restore into a wiped volume"
endgroup

"$server_dir/backup/test-restore-ledger.sh" --scratch

echo "restore drill: both restores reproduced the dump exactly; independent deletion receipts replayed safely"
