#!/usr/bin/env bash
# Opt-in database backups for the PulsHealth stack (SRV-9).
#
# Runs as the `backup` Compose service — same pinned TimescaleDB image as `db`
# and `migrate`, so pg_dump always matches the server version — and is started
# only when its profile is enabled:
#
#   docker compose --profile backup up -d backup   # scheduled dumps
#   docker compose run --rm backup once            # one dump now (`make backup`)
#   docker compose run --rm backup list            # what is in the store
#   docker compose run --rm backup cat <name>      # copy one out on stdout
#
# Each run writes /backups/puls-<UTC timestamp>.dump with `pg_dump --format=custom`
# (compressed, and the only format `pg_restore` can be selective about), verifies
# the archive is readable, then deletes dumps older than PULS_BACKUP_KEEP_DAYS —
# never the newest one, however old it is, because "the schedule stopped six
# weeks ago" must not also mean "and then it deleted your last copy".
#
# Scheduling is a sleep loop, not cron. The image ships no cron daemon and does
# not run as root, so cron would mean installing packages at container start and
# widening what this service is allowed to do — for one timer. A loop in PID 1
# needs nothing, logs to `docker compose logs backup` like every other service,
# stops on SIGTERM, and restarts with the container. What it gives up is
# wall-clock anchoring: the schedule is relative to when the container started,
# so restarting the stack shifts the dump time. For a personal install taking a
# dump a day that is the right trade; if you need 03:00 exactly, disable the
# profile and call `make backup` from the host's own cron or systemd timer.
#
# Environment (all optional except the connection):
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE  libpq connection (Compose sets these)
#   BACKUP_DIR              where dumps go inside the container (default /backups)
#   PULS_BACKUP_INTERVAL    between dumps: 24h, 90m, 3600s, or bare seconds (default 24h)
#   PULS_BACKUP_KEEP_DAYS   delete dumps older than this many days; 0 keeps everything (default 14)
#
# Restoring is server/backup/restore.sh, run from the host. Read it before you
# need it: TimescaleDB restores have rules ordinary Postgres dumps do not.

set -euo pipefail

backup_dir=${BACKUP_DIR:-/backups}
keep_days=${PULS_BACKUP_KEEP_DAYS:-14}
interval_spec=${PULS_BACKUP_INTERVAL:-24h}
prefix=puls-

log() {
  printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

# The header comment of this file, un-commented: `backup.sh help`. Derived from
# the text rather than a hard-coded line range, so editing the header cannot
# silently start printing code.
usage() {
  awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"
}

# A misconfiguration: nothing this container does will work, so stop.
die() {
  warn "$*"
  exit 1
}

# A failure of this run only. In `once` mode the caller turns it into a
# non-zero exit; in the scheduled loop the container stays up and tries again
# at the next interval, because a database that is briefly unreachable (a
# restart, a slow start-up) must not leave the schedule permanently dead.
warn() {
  printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

# "24h" / "90m" / "3600s" / "3600" -> seconds.
parse_interval() {
  local spec=$1 number unit
  number=${spec%[smhd]}
  unit=${spec#"$number"}
  case $number in
    ''|*[!0-9]*) die "PULS_BACKUP_INTERVAL must be a number optionally followed by s, m, h or d, got '$spec'" ;;
  esac
  case $unit in
    ''|s) printf '%s' "$((number))" ;;
    m) printf '%s' "$((number * 60))" ;;
    h) printf '%s' "$((number * 3600))" ;;
    d) printf '%s' "$((number * 86400))" ;;
    *) die "unknown time unit '$unit' in PULS_BACKUP_INTERVAL='$spec'" ;;
  esac
}

check_dir() {
  mkdir -p "$backup_dir" 2>/dev/null || true
  [[ -d $backup_dir ]] || { warn "$backup_dir does not exist and could not be created"; return 1; }
  [[ -w $backup_dir ]] || { warn "$backup_dir is not writable by uid $(id -u). If it is a host directory (PULS_BACKUP_DIR), make it writable by that uid."; return 1; }
}

