#!/usr/bin/env bash
set -euo pipefail
[[ -n "${WEB_DB_PASSWORD:-}" ]] || exit 0
psql -X -q -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<'EOSQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='web_app') THEN
    GRANT USAGE ON SCHEMA collections TO web_app;
    GRANT EXECUTE ON FUNCTION collections.command(text,bytea,jsonb),
      collections.discover(uuid,bytea), collections.upload(bytea,uuid,text,jsonb,jsonb) TO web_app;
  END IF;
END $$;
EOSQL
