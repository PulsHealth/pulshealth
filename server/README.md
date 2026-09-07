# PulsHealth Server

Self-hosted ingestion stack for Apple HealthKit data exported by the
PulsHealth iOS app. Four app containers plus PostgreSQL via Docker Compose:

| Service | Image | Port | Purpose |
|---|---|---|---|
| `db` | `timescale/timescaledb-ha:pg17` | 127.0.0.1:5432 | PostgreSQL 17 + TimescaleDB |
| `ingest` | built from `ingest/` (Go, distroless) | 127.0.0.1:8080 | HTTP ingest API — expose it through a TLS-terminating proxy of your choice (Tailscale Serve/Funnel is one option; see "Exposing the server"); connects as `postgres` by default, or as the scoped DML-only `ingest` role once opted in (see below) |
| `api` | built from `api/` (Go, distroless) | 127.0.0.1:8081 | Product read API for downstream apps |
| `grafana` | `grafana/grafana:13.0.2` (pinned — 13.x provisioning is version-sensitive) | 127.0.0.1:3000 | Dashboards (reach them through the same kind of TLS proxy, e.g. Tailscale Serve on `:8443`) |
| `web` | built from `../web/` (Next.js standalone) | `${WEB_BIND_ADDR:-127.0.0.1}:3001` | Web health viewer — reads the DB directly as the read-only `grafana` role |

The `web` service builds from the sibling `../web/` directory (a Next.js app),
so build from a checkout that contains both `server/` and `web/`.

```
server/
├── docker-compose.yml
├── .env.example          # copy to .env, fill in secrets
├── api/                  # Go product read API + Dockerfile
├── ingest/               # Go ingest server + Dockerfile
├── db/init/              # schema, applied on first startup
├── grafana/              # provisioned datasource + dashboard
```

## Setup

```bash
cd server
cp .env.example .env
# Generate secrets (run once per variable):
openssl rand -hex 32
# Edit .env: POSTGRES_PASSWORD, PULS_TOKEN, PULS_API_TOKEN,
# GRAFANA_PASSWORD, GRAFANA_DB_PASSWORD, API_DB_PASSWORD — and PULS_TIME_ZONE,
# which must be right BEFORE the first start (see "Configuration" below).

docker compose up -d --build
curl -s localhost:8080/healthz       # → {"db":true,"ok":true}
curl -s localhost:8081/healthz       # → {"db":true,"ok":true}
```

### Configuration

Everything is read from `.env` (`.env.example` lists every variable with
comments). Beyond the passwords and tokens, two settings deserve attention:

- **`PULS_TIME_ZONE`** — the IANA zone your phone lives in (e.g.
  `Europe/Berlin`); defaults to `UTC`. Every daily view buckets by this
  calendar: the `metric_daily` view, Grafana's daily panels, the product API's
  local-day ranges, and the web viewer. It has to match the phone because the
  daily aggregates HealthKit computes on-device are already in the phone's
  local calendar — a mismatch splits days between two rows. **Set it before
  the first start:** `db/init/013_time_zone.sh` validates it against
  `pg_timezone_names` (init fails loudly on an unknown name) and stores it on
  the database with `ALTER DATABASE … SET puls.time_zone`, which the
  `puls_time_zone()` SQL function reads. Compose hands the same value to the
  `api` and `web` containers (the API refuses to start on an invalid name).
  Nothing in `db/init/` re-runs on an existing volume, so to change the zone
  later store the new value by hand, then recreate the app containers so their
  pools reconnect:

  ```bash
  # 1. set the new PULS_TIME_ZONE in .env (so a future re-init agrees), then
  #    validate + store it on the running database (same script init ran):
  docker compose exec -T -e PULS_TIME_ZONE=Europe/Berlin \
    db bash /docker-entrypoint-initdb.d/013_time_zone.sh
  #    (equivalent, without validation:
  #     docker compose exec db psql -U postgres -d postgres \
  #       -c "ALTER DATABASE postgres SET puls.time_zone = 'Europe/Berlin'")
  # 2. pick it up — Compose recreates db/api/web because their environment
  #    changed; the data volume is untouched:
  docker compose up -d
  docker compose exec db psql -U postgres -d postgres -tAc "SELECT puls_time_zone()"
  ```

  The setting applies to new connections only. Stored rows are never
  rewritten; the daily views simply re-bucket on read, and Grafana's hidden
  `tz` variable re-queries it on dashboard load.
