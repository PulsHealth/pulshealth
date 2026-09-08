# PulsHealth Server

Self-hosted ingestion stack for Apple HealthKit data exported by the
PulsHealth iOS app. Four published app images plus Grafana, PostgreSQL and a
one-shot schema migrator via Docker Compose:

| Service | Image | Port | Purpose |
|---|---|---|---|
| `db` | `timescale/timescaledb-ha:pg17.11-ts2.29.2` (pinned — see "Upgrading the database image") | 127.0.0.1:5432 | PostgreSQL 17 + TimescaleDB |
| `migrate` | same pinned image as `db` (one-shot) | — | Applies `db/migrations/` before the app services start, on every `docker compose up -d` (see "Schema migrations") |
| `ingest` | `ghcr.io/pulshealth/ingest:${PULS_VERSION:-latest}` (Go, distroless; source in `ingest/`) | `${INGEST_BIND_ADDR:-127.0.0.1}:8080` | HTTP ingest API — expose it through a TLS-terminating proxy of your choice, or on your own LAN with `INGEST_BIND_ADDR=0.0.0.0` (see "Exposing the server"); connects as the scoped DML-only `ingest` role (see "The scoped `ingest` role") |
| `api` | `ghcr.io/pulshealth/api:${PULS_VERSION:-latest}` (Go, distroless; `api/`) | 127.0.0.1:8081 | Product read API for downstream apps |
| `mcp` | `ghcr.io/pulshealth/mcp:${PULS_VERSION:-latest}` (Go, distroless; `mcp/`) | 127.0.0.1:8082 | Read-only MCP server for AI assistants over the product API (`docs/ai.md`) |
| `grafana` | `grafana/grafana:13.0.2` (pinned — 13.x provisioning is version-sensitive) | 127.0.0.1:3000 | Dashboards (reach them through the same kind of TLS proxy, e.g. Tailscale Serve on `:8443`) |
| `web` | `ghcr.io/pulshealth/web:${PULS_VERSION:-latest}` (Next.js standalone; `../web/`) | `${WEB_BIND_ADDR:-127.0.0.1}:3001` | Web health viewer — reads the DB directly as the read-only `grafana` role |

The four app images are pulled from `ghcr.io/pulshealth` by default (see
"Images and versions"); the `compose.build.yml` overlay builds them from the
checkout instead. The `web` one builds from the sibling `../web/` directory,
so build from a checkout that contains both `server/` and `web/`.

```
server/
├── docker-compose.yml    # the stack: pulls the published images
├── compose.build.yml     # developer overlay: build the app images from here
├── .env.example          # copy to .env, fill in secrets (scripts/bootstrap.sh does it)
├── api/                  # Go product read API + Dockerfile
├── ingest/               # Go ingest server + Dockerfile
├── mcp/                  # Go MCP server + Dockerfile
├── db/migrate.sh         # schema migrator, run by the `migrate` service
├── db/migrations/        # numbered schema files it applies, in order
├── grafana/              # provisioned datasource + dashboard
```

## Setup

The fast path is the bootstrap script at the repository root: it creates
`.env` with every secret generated, starts the stack, waits for ingest and
prints the pairing block for the app (URL, token, user ID, QR code). It is
safe to re-run, and `--print-pairing` (`make pairing`) re-prints the block.

```bash
scripts/bootstrap.sh --time-zone Europe/Berlin    # the root README's "Quickstart" has the rest
```

By hand, it is:

```bash
cd server
cp .env.example .env
# Generate secrets (run once per variable):
openssl rand -hex 32
# Edit .env: POSTGRES_PASSWORD, PULS_TOKEN, PULS_API_TOKEN, PULS_MCP_TOKEN,
# GRAFANA_PASSWORD, GRAFANA_DB_PASSWORD, API_DB_PASSWORD, INGEST_DB_PASSWORD —
# and PULS_TIME_ZONE (see "Configuration" below).

docker compose up -d                 # pulls the images; db → migrate (schema) → ingest, api, mcp, web, grafana
docker compose logs migrate          # one line per schema file: applied / skipped / rerun
curl -s localhost:8080/healthz       # → {"db":true,"ok":true}
curl -s localhost:8081/healthz       # → {"db":true,"ok":true}
```

