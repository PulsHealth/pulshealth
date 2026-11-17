#!/usr/bin/env bash
# A restore with --no-privileges reinstates PostgreSQL's default PUBLIC
# EXECUTE on routines. Revoke it before 099 checks all runnable definers;
# 102 grants the three collection entry points back to web_app afterwards.
set -euo pipefail
psql -X -q -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<'EOSQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='collections') THEN
    REVOKE ALL ON SCHEMA collections FROM PUBLIC;
    REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA collections FROM PUBLIC;
  END IF;
END $$;
EOSQL
