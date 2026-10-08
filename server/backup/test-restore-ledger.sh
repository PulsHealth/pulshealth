#!/usr/bin/env bash
# Actual restore.sh with synthetic pre-deletion data and independent receipts.
# Own unique Compose project, no host ports, no access to existing volumes.
set -euo pipefail
[[ ${1:-} == --scratch ]] || { echo 'usage: test-restore-ledger.sh --scratch' >&2; exit 2; }
source_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
project="puls-ledger-drill-$$"
mkdir -p "$work/server/backup" "$work/ledger"
cp "$source_root/server/backup/restore.sh" "$work/server/backup/"
compose() { docker compose --project-directory "$work/server" "$@"; }
cleanup() { compose down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
cat > "$work/server/.env" <<'ENV'
POSTGRES_PASSWORD=synthetic-drill-password
PULS_BACKUP_STRICT_RETENTION=true
PULS_DELETION_LEDGER_DIR=/deletion-ledger
ENV
cat > "$work/server/docker-compose.yml" <<YAML
name: $project
x-image: &image timescale/timescaledb-ha:pg17.11-ts2.29.2
x-idle: &idle
  image: *image
  entrypoint: ["sleep", "infinity"]
  profiles: ["idle"]
services:
  db:
    image: *image
    environment:
      POSTGRES_PASSWORD: synthetic-drill-password
    volumes: ["data:/home/postgres/pgdata/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres && test -f /home/postgres/pgdata/data/postmaster.pid"]
      interval: 1s
      retries: 90
  migrate:
    image: *image
    entrypoint: ["bash", "/puls/migrate.sh"]
    environment:
      PGHOST: db
      POSTGRES_USER: postgres
      POSTGRES_DB: postgres
      PGPASSWORD: synthetic-drill-password
      MIGRATIONS_DIR: /puls/migrations
      GRAFANA_DB_PASSWORD: synthetic
      API_DB_PASSWORD: synthetic
      INGEST_DB_PASSWORD: synthetic
      WEB_DB_PASSWORD: synthetic
      PULS_TIME_ZONE: UTC
    volumes:
      - "$source_root/server/db:/puls:ro"
    depends_on:
      db: {condition: service_healthy}
  backup:
    image: *image
    profiles: ["backup"]
    entrypoint: ["bash", "/puls/backup.sh"]
    user: root
    environment:
      PGHOST: db
      PGUSER: postgres
      PGDATABASE: postgres
      PGPASSWORD: synthetic-drill-password
    volumes:
      - "$source_root/server/backup:/puls:ro"
      - "$work/ledger:/deletion-ledger:ro"
      - "backups:/backups"
  ingest: *idle
  api: *idle
  mcp: *idle
  web: *idle
  grafana: *idle
volumes:
  data:
  backups:
networks:
  default:
    internal: true
YAML
fail() { echo "FAIL: $*" >&2; exit 1; }
sql() { compose exec -T db psql -X -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c "$1"; }
restore() { "$work/server/backup/restore.sh" --yes --no-start --deletion-ledger-ready "$dump"; }
compose up -d --wait db >/dev/null
# Wait beyond initdb's temporary server; it can briefly satisfy pg_isready.
for _ in $(seq 1 90); do
  if compose logs db 2>&1 | grep -q 'PostgreSQL init process complete'; then break; fi
  sleep 1
done
sleep 2
compose run --rm -T migrate > "$work/migrate.log" 2>&1 || { tail -30 "$work/migrate.log"; fail 'migration failed'; }
user_id=11111111-1111-4111-8111-111111111111
protected=5ea4d000-0000-4000-8000-000000000001
sql "INSERT INTO users(id) VALUES ('$user_id');
 INSERT INTO auth.accounts(user_id,email) VALUES ('$user_id','restore-drill@example.com');
 INSERT INTO sample_types(identifier,kind,unit) VALUES ('HKQuantityTypeIdentifierStepCount','quantity','count') ON CONFLICT DO NOTHING;
 INSERT INTO quantity_samples(uuid,type_id,start_ts,end_ts,value,user_id)
 SELECT gen_random_uuid(),type_id,now()-interval '1 day',now()-interval '1 day',42,'$user_id' FROM sample_types WHERE identifier='HKQuantityTypeIdentifierStepCount';" >/dev/null
compose --profile backup run --rm -T backup once > "$work/backup.log" 2>&1
dump=$(compose --profile backup run --rm -T backup list | sed -n 's/.*\(puls-[0-9TZ]*\.dump\).*/\1/p' | tail -1)
[[ -n $dump ]] || fail 'no fixture backup'
if "$work/server/backup/restore.sh" --yes --no-start "$dump" > "$work/missing-ledger.log" 2>&1; then
  fail 'hosted restore accepted missing independent-ledger attestation'
fi
grep -q 'restore requires --deletion-ledger-ready' "$work/missing-ledger.log" || fail 'unexpected missing-ledger error'

# Malformed receipt must fail before DROP; a sentinel absent from the dump
# proves the original DB was preserved, beyond merely matching fixture counts.
sql "CREATE TABLE public.restore_sentinel (value integer); INSERT INTO restore_sentinel VALUES (1)" >/dev/null
printf '{"version":1,"user_id":"%s","requested_at":"infinity"}' "$user_id" > "$work/ledger/$user_id.json"
if restore > "$work/invalid.log" 2>&1; then fail 'invalid ledger accepted'; fi
[[ $(sql 'SELECT value FROM restore_sentinel') == 1 ]] || { tail -30 "$work/invalid.log"; fail 'invalid ledger touched database'; }
grep -q 'invalid deletion ledger receipt' "$work/invalid.log" || { tail -30 "$work/invalid.log"; fail 'unexpected invalid-ledger error'; }
printf '{"version":1,"user_id":"%s","requested_at":"2026-10-08T00:00:00.000Z"}' "$user_id" > "$work/ledger/$user_id.json"
restore > "$work/restore.log" 2>&1 || { tail -50 "$work/restore.log"; fail 'valid ledger restore failed'; }
[[ $(sql "SELECT count(*) FROM users WHERE id='$user_id'") == 0 ]] || fail 'deleted user resurrected'
[[ $(sql "SELECT count(*) FROM quantity_samples WHERE user_id='$user_id'") == 0 ]] || fail 'deleted health data resurrected'
[[ $(sql "SELECT count(*) FROM users WHERE id='$protected'") == 1 ]] || fail 'protected user erased'
[[ $(compose ps --services --status running) == db ]] || fail '--no-start launched app services'
# Protected UUID receipts refuse purge and keep the protected user intact.
printf '{"version":1,"user_id":"%s","requested_at":"2026-10-08T00:00:00.000Z"}' "$protected" > "$work/ledger/$protected.json"
if restore > "$work/protected.log" 2>&1; then fail 'protected ledger receipt accepted'; fi
grep -q 'protected account in deletion ledger' "$work/protected.log" || { tail -40 "$work/protected.log"; fail 'unexpected protected-ledger error'; }
[[ $(sql "SELECT count(*) FROM users WHERE id='$protected'") == 1 ]] || fail 'protected user erased'
[[ $(compose ps --services --status running) == db ]] || fail 'failed replay launched app services'
echo 'restore deletion-ledger drill PASS: invalid ledger before DROP; deleted user/data absent; --no-start; protected user retained'