- **`GRAFANA_ALERT_EMAIL`** — the recipient of every Grafana alert
  (`grafana/provisioning/alerting/contact-points.yml` templates it). Compose
  defaults it to `alerts@example.com` so the contact point always has an
  address; set it to your own. Mail only leaves once SMTP is configured — see
  "Alerting".
- `WEB_BIND_ADDR` — the web viewer is unauthenticated and defaults to
  loopback. To reach it from other machines bind it to a private interface
  (a VPN/tailnet address), never `0.0.0.0`.

## Deploying and upgrading

The reference stack is plain Docker Compose; there is no deploy tooling in the
repo. To upgrade a running install, pull the new revision and rebuild:

```bash
git pull
cd server && docker compose up -d --build
curl -s localhost:8080/healthz && curl -s localhost:8081/healthz
```

The schema in `db/init/` is applied automatically **only on first startup**
(empty `db_data` volume); on an existing volume nothing in `db/init/` runs
again, so schema changes must be applied by hand (next section). A migration
framework that applies numbered SQL at startup is planned — see
[`docs/open-source-plan.md`](../docs/open-source-plan.md). Until it lands,
**take a `pg_dump` before any schema change**: the stack ships no backup
service (see "Backup & restore"), so the live volume is the only copy.
Re-applying the schema from scratch means dropping the volume
(`docker compose down -v && docker compose up -d`), which **destroys all data
irrecoverably**.

### Schema changes on a live database

There is no replayable migration framework yet. Write new DDL as an idempotent
(`CREATE TABLE IF NOT EXISTS …`) file in `db/init/` — see `002_series_tables.sql`
for the pattern — so fresh installs pick it up automatically, then apply it to a
running database by hand. `db/init/` is bind-mounted read-only into the `db`
container at `/docker-entrypoint-initdb.d`, so the file is already there:

```bash
docker compose exec -T db pg_dump -U postgres -Fc postgres > before-00N.dump   # first
docker compose exec db psql -U postgres -d postgres \
  -f /docker-entrypoint-initdb.d/00N_new_tables.sql
```

Nothing ever replays the whole bootstrap set against a populated volume, and
the role script (`099_read_roles.sh`) is only re-run deliberately (below).

#### Add the product API role to an existing database

Add `PULS_API_TOKEN` and `API_DB_PASSWORD` to `.env` first. Fresh installs
pick up `api_reader` from `db/init/099_read_roles.sh`, but existing populated
`db_data` volumes do not rerun `db/init`, so the role must be applied manually.
The script is safe to rerun: it creates missing roles, rotates passwords, and
re-applies the exact product API grants.

```bash
source .env

docker compose exec -T \
  -e GRAFANA_DB_PASSWORD="$GRAFANA_DB_PASSWORD" \
  -e API_DB_PASSWORD="$API_DB_PASSWORD" \
  db bash /docker-entrypoint-initdb.d/099_read_roles.sh
```

#### Run ingest as the scoped `ingest` role (opt-in)

Ingest is the only internet-facing service, yet Compose defaults its
`DATABASE_URL` to the `postgres` superuser. The same `099_read_roles.sh` can
create a scoped `ingest` role holding exactly what `ingest/store.go` needs:
`CONNECT`, `USAGE` on `public`, `SELECT/INSERT/UPDATE/DELETE` on every table
and view in `public`, `USAGE/SELECT` on its sequences, and default privileges
so tables and sequences added by future init files are covered too. It has no
`CREATE` on the schema, no `TRUNCATE`, and none of `SUPERUSER`, `CREATEROLE`,
`CREATEDB`, `REPLICATION` or `BYPASSRLS`, so an ingest bug or a leaked
`PULS_TOKEN` cannot drop tables, alter roles, or `COPY TO PROGRAM`. TimescaleDB
propagates the grants to hypertable chunks (existing ones on grant, new ones
as they are created), and the `SET LOCAL
timescaledb.max_tuples_decompressed_per_dml_transaction` that `InsertBatch`
issues is a user-settable GUC; the script proves both, plus the exact role
attributes and ACL set, before it commits.

