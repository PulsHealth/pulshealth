# CLAUDE.md — agent guide for Puls

Personal HealthKit → self-hosted Postgres sync. Five components, each with its own README
(architecture, wire format, performance numbers live there — read them before deep work),
plus two standalone CLIs and the public website:

| Path | What | Docs |
|---|---|---|
| `PulsHealthSync/` | Swift package (iOS 17+, Swift 6 strict concurrency): sync engine, transport, NDJSON encoding | `PulsHealthSync/README.md` |
| `PulsHealth/` | SwiftUI app wrapping the library: Explore (type pages with analysis charts and an aggregate preview), Export builder (server-less files), Sync (the Database screen, synced types, activity log), Settings; benchmark | `PulsHealth/README.md` |
| `server/` | Docker Compose: Go ingest/product APIs + PostgreSQL 17/TimescaleDB + Grafana | `server/README.md` |
| `server/mcp/` | Go MCP server (stdio + streamable HTTP) giving AI assistants read-only tools over the product API; talks only to the API, never Postgres | `server/mcp/README.md`, `docs/ai.md` |
| `web/` | Next.js self-hosted viewer, published as the fourth GHCR image. Reads Postgres directly as the read-only `grafana` role; optional HTTP Basic auth. **Not** `site/`, which is the public marketing site | `web/README.md` |
| `tools/puls-export/` | Standalone Go module: CLI for the product API's `GET /v1/export` (streamed CSV/JSONL). Its own `go.mod`, stdlib only | `docs/export.md` |
| `tools/protocol-check/` | Standalone Go module: validates the `docs/protocol/fixtures/` corpus against the JSON Schemas. Own `go.mod`, own CI job | `docs/protocol/README.md` |
| `site/` | Next.js static export behind **pulshealth.com** (marketing pages, blog, knowledge-base viewer). Built with bun. **Not** `web/`, which is the self-hosted viewer | `site/README.md` |
| `knowledge-base/`, `blog/` | The site's content: 177 YAML HealthKit type files (clinical prose, ranges, sources) and the MDX posts + images | `knowledge-base/README.md`, `blog/BLOG_SYSTEM.md` |

[`AGENTS.md`](AGENTS.md) is the short, tool-agnostic version of this file for
an automated contributor (components, where the authoritative facts live, the
test command for each suite); [`llms.txt`](llms.txt) indexes the
documentation. Both point back here for the invariants below rather than
restating them — keep it that way. What is still outstanding is
[`docs/roadmap.md`](docs/roadmap.md), over the requirements in
[`docs/open-source-plan.md`](docs/open-source-plan.md).

## Build & test

```bash
# Library tests (Swift Testing)
cd PulsHealthSync && xcodebuild test -scheme PulsHealthSync \
  -destination 'platform=iOS Simulator,name=iPhone 17'
# After editing HealthTypeCatalog, regenerate docs/protocol/catalog.json, then
# web/lib/catalog.generated.ts (the comparison checks fail until you do):
cd PulsHealthSync && TEST_RUNNER_PULS_WRITE_CATALOG=1 xcodebuild test \
  -scheme PulsHealthSync -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:PulsHealthSyncTests/CatalogVocabularyTests
cd web && npm run gen:catalog

# App: run `xcodegen` (brew install xcodegen) before the first build and after
# adding/removing/renaming files. PulsHealth.xcodeproj is gitignored because it
# carries DEVELOPMENT_TEAM from Config/Local.xcconfig, which xcodegen seeds
# from Local.xcconfig.example.
cd PulsHealth && xcodegen && xcodebuild build -scheme PulsHealth \
  -destination 'platform=iOS Simulator,name=iPhone 17'
# App-hosted XCTest (needs the HealthKit entitlement): the 372-combo
# aggregate function×type matrix
cd PulsHealth && xcodebuild test -scheme PulsHealth \
  -destination 'platform=iOS Simulator,name=iPhone 17'

# The whole stack, built from this checkout (docker-compose.yml alone pulls
# the published images). bootstrap.sh writes server/.env with generated
# secrets and prints the pairing block; `make up/down/logs/ps/migrate/
# baseline/pairing` wrap Compose from the root.
scripts/bootstrap.sh --build                   # first run
make dev-up                                    # thereafter (compose.build.yml)

# Marketing site (bun, not npm; also `make site-dev|site-build|site-lint`
# and `make deploy-site`)
cd site && bun install && bun run lint && bun run build

# Self-hosted viewer (npm, not bun)
cd web && npm ci && npm run check:catalog && npm run lint && \
  npm run typecheck && npm test && npm run build

# Go unit tests, no DB. Each directory is its own module; none at server/.
cd server/ingest && go vet ./... && go test ./...
cd ../api && go vet ./... && go test ./...
cd ../mcp && go vet ./... && go test ./...   # against an httptest fake of the API
cd ../../tools/puls-export && go vet ./... && go test ./...

