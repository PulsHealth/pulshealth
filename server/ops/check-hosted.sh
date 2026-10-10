#!/usr/bin/env bash
# Five-minute host timer entry point. Latest result only; no health data.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
state=${XDG_STATE_HOME:-$HOME/.local/state}/pulshealth
umask 077
mkdir -p "$state"
exec 9>"$state/hosted-check.lock"
flock -n 9 || exit 0
result=$(mktemp "$state/.hosted-check.XXXXXX")
trap 'rm -f "$result"' EXIT
status=0
python3 "$root/server/ops/hosted-check.py" >"$result" || status=$?
if [[ ! -s $result ]]; then
  printf '%s\n' '{"ok":false,"problems":["hosted check could not run"]}' >"$result"
fi
mv "$result" "$state/hosted-check.json"
if [[ -f $state/notifications-enabled ]]; then
  node --experimental-strip-types --disable-warning=ExperimentalWarning "$root/server/ops/notify.mjs" "$state/hosted-check.json" || {
    logger -t pulshealth-ops 'Operator notification failed; inspect mail configuration privately.'
    status=1
  }
fi
if [[ $status -ne 0 ]]; then
  logger -t pulshealth-ops 'Hosted checks failed; inspect the private hosted-check.json and hosted operations runbook.'
fi
exit "$status"
