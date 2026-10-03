#!/usr/bin/env bash
# Drift check for the code the Go services copy rather than share.
#
# server/ingest, server/api and server/mcp are separate Go modules on
# purpose: each image builds from its own directory, with no cross-context
# copy and no shared module to version. A few small pieces therefore exist
# in two or three byte-copies — the auth-failure limiter, the cached health
# probe, the bool-env rule, the healthcheck subcommand, the time-zone
# helpers, the UUID check — and must behave identically everywhere. This
# compares the copies with comments, blank lines and the package clause
# stripped (each copy's header comment says where its siblings are), and
# fails on any difference in code.
#
# Usage: scripts/check-go-copies.sh
#   Run from anywhere in the repository. Prints a diff per drifted copy and
#   exits 1; exits 0 when every copy matches. Meant for CI next to the Go
#   unit tests.

set -euo pipefail

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$root/server"

status=0

# normalize prints Go source without the package clause, full-line and
# trailing // comments, or blank lines. Strings in these files hold no "//"
# preceded by whitespace; if one ever does, both copies lose it alike.
normalize() {
  sed -e '/^package /d' \
      -e 's/^[[:space:]]*\/\/.*$//' \
      -e 's/[[:space:]]\{1,\}\/\/.*$//' \
      -e '/^[[:space:]]*$/d'
}

# function_source prints one top-level function (from `func name(` to the
# first line that is a lone closing brace) of a file, normalized.
function_source() {
  local file="$1" name="$2"
  awk -v name="$name" '
    index($0, "func " name "(") == 1 { inside = 1 }
    inside { print }
    inside && $0 == "}" { exit }
  ' "$file" | normalize
}

# compare_files NAME FILE... : every FILE must equal the first, normalized.
compare_files() {
  local first="$1"
  shift
  local other
  if [[ ! -f "$first" ]]; then
    echo "check-go-copies: missing $first" >&2
    status=1
    return
  fi
  for other in "$@"; do
    if [[ ! -f "$other" ]]; then
      echo "check-go-copies: missing $other" >&2
      status=1
      continue
    fi
    if ! diff -u --label "$first" --label "$other" \
        <(normalize < "$first") <(normalize < "$other"); then
      echo "check-go-copies: $other has drifted from $first" >&2
      status=1
    fi
  done
}

# compare_function NAME FILE... : function NAME must be defined, and equal,
# in every FILE.
compare_function() {
  local name="$1" first="$2"
  shift 2
  local reference other
  reference="$(function_source "$first" "$name")"
  if [[ -z "$reference" ]]; then
    echo "check-go-copies: func $name not found in $first" >&2
    status=1
    return
  fi
  for other in "$@"; do
    if ! diff -u --label "$first:$name" --label "$other:$name" \
        <(printf '%s\n' "$reference") <(function_source "$other" "$name"); then
      echo "check-go-copies: func $name in $other has drifted from $first" >&2
      status=1
    fi
  done
}

compare_files ingest/ratelimit.go api/ratelimit.go mcp/ratelimit.go
compare_files ingest/health.go api/health.go
compare_files ingest/envbool.go api/envbool.go mcp/envbool.go
compare_files ingest/healthcheck.go api/healthcheck.go mcp/healthcheck.go
compare_files api/timezone.go mcp/timezone.go

compare_function isHexN ingest/parse.go api/main.go mcp/dates.go
compare_function isUUID ingest/parse.go api/main.go mcp/dates.go
compare_function refusePlaceholder ingest/main.go api/main.go mcp/main.go

if [[ "$status" -eq 0 ]]; then
  echo "check-go-copies: every copy matches"
fi
exit "$status"
