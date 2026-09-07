#!/bin/bash
# Stores the calendar time zone on the database so puls_time_zone() (defined in
# 009_metric_daily.sql, read by the metric_daily view and the Grafana
# dashboards' hidden `tz` variable) returns it in every session.
#
#   PULS_TIME_ZONE   IANA zone name, e.g. America/Los_Angeles. Default: UTC.
#
# It MUST match the phone's zone: the on-device daily aggregates
# (HKStatisticsCollectionQuery buckets, activity rings) are computed in the
# phone's local calendar, and the server-side daily views bucket raw samples in
# this zone to line up with them. Set it in .env before first start.
#
# The value is validated against pg_timezone_names (exact, case-sensitive, so
# the same string also satisfies Go's time.LoadLocation in the api service)
# and written with ALTER DATABASE … SET, which applies to connections opened
# after it runs (the app services connect later, so a fresh install picks it
# up immediately). Changing the zone on a live database is the same command,
# re-run — either re-run this script with the new value or:
#
#   docker compose exec db psql -U postgres -d postgres \
#     -c "ALTER DATABASE postgres SET puls.time_zone = 'Europe/Berlin'"
#
# then restart the app containers (or wait for their pools to reconnect).
set -euo pipefail

PULS_TIME_ZONE="${PULS_TIME_ZONE:-UTC}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"

known="$(psql -v ON_ERROR_STOP=1 -tA -v tz="${PULS_TIME_ZONE}" \
              --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
SELECT count(*) FROM pg_timezone_names WHERE name = :'tz';
EOSQL
)"
if [[ "$known" != "1" ]]; then
  echo "013_time_zone: PULS_TIME_ZONE='${PULS_TIME_ZONE}' is not an IANA zone" \
       "known to this PostgreSQL (see: SELECT name FROM pg_timezone_names)." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 -v tz="${PULS_TIME_ZONE}" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
ALTER DATABASE :"DBNAME" SET puls.time_zone = :'tz';
EOSQL

echo "013_time_zone: puls.time_zone set to ${PULS_TIME_ZONE} on database ${POSTGRES_DB}" \
     "(applies to new connections; re-run with a different PULS_TIME_ZONE to change it)."
