#!/usr/bin/env bash
# Hourly operator-only review check; config and delivery state stay outside Git.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
config=${1:?Pass the absolute private configuration path}
# Read the actual delivery-state directory so mismatched lock paths are impossible.
state=$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const { stateDir } = JSON.parse(readFileSync(process.argv[1], "utf8"));
  if (typeof stateDir !== "string" || !stateDir.startsWith("/")) process.exit(1);
  console.log(stateDir);
' "$config")
umask 077
mkdir -p "$state"
exec 9>"$state/reviews.lock"
flock -n 9 || exit 0
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  "$root/server/ops/app-store-reviews.mjs" "$config"
