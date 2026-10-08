#!/usr/bin/env bash
# Filesystem-only ledger transport regression tests; no DB or real receipts.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PULS_DELETION_LEDGER_DIR=$work
uuid=11111111-1111-1111-1111-111111111111
receipt='{"version":1,"user_id":"11111111-1111-1111-1111-111111111111","requested_at":"2026-10-08T12:00:00.000Z"}'
fail() { echo "FAIL: $*" >&2; exit 1; }
[[ -z $(bash "$root/deletion-ledger.sh") ]] || fail 'empty ledger produced rows'
printf '%s\n' "$receipt" > "$work/$uuid.json"
[[ $(bash "$root/deletion-ledger.sh") == "$uuid"$'\t'"$receipt" ]] || fail 'valid receipt changed in transport'
printf '{}' > "$work/invalid.json"
if bash "$root/deletion-ledger.sh" >/dev/null 2>&1; then fail 'invalid filename accepted'; fi
rm "$work/invalid.json"
printf '{"escape":"\\n"}' > "$work/$uuid.json"
if bash "$root/deletion-ledger.sh" >/dev/null 2>&1; then fail 'COPY escapes accepted'; fi
printf '{"tab":"\t"}' > "$work/$uuid.json"
if bash "$root/deletion-ledger.sh" >/dev/null 2>&1; then fail 'COPY row separator accepted'; fi
if PULS_DELETION_LEDGER_DIR="$work/missing" bash "$root/deletion-ledger.sh" >/dev/null 2>&1; then fail 'missing directory accepted'; fi
echo 'deletion ledger transport tests passed'
