#!/usr/bin/env bash
# Only the operator may classify pre-existing invited users as personal.
set -euo pipefail
default_user="${PULS_USER_ID:-5ea4d000-0000-4000-8000-000000000001}"
personal_users="${WEB_PERSONAL_USERS:-}"
uuid_pattern='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [[ ! "$default_user" =~ $uuid_pattern ]]; then
  echo '024_deletion_policy: PULS_USER_ID must be a UUID' >&2
  exit 1
fi
IFS=',' read -r -a requested_users <<< "$personal_users"
for personal_user in "${requested_users[@]}"; do
  if [[ ! "$personal_user" =~ $uuid_pattern ]]; then
    echo '024_deletion_policy: WEB_PERSONAL_USERS must be comma-separated UUIDs' >&2
    exit 1
  fi
done
psql -X -q -v ON_ERROR_STOP=1 -v default_user="$default_user" -v personal_users="$personal_users" \
  --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<'EOSQL'
BEGIN;
UPDATE auth.deletion_policy SET default_user_id = :'default_user'::uuid;
DELETE FROM auth.personal_users;
INSERT INTO auth.personal_users (user_id)
  SELECT u.id FROM public.users u
  WHERE u.id::text = ANY (string_to_array(lower(:'personal_users'), ','))
    AND u.id <> :'default_user'::uuid
    AND NOT EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM auth.accounts WHERE user_id = u.id AND is_admin);
COMMIT;
EOSQL
