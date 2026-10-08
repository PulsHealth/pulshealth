#!/usr/bin/env bash
# Emit ledger filenames + JSON as COPY-safe TSV. Semantic validation happens
# in PostgreSQL before the restore destroys any schema. Receipts are permanent.
set -euo pipefail
ledger_dir=${PULS_DELETION_LEDGER_DIR:-/deletion-ledger}
[[ -d $ledger_dir ]] || { echo 'deletion ledger directory missing' >&2; exit 1; }
shopt -s nullglob
for file in "$ledger_dir"/*.json; do
  name=$(basename "$file" .json)
  [[ $name =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
    || { echo 'invalid deletion ledger filename' >&2; exit 1; }
  # JSON may contain line breaks, so collapse those; reject tabs and backslashes
  # rather than allow COPY escaping or row injection. Writer uses simple JSON.
  body=$(tr -d '\r\n' < "$file")
  [[ $body != *$'\t'* && $body != *\\* ]] \
    || { echo 'invalid deletion ledger encoding' >&2; exit 1; }
  printf '%s\t%s\n' "$name" "$body"
done