That is the whole install: the `migrate` service creates the schema on an
empty volume, records what it applied, and every app service waits for it
to finish. The same command, after a `docker compose pull`, upgrades a
running install later. To run the code in this checkout instead of the
published images, add the developer overlay —
`docker compose -f docker-compose.yml -f compose.build.yml up -d --build`,
or `make dev-up` at the repository root.

### Configuration

Everything is read from `.env` (`.env.example` lists every variable with
comments). Beyond the passwords and tokens, two settings deserve attention:

- **`PULS_TIME_ZONE`** — the IANA zone your phone lives in (e.g.
  `Europe/Berlin`); defaults to `UTC`. Every daily view buckets by this
  calendar: the `metric_daily` view, Grafana's daily panels, the product API's
  local-day ranges, and the web viewer. It has to match the phone because the
  daily aggregates HealthKit computes on-device are already in the phone's
  local calendar — a mismatch splits days between two rows. The `migrate`
  service stores it on the database on every start:
  `db/migrations/013_time_zone.sh` validates it against `pg_timezone_names`
  (the stack refuses to start on an unknown name) and writes it with
  `ALTER DATABASE … SET puls.time_zone`, which the `puls_time_zone()` SQL
  function reads. Compose hands the same value to the `api` and `web`
  containers (the API refuses to start on an invalid name). To change the
  zone later:

  ```bash
  # 1. set the new PULS_TIME_ZONE in .env
  # 2. migrate re-stores it, and Compose recreates api/web because their
  #    environment changed; the data volume is untouched:
  docker compose up -d
  docker compose exec db psql -U postgres -d postgres -tAc "SELECT puls_time_zone()"
  ```

  The setting applies to new connections only (ingest and Grafana pick it up
  as their pools reconnect; `docker compose restart ingest grafana` forces
  it). Stored rows are never rewritten; the daily views simply re-bucket on
  read, and Grafana's hidden `tz` variable re-queries it on dashboard load.
- **`GRAFANA_ALERT_EMAIL`** — the recipient of every Grafana alert
  (`grafana/provisioning/alerting/contact-points.yml` templates it). Compose
  defaults it to `alerts@example.com` so the contact point always has an
  address; set it to your own. Mail only leaves once SMTP is configured — see
  "Alerting".
- `WEB_BIND_ADDR` — the web viewer is unauthenticated and defaults to
  loopback. To reach it from other machines bind it to a private interface
  (a VPN/tailnet address), never `0.0.0.0`.
- `INGEST_BIND_ADDR` — where ingest's port 8080 is published; defaults to
  loopback, which is right whenever a TLS proxy sits in front of it.
  `0.0.0.0` — what `scripts/bootstrap.sh --lan` writes — publishes it on
  every interface so a phone on the same Wi-Fi can sync to plain
  `http://<this host's LAN IP>:8080` with no proxy at all. See "Exposing the
  server" for the trade-off.
- `TRUST_PROXY_HEADERS` — whether ingest believes `X-Forwarded-For` when
  attributing a failed authentication to a client. Default `false`. Turn it
  on only behind a proxy that owns that header — see "Rate limiting".
- `PULS_VERSION` — which image tag the four app services run (`latest` when
  unset); `PULS_PUBLIC_URL` — the URL the pairing block should carry instead
  of the LAN address (read by `scripts/bootstrap.sh` only). See "Images and
  versions" and "Exposing the server".

## Deploying and upgrading

The reference stack is plain Docker Compose; there is no deploy tooling in the
repo. A running install upgrades by moving to newer images:

