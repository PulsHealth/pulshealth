#!/usr/bin/env bash
# Keep the public demo unable to issue/list/revoke sync tokens in the
# database as well as the viewer. This policy is writable only by the
# operator; web_app cannot bypass it by forging a browser session.
set -euo pipefail

demo_user="${WEB_DEMO_USER:-}"
if [[ -n "$demo_user" && ! "$demo_user" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "022_device_pairing_policy: WEB_DEMO_USER must be a UUID" >&2
  exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 -v demo_user="$demo_user" \
  --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<'EOSQL'
INSERT INTO auth.device_pairing_policy (singleton, demo_user_id)
VALUES (true, nullif(:'demo_user', '')::uuid)
ON CONFLICT (singleton) DO UPDATE SET demo_user_id = EXCLUDED.demo_user_id;
EOSQL