# Protocol corpus against the JSON Schemas, then posted at the Python
# reference receiver (each from the repository root)
cd tools/protocol-check && go test ./... && go run . ../../docs/protocol/fixtures/*.ndjson
python3 examples/receivers/python-sqlite/smoke_test.py

# Exploration notebook, against a throwaway TimescaleDB it starts itself
# (needs Docker and psql)
pip install -r notebooks/requirements.txt && python -m pytest tests/test_healthkit_notebook.py -rs

# Integration tests: skipped without DATABASE_URL; CI's db-integration job
# runs them as the scoped roles. server/api also needs
# PULS_API_WRITE_INTEGRATION_TESTS=1. As a scoped role, point DATABASE_URL
# at it and ADMIN_DATABASE_URL at postgres.
cd server && docker compose up -d migrate      # db + schema, nothing else
cd ingest && DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres" \
  go test -run Integration ./...
```

Device builds need a paid Apple Developer team (HealthKit + background-delivery
entitlements): set `DEVELOPMENT_TEAM` in `PulsHealth/Config/Local.xcconfig`.

## Invariants — do not break

- **Anchor-after-ack.** A type's `HKQueryAnchor` is persisted *only after* the server
  confirms the upload (`HealthSyncEngine` → `recordUploadedBatch`). Persisting earlier
  loses data on crash. Re-sending the same page is safe: every insert is
  `ON CONFLICT DO NOTHING` on sample UUID, so the pipeline is idempotent end-to-end.
- **Export never shares sync state.** Anchors and watermarks are keyed per type
  with **no destination dimension** and advance whenever the transport returns
  normally, so an export through the app's engine (or `ExportFileTransport`
  given to it) would silently record every exported sample as delivered.
  `HealthExporter.run` builds a throwaway `HealthSyncEngine` per run — its own
  `SyncStateStore`, `SyncEventLog` **and `WakeLog`** (the default one rewrites
  the app's real `wake-log.json`), an `InMemoryTokenStore`, a configuration
  with no server URL, token or identity (`ExportPlan.configuration`),
  `recentWindowFirst: false` — never calls `startObserving` or
  `syncAllEnabled` (the priority window would write recent buckets twice), and
  deletes its directory on every exit path. Failures come from the throwaway
  store's completion markers (`ExportPlan.failures`) and
  `HealthSyncEngine.unmappableSampleCounts`, because the engine only logs
  them: a throw leaves no files, a partial export returns `isComplete ==
  false`. `ExportColumnTests` pins the CSV columns shared with the product API
  to `docs/export.md`. **App side, which the privacy documents promise:**
  staged files live under `HealthExporter.stagingRoot` in the temporary
  directory. `AppModel.init` clears it at launch, before any export can run
  (`removeAllExports()` must never run during one), with `ExportZipper`'s
  `CoordinatedZipFile…` scratch directories outside it (`ExportZipTests` fails
  if iOS renames them); `ExportModel` clears it when another export starts, on
  Delete Export, and when the share sheet reports `completed` — hence
  `UIActivityViewController`, not `ShareLink`, which has no completion
  callback. The Export tab exports its own `ExportDraft` (seeded once from
  `appliedConfig`, never the Synced Data draft) and requests Health access
  itself (`requestHealthAccessForExport`: skips undeterminable types, never
  presents the medication picker). Change any of that and
  `docs/privacy-policy.md` § Exports, `SECURITY.md`, the site's `/privacy` card
  and `docs/appstore/` change with it.
- **Every row belongs to a user.** `users` (`db/migrations/000_users.sql`,
  seeded with the default user) is the FK target of `user_id` on every data
  table. The client sends its user in the **`X-User-ID` header**
  (`SyncConfiguration.userID`, set by `HTTPSyncTransport`), *not* in the NDJSON
  body; ingest (`main.go`) defaults an absent header to the default user,
  `ensureUser`s whatever id arrives before any insert, and tags every row.
  `user_id` joins the conflict target where identity would otherwise collide
  (`activity_summaries` `(user_id, date)`, `aggregate_samples` `(series_id,
  bucket_start, user_id)`); UUID-keyed sample tables keep their UUID PK. The
  `{"profile":…}` line is the complete identity snapshot (null or omitted
  fields clear stored values; DOB/sex feed HR zones), so the app sends an empty
  profile only to replace a non-empty one (`ProfilePayload.shouldUpload`, from
  `AppModel.applyConfiguration`) — otherwise a reinstall pairing with its old
  server wipes it. The product API settles one user per request in the
  `scopeUser` middleware (`server/api/main.go`, after `auth`) and passes it to
  every `Store` read as an explicit argument. Naming a non-default user needs
  `PULS_MULTI_USER` (default off, because the static `PULS_API_TOKEN` is bound
  to nobody): off, it is **403 `multi-user reads are disabled`**, never a quiet
  answer for the default user, and neither that nor a malformed id (400)
  charges the auth-failure limiter. On ingest a per-device token
  (`device_tokens`, `server/ingest/auth.go`) is bound to a user — `X-User-ID`
  must be absent or equal to it, else 403; the shared `PULS_TOKEN` (while
  `PULS_ALLOW_SHARED_TOKEN`, default true) is not, so with it `X-User-ID` is
  unauthenticated tenant selection. Details: `server/README.md`, "Product API"
  and "Tokens".
- **Canonical units.** Every quantity type has one `unitString` in
  `HealthTypeCatalog`; `SampleMapper` converts before encoding. Never send raw
  device units. **A wrong one is silent:** `SampleMapper.map` returns nil for a
  quantity incompatible with the unit, and compatibility is per type, so one bad
  `unitString` makes every sample of that type unmappable. So **"drained" is a
  raw-count question, never a mapped-count one** — `result.addedSamples.count`,
  not `samples.count`; `MergedPage.isRawEmpty`, not `isEmpty` — or such a type
  reports zero samples, drained and backfill complete, with no error. Both
  sweeps log any drop (`HealthSyncEngine.runSync`, `MergedSync`), and a type
  that dropped anything is never marked backfill-complete.
- **The bearer token has a second home, and it is load-bearing for the privacy
  claims.** Normally it lives only in the Keychain (`writeSnapshot` strips it,
  `SyncConfiguration.encode` omits it). **When a Keychain write fails** it is
  parked in `sync-state.json` under `PersistedState.fallbackAuthToken`, retried
  on the next launch and removed once the Keychain accepts it — dropping it
  instead stalls every sync until the user retypes it. That file is
  `.completeUntilFirstUserAuthentication` and backup-excluded
  (`ProtectedStateFile`), which keeps a parked token off iCloud and other
  devices. Anything that changes where the token can rest, removing this
  fallback included, changes `docs/privacy-policy.md`, `SECURITY.md` and the
  site's `/privacy` page with it.
- **One type vocabulary.** `HealthTypeCatalog.swift` is the only hand-written
  list of types. `docs/protocol/catalog.json` is rendered from it by
  `CatalogVocabularyTests` (write mode `TEST_RUNNER_PULS_WRITE_CATALOG=1`;
  otherwise it compares byte for byte and fails), and
  `web/lib/catalog.generated.ts` from the JSON by `web/scripts/gen-catalog.mjs`
  (`npm run gen:catalog`; `npm run check:catalog` in CI). Never edit either
  generated file, and never restate a type in `web/lib/catalog.ts`, the web-only
  overlay. OS gates on catalog entries are declarative (`minimumIOS`), not
  `#available`, so `definitions` is complete on every runtime while `all` stays
  the available subset. Likewise `PulsHealth/Sources/Resources/knowledge.json`
  is generated from `knowledge-base/**/*.yaml` by `scripts/gen-knowledge-json.py`,
  and CI's `scripts/check-knowledge-json.sh` fails until the checked-in file
  matches — never edit it by hand.
- **Epoch-ms dates everywhere.** Wire format, state files, and query params use
  millisecondsSince1970 (`JSONEncoder.puls` / `JSONDecoder.puls`). Not ISO 8601.
- **Wire format changes touch both sides.** `Models/SyncModels.swift` (incl.
  `AggregateSampleRow`) + `Serialization/NDJSONEncoder.swift` on the client stay
  in lockstep with `server/ingest/parse.go` + `store.go` and the schema in
  `server/db/migrations/`; update the fixtures in `parse_test.go` and the curl
  example in `server/README.md` too. **The protocol documents change in the
  same PR:** `docs/protocol/README.md` (the spec), the JSON Schemas in
  `docs/protocol/schema/`, the fixture corpus in `docs/protocol/fixtures/`
  (with `.expected.json` counts) and, for a catalog change, the two rendered
  vocabulary files above. `tools/protocol-check` runs the corpus against the
  schemas in CI and `examples/receivers/python-sqlite/smoke_test.py` posts it to
  the Python reference receiver, so both fail until they agree. The header's
  `schemaVersion` (and `X-Puls-Protocol`) is bumped **only for incompatible
  changes** — anything a v1 receiver written from the spec would reject,
  including new sample kinds and new line types; new optional fields, type
  identifiers and read endpoints are additive and keep the number. Deploy
  server-first: an old server 400s batches carrying new line types (the client
  doesn't retry 4xx and its anchors/watermarks stay put, so nothing is lost, but
  syncing stalls until the server updates).
- **Aggregates overwrite; raw samples never do.** Aggregate buckets
  (`Engine/AggregateSync.swift`) have no UUIDs: identity is (type, func,
  interval, deviceFilter, bucketStart, user_id), and the server **upserts**
  (`aggregate_samples` `ON CONFLICT DO UPDATE`); empty buckets go out as
  explicit `"value":null` so recomputes clear stale values. The per-config
  `computedThrough` watermark advances only after ack; every run recomputes a
  trailing lookback (late Watch data) and a ~monthly full pass repairs older
  edits/deletes. **The priority window** (`syncRecentAggregates`,
  `AggregatePass.priority`: ~30 recent days ahead of a first backfill's raw
  sweep) **uploads without advancing a watermark**
  (`recordAggregateUploadWithoutWatermark`): its chunks end near *now*, so
  recording them would push `computedThrough` (and, mid-full-pass,
  `fullRecomputeThrough`) past all unprocessed history, and the full pass would
  compute nothing older than the window. Keep any future bounded pass on that
  recorder — the raw recent-window pass keeps an anchor of its own for the same
  reason. Day buckets use the phone's calendar, so `PULS_TIME_ZONE` must match
  the phone (next rule).
- **Activity rings upsert by date; they are not samples.** `HKActivitySummary`
  (`Engine/ActivitySummarySync.swift`) has no UUID, one row per local calendar
  day, and today mutates all day. It rides its own `{"activitySummary":…}`
  line; the server **upserts** on `(user_id, date)` (null value/goal columns
  overwrite); progress is a *singleton* `computedThrough` day watermark
  (`SyncStateStore.activitySummaryState`) advanced only after ack. `validKind`
  rejects it as a sample kind. Its type is an `HKObjectType` (catalog
  `sampleType == nil`, added to read auth separately) with **no observer or
  background delivery**, so it rides `syncAllEnabled` and
  `refreshActivitySummaryIfStale()` at the tail of every observer wake (at most
  hourly, `ActivitySummaryState.lastComputedAt`). Keep that second path: the
  scheduled one runs from the `BGProcessingTask` while the device is locked.
  Store the local `date` straight through — never UTC-shift it (the PK is a
  plain `date`), or a day splits across two rows. The server's day boundary for
  `metric_daily` and every server-side daily query is `PULS_TIME_ZONE` (stored
  by `db/migrations/013_time_zone.sh`, exposed as `puls_time_zone()`, default
  UTC) and must match the phone's zone.
- **A locked device means HealthKit is unreadable.** Every query fails with
  `errorDatabaseInaccessible`, and iOS runs `BGProcessingTask` when the device
  is idle — overnight, locked. Check `ProtectedData.isAvailable` (or
  `engine.isHealthDataAccessible()`) before HealthKit work in any background
  path and skip cleanly, recording `WakeRecord.Outcome.skippedLocked`, not
  `.completed`. Never report the BG task itself as failed for this — that costs
  future scheduling opportunities.
- **Limited history access (iOS 27).** A type limited to *Past 30 Days* is
  readable only from a fixed date (`HKHealthStore.earliestAuthorizedSampleDate(for:)`),
  and older history reads as **empty**, never an error. Empty is destructive, so
  `ReadableHistory` clamps every pass the server overwrites or deletes from:
  every aggregate pass computes only buckets that *start* at or after the date,
  the rings start at the first whole readable day, and reconciliation compares
  from the date or throws `readableHistoryUnknown`. The raw sweep and the
  route/stream phases never overwrite and need no clamp. Each pass records
  `readableSince` in its state — optional, so 1.5 state files decode; never
  make it required. **Widening re-sweeps**, because an anchor taken under a
  limit never returns the older samples: `refreshReadableHistory` (engine entry
  points and observer wakes, at most every 15 min; forced by the app at launch,
  on every foreground and after every permission sheet) resets a widened raw
  type's anchors and reopens its backfill; aggregate series, rings and
  enrichment reset on their next run. **A widening must be confirmed:** a type
  set to **None** drops out of `earliestAuthorizedSampleDate(for:)` exactly like
  Full Access, and treating that as widening resets an aggregate series to all
  nulls, so it counts only once HealthKit returns a sample (rings: a day)
  ending before the recorded date (`ReadableHistory.resolve`, `hasHistory`). A
  widened type a run holds is not touched, not even recorded, until released;
  ±1 day (DST) is the same date; a narrowing only records. Every call here
  times out after 10 s and fails closed (an aggregate or ring pass records
  `readableHistoryUnknown` and sends nothing; an export says it may be
  incomplete). Never pass the API an empty set — it breaks the `healthd`
  connection (Cocoa 4099). The API is iOS 27 SDK only and CI also builds with
  Xcode 26.5, so it is called **only** in `ReadableHistory.swift`, behind
  `#if compiler(>=6.4)` (Xcode 27) *and* `#available(iOS 27.0, *)`. Don't
  Allow on the history page throws `errorAuthorizationDenied`;
  `requestAuthorization` returns `.declined`, and the app treats it as an
  answer. Details: `PulsHealthSync/README.md`, "Limited history access (iOS 27)".
