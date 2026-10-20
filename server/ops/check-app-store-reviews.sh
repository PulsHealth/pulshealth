#!/usr/bin/env bash
# Hourly operator-only review check; config and delivery state stay outside Git.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
config=${1:?Pass the absolute private configuration path}
state=${2:?Pass the absolute private state directory}
umask 077
mkdir -p "$state"
exec 9>"$state/reviews.lock"
flock -n 9 || exit 0
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  "$root/server/ops/app-store-reviews.mjs" "$config"
