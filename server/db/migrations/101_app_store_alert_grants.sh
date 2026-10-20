#!/usr/bin/env bash
# 099 reconciles ACLs each run. Restore only the financial delivery store.
set -euo pipefail
[[ -n "${WEB_DB_PASSWORD:-}" ]] || exit 0
psql -X -q -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<'EOSQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.app_store_alerts TO web_app;
  END IF;
END $$;
EOSQL