- **Incremental sync merges types into one batch; backfill does not.**
  `syncTypes(_:reason:)` routes `.incremental` through `MergedSync`: one
  anchored page per type, packed into shared uploads (`maxMergedBatchSamples`,
  default 1,000). Anchor-after-ack holds because **a page is never split across
  batches** — the budget is clamped up to `batchSize`, so one page is one ack
  and a failed upload leaves every anchor in its pack untouched; keep
  `HealthSyncEngine.pack`'s no-split property (`MergedSyncPackingTests`).
  Backfill keeps the per-type path: its pages are full, and four type pipelines
  overlap better. Reading ahead keeps anchor-after-ack: the merged path reads
  the next wave while up to `maxConcurrentTypes` packs of disjoint types upload
  (`ConcurrentUploadTests`); the per-type path reads one page ahead in memory,
  and a failed upload cancels that read. **A backfill claims all its types up
  front** (`claimTypes`, then `sweep` releases each as it ends;
  `syncAllEnabled(.backfill)` claims before its first phase), or the observer
  wake that Apply's observer registration triggers takes them down the merged
  path one upload at a time. The iOS 26 continued-processing task claims later
  still, so a whole-history Apply calls `expectBackfill()` before registering
  the observer: observer wakes then leave still-backfilling types alone until a
  backfill claims them (a minute at most).