# One dump. Written to .part and renamed only after pg_restore has confirmed it
# can read the archive, so a truncated file is never mistaken for a backup and
# never survives to be pruned in favour of something newer.
take_dump() {
  check_dir || return 1
  local stamp file part started elapsed size
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$backup_dir/${prefix}${stamp}.dump"
  part="$file.part"
  started=$SECONDS

  log "dumping ${PGDATABASE:-postgres} on ${PGHOST:-localhost} to $(basename "$file")"
  # Everything the database has, including owners and grants: what to ignore is
  # restore.sh's decision (it recreates roles through the migrate service), and
  # a dump cannot grow information back.
  if ! pg_dump --format=custom --file="$part"; then
    rm -f "$part"
    warn "pg_dump failed; no dump was written"
    return 1
  fi
  if ! pg_restore --list "$part" >/dev/null 2>&1; then
    rm -f "$part"
    warn "the dump just written is not a readable archive; discarded"
    return 1
  fi
  chmod 600 "$part"
  mv "$part" "$file"
  # A bind-mounted host directory belongs to the person who made it; hand the
  # dump to the same owner rather than leaving root-owned files behind.
  if [[ $(id -u) -eq 0 ]]; then
    chown --reference="$backup_dir" "$file" 2>/dev/null || true
  fi

  elapsed=$((SECONDS - started))
  size=$(du -h "$file" | cut -f1)
  log "wrote $(basename "$file") ($size) in ${elapsed}s"
}

prune() {
  case $keep_days in
    ''|*[!0-9]*) die "PULS_BACKUP_KEEP_DAYS must be a whole number of days, got '$keep_days'" ;;
  esac
  # Abandoned partial dumps from a killed run.
  find "$backup_dir" -maxdepth 1 -type f -name "${prefix}*.dump.part" -mtime +1 -delete 2>/dev/null || true
  if [[ $keep_days -eq 0 ]]; then
    return
  fi
  local newest
  newest=$(find "$backup_dir" -maxdepth 1 -type f -name "${prefix}*.dump" -printf '%T@\t%p\n' 2>/dev/null \
    | sort -rn | head -n 1 | cut -f2- || true)
  local file
  while IFS= read -r file; do
    [[ -n $file ]] || continue
    if [[ $file == "$newest" ]]; then
      log "keeping $(basename "$file") despite its age: it is the only/newest dump"
      continue
    fi
    rm -f -- "$file"
    log "pruned $(basename "$file") (older than $keep_days days)"
  done < <(find "$backup_dir" -maxdepth 1 -type f -name "${prefix}*.dump" -mtime +"$keep_days" 2>/dev/null)
}

list_dumps() {
  [[ -d $backup_dir ]] || die "$backup_dir does not exist"
  if ! find "$backup_dir" -maxdepth 1 -type f -name "${prefix}*.dump" -print -quit | grep -q .; then
    echo "no dumps in $backup_dir yet"
    return
  fi
  find "$backup_dir" -maxdepth 1 -type f -name "${prefix}*.dump" \
    -printf '%TY-%Tm-%Td %TH:%TM  %10s bytes  %f\n' | sort
}

cat_dump() {
  local name=${1:-}
  [[ -n $name ]] || die "usage: backup.sh cat <file name>"
  name=$(basename -- "$name")
  [[ -f "$backup_dir/$name" ]] || die "$name is not in $backup_dir (try: backup.sh list)"
  cat -- "$backup_dir/$name"
}

run_loop() {
  local interval sleep_pid
  interval=$(parse_interval "$interval_spec")
  [[ $interval -ge 60 ]] || die "PULS_BACKUP_INTERVAL must be at least 60s, got '$interval_spec'"

  # Stop promptly on `docker compose stop`: bash runs a trap only when the
  # foreground command finishes, so the sleep runs in the background and the
  # script waits on it.
  trap 'log "stopping"; [[ -n ${sleep_pid:-} ]] && kill "$sleep_pid" 2>/dev/null; exit 0' TERM INT

  log "scheduled dumps every $interval_spec into $backup_dir, keeping $keep_days days"
  while :; do
    # A failed dump is logged and retried at the next interval rather than
    # killing the container: `restart: unless-stopped` would otherwise turn a
    # database that is momentarily down into a restart loop, and pruning is
    # skipped so a run that produced nothing cannot age anything out.
    if take_dump; then
      prune
    else
      warn "dump failed; retrying at the next interval"
    fi
    log "next dump in $interval_spec"
    sleep "$interval" &
    sleep_pid=$!
    wait "$sleep_pid" || true
  done
}

case ${1:-loop} in
  loop) run_loop ;;
  once) take_dump || exit 1; prune ;;
  list) list_dumps ;;
  prune) prune ;;
  cat) shift; cat_dump "$@" ;;
  -h|--help|help) usage ;;
  *) die "unknown command '$1' (loop | once | list | prune | cat <name>)" ;;
esac
