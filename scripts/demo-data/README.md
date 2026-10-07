# Demo data

Two scripts that fill the viewer's public demo account (`WEB_DEMO_USER`,
[`web/README.md`](../../web/README.md), "Demo account") with a de-identified
copy of one person's recent history, so the demo looks like real life without
being anyone's.

- **`build_pack.py`** reads 26 weeks of one user's data, read-only, and writes
  a *pack*: a gzipped JSON file of about 3 MB.
- **`load.py`** replays the pack into the demo user through the ingest API,
  like a phone would, laid onto a timeline that ends today and loops every
  26 weeks.

Both are Python 3.9+ with the standard library only.

## What the pack keeps, and what it doesn't

| | Treatment |
|---|---|
| Types | An allowlist (`QUANTITY`, `CATEGORY` in `build_pack.py`): activity, energy, distance, heart rate, HRV, resting and walking heart rate, VO2 max, SpO2, respiratory rate, sleep stages, body mass, gait and running metrics, workouts. Everything else stays in the database: ECG, heartbeat series, State of Mind, medications, blood pressure, nutrition, audio exposure, falls, cycle tracking, and anything newer. |
| Dates | Days are stored as offsets from the pack's first day, plus its weekday. No calendar date is kept. |
| Values | Each family of related types (heart rate, energy, distance, power, body mass, …) is scaled by one random factor, drawn at build time and never stored. Most readings also get a little noise of their own. Ratios between related types survive, but no heart, energy, distance or body reading equals a real one. Minute counts (exercise, stand, daylight) are kept as they are. |
| Volume | Cumulative types are summed into 15-minute buckets, and basal energy into hours. Where iPhone and Watch overlap, the bucket keeps whichever device has the larger total, as HealthKit's de-duplication does. Heart rate is thinned to one reading per 5 minutes, respiratory rate to one per 10, and running metrics to one per 30 seconds. Workout series are cut to one point per 10 seconds. |
| Sleep | Each night is moved, as one block, by a random amount of up to 20 minutes either way. |
| Identity | The profile is a fixed "Demo" (1990-01-01, male). There are two sources, "Apple Watch" and "iPhone". Every sample gets a new UUID at load time. Metadata is dropped except heart-rate motion context and a workout's indoor flag and average METs. Workout events keep only their type and times, and sub-activities only their type, times and duration. |
| Places | No GPS point is read. A workout that had a route gets a generated one on loops in a public park, paced by its own scaled distance samples. |

The pack is still derived from a real person's history. Keep it out of
version control (this directory's `.gitignore` refuses `*.json.gz`), and
somewhere only the operator can read.

## Setup

On the server that runs the stack, from the checkout:

```bash
# 1. The demo user, and a sync token bound to it (save the token, mode 600)
make issue-device NAME='Demo data' ARGS='--user <new uuid>'

# 2. Its viewer account, then WEB_DEMO_USER=<uuid> in server/.env
make web-demo ARGS='--user <uuid>'
docker compose -f server/docker-compose.yml up -d web

# 3. The pack, from the person whose history it copies (default: the
#    default user; --user for another). Reads through psql, read-only.
scripts/demo-data/build_pack.py \
  --psql 'docker compose -f server/docker-compose.yml exec -T db psql -U postgres -X -q' \
  --out ~/puls-demo/pack.json.gz

# 4. The first fill: the last 26 weeks
scripts/demo-data/load.py --pack ~/puls-demo/pack.json.gz --user <uuid> \
  --token-file ~/puls-demo/token --zone "$PULS_TIME_ZONE" --days 182

# 5. Every hour, what "happened" since: cron, e.g.
#    7 * * * * cd <checkout> && scripts/demo-data/load.py --pack ... --hours 26
```

`--zone` must be the server's `PULS_TIME_ZONE`, or the demo's days won't
match the viewer's. A sample is sent only once its end has passed, so an
hourly run fills today in through the day. Today's rings and daily aggregates
are recomputed from what has been sent. Re-sending is harmless: samples are
idempotent by UUID, and rings and aggregates upsert. The 26-hour window means
a missed run or two heals itself.

`load.py --dry-run DIR` writes the batches instead of sending them;
`tools/protocol-check` validates them against the protocol's schemas.

**Keep the pack.** UUIDs come from the pack's ID, so a new pack loaded into
the same user would add a second copy of every sample. To replace the data,
make a new demo user (steps 1, 2 and 4 with a new UUID), point
`WEB_DEMO_USER` and the cron at it, then remove the old user.

## Tests

```bash
python3 -m unittest discover -s scripts/demo-data -p 'test_*.py'
python3 scripts/demo-data/test_demo_data.py --emit /tmp/demo-batches
(cd tools/protocol-check && go run . /tmp/demo-batches/*.ndjson)
```

The tests build a pack from synthetic rows: no database, and no one's data.