- **Recent data first, on an anchor of its own.** A nil-anchor sweep returns
  history roughly oldest first, so every sweep entry point first runs a
  recent-window pass (`RecentSampleWindow`, `SweepPass.recent`) over its types
  still backfilling: the last 30 days, through `TypeSyncState.recentAnchorData`
  from a `recentWindowStart` fixed when the stream begins. Its acks go through
  `recordRecentWindowUpload`, which moves that anchor and nothing else — never
  `anchorData`, `backfillComplete` or `totalSamplesExported` (the sweep sends
  and counts the same samples later). The two anchors never stand in for each
  other: the stream's is read under a date-bounded predicate and would skip all
  older history. `markBackfillComplete` drops the stream. A destination where a
  repeated sample is a duplicate row rather than a no-op builds its engine with
  `recentWindowFirst: false`.
- **Work the app starts itself holds a background-task assertion**
  (`BackgroundExecution.run`): observer wakes, the foreground/Sync Now pass,
  Apply's inline backfill and Start Initial Backfill's fallback. When iOS's
  grace period ends the work is **cancelled, not frozen** — every sweep stops at
  a page boundary with its acked anchors recorded and its claims released, and
  the wake is logged `expired` (a frozen run keeps its types claimed, and the
  next wake does nothing). An observer wake whose types another run holds waits
  for it (`waitForRelease`, ≤25 s) rather than acknowledging HealthKit at once,
  and acknowledges from `onExpiration` if time runs out: the cancelled wake may
  be suspended before its `defer` runs, and three unacknowledged deliveries stop
  HealthKit waking the app. After expiry a sweep starts no further type
  (`addTaskUnlessCancelled`) and `syncAllEnabled` stops after phase 3. Never
  nest it inside a `BGTaskScheduler` handler: those have their own expiration,
  and a nested request would cut a processing task short at ~30 s.
