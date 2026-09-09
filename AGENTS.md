# AGENTS.md

Orientation for an automated contributor (Claude Code, Codex, Cursor, an
agentic CI job) working in this repository. It says what the repository is,
where the authoritative facts live, what must not be broken, and how to run
each test suite. It does not restate the rules it points at — read the file it
names.

**[`CLAUDE.md`](CLAUDE.md) is the deep guide**: the component map, the
invariants in full, and the accumulated gotchas (HealthKit crashes, iOS
permission bugs, TimescaleDB compression traps). Read it before changing code.
**[`CONTRIBUTING.md`](CONTRIBUTING.md) is the process**: sign-off, style, what
a pull request has to carry.

## What this is

PulsHealth syncs Apple Health data from an iPhone to a backend you run.
An iOS app and the Swift package under it read HealthKit and stream every
sample as gzip NDJSON to an HTTP endpoint; a reference backend (PostgreSQL 17 +
TimescaleDB, a Go ingest server, a read-only Go product API, Grafana, a Next.js
viewer, an MCP server) stores and serves it. The sync protocol is specified
here, so anyone can write their own receiver. Apache-2.0. The iOS app is on
the App Store
([PulsHealth](https://apps.apple.com/us/app/pulshealth/id6757657354), free);
the self-hosted backend is pre-release.

| Path | What | Its own docs |
|---|---|---|
| `PulsHealthSync/` | Swift package: sync engine, transport, NDJSON encoding (iOS 17+, Swift 6 strict concurrency, no dependencies) | `PulsHealthSync/README.md` |
| `PulsHealth/` | SwiftUI app around the package. `project.pbxproj` is **generated** — run `xcodegen` after adding or renaming a file | `PulsHealth/README.md` |
| `server/ingest/` | Go ingest server: parses batches, writes Postgres | `server/README.md` |
| `server/api/` | Go product API: read-only JSON + `/v1/export`, OpenAPI at `/openapi.json`, HTML at `/docs` | `server/README.md` |
| `server/mcp/` | Go MCP server, read-only, over the product API only | `server/mcp/README.md`, `docs/ai.md` |
| `server/db/` | `migrate.sh` and the numbered migrations it applies | `server/README.md` |
| `server/backup/` | The opt-in `backup` Compose profile: scheduled `pg_dump`s and the restore drill | `server/README.md` |
| `web/` | Next.js viewer, reads Postgres directly. **Not** `site/` | `web/README.md` |
| `site/` | Next.js static export behind **pulshealth.com**: marketing pages, blog, knowledge-base viewer. Built with **bun**, not npm | `site/README.md` |
| `knowledge-base/`, `blog/` | The site's content: 177 YAML HealthKit type files and the MDX posts with their images | `knowledge-base/README.md`, `blog/BLOG_SYSTEM.md` |
| `docs/protocol/` | The Puls Sync Protocol v1 spec, JSON Schemas, fixtures | `docs/protocol/README.md` |
| `tools/protocol-check/` | Validates a batch against the schemas | — |
| `tools/puls-export/` | CLI for `GET /v1/export` | `docs/export.md` |
| `examples/receivers/python-sqlite/` | A complete third-party receiver | its `README.md` |
| `scripts/` | `bootstrap.sh` (first run), `check-public-tree.sh` (the public-tree gate) | root `README.md` |

## Where the authoritative facts live

Do not infer these from code you happen to be reading; go to the source.

| Question | Authority |
|---|---|
| What goes on the wire, and what a receiver must accept | [`docs/protocol/README.md`](docs/protocol/README.md) — Puls Sync Protocol v1, with JSON Schemas in `docs/protocol/schema/` and a fixture corpus in `docs/protocol/fixtures/` |
| Which HealthKit types exist, their `kind`, canonical `unit` and legal aggregate functions | [`docs/protocol/catalog.json`](docs/protocol/catalog.json) — **generated** from `PulsHealthSync/Sources/PulsHealthSync/Models/HealthTypeCatalog.swift`; `web/lib/catalog.generated.ts` is generated from it in turn. Never hand-edit either. `docs/protocol/catalog.md` documents the render chain |
| What each table and column means, and how to query it without misreading the data | [`docs/database-guide.md`](docs/database-guide.md) |
| What the product API serves and in what shape | The OpenAPI document in `server/api/docs.go`, served at `/openapi.json` and mirrored as HTML at `/docs`. A test compares it against the router in both directions — adding a route without documenting it fails the build |
| What the schema is | `server/db/migrations/`, applied by `server/db/migrate.sh` |
| What a bulk export contains | [`docs/export.md`](docs/export.md) |

## Invariants

These are stated in full — with the reasoning, which matters — under
"Invariants — do not break" in [`CLAUDE.md`](CLAUDE.md). Breaking one loses
data or corrupts it silently, so read that section before touching the
subsystem. The list, so you know when to go and read it:

- **Anchor-after-ack** — a type's HealthKit anchor is persisted only after the
  server confirms the upload.
- **Every row belongs to a user** — `user_id` on every data table, sent in the
  `X-User-ID` header, never in the NDJSON body.
- **Canonical units** — one unit per type, converted before encoding; never
  send raw device units.
- **One type vocabulary** — `HealthTypeCatalog.swift` is the only hand-written
  list of types; `docs/protocol/catalog.json` and `web/lib/catalog.generated.ts`
  are rendered from it and are never hand-edited.
- **Epoch milliseconds everywhere** — wire format, state files, query
  parameters. Not ISO 8601.
- **Wire-format changes touch both sides** — see the next section.
- **Aggregates overwrite; raw samples never do.**
- **Activity rings upsert by date and are not samples** — the local calendar
  day is stored straight through, never UTC-shifted.
- **A locked device means HealthKit is unreadable** — background paths must
  check and skip cleanly rather than report failure.
- **Incremental sync merges types into one batch; a page is never split
  across batches.**
- **The schema is applied by the `migrate` service, never by hand** — new DDL
  is a new numbered file, an applied file's checksum is enforced, and only a
  file whose first line is `-- puls:rerun` is re-applied.
- **Actors** — `HealthSyncEngine`, `SyncStateStore` and `SyncEventLog` are
  actors under Swift 6 strict concurrency; views reach them through the
  `@MainActor` `AppModel`.
- **iOS version gates** — new type support is gated the same way the existing
  `#available` checks are.

### The wire-format lockstep rule

A change to what goes over the wire is never a change to one file. It has to
land, in the same pull request, in **all** of:

1. `PulsHealthSync/Sources/PulsHealthSync/Models/SyncModels.swift` and
   `Serialization/NDJSONEncoder.swift` (the sender),
2. `server/ingest/parse.go` and `server/ingest/store.go` (the receiver),
3. a **new** migration in `server/db/migrations/` if it needs schema,
4. the spec and schemas in `docs/protocol/` — plus a fixture in
   `docs/protocol/fixtures/` and its `.expected.json`,
5. `server/ingest/parse_test.go` fixtures and the curl example in
   `server/README.md`.

A catalog change additionally regenerates `docs/protocol/catalog.json` and
`web/lib/catalog.generated.ts`. The header's `schemaVersion` (and
`X-Puls-Protocol`) is bumped **only** for a change a v1 receiver written from
the spec would reject — new sample kinds and new line types; new optional
fields, new type identifiers and new read endpoints are additive and keep the
number. **Deploy the server first**: an old server rejects batches carrying
new line types with a `400`, which stalls syncing until it is updated (nothing
is lost — the client does not retry a `4xx` and its anchors stay put).

## Running the tests

Every command is run from the repository root unless a `cd` is shown.
`.github/workflows/ci.yml` is the authority; this is the same set.

**Go — every module** (`server/ingest`, `server/api`, `server/mcp`,
`tools/protocol-check`, `tools/puls-export`):

```bash
cd server/api && go mod verify && go vet ./... && go test -race -count=1 ./...
```

Each of those directories is its own Go module; there is no module at
`server/` or at the repository root.

**Go integration tests** need a database and are skipped without one. Bring
one up with `cd server && docker compose up -d migrate` (that applies the
schema and starts nothing else), then, with `server/.env` sourced:

```bash
export DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres"

# ingest
(cd server/ingest && go test -run Integration -count=1 ./...)

# product API — the fixture-writing ones also need this flag, and write
# through ADMIN_DATABASE_URL (which defaults to DATABASE_URL)
(cd server/api && PULS_API_WRITE_INTEGRATION_TESTS=1 go test -run Integration -count=1 ./...)
```

**Protocol corpus** — every fixture must validate, and the reference receiver
must accept the corpus:

```bash
cd tools/protocol-check && go test ./... && go run . ../../docs/protocol/fixtures/*.ndjson
python3 examples/receivers/python-sqlite/smoke_test.py
```

**Web:**

```bash
cd web && npm ci && npm run check:catalog && npm run lint && \
  npm run typecheck && npm test && npm run build
```

**Marketing site** (bun, not npm — it exports 197 static pages, 177 of them
rendered from `knowledge-base/`, and the CI job asserts those counts, so a
content directory that goes missing fails the build rather than silently
shrinking it):

```bash
cd site && bun install && bun run lint && bun run build
```

**Swift package** (macOS with Xcode 26):

```bash
cd PulsHealthSync && xcodebuild test -scheme PulsHealthSync \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

**iOS app** — `xcodegen` first, always, because the project file is generated:

```bash
cd PulsHealth && xcodegen && xcodebuild test -scheme PulsHealth \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

**Compose, shell and the public-tree gate:**

```bash
docker compose -f server/docker-compose.yml config --quiet
docker compose -f server/docker-compose.yml -f server/compose.build.yml config --quiet
docker compose -f server/docker-compose.yml --profile backup config --quiet
shellcheck server/db/migrate.sh server/db/migrations/*.sh server/backup/*.sh scripts/*.sh
scripts/check-public-tree.sh
```

The `docker compose config` calls need the `${VAR:?}` secrets to be set;
CI passes `validation-only` placeholders and starts nothing.

`scripts/check-public-tree.sh` fails if a tracked file carries owner-specific
or private-infrastructure content (a tailnet hostname, a personal mailbox, a
home directory, an Apple Team ID). Run it before proposing a change; CI runs
it too.

## House rules for a change

- **Sign off every commit.** `git commit -s` adds the
  `Signed-off-by:` trailer the DCO requires. There is no CLA.
- **Commit subject:** short, imperative, with a component prefix — `ingest:`,
  `app:`, `sync:`, `web:`, `site:`, `db:`, `docs:`, `api:`, `mcp:`. The body
  says why.
- **Never edit a generated file.** `PulsHealth/PulsHealth.xcodeproj`
  (`xcodegen`), `docs/protocol/catalog.json` (the Swift catalog test),
  `web/lib/catalog.generated.ts` (`npm run gen:catalog`).
- **Never edit an applied migration.** Add a new numbered file.
- **Go:** `gofmt`, `go vet` and the race detector clean; standard library plus
  `pgx` only. **TypeScript:** `eslint` with zero warnings, `tsc --noEmit`
  clean. **Shell:** `shellcheck` clean, `set -euo pipefail`. **SQL:**
  idempotent DDL, and a predicate against a compressed hypertable must include
  `start_ts`.
- **Secrets never enter the tree.** `server/.env` is generated by
  `scripts/bootstrap.sh` and is not tracked. Do not commit one.
- For anything larger than a bug fix, open an issue first —
  `docs/open-source-plan.md` is the roadmap.
