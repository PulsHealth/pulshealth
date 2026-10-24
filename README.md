# PulsHealth

**Your Apple Health data. Your database. Your next project.**

Sync Apple Health to a database you control, export files for a spreadsheet,
and build dashboards or AI tools on your own history. PulsHealth includes an
iPhone and iPad app, a self-hosted stack, and an open sync protocol — all under
[Apache-2.0](LICENSE).

**[Try the dashboard demo](https://app.pulshealth.com/demo)** ·
**[Get the iOS app](https://apps.apple.com/us/app/pulshealth/id6757657354)** ·
**[Self-host it](docs/setup.md)** · **[Read the docs](https://pulshealth.com/docs/)**

<p align="center">
  <a href="https://app.pulshealth.com/demo"><img src="docs/images/web/today.png" alt="PulsHealth demo dashboard: activity rings and trends for steps, sleep, heart rate, HRV, and more" width="100%"></a>
</p>

*The working dashboard with demo data. [Open the interactive demo](https://app.pulshealth.com/demo)
without connecting your phone.*

## What can you build?

| You want to… | Start here |
|---|---|
| **Keep a health database you control** | [Docker setup](docs/setup.md): PostgreSQL + TimescaleDB, automatic phone sync, a web viewer, and Grafana |
| **Use your data in Excel or Python** | [Export CSV, JSON, or JSONL](docs/export.md#on-device-export-no-server) directly on your phone; no account or server needed |
| **Ask an AI assistant about your history** | [Connect read-only MCP tools](docs/ai.md) over the product API; your chosen AI provider receives the records it reads |
| **Build an app, dashboard, or automation** | [Product API](docs/api.md), [Python walkthrough](https://pulshealth.com/blog/analyze-apple-health-with-python/), and [Home Assistant integration](https://github.com/PulsHealth/home-assistant) |
| **Write your own receiver** | [Open protocol + fixtures](docs/protocol/README.md) and a [Python + SQLite example](examples/receivers/python-sqlite/README.md) |

### Why PulsHealth?

- **Start on your phone.** Explore types, sources, and charts before setting up
  anything. Export only the measurements and dates you choose.
- **Keep new data flowing.** Resumable history imports, incremental updates,
  deletions, activity rings, workout routes, and on-device aggregates.
- **Keep your options open.** Query SQL, use the read API, connect MCP, or replace
  the reference receiver with your own implementation of the documented protocol.
- **Inspect the whole path.** The Swift sync library, Go services, database
  migrations, viewer, and protocol are all in this repository.

The app is free to download. **Free includes full Explore, manual exports of all
supported types from the last 30 days, and sync of up to five distinct types
from the last 30 days.** Pro unlocks all available history and unlimited sync
types, subject to Health access. See [current plans](https://pulshealth.com/pricing/).
The self-hosted server is open source; running it does not remove the app's limits.
[Hosted accounts](https://app.pulshealth.com/signup) are also available, subject
to approval and availability.

If this is useful to you, **[star the repo](https://github.com/PulsHealth/pulshealth)**
to help other people discover it. Building something with it? Share your project
in [an issue](https://github.com/PulsHealth/pulshealth/issues).

## See the app

<p align="center">
  <img src="docs/images/app/explore.png" alt="Explore: browse Apple Health types and inspect their sources and recorded history" width="240">
  <img src="docs/images/app/type-page.png" alt="Heart Rate detail: synthetic sample history, coverage, and analysis" width="240">
  <img src="docs/images/app/export.png" alt="Export: choose raw samples, aggregates, date range, and CSV, JSON, or JSONL" width="240">
</p>

*Current source captures with synthetic Explore fixtures. Export shows the
builder, not a completed export. [Screenshot provenance](docs/images/README.md).*

<details>
<summary><strong>More screenshots: workouts and Grafana</strong></summary>

<p align="center">
  <img src="docs/images/web/workouts.png" alt="Demo workout list with duration, energy, distance, and totals for the latest 120 listed sessions" width="100%">
</p>

<p align="center">
  <img src="docs/images/server/grafana-health.png" alt="Provisioned Grafana dashboard with synthetic heart rate, steps, and sleep data" width="100%">
</p>

The web viewer uses the public demo account. Grafana shows a synthetic seed
in a throwaway stack; it is a separate dashboard from the blog tutorial.

</details>

> **Status:** the iOS app is on the App Store; the self-hosted backend is
> **pre-release (0.x)** and expects familiarity with Docker. Background delivery
> depends on iOS, Health access, and Watch-to-phone sync.
> **Backups are opt-in:** enable the `backup` Compose profile or run `make backup`,
> then test recovery on a scratch stack. See the [roadmap](docs/roadmap.md) and
> [backup guide](server/README.md#backup--restore).

## Architecture

```
┌────────────── iPhone ──────────────┐      ┌────────── your server ──────────┐
│ HealthKit store                    │      │                                 │
│   │ HKAnchoredObjectQuery (paged)  │      │  ingest (Go) ──► PostgreSQL 17  │
│   ▼                                │ HTTPS│   bearer auth     + TimescaleDB │
│ HealthSyncEngine (actor)           │─────►│   gzip NDJSON     hypertables,  │
│   per-type anchors, TaskGroup ×4   │      │   idempotent      compression   │
│   gzip NDJSON batches              │      │        │                        │
│   HKObserverQuery + bg delivery    │      │        ▼                        │
│   BGProcessingTask catch-up        │      │  product API · Grafana · web    │
└────────────────────────────────────┘      └─────────────────────────────────┘
```

Regular sync uploads only to the database you configure. Account sign-in and
one-time Data Requests are separate flows; a request sends an export only
after you review its destination and choose to send it. Any HTTP server that
accepts the batch format can stand in for the reference stack — see
[Bring your own backend](#bring-your-own-backend).

## Quickstart

Choose where to start:

- **Self-managed database:** follow the server setup below, then pair the app.
  You run the database, dashboard, and AI connection.
- **Explore or export:** install the app and grant Health access. Explore and
  Export work without an account or database.
- **Hosted account:** [create a PulsHealth account](https://app.pulshealth.com/signup),
  then sign in under **Sync → Database** in the app.

### Server

Follow **[Set up your PulsHealth server](docs/setup.md)** for the complete path:
prepare Docker, start the stack, choose a reachable address, pair the phone and
verify that data arrives. It includes a copyable AI prompt and troubleshooting.
The [server reference](server/README.md) covers configuration and operations.

For a fresh installation built from this checkout:

```bash
git clone https://github.com/PulsHealth/pulshealth.git
cd pulshealth
scripts/bootstrap.sh --build --time-zone Europe/Berlin
```

Replace the time zone with your usual reporting zone. This creates private
`server/.env` credentials and starts the database, dashboard, API and MCP server.
The services initially listen only on the host; complete the guide's
[network step](docs/setup.md#3-give-the-phone-a-reachable-address) before pairing.
For later starts and updates of this source-built installation, keep using
`--build` or `make dev-up`; `make up` selects published images instead.

### App

Install [PulsHealth from the App Store](https://apps.apple.com/us/app/pulshealth/id6757657354)
and complete its Health permission step. To sync, open **Sync → Connect Your
Server**, scan or paste the server's pairing code, then review the types and
history before applying the setup. See [pairing and first sync](docs/setup.md#4-pair-the-app-and-choose-what-to-sync)
for the controls and verification. Explore and Export work without pairing.

Building the iOS app yourself is optional; [the app README](PulsHealth/README.md#project-generation)
covers Xcode, XcodeGen and local signing.

**Several people on one server:** give each person a separate user ID and
[per-device tokens](server/README.md#tokens), and choose the appropriate
[viewer access mode](web/README.md#access-control). The single-password viewer
can show everyone on that server; API multi-user access is a separate setting.

## Use it with AI

For help **installing the server**, give a coding assistant [the setup guide](docs/setup.md)
or point it at [pulshealth.com/llms.txt](https://pulshealth.com/llms.txt).

To **ask questions about synced health data**, connect an assistant through the
read-only MCP server or product API. Start with [Connect an AI assistant](docs/ai.md)
for local, remote and hosted-account options, credentials and example questions.
MCP reads through the product API, never directly from Postgres. An AI provider
can receive the health data its tools return, so connect only an assistant you
want to share that data with.

For a whole range as a file, [bulk export](docs/export.md) covers the app's
CSV/JSON/JSONL files, the API's streamed export and the `puls-export` CLI.

## How syncing works

The mechanics are in [`PulsHealthSync/README.md`](PulsHealthSync/README.md);
in short:

- **Per-type cursors.** Each HealthKit type has its own `HKQueryAnchor`,
  persisted only *after* the server confirms the batch. A crash or failed
  upload re-sends the same page, and the server deduplicates by sample UUID
  (`ON CONFLICT DO NOTHING`), so the pipeline is idempotent end to end.
- **Backfill** is the same anchored paging loop from a nil anchor, bounded by
  your start date: 1,000-sample pages, four types at a time (HealthKit query
  throughput degrades beyond that), resumable at any page. Workouts' GPS
  routes and intra-workout series come in later phases, so one large workout
  cannot stall the rest.
- **Recent data first.** A backfill sends activity rings first, then the last
  30 days of each aggregate series (the server's daily views need an
  aggregate line before they show anything), then the last 30 days of each
  raw type, then the raw history — the heaviest type (heart rate) from the
  start, the rest cheapest-first — and finally the full aggregate pass and
  workout routes and series. Batches therefore arrive out of chronological
  order, which the [protocol](docs/protocol/README.md) requires receivers to
  accept.
- **Incremental sync** merges one page per changed type into shared uploads,
  never splitting a page across batches, so anchor-after-ack still holds.
- **Real-time** is one multi-type `HKObserverQuery` plus
  `enableBackgroundDelivery(.immediate)`. When HealthKit wakes the app it
  drains changes, including **deletions**, which anchored queries report as
  tombstones and the server applies as `DELETE`s.
- **On-device aggregates** (optional, per type): `HKStatisticsCollectionQuery`
  buckets — sums, averages, minima, maxima — by hour, day, week or month, and
  optionally per device (Watch vs. iPhone). They have no UUIDs, so the server
  upserts them, and each run recomputes a trailing window so late Watch data
  corrects itself. In the app a type added to **Aggregates** starts with its
  daily total (steps, energy) or daily average (heart rate, weight), the one
  the database's daily views read; **Match Raw Samples** gives every raw
  measurement its own in one tap.
- **Activity rings** (`HKActivitySummary`) sync as one upserted row per day,
  refreshed on every sync run and at most hourly off observer wakes.
- **Safety nets:** a `BGProcessingTask` runs periodic catch-up syncs when the
  device is idle, and every foreground open runs a full incremental pass —
  the most reliable trigger iOS offers. On iOS 26 a user-initiated backfill
  runs as a `BGContinuedProcessingTask`, so it keeps going with system
  progress UI after you leave the app.
- **Reconciliation:** HealthKit may purge deletion tombstones before a sync
  sees them. A type's sync details can compare per-UTC-month UUID digests
  with the server (`GET /v1/digest`), re-upload anything missing, and delete
  server-side orphans — never from a month HealthKit returned nothing for,
  since a type whose Health access is off reads exactly like one with no data.
- **Locked devices:** HealthKit is unreadable while the phone is locked.
  Background wakes that find it locked are recorded as *skipped*, and the next
  unlock or app open catches up.
- **Limited history (iOS 27):** a type the user shares only from the past 30
  days is read from that date. Passes that overwrite server data stay inside
  it, and widening access later re-reads the type's history.

### Wire format

`POST /v1/batches` with `Authorization: Bearer <token>`, `Content-Encoding:
gzip`, `X-Puls-Protocol: 1`, and an `X-User-ID` header naming the user. The
body is NDJSON: a header line (batch and device IDs, protocol and client
version, per-line-type counts), then samples, deletions, workout routes and
intra-workout series, aggregate buckets, activity summaries, and an optional
profile line. Samples are quantities, categories, workouts (with effort
scores), heartbeat series, ECGs, State of Mind logs and medication doses.
Every quantity is in one canonical unit per type; every timestamp is epoch
milliseconds.

Any **2xx** acknowledges the batch and advances the anchor. **4xx other than
429** is never retried (the anchors stay put, so nothing is lost, but the type stalls until
the server accepts it); **5xx**, **429** and network errors are retried with
jittered exponential backoff. Retried batches are no-ops server-side. The
normative description is the [Puls Sync Protocol v1](docs/protocol/README.md);
the reference server's limits and a runnable `curl` example are in
[`server/README.md`](server/README.md).

### Bring your own backend

The app posts to a URL; the reference stack is one receiver, not the only
one. A receiver accepts the batch, deduplicates samples by UUID, upserts
aggregate buckets and activity summaries by their identity, and returns 2xx.
The **Puls Sync Protocol v1** under [`docs/protocol/`](docs/protocol/README.md)
has everything it must do: the transport and retry contract, every line type
with a JSON Schema, the canonical units, the idempotency rules, a
minimal-receiver checklist, and a fixture corpus with the counts a reference
server returns.

- [`examples/receivers/python-sqlite/`](examples/receivers/python-sqlite/README.md)
  is a complete receiver in one standard-library Python file writing to
  SQLite. Its `smoke_test.py` posts the whole corpus to **any** receiver URL
  and checks the responses.
- [`tools/protocol-check/`](tools/protocol-check/) validates captured batches
  against the schemas and the framing rules.
- The optional read endpoints (`/v1/capabilities`, `/v1/stats`, `/v1/digest`,
  `/v1/uuids`) back the app's connection test, server counts and
  reconciliation, and can be left out; the app probes a receiver without
  `/v1/capabilities` with an empty batch.

Gaps in the spec go in the "Backend implementer question" issue template.

## Performance expectations

Measure your own device with **Settings → Developer → Run Throughput
Benchmark**. To reveal Developer, tap **Settings → About → Version** seven
times and confirm. The benchmark reads HealthKit through a discarding transport
and does not touch sync state. The following are planning estimates, not
guaranteed timings:

**Initial backfill** (foreground, plugged in, LAN or VPN to the server):

| Profile | Volume | Expected duration |
|---|---|---|
| Casual iPhone-only user, 5 years | ~1–2 M samples | **2–6 min** |
| Apple Watch wearer, 3 years | ~5–10 M samples (heart rate at ~3.5 K/day dominates) | **15–40 min** |
| Heavy Watch user (daily workouts), 5+ years, all types | ~15–25 M samples | **45–90 min** |

HealthKit reads often dominate the initial import. Device speed, selected
types, server capacity, and network latency all affect throughput; measure
your installation rather than assuming a fixed ingest rate.
Backfills pause if iOS suspends the app and resume on the next open without
losing progress.

**Settings → Performance** sets the batch size (250–5,000) and type
concurrency (1–8). The defaults (1,000 × 4) are field-tested; larger batches
help on high-latency links, smaller ones reduce memory and re-upload cost
after failures.

**Event → queryable-in-database latency** (steady state):

| Data path | Typical latency | Why |
|---|---|---|
| Written on iPhone, immediate-class type (workouts, body mass, HRV, …) | **seconds** (≈1–10 s) | `.immediate` background delivery is honoured |
| Steps / active energy / distance (iPhone) | **often about hourly or longer** | Background delivery is limited and is not a guaranteed upload schedule |
| Anything recorded on Apple Watch | **minutes–hours** | Watch → iPhone HealthKit sync is opportunistic and Apple provides no API to force it. Opening the app (or charging the Watch) usually triggers it |
| Device locked | deferred | HealthKit can be unreadable while locked; the next unlocked run catches up |
| App force-quit by the user | until the next app open | iOS stops waking force-quit apps |
| Activity rings | next sync run, at most hourly off observer wakes | Activity summaries are not observable and have no background delivery; the current day is re-queried on every run and upserted |

Upload and ingest latency depend on the network and server. A type's **Sample to upload
latency** (in its sync details) shows the number you are actually getting.

## FAQ

**My Watch data arrives minutes or hours late.**
Watch → iPhone HealthKit transfer is scheduled by watchOS and cannot be
forced by any app. Opening PulsHealth, or putting the Watch on its charger,
usually prompts it. Once the data is on the phone it syncs normally.

**Steps, active energy, and distance lag behind workouts.**
Background delivery has type-specific limits; Apple documents an hourly
maximum notification frequency for steps on iOS. A notification is an
opportunity to sync, not a promised upload deadline. Opening the app with
the phone unlocked provides another opportunity to catch up. See the
[sync troubleshooting guide](https://pulshealth.com/blog/apple-health-not-syncing/).

**Nothing synced overnight.**
While the phone is locked HealthKit is unreadable, and iOS prefers to run
background processing when the device is idle — locked, overnight. PulsHealth
records those wakes as *skipped (locked)* on the Background Activity screen
and catches up at the next unlock or app open.

**I swiped the app away and it stopped syncing.**
iOS does not wake force-quit apps for background delivery or scheduled
tasks. Open the app again and it resumes; leaving it in the app switcher is
enough.

**Blood pressure never shows up in the permission sheet.**
On iOS 26 the Health permission sheet silently omits blood pressure
systolic/diastolic (Apple Feedback FB22735935); iOS 27 fixes it. On iOS 26,
grant them in **Settings → Privacy & Security → Health → PulsHealth**; the app
shows a hint when it detects this and backfills the full history once access
exists.

**Daily step totals in the database are higher than the Health app shows.**
The iPhone and the Watch both record steps, and a naive sum of raw samples
counts both. Use the `metric_daily` view (or an on-device aggregate series,
which HealthKit already de-duplicates) instead of summing `quantity_samples`.
`docs/database-guide.md` explains the query patterns.

**Can I sync to a database I already have?**
Yes — anything that speaks the sync protocol is a valid destination; see
[Bring your own backend](#bring-your-own-backend).

**Does it write anything into Apple Health?**
No. The app requests read access only, and its usage strings say so.

## Observability

- **App → Sync:** the server's status, samples and bytes sent, backfill
  progress and ETA, and a row per type that opens its sync details — anchor
  presence, backfill state, counters, earliest/latest sample dates, last sync
  time and duration, live rate and ETA, last error.
- **App → Sync → Activity → Log:** a filterable live event stream, persisted
  across launches and mirrored to `os.Logger` (`log stream --predicate
  'subsystem == "com.pulsHealth.healthsync"'` from a Mac). **Activity →
  Background** keeps one durable record per wake (trigger, duration, outcome,
  work done, Low Power Mode, thermal state) and exports them.
- **Instruments:** signposts (`syncAll`, `syncType`) profile every phase.
- **Server:** structured JSON logs per batch (counts, bytes, parse/insert
  timings); a PulsHealth dashboard for the health data and an Ops dashboard
  for ingest health with provisioned alert rules; `GET /v1/stats` returns
  per-type row counts to cross-check against the app.

## Security notes

The full list of design properties, and how to report a vulnerability, is in
[`SECURITY.md`](SECURITY.md).

- **Regular sync goes only to the database you choose.** Self-hosted, that is
  your server and the developer never sees it; on the PulsHealth database it
  is held by the developer under your account (`docs/privacy-policy.md`). No
  analytics, no crash reporting either way.
- **An export is a file you hand over yourself.** The Export tab makes no
  network request: it stages files in the app's temporary directory (never
  backed up), hands them to the share sheet, and deletes its copy once the
  share completes, when another export starts, and at every launch. The files
  are not encrypted and carry no token.
- **Bearer tokens.** Ingest accepts a shared static `PULS_TOKEN` — whoever
  holds it can upload and delete data for any user ID — and per-device tokens
  (`make devices ARGS='issue --user <uuid> --name <label>'`), hashed at rest,
  bound to one user and revocable one at a time. Set
  `PULS_ALLOW_SHARED_TOKEN=false` once every phone has its own. On the phone
  the token is in the Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`:
  background wakes can read it, a backup cannot carry it to another device).
  Ingest rate-limits failed authentications per client IP and never throttles
  a request with the right token (`server/README.md`, "Rate limiting").
- **Put the ingest endpoint behind TLS.** Every service binds to loopback by
  default. Expose only the ingest port, through a TLS-terminating proxy or a
  VPN; `scripts/bootstrap.sh --lan` is the one plain-HTTP exception, for a
  network you control. Never publish the product API, Grafana or Postgres on
  a public interface.
- **The MCP server's tokens read everything the product API serves.** Publish
  it only over HTTPS and keep client config files that hold a token out of
  version control (`docs/ai.md`).
- **The web viewer's login is optional.** `WEB_AUTH_PASSWORD`, which
  `scripts/bootstrap.sh` generates on a fresh install, puts every page behind
  HTTP Basic; without it the viewer is open to anyone who can reach it. Either
  way keep `WEB_BIND_ADDR` on loopback or a private network.
- **The database holds identifiable data** (name, email, date of birth, sex
  next to the samples). Ingest connects as the scoped DML-only `ingest` role,
  never as the superuser (`server/README.md`, "The scoped `ingest` role").

## What this is not

- **Not a lock-in.** The PulsHealth database runs this same open-source
  code; you can run it yourself instead, and export everything either way.
- **Not on Android.** The v1 type vocabulary is HealthKit's. The protocol is
  platform-neutral in shape, so a Health Connect client is possible, but none
  is planned here.
- **Not a writer.** It never modifies HealthKit data.
- **Not a sink for every cloud.** The app speaks HTTP to one URL; S3, Google
  Sheets, Notion and similar are a receiver's job, not the app's.

## Inside the repository

| Component | Source | Purpose |
|---|---|---|
| iOS app | [PulsHealth](PulsHealth/README.md) | SwiftUI Explore, Export, Sync, and Settings |
| Sync library | [PulsHealthSync](PulsHealthSync/README.md) | Swift 6, iOS 17+, zero dependencies; embeddable in other apps |
| Server | [server](server/README.md) | Go ingest and read APIs, PostgreSQL 17 + TimescaleDB, Grafana |
| Web viewer | [web](web/README.md) | Next.js dashboard for synced data |
| MCP server | [server/mcp](server/mcp/README.md) | Read-only tools over the product API |
| Protocol | [docs/protocol](docs/protocol/README.md) | Schemas, fixture corpus, and receiver contract |
| Site and articles | [site](site/README.md), [blog](blog/BLOG_SYSTEM.md) | pulshealth.com, documentation, and worked examples |
| HealthKit reference | [knowledge-base](knowledge-base/README.md) | 178 type guides, also bundled into the app |

## Development

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup and test commands for every
component, the integration tests, and the rules that keep the app and server
in step; `make dev-up` runs the whole stack from this checkout.
[`CLAUDE.md`](CLAUDE.md) lists the invariants (anchor-after-ack, canonical
units, epoch milliseconds everywhere, upsert versus never-overwrite) and the
HealthKit gotchas; it is written for AI coding agents and is worth reading
regardless. [`AGENTS.md`](AGENTS.md) is the short orientation for an automated
contributor, and [`llms.txt`](llms.txt) indexes the documentation.

## Contributing, security, license

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — DCO sign-off, per-component setup,
  what to run before a pull request. Issue templates cover bugs, feature
  requests, and questions from people implementing their own receiver.
- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting and scope.
- [`docs/privacy-policy.md`](docs/privacy-policy.md) — what the app reads,
  regular sync, hosted accounts, approved request destinations, and what stays
  on the phone.
  [`docs/appstore/`](docs/appstore/README.md) holds the App Store listing copy,
  review notes, the recipe for the throwaway review backend, and the release
  record.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Contributor Covenant.
- [`LICENSE`](LICENSE) — Apache License 2.0, for everything in this
  repository. [`NOTICE`](NOTICE) carries the attribution.
- [`TRADEMARK.md`](TRADEMARK.md) — the PulsHealth name, icon, and App Store
  listing are reserved; forks ship under their own name and bundle
  identifier; "works with PulsHealth" and "implements the Puls Sync
  Protocol" are welcome.

## Home Assistant

The [PulsHealth Home Assistant integration](https://github.com/PulsHealth/home-assistant)
turns synced health data into sensors for dashboards and automations: daily
steps, activity rings, recent sleep, completed workouts, and last sync.
It reads the existing product API and supports setup through the HA UI.