- **The schema is applied by the `migrate` service, never by hand.**
  `server/db/migrate.sh`, a one-shot Compose service that runs before every app
  service on each `docker compose up -d`, applies `db/migrations/` in lexical
  order and records each file's checksum in `schema_migrations`. New DDL is a
  new `NNN_name.sql`; an applied file is immutable (a changed checksum or a
  missing recorded file aborts the run, and the app services do not start).
  First-line exceptions: `-- puls:rerun` (re-applied whenever it changes —
  `009_metric_daily.sql`, `010_category_labels.sql`) and
  `-- puls:no-transaction` (statement by statement — `008_quantity_rollups.sql`,
  for `refresh_continuous_aggregate`). `*.sh` files (`013_time_zone.sh`,
  `099_read_roles.sh`) run every time from `.env` values, so rotating a
  database password or changing the zone is "edit `.env`, `docker compose up
  -d`". A database with the schema but no `schema_migrations` is refused until
  `docker compose run --rm migrate baseline`. DDL on a live database is one-way:
  `make backup` first. See `server/README.md`, "Schema migrations".
- **Actors.** `HealthSyncEngine`, `SyncStateStore`, and `SyncEventLog` are actors
  under Swift 6 strict concurrency (`BackgroundSyncScheduler` is a `Sendable` final
  class). Views call them via `@MainActor` `AppModel`.
- **iOS version gates.** State of Mind / effort scores / sleep apnea are
  `#available(iOS 18, *)`; medication doses and `BGContinuedProcessingTask` are
  `#available(iOS 26, *)`. Gate new type support the same way. An API that
  exists only in an SDK newer than CI's oldest Xcode also needs a compile guard
  — `#if compiler(>=6.4)` for the iOS 27 SDK; `#available` alone does not
  compile against the older SDK.
