#!/usr/bin/env bash
# test-migrate.sh — the contract of server/db/migrate.sh, against a throwaway
# TimescaleDB container. CI's "Schema migrations" job runs it; it runs the same
# way on any machine with Docker:
#
#   server/db/test-migrate.sh
#
# migrate.sh is the script that can silently corrupt a database (apply a file
# twice, skip one, half-apply one), so this pins every rule server/README.md
# ("Schema migrations") states, each against its own fresh database:
#
#   real       the repository's own migrations: fresh, again, refused without
#              schema_migrations until `baseline`, then only the re-runnable
#              files; an edited applied file is refused; schema assertions
#   order      lexical (C collation) order across .sql and .sh files; the
#              recorded checksum is the file's SHA-256; *.sh files run on every
#              invocation and are never recorded
#   rerun      a `-- puls:rerun` file is re-applied when (and only when) it
#              changes; a one-shot file that changed is refused, as is a
#              recorded file that went missing — before anything runs
#   atomic     a failing one-shot file leaves neither its effects nor a record,
#              and is applied on the next run once fixed
#   notxn      `-- puls:no-transaction` runs a statement no transaction block
#              allows; without the marker the same file fails and leaves nothing
#   baseline   a schema without schema_migrations is refused until `baseline`,
#              which records without executing; `baseline` refuses a database
#              with nothing to adopt and one that is already tracked
#   lock       a run waits for the advisory lock; two concurrent runs apply a
#              non-idempotent file exactly once
#
# migrate.sh runs inside the image the compose `migrate` service uses, so
# nothing depends on the host's psql. Set KEEP_DB=1 to leave the container up.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
server_dir=$(cd "$here/.." && pwd)

DB_IMAGE=${DB_IMAGE:-$(grep -oE -m1 'timescale/timescaledb-ha:[A-Za-z0-9._-]+' "$server_dir/docker-compose.yml")}
net=puls-migrate-test-$$
db=puls-migrate-test-db-$$
work=$(mktemp -d "${TMPDIR:-/tmp}/puls-migrate-test.XXXXXX")
# Docker Desktop shares /private, not the /var/folders symlink in front of it.
work=$(cd "$work" && pwd -P)

