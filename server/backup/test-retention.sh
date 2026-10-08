#!/usr/bin/env bash
# Isolated filesystem-only retention regression test; run inside the backup
# image (GNU find/touch) or on Linux. Never points at an existing backup store.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/dumps" "$work/bin"
export BACKUP_DIR=$work/dumps PULS_BACKUP_KEEP_DAYS=14
old=$BACKUP_DIR/puls-old.dump
new=$BACKUP_DIR/puls-new.dump
fail() { echo "FAIL: $*" >&2; exit 1; }
touch -d '20 days ago' "$old"
bash "$root/backup.sh" prune
[[ -f $old ]] || fail 'default retention deleted newest old dump'
PULS_BACKUP_STRICT_RETENTION=true bash "$root/backup.sh" prune
[[ ! -e $old ]] || fail 'strict retention preserved newest old dump'
touch -d '14 days ago 2 minutes ago' "$old"
touch -d '13 days ago 23 hours ago' "$new"
PULS_BACKUP_STRICT_RETENTION=true bash "$root/backup.sh" prune
[[ ! -e $old && -e $new ]] || fail 'strict cutoff did not expire at day boundary'
touch -d '20 days ago' "$old"
printf '#!/usr/bin/env bash\nexit 1\n' > "$work/bin/pg_dump"
chmod +x "$work/bin/pg_dump"
if PATH="$work/bin:$PATH" PULS_BACKUP_STRICT_RETENTION=true bash "$root/backup.sh" once; then
  fail 'failed dump returned success'
fi
[[ ! -e $old && -e $new ]] || fail 'failed dump skipped strict retention'
if PULS_BACKUP_STRICT_RETENTION=true PULS_BACKUP_KEEP_DAYS=0 bash "$root/backup.sh" prune; then
  fail 'strict retention accepted unlimited retention'
fi
if PULS_BACKUP_STRICT_RETENTION=typo bash "$root/backup.sh" prune; then
  fail 'invalid strict setting accepted'
fi
touch -d '20 days ago' "$old"
PULS_BACKUP_KEEP_DAYS=0 bash "$root/backup.sh" prune
[[ -e $old && -e $new ]] || fail 'default unlimited retention removed dumps'
echo 'retention regression tests passed'
