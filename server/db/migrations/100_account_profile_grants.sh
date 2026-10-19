#!/usr/bin/env bash
# 099 rebuilds the read-role ACLs every run, so restore this additive grant
# every run as well, including when the SQL migration has not changed.
set -euo pipefail
[[ -n "${WEB_DB_PASSWORD:-}" ]] || exit 0
psql -X -q -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<'EOSQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_app') THEN
    GRANT SELECT, INSERT, DELETE ON auth.native_handoffs TO web_app;
    GRANT EXECUTE ON FUNCTION auth.set_my_profile(bytea, text, text, date, text, text) TO web_app;
  END IF;
END $$;
EOSQL