The role is opt-in so an unchanged `.env` keeps working: the `db` service's
environment carries only the two required passwords, so on a fresh volume the
script runs without `INGEST_DB_PASSWORD`, logs that it skipped the ingest
role, and ingest keeps connecting as `postgres`. To opt in on a running
database:

```bash
# 1. add to .env:  INGEST_DB_USER=ingest  and  INGEST_DB_PASSWORD=$(openssl rand -hex 32)
set -a; source .env; set +a

# 2. create (or rotate) the role and apply its exact grants — safe to rerun
docker compose exec -T \
  -e GRAFANA_DB_PASSWORD="$GRAFANA_DB_PASSWORD" \
  -e API_DB_PASSWORD="$API_DB_PASSWORD" \
  -e INGEST_DB_PASSWORD="$INGEST_DB_PASSWORD" \
  db bash /docker-entrypoint-initdb.d/099_read_roles.sh

# 3. recreate only ingest with the new DATABASE_URL, then verify
docker compose up -d ingest
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS -H "Authorization: Bearer $PULS_TOKEN" http://127.0.0.1:8080/v1/stats
```

Roll back by removing `INGEST_DB_USER`/`INGEST_DB_PASSWORD` from `.env` and
running `docker compose up -d ingest` again; the role can stay. These three
steps are the complete procedure — other docs that mention opting in point
back to this section.

Live databases whose volume predates `003_aggregates.sql` (aggregate
series/bucket tables + `batches.aggregate_count`) need it applied this way
**before** deploying an ingest build that accepts aggregate lines — the
ingest transaction references the new tables and column unconditionally. The
same applies to `005_activity_summaries.sql` (the `activity_summaries` table +
`batches.activity_summary_count`): apply it before deploying an ingest build
that accepts activity-summary lines.

Likewise `006_workout_enhanced.sql` (the `workout_series_points` hypertable and
`workouts.stats_detail/events/activities` columns) must be applied **before**
deploying an ingest build that accepts workout-series lines, since `InsertBatch`
references those tables unconditionally.

`007_wake_telemetry.sql` adds wake-correlation/timing columns to `batches`
(`wake_id`, `trigger`, `parse_ms`, `insert_ms`). `InsertBatch` writes them
unconditionally, so apply it **before** deploying the ingest build that sets them.

`011_temporal_contexts.sql` adds the `temporal_contexts` lookup table and nullable
temporal-context ID columns used to reconstruct source local wall time.
`InsertBatch` writes those columns whenever new clients send temporal context,
so apply it **before** deploying an ingest build that stores local-time context.

`010_category_labels.sql` adds the `category_labels` lookup table for joining
raw `category_samples.value` integers to their HealthKit meanings:

```sql
SELECT c.*, cl.label, cl.enum_name
FROM category_samples c
JOIN sample_types st USING (type_id)
LEFT JOIN category_labels cl
  ON cl.type_identifier = st.identifier
 AND cl.value = c.value;
```

The ground truth for this seed data is the HealthKit SDK bundled with Xcode:
`HKTypeIdentifiers.h` maps each `HKCategoryTypeIdentifier*` to its category
value enum, and `HKCategoryValues.h` defines the integer values and enum names.
Refresh `010_category_labels.sql` after major Xcode/iOS SDK updates, or when
adding support for newly exposed HealthKit category types. Apply it to a live DB
the same way as other idempotent schema files, then verify the expected seed
shape:

```bash
docker compose exec db psql -U postgres -d postgres \
  -f /docker-entrypoint-initdb.d/010_category_labels.sql
docker compose exec db psql -U postgres -d postgres -tA \
  -c "SELECT count(*), count(DISTINCT type_identifier) FROM category_labels;"
# iPhoneOS 26.5 SDK seed: 257|70
```