```bash
git pull                                         # newer compose file and migrations
cd server
# optional: pin the release in .env, e.g. PULS_VERSION=1.3.0 (default: latest)
docker compose pull && docker compose up -d      # or, at the repository root: make pull up
docker compose logs migrate                      # what the schema step did
curl -s localhost:8080/healthz && curl -s localhost:8081/healthz
```

`docker compose up -d` always runs the `migrate` service before it
(re)starts `ingest`, `api`, `mcp`, `web` and `grafana`, so a revision that
adds a schema file applies it before the code that depends on it comes up.
If a migration fails, the app services are not started and `docker compose
up` reports `dependency failed to start`; the containers from the previous
revision are left running as they were. Fix the cause and `docker compose
up -d` again. **Take a `pg_dump` before upgrading**: the stack ships no
backup service (see "Backup & restore"), so the live volume is the only
copy. Re-applying the schema from scratch means dropping the volume
(`docker compose down -v && docker compose up -d`), which **destroys all data
irrecoverably**.

### Images and versions

The four app services run images published from this repository:

| Service | Image | Reports its build as |
|---|---|---|
| `ingest` | `ghcr.io/pulshealth/ingest` | `version` in `GET /v1/capabilities` |
| `api` | `ghcr.io/pulshealth/api` | — |
| `mcp` | `ghcr.io/pulshealth/mcp` | `--version`, and `serverInfo` on MCP `initialize` |
| `web` | `ghcr.io/pulshealth/web` | — |

`.github/workflows/release.yml` builds all four for `linux/amd64` and
`linux/arm64` (natively, one runner per architecture, merged into a single
manifest list) and every image carries the commit it was built from as the
`org.opencontainers.image.revision` label. The tags:

- On a git tag `vX.Y.Z`: the exact version (`1.2.3`), a floating `1.2`, and
  `latest`. `latest` and `1.2` move only for non-prerelease tags, so a
  `v1.3.0-rc1` publishes `1.3.0-rc1` and nothing else floats onto it.
- On a manual run of the workflow (`workflow_dispatch`, e.g. from `main`
  before the first tag): the tag given as input, or the short commit SHA.
  Never `latest`.