- **First run only, it applies nothing until the last page, and its Health
  page cannot be skipped.** `OnboardingView` covers `RootView` while
  `AppModel.showsOnboarding` is true — decided synchronously in `init` from the
  durable `onboardingCompleted` and `authorizationRequested` flags (so a fresh
  launch never flashes an unconfigured tab), then corrected in `startBody` from
  the stored configuration: an install with a database, types or a prior Apply
  must **never** be sent through it. Four pages in a paging horizontal
  `ScrollView` (a paged `TabView` swallows the drag past its last page). The
  draft holds the starter set (`TypePresets.common`, via
  `preselectCommonTypesIfUnset`), and only Start Exploring applies it
  (`finishOnboarding()` → `applyConfiguration(syncNewTypes: true)`, the Save &
  Apply path). **Page 2 is the pre-permission screen App Review judges under
  guideline 5.1.1(iv)**: one neutral Continue, no skip. Until
  `onboardingHealthAccessPending()` reports nothing left to ask (it awaits
  `start()`, since an empty draft would read as settled), the pager holds only
  pages 1 and 2; Continue or a swipe past page 2 (`onPullPastEnd`, iOS 18+)
  presents the sheet, and any answer — Don't Allow on either sheet page
  included — moves on to page 3. Never add a page, link or gesture that reaches
  page 3 around that. The medication picker is scheduled after the cover is
  down, never awaited (see Gotchas), and a pairing link accepted during the
  flow waits in `confirmedPairing` until then (`pairingAwaitsSyncTab`), when
  RootView opens Sync → Database with it.
- **`site/` reads its content by relative path:** `knowledge-base/`
  (`site/src/lib/api.ts`), `blog/articles` (`site/src/lib/blog.ts`),
  `blog/images` (`copy-blog-images` in `site/package.json`) and the eleven
  repository markdown files in the manifest in `site/src/lib/docs.ts`
  (rendered at `/docs/<slug>/` with relative links rewritten; never edit the
  markdown for the site). Move or rename any of them and the loaders log "not
  found" and the build **still succeeds** with fewer pages, so the `site` CI job
  asserts the counts: 177 type pages (one per tracked YAML file), one per
  `blog/articles/*.mdx`, one `/docs/` page per manifest entry (`manifest=11` in
  `ci.yml` moves with the manifest). Keep that check honest; don't loosen it.