`000_users.sql` adds the `users` table (which the per-row `user_id` foreign keys
and the profile line's user upsert reference) and seeds the default user. It runs
first on a fresh volume; there is no in-place migration for the `user_id`
columns, so adding users to a database with existing data means a full reset —
drop the volume, let `db/init` re-run, and resync from the app.

### The token

`PULS_TOKEN` is a single static bearer token shared by the server and the iOS
app. Create it with `openssl rand -hex 32`, put it in `.env`, and paste the
same value into PulsHealth's server settings. Rotate by changing `.env`,
running `docker compose up -d ingest`, and updating the app.

## Exposing the server

The phone has to reach the ingest API over HTTPS. Every service binds to
loopback, so nothing is reachable until you put a TLS-terminating proxy in
front of it — and that is the only supported way to expose it. **Never open
port 8080 to the internet and never serve it over plaintext**: the bearer
token is a second layer behind TLS, not a substitute for it.

Any reverse proxy that terminates TLS works (Caddy, nginx, Traefik, a cloud
tunnel). The easiest path is Tailscale: install it on the server and on your
iPhone, then publish the ingest API inside your tailnet:

```bash
tailscale serve --bg --https=443 http://localhost:8080
```

Point the app at `https://<machine-name>.<tailnet>.ts.net`. Tailscale
provisions the certificate and the phone reaches the server from anywhere it
has connectivity. `tailscale funnel` publishes the same listener to the
public internet for a phone that cannot join the tailnet; the token is then
the only gate, so rotate it if it ever leaks.

Grafana is bound to loopback too. Serve it the same way on another port —
`tailscale serve --bg --https=8443 http://localhost:3000` — or through your
proxy behind its own authentication; this is the only way to reach it from
other machines.

Keep the product API bound to `127.0.0.1:8081` and publish it on a separate
HTTPS port the same way:

```bash
tailscale serve --bg --https=8444 http://localhost:8081
```

## API

- `POST /v1/batches` — gzipped NDJSON batch. Line order: header, then samples,
  then deletions, then workout-route lines (`routeCount`), then workout-series
  lines (`seriesCount`), then aggregate lines (`aggregateCount`), then
  activity-summary lines (`activitySummaryCount`), then an optional profile line
  (`profileCount` 0 or 1). All counts past `deletionCount` are optional and
  default to 0 for old clients.
  `Authorization: Bearer $PULS_TOKEN`. The `X-User-ID` header (a UUID) attributes
  every row in the batch to that user (a `users` row); absent, it defaults to the
  seeded default user. Two optional wake-correlation headers are also recorded on
  the `batches` row: `X-Wake-ID` (a UUID identifying the iOS background/foreground
  wake that produced the upload — see the Background Activity export in the app)
  and `X-Wake-Trigger` (`observer | backgroundProcessing | backgroundContinued |
  foreground | manual`). Both are absent for old clients, curl, and work outside a
  wake; a malformed `X-Wake-ID` is the only one rejected (400). Returns
  `{"accepted":N,"deleted":M,"duplicates":K,"routePoints":P,"seriesPoints":S,"aggregateSamples":A,"activitySummaries":U}`.
  Idempotent on retry.
  Sample `kind` may be `quantity`, `category`, `workout`, `heartbeatSeries`
  (`heartbeats: [[secs, gap], …]`), `ecg` (`ecg: {classification, voltagesUV, …}`),
  `stateOfMind`, or `medicationDose`; each lands in its own table.
  A `workout` payload also carries `statisticsDetail` (per-type
  `{min,avg,max,sum}`), `events` (`[{type,start,end?,metadata?}]`), and
  `activities` (multi-sport sub-activities). Workout-series lines stream the
  intra-workout curves:
  `{"series":{"workoutUUID","type","unit","points":[{"t","value"}, …]}}` (split
  into ≤4,000-point chunks). The profile line carries the batch user's identity
  and characteristics:
  `{"profile":{"name","email","dateOfBirth","biologicalSex"}}` (epoch-ms DOB),
  replacing that user's complete profile snapshot. Null or omitted fields clear
  the stored values; omit the entire profile line to leave it unchanged. DOB/sex
  feed HR-zone math.
  Aggregate lines carry on-device `HKStatisticsCollectionQuery` buckets:
  `{"aggregate":{"type","func","intervalValue","intervalUnit","deviceFilter","bucketStart","bucketEnd","value","unit"}}`
  with `func` ∈ `sum|average|min|max|mostRecent|duration`, `intervalUnit` ∈
  `minute|hour|day|week|month`, `deviceFilter` ∈ `all|watch|iphone`,
  `intervalValue` ≥ 1 and `bucketEnd` > `bucketStart` (epoch ms). Unlike
  samples, buckets are recomputed and re-sent: the server **upserts** them
  (`aggregate_series` / `aggregate_samples`), and an explicit `"value":null`
  overwrites a previously stored value with NULL ("bucket is empty").
  Activity-summary lines carry one daily `HKActivitySummary` (the activity
  rings): `{"activitySummary":{"date","moveKcal","moveGoalKcal","exerciseMin",`
  `"exerciseGoalMin","standHours","standGoalHours","moveMode","moveTimeMin",`
  `"moveTimeGoalMin"}}` (`date` epoch ms at the start of the local day,
  `moveMode` ∈ `0` activeEnergy / `1` appleMoveTime, value/goal fields
  nullable). Like aggregates these are recomputed and re-sent (today's rings
  change all day), so the server **upserts** keyed on `date` (`activity_summaries`)
  and explicit nulls overwrite. Limits: compressed body ≤ 256 MB, decompressed
  NDJSON ≤ 128 MB, each declared count ≤ 100,000, combined declared lines
  ≤ 200,000, route and series points ≤ 100,000 each per batch, and a single
  NDJSON line ≤ 4 MB (the largest real lines — ECG voltages and 4,000-point
  route chunks — run ~400 KB).
- `GET /v1/stats` — per-type row counts/bounds + batch bookkeeping (auth required).
- `GET /v1/digest?type=&from=&to=` — per-UTC-month `{window, rows, digest}` where
  digest is the XOR of all sample UUID bytes; the app uses it to detect drift
  (auth required).
- `GET /v1/uuids?type=&from=&to=` — sample UUIDs for one window, range capped at
  35 days (auth required).
- `GET /v1/routes` — route-backed workout summaries for external route consumers
  (e.g. route-visualisation tools); accepts optional
  `start`, `end`, `activityType`, `minDistanceM`, `maxDistanceM`, `limit`, and
  `offset` query parameters (auth required).
- `GET /v1/routes/{uuid}` — one route-backed workout plus ordered GPS points
  (auth required).
- `GET /v1/routes/{uuid}/metrics` — intra-workout metric streams for the route
  (auth required).
- `GET /healthz` — liveness + DB ping (no auth).

Every authenticated ingest read accepts the same optional `X-User-ID` UUID as
uploads and returns only that user's rows. Omitting it selects the seeded
default user for backward compatibility.

## Product API

The product read API is a separate Go service bound to loopback on port 8081.
Expose it through an authenticated HTTPS proxy such as Tailscale Serve; do not
publish the bearer-token endpoint directly on the LAN. It does not share the
phone ingest token: clients send `Authorization: Bearer $PULS_API_TOKEN`, while
ingest keeps using `PULS_TOKEN` on port 8080. The service connects to Postgres
as the read-only `api_reader` role. That role is limited to schema usage plus
`SELECT` grants; it is not the ingest/write credential.

`/v1/catalog/types` is cached briefly by the API service because it computes
per-type row counts and time bounds. It includes aggregate-only types;
`rawRows` and `aggregateRows` name the two storage grains and `rows` is their
sum. Timestamps are epoch milliseconds, time ranges use `[start, end)`, and
valid queries with no matching rows return empty arrays rather than errors.

The service publishes its own discovery surface:

- `GET /` — JSON index with docs and OpenAPI links.
- `GET /docs` — browser-readable endpoint reference.
- `GET /openapi.json` — OpenAPI 3.1 document for tools and downstream services.
- `GET /healthz` — liveness and DB ping.

Other services should store the base URL as `PULS_API_BASE_URL` and the bearer
token as `PULS_API_TOKEN`.

```bash
curl -s -H "Authorization: Bearer $PULS_API_TOKEN" \
  http://localhost:8081/v1/catalog/types | python3 -m json.tool
```

- `GET /v1/profile`
- `GET /v1/catalog/types`
- `GET /v1/metrics/latest?types=...`
- `GET /v1/metrics/daily?types=...&start=...&end=...`
- `GET /v1/activity/summary?start=...&end=...`
- `GET /v1/workouts?start=...&end=...&limit=50&offset=0`
- `GET /v1/workouts/{uuid}`
- `GET /healthz`

Fixture-writing integration tests for this service require
`PULS_API_WRITE_INTEGRATION_TESTS=1` and should not be run against live or
shared databases.

### Verify ingest with curl

```bash
source .env

cat > /tmp/puls-fixture.ndjson <<'EOF'
{"batchID":"0a4fdc4e-9f3b-4f7e-9a64-0c2f7a1b9d11","deviceID":"curl-test","type":"HKQuantityTypeIdentifierHeartRate","reason":"manual","exportedAt":1718000000000,"sampleCount":2,"deletionCount":1,"aggregateCount":1,"activitySummaryCount":1}
{"uuid":"7f3e2b9a-1c4d-4e5f-8a6b-9c0d1e2f3a4b","type":"HKQuantityTypeIdentifierHeartRate","kind":"quantity","start":1718000000000,"end":1718000005000,"value":62.5,"unit":"count/min","sourceName":"Apple Watch","sourceBundleID":"com.apple.health","sourceVersion":"10.0","device":"Apple Watch","metadata":{"HKMetadataKeyHeartRateMotionContext":1}}
{"uuid":"8a4f3c0b-2d5e-4f6a-9b7c-0d1e2f3a4b5c","type":"HKQuantityTypeIdentifierHeartRate","kind":"quantity","start":1718000010000,"end":1718000015000,"value":64.0,"unit":"count/min","sourceName":"Apple Watch","sourceBundleID":"com.apple.health","sourceVersion":"10.0"}
{"deleted":{"uuid":"9b5a4d1c-3e6f-4a7b-8c8d-1e2f3a4b5c6d","type":"HKQuantityTypeIdentifierHeartRate"}}
{"aggregate":{"type":"HKQuantityTypeIdentifierHeartRate","func":"average","intervalValue":1,"intervalUnit":"hour","deviceFilter":"watch","bucketStart":1718000000000,"bucketEnd":1718003600000,"value":62.4,"unit":"count/min"}}
{"activitySummary":{"date":1718000000000,"moveKcal":420.5,"moveGoalKcal":600.0,"exerciseMin":25.0,"exerciseGoalMin":30.0,"standHours":9.0,"standGoalHours":12.0,"moveMode":0,"moveTimeMin":null,"moveTimeGoalMin":null}}
EOF

gzip -c /tmp/puls-fixture.ndjson | curl -sS \
  -X POST http://localhost:8080/v1/batches \
  -H "Authorization: Bearer $PULS_TOKEN" \
  -H "Content-Type: application/x-ndjson" \
  -H "Content-Encoding: gzip" \
  -H "X-Batch-ID: 0a4fdc4e-9f3b-4f7e-9a64-0c2f7a1b9d11" \
  -H "X-User-ID: 5ea4d000-0000-4000-8000-000000000001" \
  -H "X-Wake-ID: 11111111-2222-4333-8444-555555555555" \
  -H "X-Wake-Trigger: observer" \
  --data-binary @-
# → {"accepted":2,"deleted":0,"duplicates":0,"routePoints":0,"seriesPoints":0,"aggregateSamples":1,"activitySummaries":1}
# Run it again → {"accepted":0,"deleted":0,"duplicates":2,"routePoints":0,"seriesPoints":0,"aggregateSamples":0,"activitySummaries":0}
#   (the batch ID is reserved before health-data mutations, so a retry exits early)

curl -s -H "Authorization: Bearer $PULS_TOKEN" http://localhost:8080/v1/stats | python3 -m json.tool
```

### Analysing background wakes

Every upload writes one `batches` row stamped with `received_at` (server time),
`wake_id`/`trigger` (the iOS wake that produced it), `bytes`, `parse_ms`,
`insert_ms`, and the per-kind counts. That's enough to reconstruct how often the
device got execution time and what each wake did — pair it with the device-side
wake export (app → Log tab → Background Activity → Export) for the full picture
(durations, gaps, expirations, Low Power Mode).

```bash
# Uploads per hour over the last 14 days, by trigger.
docker compose exec db psql -U postgres -d postgres -c "
  SELECT date_trunc('hour', received_at) AS hour, trigger,
         count(*) AS batches, sum(sample_count) AS samples, sum(bytes) AS bytes
  FROM batches WHERE received_at > now() - interval '14 days'
  GROUP BY 1, 2 ORDER BY 1 DESC, 2;"

# One row per wake: when, what triggered it, how much it carried, server timings.
docker compose exec db psql -U postgres -d postgres -c "
  SELECT min(received_at) AS at, trigger, count(*) AS batches,
         sum(sample_count) AS samples, sum(bytes) AS bytes,
         max(parse_ms) AS parse_ms, max(insert_ms) AS insert_ms
  FROM batches WHERE wake_id IS NOT NULL AND received_at > now() - interval '7 days'
  GROUP BY wake_id, trigger ORDER BY at DESC;"

# Dump the raw batch log to CSV for offline analysis.
docker compose exec db psql -U postgres -d postgres -c "
  COPY (SELECT received_at, wake_id, trigger, type_identifier, reason,
               sample_count, deletion_count, aggregate_count,
               activity_summary_count, bytes, parse_ms, insert_ms
        FROM batches WHERE received_at > now() - interval '14 days'
        ORDER BY received_at) TO STDOUT CSV HEADER" > batches_14d.csv
```

## Grafana

Open `http://localhost:3000` on the host (or through your TLS proxy, e.g.
`https://<machine>.<tailnet>.ts.net:8443` with Tailscale Serve), log in as
`$GRAFANA_USER` (defaults to `admin`) /
`$GRAFANA_PASSWORD`. The
TimescaleDB datasource (read-only `grafana` DB role) and two dashboards are
provisioned automatically:

- **PulsHealth** (`puls-health`, 15 min refresh) — health data only: heart
  rate (with workout annotations), daily steps, on-device aggregate series
  (`aggregate_samples`, pick series via the *Aggregate series* variable), a
  templated metric explorer over `quantity_rollups` (*Metric*/*Bucket*
  variables), sleep stage timeline + minutes-per-night, resting HR and HRV
  7-day trends, workouts table, GPS route geomap (*Route* variable lists
  workouts that have route points), state of mind, medication doses. Daily
  bucketing uses the hidden `tz` query variable, which reads
  `puls_time_zone()` — the database's `PULS_TIME_ZONE` setting — on dashboard
  load, so the panels agree with `metric_daily` and the API.
  Every health query, annotation, and data-backed selector is filtered by the
  *User* variable, a query over `users` that resolves to the first (seeded)
  user on load.
- **PulsHealth Ops** (`puls-ops`, 1 min refresh) — ingest health: last-batch
  age stat (yellow > 2 h, red > 6 h), batches/hour, ingest latency,
  samples/aggregates/deletions per day, and per-type row counts (quantity
  counts come from the `quantity_rollups` rollup, not full hypertable scans).

The two dashboards cross-link via dashboard-tag links in the top nav.

### Alerting

Dashboards only help when someone is looking at them. On 2026-08-13 ingest
returned 500 on every batch for 28 hours while "Last Batch Age" sat red on a
screen nobody had open. Four rules in
`grafana/provisioning/alerting/rules.yml` now push instead:

| Rule | Fires when | Detects in | Why that threshold |
|---|---|---|---|
| Ingest is rejecting batches | > 10 rejections in 30 min | ~10 min | The outage produced ~85/hour; the benign `context canceled` class runs 1–2 per *month*. Nothing lives between those numbers. |
| A batch is stuck on a rejected page | the same 4xx message in ≥ 3 distinct hours of the last 6 | ~3 h | A page the server deterministically rejects (unknown line type after a client-first update, oversized line, out-of-range value) is re-sent about once an hour and never reaches the rate rule above; the client does not retry 4xx, so that type is stalled until server or client is fixed. |
| Ingest stalled | no batch for > 14 h | 14.5 h | Measured against 60 days of `batches`: only 2 normal gaps exceeded 14 h, versus 7 at 12 h and 22 at 10 h. |
| Lookup sequence near exhaustion | any smallint identity sequence > 95% | ~5 min | Would have prevented the outage entirely. Not 80%, because `sources_source_id_seq` legitimately sits at ~90% with unreclaimable gaps and a permanently-red rule gets muted. |

To re-derive the staleness threshold after usage patterns change:

```sql
SELECT thr, count(*) FILTER (WHERE gap > thr) AS false_alarms_60d FROM (
  SELECT received_at - lag(received_at) OVER (ORDER BY received_at) AS gap
  FROM batches WHERE received_at > now() - interval '60 days'
) s, (VALUES (interval '10 hours'),(interval '12 hours'),
             (interval '14 hours'),(interval '18 hours')) t(thr)
WHERE gap IS NOT NULL GROUP BY thr ORDER BY thr;
```

The sequence rule needs `SELECT` on the sequences — without it
`pg_sequences.last_value` reads NULL for the `grafana` role and the rule
evaluates to 0 forever. `099_read_roles.sh` grants it; on a database created
before that change, apply it by hand:

```bash
docker compose exec -T db psql -U postgres -d postgres \
  -c "GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO grafana;" \
  -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO grafana;"
```

**Email delivery needs one manual step.** Rules always evaluate and always
turn the UI red, but `GF_SMTP_ENABLED` defaults to `false` so a deploy can
never fail on a missing credential. To turn mail on, put a Gmail **App
Password** (not the account password — needs 2-Step Verification, from
<https://myaccount.google.com/apppasswords>) in `GRAFANA_SMTP_PASSWORD`, set
`GRAFANA_SMTP_USER`, flip `GRAFANA_SMTP_ENABLED=true`, then:

```bash
docker compose up -d grafana
```

Verify end to end in the UI: **Alerting → Contact points → puls-email → Test**.
If that email does not arrive, the alerts will not arrive either. The
recipient is `GRAFANA_ALERT_EMAIL` from `.env` (see "Configuration"); Compose
defaults it to `alerts@example.com` so a missing variable cannot expand to an
empty recipient — check the contact point shows your address.

## Backup & restore

**The reference stack ships no backups.** Nothing in this repo dumps, copies,
or verifies the database: the live Postgres volume is the only copy of the
data until you add something yourself. A nightly `pg_dump` on the host copied
off the machine is the minimum; at the very least take one by hand before any
schema change (see "Deploying and upgrading").

If you add backups, note that TimescaleDB restores require
`timescaledb_pre_restore()` / `timescaledb_post_restore()` and **never**
`pg_restore -j`.

## Development

```bash
cd ingest
go vet ./... && go test ./...                  # unit tests, no DB needed
# Integration test against the compose database:
docker compose up -d db
DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres" go test -run Integration ./...
# ...or as the scoped ingest role (after opting in, see above); the superuser
# URL is still needed for the tests' DDL and compress_chunk setup steps:
DATABASE_URL="postgres://ingest:$INGEST_DB_PASSWORD@localhost:5432/postgres" \
ADMIN_DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres" \
  go test -run Integration ./...
```