`PULS_VERSION` in `.env` selects the tag; unset, it is `latest`. Pinning a
release (`PULS_VERSION=1.2.3`) makes upgrades deliberate: bump it, then
`docker compose pull && docker compose up -d` (`make pull up`). The `migrate`
service runs first and applies any schema files the new release brought, and
the app containers start only after it exits 0. Migrations are forward-only,
so going back to an older image after a release that migrated the schema is
not supported — take a `pg_dump` before upgrading. The database image is
versioned separately (`x-db-image` in `docker-compose.yml`; see "Upgrading
the database image").

To run what is in the checkout — a local change, a branch under review, or
a fresh clone before any image has been published — add the developer
overlay, which puts the `build:` blocks back and tags the results
`pulshealth-<service>:dev` so they never masquerade as a published version:

```bash
cd server && docker compose -f docker-compose.yml -f compose.build.yml up -d --build
# or, at the repository root:
make dev-up                                      # sets DEPLOY_COMMIT from git
scripts/bootstrap.sh --build                     # the bootstrap flow, building instead of pulling
```

A plain `docker compose up -d` afterwards switches the containers back to
the `ghcr.io/pulshealth` images (pulling them if needed). Every pull request
builds the four images for `linux/amd64` in CI (`images` job in `ci.yml`),
so a broken Dockerfile fails there rather than at release time.

### Schema migrations

`db/migrate.sh`, run by the `migrate` Compose service (the same pinned
`timescale/timescaledb-ha` image as `db`, so `psql` and `bash` are there and
nothing is built), applies the files in `db/migrations/` in lexical
order and records each one in a `schema_migrations` table (`filename`,
`applied_at`, `checksum`). It runs on every `docker compose up -d` and by
hand with `docker compose run --rm migrate`. It logs one line per file —
`applied`, `skipped`, `rerun` or `ran` — and a summary line.

| File | Behaviour |
|---|---|
| `NNN_name.sql` | One-shot. Applied once, inside a single transaction together with its `schema_migrations` row (`psql --single-transaction`, `ON_ERROR_STOP`), so a failed file leaves nothing behind and is retried on the next run. Applied files are immutable: the migrator refuses to continue when a recorded file's checksum no longer matches (edit a new file, never an applied one) or when a recorded file is missing (never rename or delete one). |
| `-- puls:rerun` on the first line | Re-runnable: applied whenever its checksum differs from the recorded one, and the record is updated. For files that are `CREATE OR REPLACE` or upserts by design — `009_metric_daily.sql` (the view and `puls_time_zone()`) and `010_category_labels.sql` (the label seed, refreshed after SDK updates). Edit those in place. |
| `-- puls:no-transaction` on the first line | Applied statement by statement instead of under one transaction, for a file with a statement that cannot run in a transaction block (`008_quantity_rollups.sql`: `refresh_continuous_aggregate`). Such a file must be idempotent, since a mid-file failure is retried from the top. |
| `NNN_name.sh` | Run on every invocation, never recorded: `013_time_zone.sh` (stores `PULS_TIME_ZONE`) and `099_read_roles.sh` (creates the `grafana`, `api_reader` and `ingest` roles and rotates their passwords to the `.env` values, so rotating a database password is "edit `.env`, `docker compose up -d`"). They read `GRAFANA_DB_PASSWORD`, `API_DB_PASSWORD`, `INGEST_DB_PASSWORD` and `PULS_TIME_ZONE`, which Compose passes to the service. |

**Adding a migration.** Create the next `NNN_name.sql` (three digits, an
underscore, a name), write plain DDL/DML — no `BEGIN`/`COMMIT`, the migrator
wraps it; `IF NOT EXISTS` is still welcome — and `docker compose up -d`.
Fresh installs and existing installs take the same path. Tables created this
way are readable by `grafana` and writable by `ingest` at once through the
default privileges `099_read_roles.sh` sets; `api_reader` has an exact grant
list, so extend that script (and its assertion) when the product API needs a
new table. Never edit a file that has been applied anywhere — put the change
in a new file. Ordering between schema and code is automatic: `migrate`
applies every pending file before `ingest` starts, which is why files such
as `003_aggregates.sql`, `005_activity_summaries.sql`,
`006_workout_enhanced.sql`, `007_wake_telemetry.sql` and
`011_temporal_contexts.sql` — all referenced unconditionally by
`InsertBatch` — are in place before the build that writes them comes up.

**Existing databases (created before the migrate service): baseline once.**
A database that has the schema but no `schema_migrations` table makes the
migrator stop with exit 1 rather than guess which files it contains, so
`docker compose up -d` will not start the app services until you tell it.
If every file in `db/migrations/` has already been applied to it — true for
any database created by the old first-start init and kept current by hand —
record that:

```bash
git pull
# add INGEST_DB_PASSWORD=<openssl rand -hex 32> to .env (see "The scoped ingest role")
cd server
docker compose run --rm migrate baseline
docker compose up -d --build
```

`baseline` records every `*.sql` file as applied, with its checksum,
**without running any of them**, runs the `*.sh` files (so the `ingest` role
exists before ingest starts), and prints what it recorded. Re-runnable files
are recorded without a checksum, so the `docker compose up -d` that follows
applies `009_metric_daily.sql` and `010_category_labels.sql` once. Both are
`CREATE OR REPLACE`/upsert, so that is safe whatever state their objects were
in — a database created before `puls_time_zone()` existed gets the current
`metric_daily` this way with no manual step; if you prefer, apply such a file
by hand before or after the baseline instead. If a one-shot file has *not*
been applied to your database, apply it by hand first, then baseline:

```bash
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < db/migrations/NNN_name.sql
```

The first `docker compose up -d` after this change also recreates the `db`
container (its definition lost the init-script mount and the role passwords,
and its image is now pinned rather than the floating `pg17` tag); the data
volume is untouched, but a database created from the older floating tag now
runs under a newer TimescaleDB binary — read "Upgrading the database image"
below before or right after adopting it.

### Upgrading the database image

`docker-compose.yml` pins PostgreSQL + TimescaleDB to one exact tag
(`x-db-image`, shared by `db` and `migrate` so they cannot drift; currently
`timescale/timescaledb-ha:pg17.11-ts2.29.2`). The floating `pg17` tag moves
TimescaleDB minor versions underneath running installs — 2.27 → 2.29 changed
its internal catalog and broke the role script until it was rewritten
against the public `timescaledb_information` views — so bumping the tag is a
deliberate step. What was verified for this pin, on a volume created by the
2.27.1 image with compressed chunks, a continuous aggregate and the three
roles:

- **The image does not upgrade the extension by itself.** It ships every
  versioned `timescaledb-*.so` back to 2.17 and its only initdb hook is a
  `CREATE EXTENSION` that runs on a brand-new volume, so the old database
  starts under the new image and keeps working on its old extension
  (`extversion` stays `2.27.1`, queries and `migrate` run). `migrate` prints
  a NOTE whenever the installed extension differs from the one the image
  ships.
- **Upgrade the extension yourself, deliberately** — in a fresh session
  (`psql -X`, first statement) with no app service connected, after a
  `pg_dump`; extension updates are one-way:

  ```bash
  docker compose stop ingest api web grafana
  docker compose exec db psql -X -U postgres -d postgres -c "ALTER EXTENSION timescaledb UPDATE"
  docker compose up -d
  ```

  Verified 2.27.1 → 2.29.2: the update drops the old `_compressed_hypertable_N`
  parents, keeps the existing compressed chunks (and their grants) under
  their old `compress_hyper_N_M_chunk` names next to new `<chunk>_compressed`
  ones, and `migrate` — `099_read_roles.sh` included — runs clean before and
  after it.
- Bump the tag in `docker-compose.yml` only: CI's `db-migrate` job and
  `tests/test_healthkit_notebook.py` read the image from there.

### The scoped `ingest` role

Ingest is the only internet-facing service, so it does not hold the
superuser password: Compose connects it as the `ingest` role
(`INGEST_DB_USER` defaults to `ingest`; `INGEST_DB_PASSWORD` is required),
which `099_read_roles.sh` creates on every migrate run holding exactly what
`ingest/store.go` needs: `CONNECT`, `USAGE` on `public`,
`SELECT/INSERT/UPDATE/DELETE` on every table and view in `public`,
`USAGE/SELECT` on its sequences, and default privileges so tables and
sequences added by future migrations are covered too. It has no `CREATE` on
the schema, no `TRUNCATE`, and none of `SUPERUSER`, `CREATEROLE`,
`CREATEDB`, `REPLICATION` or `BYPASSRLS`, so an ingest bug or a leaked
`PULS_TOKEN` cannot drop tables, alter roles, or `COPY TO PROGRAM`.
TimescaleDB propagates the grants to hypertable chunks (existing ones on
grant, new ones as they are created), and the `SET LOCAL
timescaledb.max_tuples_decompressed_per_dml_transaction` that `InsertBatch`
issues is a user-settable GUC; the script proves both, plus the exact role
attributes and ACL set, before it commits.

To run ingest as the superuser instead (not recommended), set
`INGEST_DB_USER=postgres` and `INGEST_DB_PASSWORD` to the same value as
`POSTGRES_PASSWORD` in `.env`, then `docker compose up -d ingest`. Either
way, verify who is connected:

```bash
docker compose exec db psql -U postgres -d postgres -tAc \
  "SELECT DISTINCT usename FROM pg_stat_activity WHERE client_addr IS NOT NULL"
# → api_reader, grafana, ingest
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS -H "Authorization: Bearer $PULS_TOKEN" http://127.0.0.1:8080/v1/stats
```

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
adding support for newly exposed HealthKit category types. It carries the
`-- puls:rerun` marker and its insert is an upsert, so after editing it
`docker compose up -d` re-applies it; then verify the expected seed shape:

```bash
docker compose exec db psql -U postgres -d postgres -tA \
  -c "SELECT count(*), count(DISTINCT type_identifier) FROM category_labels;"
# iPhoneOS 26.5 SDK seed: 257|70
```

`000_users.sql` adds the `users` table (which the per-row `user_id` foreign keys
and the profile line's user upsert reference) and seeds the default user. It runs
first on a fresh volume; there is no in-place migration for the `user_id`
columns, so adding users to a database with existing data means a full reset —
drop the volume, let `migrate` rebuild the schema, and resync from the app.

### The token

`PULS_TOKEN` is a single static bearer token shared by the server and the iOS
app. Create it with `openssl rand -hex 32` (or let `scripts/bootstrap.sh`
do it), put it in `.env`, and paste the same value into PulsHealth's server
settings — the pairing block (`make pairing`) shows it next to the URL and
user ID.

### Rate limiting

One static token on a published port is guessable, so ingest throttles **failed
authentications** per client IP. Each address gets a token bucket holding **10
failures**, refilling at **10 per minute**. While the bucket has tokens a wrong
token answers `401` as before; once it is empty every attempt from that address
answers

```
HTTP/1.1 429 Too Many Requests
Retry-After: 7

{"error":"too many failed authentications"}
```

and the server logs `auth attempts throttled` with the address, the path and
the wait. Two properties matter:

- **A correct token is never throttled.** Only failures draw from the bucket, so
  a backfill — thousands of authenticated uploads in a row — never touches it,
  and neither does a device that has simply been syncing for months.
- **An exhausted address is refused *before* the token is compared.** Charging a
  failure but still answering `401`/`200` would leave the guessing rate
  untouched and only change the status code; refusing first is what makes this
  a brute-force limit. The cost is that a client sharing an address with an
  attacker waits too — buckets are small and refill in a minute, and a client
  that never fails never has a bucket at all.

Memory is bounded: only failures create an entry, entries that have refilled
and gone idle for ten minutes are forgotten, and a hard cap of 10,000 tracked
addresses drops the least recently seen first, so an attacker rotating IPv6
source addresses cannot grow the table.

The limit is keyed on the TCP peer address. If a proxy terminates TLS in front
of ingest, every request appears to come from the proxy and one attacker
exhausts the shared bucket for everyone. Set **`TRUST_PROXY_HEADERS=true`** in
`.env` in that case and ingest keys on the first entry of `X-Forwarded-For`
instead. Only do that when the proxy is the *only* route to port 8080 and it
overwrites the header (reverse proxies, Tailscale Serve/Funnel do): the header
is otherwise set by whoever sends the request, and believing it lets a single
attacker look like an unlimited number of clients. Leave it at the default
`false` for `INGEST_BIND_ADDR=0.0.0.0` on a LAN.

Docker's userland proxy can also rewrite the source address to the bridge
gateway on some hosts. If `docker compose logs ingest` shows every throttled
client as the same `172.x.x.1`, that is what happened: have the TLS proxy in
front set `X-Forwarded-For` and turn `TRUST_PROXY_HEADERS` on.

The rate limit is not a substitute for a good token. `openssl rand -hex 32` is
256 bits; ten guesses a minute will not find it either way.

### Rotating secrets

`scripts/bootstrap.sh` never regenerates an existing `.env`: the app holds
`PULS_TOKEN` and the database volume holds `POSTGRES_PASSWORD`, so a fresh
set of secrets would strand both. Rotate one value at a time instead:

| Secret | How |
|---|---|
| `PULS_TOKEN` | Edit `.env`, `docker compose up -d ingest`, paste the new token into the app (`make pairing` shows it). |
| `PULS_API_TOKEN`, `PULS_MCP_TOKEN` | Edit `.env`, `docker compose up -d api mcp`, update the API consumers and AI clients (`docs/ai.md`). |
| `GRAFANA_DB_PASSWORD`, `API_DB_PASSWORD`, `INGEST_DB_PASSWORD` | Edit `.env`, `docker compose up -d`: `migrate` re-runs `099_read_roles.sh`, which sets the roles' passwords to the new values, and the containers restart with them. |
| `POSTGRES_PASSWORD` | The superuser password lives in the database, not in `.env`: `docker compose exec db psql -U postgres -c "ALTER USER postgres PASSWORD '<new>'"` first, then edit `.env` and `docker compose up -d`. |
| `GRAFANA_PASSWORD` | Read at Grafana's first start only; change it in Grafana's own UI (or `docker compose exec grafana grafana cli admin reset-admin-password <new>`), then update `.env` to match. |

## Exposing the server

The phone has to reach ingest's port 8080. There are two supported ways, and
`scripts/bootstrap.sh` builds the pairing block for either:

- **On your own LAN, in plain HTTP.** Set `INGEST_BIND_ADDR=0.0.0.0` in
  `.env` (`scripts/bootstrap.sh --lan`) and `docker compose up -d`; the phone
  uses `http://<this host's LAN IP>:8080`. The app accepts plain `http://`
  only for local-network hosts (`localhost`, `*.local`, `10.x`,
  `172.16–31.x`, `192.168.x`), so this works on the same Wi-Fi and nowhere
  else. The trade-off is that the traffic is readable by anything on that
  network and the bearer token is the only thing between it and your health
  data: use it on a network you control, never a shared one, and keep the
  default loopback bind everywhere else.
- **From anywhere, over HTTPS.** Keep ingest on loopback (the default) and
  put a TLS-terminating proxy in front of it. **Never open port 8080 to the
  internet and never serve it over plaintext beyond your LAN**: the bearer
  token is a second layer behind TLS, not a substitute for it. Tell the
  bootstrap script the proxy's URL (`scripts/bootstrap.sh --url
  https://<host>`, stored as `PULS_PUBLIC_URL`) and the pairing block and QR
  code carry it.

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

The wire format is versioned — the Puls Sync Protocol, currently **1**. A
client declares the version twice: as `"schemaVersion": 1` (integer) in the
batch header and as the `X-Puls-Protocol: 1` request header on every call.
Both are optional: a request carrying neither comes from a client that
predates versioning and is read with version-1 semantics. This server speaks
`[1]`. A batch whose `schemaVersion` or `X-Puls-Protocol` names any other
version, or whose two declarations disagree, is refused before decompression,
parsing, or any database work with HTTP 400 and the fixed body

```json
{"error":"unsupported protocol version","supportedVersions":[1]}
```

and is recorded in `ingest_rejections` (stage `protocol`). The app never
retries a 4xx, so this is the response it turns into a "server speaks a
different protocol version" message instead of stalling silently. Servers
older than this one ignore both declarations (unknown header fields and
request headers are tolerated), so a versioned client can still talk to them.

- `POST /v1/batches` — gzipped NDJSON batch. Line order: header, then samples,
  then deletions, then workout-route lines (`routeCount`), then workout-series
  lines (`seriesCount`), then aggregate lines (`aggregateCount`), then
  activity-summary lines (`activitySummaryCount`), then an optional profile line
  (`profileCount` 0 or 1). All counts past `deletionCount` are optional and
  default to 0 for old clients. The header also carries `schemaVersion` (the
  protocol version, above) and `clientVersion` (free text such as
  `"0.1.0 (1)"`, logged on the per-batch line, never stored); both are
  optional. A header-only batch — every count 0 — is valid and returns
  all-zero counts: the app sends one with `reason` `manual` as its connection
  probe against receivers that have no `/v1/capabilities`.
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
- `GET /v1/capabilities` — what this receiver speaks (auth required, so the
  app's "Test connection" step validates URL and token together here, before
  the first upload; a wrong token is a 401):
  `{"protocolVersions":[1],"features":["batches","stats","digest","uuids","aggregates","activitySummaries","routes","series","profile"],"server":"puls-ingest","version":"<git commit or dev>"}`.
  `version` is the image's `BUILD_COMMIT` build arg (compose passes
  `DEPLOY_COMMIT`); a plain `go run` reports `dev`. A receiver without this
  endpoint is probed with an empty batch instead (see `POST /v1/batches`).
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
{"batchID":"0a4fdc4e-9f3b-4f7e-9a64-0c2f7a1b9d11","deviceID":"curl-test","type":"HKQuantityTypeIdentifierHeartRate","reason":"manual","exportedAt":1718000000000,"schemaVersion":1,"clientVersion":"curl","sampleCount":2,"deletionCount":1,"aggregateCount":1,"activitySummaryCount":1}
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
  -H "X-Puls-Protocol: 1" \
  -H "X-Batch-ID: 0a4fdc4e-9f3b-4f7e-9a64-0c2f7a1b9d11" \
  -H "X-User-ID: 5ea4d000-0000-4000-8000-000000000001" \
  -H "X-Wake-ID: 11111111-2222-4333-8444-555555555555" \
  -H "X-Wake-Trigger: observer" \
  --data-binary @-
# → {"accepted":2,"deleted":0,"duplicates":0,"routePoints":0,"seriesPoints":0,"aggregateSamples":1,"activitySummaries":1}
# Run it again → {"accepted":0,"deleted":0,"duplicates":2,"routePoints":0,"seriesPoints":0,"aggregateSamples":0,"activitySummaries":0}
#   (the batch ID is reserved before health-data mutations, so a retry exits early)
# Send it with -H "X-Puls-Protocol: 2" (or "schemaVersion":2 in the header line)
#   → HTTP 400 {"error":"unsupported protocol version","supportedVersions":[1]}

curl -s -H "Authorization: Bearer $PULS_TOKEN" http://localhost:8080/v1/capabilities
# → {"protocolVersions":[1],"features":["batches","stats","digest","uuids","aggregates","activitySummaries","routes","series","profile"],"server":"puls-ingest","version":"…"}

# The app's connection probe for a receiver without /v1/capabilities: a
# header-only batch (fresh batchID each time, every count 0, reason "manual").
printf '%s\n' '{"batchID":"1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9","deviceID":"curl-test","type":"HKQuantityTypeIdentifierHeartRate","reason":"manual","exportedAt":1718000000000,"schemaVersion":1,"clientVersion":"curl","sampleCount":0,"deletionCount":0}' \
  | gzip -c | curl -sS -X POST http://localhost:8080/v1/batches \
  -H "Authorization: Bearer $PULS_TOKEN" -H "Content-Encoding: gzip" -H "X-Puls-Protocol: 1" \
  --data-binary @-
# → {"accepted":0,"deleted":0,"duplicates":0,"routePoints":0,"seriesPoints":0,"aggregateSamples":0,"activitySummaries":0}

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
evaluates to 0 forever. `099_read_roles.sh` grants it on every
`docker compose up -d`.

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

Run the stack from the checkout with the build overlay (`make dev-up` at
the repository root, or `docker compose -f docker-compose.yml -f
compose.build.yml up -d --build` here); see "Images and versions".

```bash
cd ingest
go vet ./... && go test ./...                  # unit tests, no DB needed
# Integration tests against the compose database (db + schema, nothing else):
docker compose up -d migrate
set -a; source ../.env; set +a
# As the scoped ingest role — what the stack connects as; the superuser URL is
# still needed for the tests' DDL and compress_chunk setup steps:
DATABASE_URL="postgres://ingest:$INGEST_DB_PASSWORD@localhost:5432/postgres" \
ADMIN_DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres" \
  go test -run Integration ./...
# ...or everything as the superuser:
DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres" go test -run Integration ./...
```