- **The app is shipped software, not a source drop.** It is on the App Store as
  [PulsHealth](https://apps.apple.com/us/app/pulshealth/id6757657354), so the
  privacy policy, listing copy and entitlements describe a binary people are
  running. `docs/appstore/` is a **record** of what shipped as well as material
  for the next submission; its README's § Release record is the version log and
  where a submission starts. The store record's bundle ID
  `com.pulsHealth.PulsHealth` is immutable, so `PulsHealth/project.yml`'s
  `bundleIdPrefix` (`com.pulsHealth`) is fixed, and only an archive carrying it
  updates the listing. `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` must stay
  ahead of every upload: 1.6 (19) is on the store (released 2026-10-01), so the
  next upload needs build 20 and a version above 1.6.
- **The published privacy claims are load-bearing.** `docs/privacy-policy.md`,
  `docs/appstore/` and the site's `/privacy` page state as fact that the app
  has zero third-party dependencies, sends data only to the configured server,
  never writes HealthKit, keeps the token in the Keychain, and stores no health
  samples on the device — except an export the user asked for, staged in the
  temporary directory until it is shared. A change to any of those — a
  dependency, a new outbound request, a new permission, a new on-disk store —
  updates those documents in the same pull request, and the App Store listing's
  privacy answers with them (`docs/appstore/README.md` has the table).

## Gotchas

- `HKQueryAnchor` blobs are opaque NSKeyedArchiver data — never inspect or
  synthesize them; reset state instead (`Settings → Reset All Anchors`).
- A type the permission sheet will not list stays `.shouldRequest` forever, and
  requested alone it flash-dismisses the sheet. iOS 26 does this to blood
  pressure systolic/diastolic (FB22735935, fixed in iOS 27.0), with no in-app
  fix (the BP correlation type is disallowed in auth requests — ObjC
  exception). So `AppModel` remembers undeterminable types per session
  (`undeterminableTypes`), skips them in later requests, and points at
  Settings → Privacy & Security → Health, naming the iOS 26 bug only below iOS
  27. Keep it: it is version-agnostic and self-heals (retried each launch).
- Statistics queries crash on illegal option×type combos: HealthKit raises
  NSInvalidArgumentException when the query *executes* (uncatchable from Swift;
  construction succeeds, so there is no early warning). Only ever offer or
  construct functions from `HealthTypeCatalog.allowedAggregateFunctions(for:)` —
  derived from `aggregationStyle` and verified against all 372 type×function
  combos by `PulsHealth/HostedTests/AggregateMatrixTests` (ObjC exception
  catcher + legacy `execute()`, which raises synchronously). Re-run that test on
  each new iOS runtime; Settings → Validate Aggregate Functions does the
  legal-set half on-device.
- Never add `workoutEffortScore`/`estimatedWorkoutEffortScore` to the catalog or
  any read-authorization request: iOS refuses to show them in the permission
  sheet (FB15315876), leaving the request stuck at `.shouldRequest` and making
  the sheet flash-dismiss, which blocks grants for every other pending type.
  Effort scores ship attached to workout payloads via `SeriesEnricher` instead.
- The iOS 26 medication picker (`requestPerObjectReadAuthorization`) presents
  itself over whatever HealthKit view controller is on screen. Asked while the
  bulk permission sheet is still tearing down, it never appears ("…whose view
  is not in the window hierarchy") and the call **never returns**, so awaiting
  it deadlocks Apply. `AppModel.scheduleMedicationAccessRequest()` starts it
  without awaiting, after the onboarding cover is down and the bulk sheet has
  settled, with a watchdog that logs when it never appears. Keep per-object
  requests off Apply's awaited path.
- iOS silently throttles "immediate" background delivery to ~hourly for
  steps/energy/distance, and Watch→iPhone sync can't be forced. Latency complaints
  are usually iOS behavior, not bugs — see the latency table in the root README.
- `quantity_samples` chunks >30 days old are columnstore-compressed (segmentby
  `type_id`, orderby `start_ts`). DELETE/UPDATE against them must be prunable —
  include `start_ts` (and ideally `type_id`) in the predicate, never bare
  `uuid` — or TimescaleDB trips its per-transaction decompression limit
  (SQLSTATE 53400 → 500s, sync stalls). `InsertBatch` lifts the limit via
  `SET LOCAL` as a safety net; `TestIntegration_DeletionsOnCompressedChunk`
  guards the deletion path.
- Reconciliation (digest/UUID repair) covers only quantity/category/workout kinds.
- The ingest container is distroless: no shell, debug via `docker compose logs ingest`.
- `server/mcp` is a read-only client of the product API (`server/api/docs.go`
  is its contract) and must stay one: no database URL, no writes, every tool
  annotated read-only. Its tool descriptions and embedded `guide.md` spell out
  units, the time-zone rule and the double-counting rule for the model — update
  them with any change to the API's shapes. `PULS_TIME_ZONE` must be handed to
  it separately (the API does not report its zone). In stdio mode stdout is the
  transport: never print to it; logs go to stderr.
- Grafana datasource UID `puls-tsdb` is hardcoded in dashboard JSON — keep it stable.
- Debounces are intentional: state persist 250 ms, event-log save 1 s. Synced Data
  edits are not debounced — they are staged in `AppModel.config` and reach the
  engine only when the user taps Apply (`applyChanges`).
- **Public tree.** This repository is public: no personal identifiers, hostnames,
  e-mail addresses, Apple Team IDs or credentials in tracked files (`.env`,
  `PulsHealth/Config/Local.xcconfig` and `PulsHealth/PulsHealth.xcodeproj` are
  gitignored for exactly this reason). CI runs `scripts/check-public-tree.sh`,
  which fails on the known identifiers — keep examples generic (`<host>`,
  `<user>`, `YOUR_PASSWORD`).
- The `web` viewer's data pages are `export const dynamic = "force-dynamic"` so
  they always render live from Postgres. Don't reintroduce `revalidate`/ISR on
  them — it bakes a DB-less demo render at build time and serves it stale after
  deploys. **Demo data is dev-only:** `web/lib/queries.ts` gates it on
  `ALLOW_DEMO = NODE_ENV !== "production"`, and the container sets
  `NODE_ENV=production`, so an unset or unreachable DB shows the `"error"`
  source ("Database unavailable") with empty queries, never demo data.

## Deployment

The reference stack (`server/docker-compose.yml`) runs on any Docker host;
`server/README.md` covers configuration, ports, tokens, upgrades and backups.
The maintainer's own production operations live outside this repository —
nothing here assumes a particular machine.

- **The four app services run published images, not local builds.**
  `server/docker-compose.yml` uses `ghcr.io/pulshealth/<name>:${PULS_VERSION:-latest}`
  with no `build:` block; the developer overlay `server/compose.build.yml` puts
  the builds back (tagged `pulshealth-<service>:dev`, so a local build never
  looks like a release). A Dockerfile, build-context or build-arg change
  touches all three of that overlay, the `images` job in `ci.yml` and the build
  matrix in `release.yml`. The checkout must be on the release `PULS_VERSION`
  names, because the compose file and `db/migrations/` (which `migrate` mounts)
  come from it.
- CI is `.github/workflows/ci.yml` (Go vet/tests, lint, shellcheck,
  `scripts/check-public-tree.sh`, `docker compose config` over **both** compose
  variants, and an `images` job that builds all four images for `linux/amd64`
  without pushing) plus `ios-ci.yml` for the Swift side. `release.yml`
  publishes to `ghcr.io/pulshealth` on `v*` tags and on `workflow_dispatch`
  (which never moves `latest`), each platform on its own native runner, merged
  into one manifest list. There is no deploy workflow in this repo.
- **Backups are opt-in and off by default** (the `backup` Compose profile;
  `make backup` for one dump, `make restore FILE=…`). Until they are on, the
  Postgres volume is the only copy, and only a `PULS_BACKUP_DIR` off that disk
  survives losing it; only the restore drill in `server/README.md` verifies a
  backup. TimescaleDB restore rules, which `server/backup/restore.sh` enforces
  and a hand-restore must follow: `timescaledb_pre_restore()`/
  `timescaledb_post_restore()` around it, never `pg_restore -j`, and drop the
  old `public` schema *before* `pre_restore` (the drop takes the extension with
  it — reinstall it first).
- Ingest connects as the scoped DML-only `ingest` role (`INGEST_DB_USER`,
  default `ingest`; `INGEST_DB_PASSWORD` required, kept equal to the role's
  password by `099_read_roles.sh`), never with the superuser password;
  `INGEST_DB_USER=postgres` is the documented, discouraged way back.
- Ingest publishes port 8080 on `${INGEST_BIND_ADDR:-127.0.0.1}`, assuming a TLS
  proxy in front. Only `scripts/bootstrap.sh --lan` writes `0.0.0.0`, on
  request: a phone on the same Wi-Fi then uses `http://<LAN IP>:8080`, which the
  app's ATS exception allows only for local-network hosts
  (`ServerURLValidation.isLocalNetworkHost`). Keep the two rules in step, and
  keep the loopback default.
- The product API host mapping stays on `127.0.0.1`. The `web` viewer's login is
  **optional and off unless `WEB_AUTH_PASSWORD` is set** (`web/proxy.ts` over
  `web/lib/auth.ts`: HTTP Basic, any username, `/api/healthz` exempt,
  constant-time compare, nothing about an attempt logged). It is a password
  prompt, not TLS, so `web` still binds to `WEB_BIND_ADDR` (default
  `127.0.0.1`) behind a private network or an HTTPS proxy, and reads Postgres
  over the internal network as the read-only `grafana` role.
- **Ingest and the product API throttle failed authentications, never
  successful ones** (`server/ingest/ratelimit.go`, `server/api/ratelimit.go` —
  copies, because they are separate modules; keep them in step): a per-IP
  bucket of 10 failures refilling at 10/minute, then `429` + `Retry-After`. The
  refusal comes *before* the token comparison, or it would change only the
  status code an attacker sees, not their guessing rate; successes never draw,
  because a backfill is thousands of authenticated requests.
  `TRUST_PROXY_HEADERS=true` keys on `X-Forwarded-For` behind a proxy that owns
  it and, on the API, lets `X-Forwarded-Host` choose the host the
  unauthenticated `/openapi.json` advertises. See `server/README.md`, "Rate
  limiting".
- **Ingest auth order** (`server/ingest/auth.go`): the limiter, the shared token
  in memory, then the bearer's SHA-256 looked up in `device_tokens` (no salt:
  the preimage is 256 random bits). A database error in that lookup is **503
  `authentication unavailable`, never 401**, and not charged to the limiter:
  the app retries 5xx but treats 401 as terminal, so a 401 would stall syncing
  until the user retyped a correct token. Only wrong credentials (missing
  bearer, unknown hash, revoked token) charge the limiter; a user mismatch
  (403) is a misconfigured phone with a valid credential. `grafana` has SELECT
  on every table by default privilege, so `099_read_roles.sh` revokes it on
  `device_tokens` every run; `api_reader` is an exact grant list asserted by a
  `DO` block, so a table the product API newly reads goes on BOTH the `GRANT`
  and the `expected_public` rows. `PULS_TOKEN` is optional; do not make it
  required again.
- **`/healthz` is unauthenticated on both services, so it must not touch the
  pool per request** (`server/ingest/health.go`, `server/api/health.go` — again
  copies). The database status is cached for two seconds and concurrent callers
  collapse onto one probe; otherwise a loop of GETs from anyone who can reach
  the port holds every pooled connection and stalls the service.