cleanup() {
  if [[ ${KEEP_DB:-} != 1 ]]; then
    docker rm -f "$db" >/dev/null 2>&1 || true
    docker network rm "$net" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
group() { if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::group::$*"; else echo "== $*"; fi; }
endgroup() { if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::endgroup::"; fi; }

echo "using $DB_IMAGE"
docker network create "$net" >/dev/null
docker run -d --name "$db" --network "$net" -e POSTGRES_PASSWORD=ci-secret "$DB_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$db" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$db" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1 \
  || { docker logs "$db"; fail "database did not become ready"; }

# sql <database> <statement>: one value per line, unaligned.
sql() {
  docker exec "$db" psql -X -U postgres -d "$1" -tA -v ON_ERROR_STOP=1 -c "$2"
}
newdb() { sql postgres "CREATE DATABASE $1" >/dev/null; }

# migrate <database> <migrations dir> [args...]: migrate.sh as the compose
# service runs it, against one database of the throwaway server.
migrate() {
  local database=$1 dir=$2 name=(); shift 2
  [[ -z ${MIGRATE_NAME:-} ]] || name=(--name "$MIGRATE_NAME")
  docker run --rm ${name[@]+"${name[@]}"} --network "$net" \
    -v "$here/migrate.sh:/puls/migrate.sh:ro" \
    -v "$dir:/puls/migrations:ro" \
    -e PGHOST="$db" -e PGPASSWORD=ci-secret -e MIGRATIONS_DIR=/puls/migrations \
    -e POSTGRES_DB="$database" -e PGOPTIONS="-c client_min_messages=warning" \
    -e GRAFANA_DB_PASSWORD=ci-grafana -e API_DB_PASSWORD=ci-api \
    -e INGEST_DB_PASSWORD=ci-ingest -e WEB_DB_PASSWORD=ci-web \
    -e PULS_TIME_ZONE=Europe/Berlin \
    --entrypoint bash "$DB_IMAGE" /puls/migrate.sh "$@"
}

# PGOPTIONS only quiets the synthetic files' "already exists, skipping"
# NOTICEs.
# expect <want> <database> <dir> [args...]: the run succeeds and its output
# carries <want>; prints the summary line.
expect() {
  local want=$1 out status=0; shift
  out=$(migrate "$@" 2>&1) || status=$?
  [[ $status -eq 0 ]] || { echo "$out"; fail "migrate exited with status $status (wanted: $want)"; }
  grep '^migrate: ' <<<"$out" | tail -n 1
  grep -qF -- "$want" <<<"$out" || { echo "$out"; fail "expected: $want"; }
}

# refuse <want> <database> <dir> [args...]: the run fails, saying <want>.
refuse() {
  local want=$1 out status=0; shift
  out=$(migrate "$@" 2>&1) || status=$?
  [[ $status -ne 0 ]] || { echo "$out"; fail "migrate must refuse (wanted: $want)"; }
  grep -qF -- "$want" <<<"$out" || { echo "$out"; fail "refused, but without: $want"; }
  echo "refused: $want"
}

eq() { [[ $1 == "$2" ]] || fail "$3: got '$1', want '$2'"; }

# A migrations directory of synthetic files. Every file logs its own name to
# the `log` table, so the table's id order is the order files ran in.
mkdir_migrations() { mkdir -p "$work/$1"; printf '%s' "$work/$1"; }
sql_file() { # sql_file <dir> <name> [marker]: logs its name; stdin appended
  {
    [[ -z ${3:-} ]] || echo "-- puls:$3"
    echo "CREATE TABLE IF NOT EXISTS log (id serial PRIMARY KEY, name text NOT NULL);"
    echo "INSERT INTO log (name) VALUES ('$2');"
    cat
  } >"$1/$2"
}
sh_file() { # sh_file <dir> <name>: logs its name through its own psql session
  cat >"$1/$2" <<EOF
#!/usr/bin/env bash
set -euo pipefail
psql -X -q -w -v ON_ERROR_STOP=1 -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" \\
  -c "CREATE TABLE IF NOT EXISTS log (id serial PRIMARY KEY, name text NOT NULL)" \\
  -c "INSERT INTO log (name) VALUES ('$2')"
EOF
}
log_of() { sql "$1" "SELECT string_agg(name, ' ' ORDER BY id) FROM log"; }
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-64; }

# --- real: the repository's migrations ---------------------------------------
group "real: the repository's migrations, fresh, again, baselined, edited"
real=$server_dir/db/migrations
sql_files=("$real"/*.sql)
sh_files=("$real"/*.sh)
sqls=${#sql_files[@]}
shs=${#sh_files[@]}
reruns=$( (grep -lx -- '-- puls:rerun' "$real"/*.sql || true) | wc -l | tr -d ' ')
expect "$sqls applied, 0 rerun, 0 skipped, $shs script(s) ran" postgres "$real"
expect "0 applied, 0 rerun, $sqls skipped, $shs script(s) ran" postgres "$real"
sql postgres "DROP TABLE schema_migrations"
refuse "no schema_migrations records" postgres "$real"
expect "baseline complete: $sqls file(s) recorded" postgres "$real" baseline
eq "$(sql postgres 'SELECT count(*) FROM schema_migrations')" "$sqls" "baselined rows"
expect "0 applied, $reruns rerun, $((sqls - reruns)) skipped, $shs script(s) ran" postgres "$real"
expect "0 applied, 0 rerun, $sqls skipped, $shs script(s) ran" postgres "$real"
cp -R "$real" "$work/edited"
echo "-- edited" >>"$work/edited/001_schema.sql"
refuse "with different content" postgres "$work/edited"
eq "$(sql postgres 'SELECT puls_time_zone()')" "Europe/Berlin" "puls_time_zone()"
sql postgres 'SELECT count(*) FROM metric_daily' >/dev/null
[[ $(sql postgres 'SELECT count(*) FROM category_labels') -gt 0 ]] || fail "category_labels is empty"
eq "$(sql postgres "SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('grafana','api_reader','ingest')")" \
  "api_reader,grafana,ingest" "scoped roles"
# The web viewer's accounts-mode role (WEB_DB_PASSWORD), with the per-user
# views first on its search_path; its isolation is proven by
# web/lib/webapp.integration.test.ts in db-integration.
eq "$(sql postgres "SELECT rolcanlogin::text || ' ' || array_to_string(rolconfig, ';') FROM pg_roles WHERE rolname = 'web_app'")" \
  "true search_path=web, public" "web_app role"
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < "$here/tests/recording_quality.sql" >/dev/null
echo "recording quality: enum decoding, calendar boundaries, DST and user scope passed"
endgroup

# --- order: lexical order, checksums, scripts every run ----------------------
group "order: C-collation order, recorded checksums, *.sh every run"
newdb c_order
d=$(mkdir_migrations order)
sql_file "$d" 001_init.sql </dev/null
sh_file "$d" 002_script.sh
# In C collation uppercase sorts first; most locales put 003_a first.
sql_file "$d" 003_a.sql </dev/null
sql_file "$d" 003_Z.sql </dev/null
sql_file "$d" 010_ten.sql </dev/null
sql_file "$d" 009_nine.sql </dev/null
expect "5 applied, 0 rerun, 0 skipped, 1 script(s) ran" c_order "$d"
eq "$(log_of c_order)" "001_init.sql 002_script.sh 003_Z.sql 003_a.sql 009_nine.sql 010_ten.sql" "first run order"
for f in 001_init.sql 003_Z.sql 003_a.sql 009_nine.sql 010_ten.sql; do
  eq "$(sql c_order "SELECT checksum FROM schema_migrations WHERE filename = '$f'")" "$(sha "$d/$f")" "$f checksum"
done
eq "$(sql c_order "SELECT count(*) FROM schema_migrations WHERE filename LIKE '%.sh'")" 0 "recorded scripts"
expect "0 applied, 0 rerun, 5 skipped, 1 script(s) ran" c_order "$d"
eq "$(sql c_order "SELECT count(*) FROM log WHERE name = '002_script.sh'")" 2 "script runs after two invocations"
eq "$(sql c_order "SELECT count(*) FROM log WHERE name <> '002_script.sh'")" 5 "one-shot files applied once"
# A file that is not a migration is a mistake, not something to skip.
touch "$d/README.md"
refuse "unexpected file" c_order "$d"
rm "$d/README.md"
endgroup

# --- rerun: puls:rerun, edited and missing one-shot files ---------------------
group "rerun: re-applied on change only; edited or missing applied files refused"
newdb c_rerun
d=$(mkdir_migrations rerun)
sql_file "$d" 001_init.sql </dev/null
sql_file "$d" 002_view.sql rerun <<<"CREATE OR REPLACE FUNCTION answer() RETURNS int LANGUAGE sql AS 'SELECT 1';"
sql_file "$d" 003_after.sql </dev/null
expect "3 applied, 0 rerun, 0 skipped, 0 script(s) ran" c_rerun "$d"
expect "0 applied, 0 rerun, 3 skipped, 0 script(s) ran" c_rerun "$d"
eq "$(sql c_rerun "SELECT count(*) FROM log WHERE name = '002_view.sql'")" 1 "unchanged rerun file applied once"
sql_file "$d" 002_view.sql rerun <<<"CREATE OR REPLACE FUNCTION answer() RETURNS int LANGUAGE sql AS 'SELECT 2';"
expect "0 applied, 1 rerun, 2 skipped, 0 script(s) ran" c_rerun "$d"
eq "$(sql c_rerun 'SELECT answer()')" 2 "rerun file's new content"
eq "$(sql c_rerun "SELECT checksum FROM schema_migrations WHERE filename = '002_view.sql'")" "$(sha "$d/002_view.sql")" "rerun checksum updated"
expect "0 applied, 0 rerun, 3 skipped, 0 script(s) ran" c_rerun "$d"
# An edited one-shot file: refused, and its record keeps the original sum.
before=$(sql c_rerun "SELECT checksum FROM schema_migrations WHERE filename = '003_after.sql'")
echo "-- edited" >>"$d/003_after.sql"
refuse "003_after.sql was applied" c_rerun "$d"
eq "$(sql c_rerun "SELECT checksum FROM schema_migrations WHERE filename = '003_after.sql'")" "$before" "refused file's checksum"
# A recorded file that is gone (renamed, deleted): refused before any file
# runs, so the rerun file below is not applied either.
# (A copy, not a rename in place: Docker Desktop's file sharing can keep
# answering stat() for a path that was just renamed away.)
cp -R "$d" "$work/renamed"
d=$work/renamed
mv "$d/003_after.sql" "$d/004_renamed.sql"
sql_file "$d" 002_view.sql rerun <<<"CREATE OR REPLACE FUNCTION answer() RETURNS int LANGUAGE sql AS 'SELECT 3';"
logged=$(log_of c_rerun)
refuse "003_after.sql is recorded in schema_migrations but is not in" c_rerun "$d"
eq "$(log_of c_rerun)" "$logged" "nothing ran before the missing-file refusal"
eq "$(sql c_rerun 'SELECT answer()')" 2 "rerun file untouched by a refused run"
endgroup

# --- atomic: a failing one-shot file ------------------------------------------
group "atomic: a failing file leaves nothing behind and is retried"
newdb c_atomic
d=$(mkdir_migrations atomic)
sql_file "$d" 001_init.sql </dev/null
sql_file "$d" 002_broken.sql <<<"CREATE TABLE half_done (x int); SELECT 1/0;"
sql_file "$d" 003_later.sql </dev/null
refuse "002_broken.sql failed" c_atomic "$d"
eq "$(sql c_atomic "SELECT to_regclass('half_done') IS NULL")" t "the failed file's table rolled back"
eq "$(sql c_atomic "SELECT string_agg(filename, ' ' ORDER BY filename) FROM schema_migrations")" "001_init.sql" "records after a failure"
eq "$(log_of c_atomic)" "001_init.sql" "nothing after the failed file ran"
sql_file "$d" 002_broken.sql <<<"CREATE TABLE half_done (x int);"
expect "2 applied, 0 rerun, 1 skipped, 0 script(s) ran" c_atomic "$d"
endgroup

# --- notxn: puls:no-transaction ------------------------------------------------
group "notxn: a statement no transaction block allows"
newdb c_notxn
d=$(mkdir_migrations notxn)
sql_file "$d" 001_init.sql </dev/null
# VACUUM, like refresh_continuous_aggregate, cannot run inside a transaction.
sql_file "$d" 002_vacuum.sql <<<"CREATE TABLE vacuumed (x int); VACUUM vacuumed;"
refuse "002_vacuum.sql failed" c_notxn "$d"
eq "$(sql c_notxn "SELECT to_regclass('vacuumed') IS NULL")" t "unmarked file rolled back"
sql_file "$d" 002_vacuum.sql no-transaction <<<"CREATE TABLE IF NOT EXISTS vacuumed (x int); VACUUM vacuumed;"
expect "1 applied, 0 rerun, 1 skipped, 0 script(s) ran" c_notxn "$d"
eq "$(sql c_notxn "SELECT checksum FROM schema_migrations WHERE filename = '002_vacuum.sql'")" "$(sha "$d/002_vacuum.sql")" "no-transaction file recorded"
[[ -n $(sql c_notxn "SELECT last_vacuum FROM pg_stat_user_tables WHERE relname = 'vacuumed'") ]] \
  || fail "VACUUM did not run"
expect "0 applied, 0 rerun, 2 skipped, 0 script(s) ran" c_notxn "$d"
endgroup

# --- baseline: a schema from before the migrate service -----------------------
group "baseline: refused until baselined; baseline records without executing"
newdb c_baseline
d=$(mkdir_migrations baseline)
sql_file "$d" 001_init.sql </dev/null
sh_file "$d" 002_script.sh
sql_file "$d" 003_rerun.sql rerun </dev/null
sql_file "$d" 004_once.sql </dev/null
refuse "nothing to baseline" c_baseline "$d" baseline
# The PulsHealth schema's marker is public.users.
sql c_baseline "CREATE TABLE users (id uuid PRIMARY KEY)"
refuse "no schema_migrations records" c_baseline "$d"
eq "$(sql c_baseline "SELECT to_regclass('log') IS NULL")" t "nothing ran while refusing"
expect "baseline complete: 3 file(s) recorded" c_baseline "$d" baseline
eq "$(log_of c_baseline)" "002_script.sh" "baseline runs scripts and no .sql file"
eq "$(sql c_baseline "SELECT string_agg(filename || '=' || coalesce(checksum, 'null'), ' ' ORDER BY filename) FROM schema_migrations")" \
  "001_init.sql=$(sha "$d/001_init.sql") 003_rerun.sql=null 004_once.sql=$(sha "$d/004_once.sql")" "baselined records"
refuse "already has schema_migrations rows" c_baseline "$d" baseline
expect "0 applied, 1 rerun, 2 skipped, 1 script(s) ran" c_baseline "$d"
eq "$(log_of c_baseline)" "002_script.sh 002_script.sh 003_rerun.sql" "after baseline only the re-runnable file ran"
expect "0 applied, 0 rerun, 3 skipped, 1 script(s) ran" c_baseline "$d"
endgroup

# --- lock: the advisory lock serialises runs ----------------------------------
group "lock: a run waits for the lock; concurrent runs apply a file once"
newdb c_lock
d=$(mkdir_migrations lock)
sql_file "$d" 001_init.sql </dev/null
# Not idempotent, and slow enough that two unserialised runs would overlap.
sql_file "$d" 002_slow.sql <<<"SELECT pg_sleep(3); CREATE TABLE once_only (x int);"
# Hold migrate.sh's lock (pg_advisory_lock(int, int) on ('puls', 1)) for 6 s
# from another session; a run started meanwhile must wait it out. The holder
# carries the application_name every containerised run (bash is PID 1) used
# to mark its lock session with: a run must recognise its own session, not
# take another run's held lock for its own.
docker exec -e PGAPPNAME=puls-migrate-lock-1 "$db" psql -X -U postgres -d c_lock -q -o /dev/null \
  -c "SELECT pg_advisory_lock(1886743667, 1)" -c "SELECT pg_sleep(6)" &
holder=$!
for _ in $(seq 1 50); do
  [[ $(sql c_lock "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted") -ge 1 ]] && break
  sleep 0.2
done
started=$SECONDS
out=$(migrate c_lock "$d" 2>&1) || { echo "$out"; fail "migrate failed behind a held lock"; }
waited=$((SECONDS - started))
wait "$holder"
grep -qF "holds the migration lock" <<<"$out" || { echo "$out"; fail "no waiting message"; }
[[ $waited -ge 4 ]] || fail "migrate finished in ${waited}s while the lock was held for 6s"
grep '^migrate: done' <<<"$out"
eq "$(sql c_lock "SELECT count(*) FROM schema_migrations")" 2 "records after waiting"
# Two runs at once on a fresh database, three times over: one applies, the
# other waits and then finds the work recorded. Without the lock both would
# apply 002_slow.sql and the second CREATE TABLE would fail. Both run as PID 1
# in their containers, as the compose service and `docker compose run` do.
# A broken lock can also deadlock the pair, so each race has a deadline.
for race in 1 2 3; do
  newdb "c_race$race"
  MIGRATE_NAME="$db-race-a" migrate "c_race$race" "$d" >"$work/race1.log" 2>&1 & r1=$!
  MIGRATE_NAME="$db-race-b" migrate "c_race$race" "$d" >"$work/race2.log" 2>&1 & r2=$!
  for _ in $(seq 1 60); do
    kill -0 "$r1" 2>/dev/null || kill -0 "$r2" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$r1" 2>/dev/null || kill -0 "$r2" 2>/dev/null; then
    docker rm -f "$db-race-a" "$db-race-b" >/dev/null 2>&1 || true
    cat "$work/race1.log" "$work/race2.log"
    fail "concurrent runs still running after 60 s (race $race)"
  fi
  s1=0 s2=0
  wait "$r1" || s1=$?
  wait "$r2" || s2=$?
  [[ $s1 -eq 0 && $s2 -eq 0 ]] || { cat "$work/race1.log" "$work/race2.log"; fail "concurrent runs: exit $s1 and $s2"; }
  summaries=$(cat "$work/race1.log" "$work/race2.log" | grep -oE '[0-9]+ applied, [0-9]+ rerun, [0-9]+ skipped' | sort | tr '\n' '|')
  eq "$summaries" "0 applied, 0 rerun, 2 skipped|2 applied, 0 rerun, 0 skipped|" "concurrent run summaries ($race)"
  eq "$(sql "c_race$race" "SELECT count(*) FROM log WHERE name = '002_slow.sql'")" 1 "002_slow.sql applications ($race)"
  echo "race $race: $summaries"
done
endgroup

echo "migrate.sh contract: all scenarios passed"
