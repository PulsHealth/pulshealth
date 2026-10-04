# Deep review, October 2026 — findings and roadmap

Reviewed 2026-10-03 on `main` at 21f9430 (app 1.6 (19) on the store, server
v0.2.0 tagged, 015/016 unreleased). Six read-only audits, one per component,
each cross-checked against the invariants in `CLAUDE.md`; every High item was
re-verified by hand before it was written down here. The goal was not a list of
everything that could be nicer, but what stands between this code and many
people running it without the maintainer in the loop.

**Verdict.** The core is sound. Anchor-after-ack, idempotent inserts, the
no-split packing rule, canonical units, the accounts-mode database barrier and
the definer-function boundary all hold in code and are tested; no audit found a
violation of a stated invariant. What is weak is the *edge*: resource bounds,
proxy trust, release cadence, the first-run path for a self-hoster, and a few
process-lifecycle cases on the phone. Those are what this roadmap orders.

Status column: **done** = landed on the `deep-refactor` branch (each fix
with a test); **no** = considered and declined, with the reason. Every item
now has one of the two. The app and library fixes of the second round
(S11, R7–R11, R13, R16, R17, F3, F4) were written without a Swift
toolchain: CI's iOS job is their first build, and R8, R16 and R17 want a
device pass before the next App Store upload.

## 1. Security

| # | Where | Finding | Fix | Status |
|---|---|---|---|---|
| S1 | `server/ingest/ratelimit.go`, `server/api/ratelimit.go`, `web/lib/accounts/request.ts` | With `TRUST_PROXY_HEADERS=true` the failure limiter keys on the **first** `X-Forwarded-For` entry. Every documented proxy (Cloudflare Tunnel, nginx, Caddy) *appends*, so a client sends its own first entry and gets a fresh bucket per request: brute force at line rate on the ingest, API and viewer sign-in. | Key on the **last** entry (the one the trusted proxy appended). Test with `"evil, real"`. | done |
| S2 | `server/.env.example`, Go services, `099_read_roles.sh` | Every secret ships as `change-me`; only `bootstrap.sh` rejects it. The by-hand install path plus `INGEST_BIND_ADDR=0.0.0.0` is an internet-reachable ingest with a guessable token. | Ingest, API and MCP refuse to start when a token is `change-me`; `migrate.sh` refuses a role password of `change-me`. | done |
| S3 | `server/mcp/tools.go` `listUsers` | A connector pinned with `PULS_USER_ID` (which `docs/ai.md` promises "can never be asked about another" person) still lists every user's name, e-mail and sync counts. | Pinned instance returns only its user. | done |
| S4 | `server/mcp/main.go` `bearerAuth` | The MCP's HTTP mode is the one bearer surface with no failure throttling and no log line. | Reuse the limiter copy, warn on failure. | done |
| S5 | `web/lib/accounts/password.ts` | scrypt N=2^15, r=8, p=1 is 3–4× under OWASP's listed minimums; `needsRehash` already upgrades transparently. | N=2^16, p=2 (raise `maxmem`). | done |
| S6 | `web/lib/accounts/session.ts` | Sessions slide 30 days with no absolute cap: a stolen cookie used monthly lives forever. | Also refuse `created_at` older than 90 days in `findSession`. | done |
| S7 | `016_web_signups.sql` `set_account_disabled` | An administrator can disable another administrator, or themselves, through `/api/admin` (the UI only hides the button). | Refuse `is_admin` targets and self in the definer function (new migration). | done |
| S8 | `web/lib/accounts/signups.ts` | Pending sign-up requests are unbounded and never pruned; a flood buries real ones past the `/admin` 200 cut-off and burns the operator-mail daily cap. | Prune pending rows older than 30 days in `auth.prune_signups`; cap pending rows; bulk decline. | done |
| S9 | `web/lib/accounts/ratelimit.ts` | The e-mail bucket lets 10 wrong guesses a minute keep a victim signed out indefinitely (targeted lockout). | Slower drain on the e-mail bucket than the IP bucket, or require both exhausted. | done (a known-address exemption: a failure from an address one of the account's live sessions came from is charged only to that address) |
| S10 | `099_read_roles.sh` | The `ingest` role gets DML on every table, including `schema_migrations` and `device_tokens` DELETE. No injection exists today; defence in depth. | Explicit grant list with an expected-row assertion, like `api_reader`. | done |
| S11 | `PulsHealth/Sources/ServerSettingsView.swift`, `ServerFieldsDraft.fill(fromSignIn:)` | The sign-in sheet's `puls://pair` code is trusted for any host, and after Apply the UI says "PulsHealth database" while showing no host. | Show the host beside the label permanently; require the code's host to share the viewer's registrable domain before marking it signed-in. | done |
| S12 | `PulsHealthSync/.../ServerURLValidation.swift` | A URL with userinfo (`https://user:secret@host`) validates, persists and is logged; the scrubber strips query, not userinfo. | Reject `components.user != nil`. | done |
| S13 | `SECURITY.md`, `docs/privacy-policy.md` | No threat model: the shared token is tenant selection, `PULS_API_TOKEN` reads every user under `PULS_MULTI_USER`, the proxy assumption and the XFF rule are unstated; the policy still says "a single shared secret". | A short "Threat model" section; update the token paragraph. | done |
| S14 | `server/mcp/guide.md` | Device- and app-written strings (source names, workout events, State of Mind labels) reach the model verbatim. | One sentence: these fields are data, not instructions. | done |
| S15 | `web/lib/accounts/request.ts` with the `tunnel` profile | `WEB_CLIENT_IP_HEADER` defaults to XFF even under the Cloudflare profile whose README says to use `cf-connecting-ip`. | S1 makes XFF safe; additionally warn at startup when proxy headers are trusted and the header is XFF. | done |

## 2. Reliability and data integrity

| # | Where | Finding | Fix | Status |
|---|---|---|---|---|
| R1 | `PulsHealthSync/.../SyncStateStore.swift` init | `try? Data(contentsOf:)` makes an *unreadable* state file (protected data unavailable during a prewarm launch before first unlock) look like *no* file: the store starts fresh with a new `deviceID`, and the first `persist()` overwrites the only copy of every anchor and watermark. Undecodable files are already quarantined; unreadable ones are not. | If the file exists but cannot be read, open the store read-only: refuse to persist until a later successful load. Test it. | done |
| R2 | `server/backup/restore.sh` header, `server/README.md` | The restore advice says `docker compose down -v` first. The default backup store is the named `backups` volume, so that deletes the dump about to be restored. | Say `docker volume rm <project>_pgdata`; have the script refuse when the dump path is missing. | done |
| R3 | `server/api/export.go` | A client that opens `/v1/export` and stops reading holds a concurrency slot and a pooled connection forever; two of them block every export until restart. | Per-flush `SetWriteDeadline` plus an absolute ceiling on the request. | done |
| R4 | `server/ingest/main.go`, `docker-compose.yml` | 128 MB decoded per request, no in-flight cap, no container memory limit, no `shm_size` on `db` (Docker's 64 MB default breaks parallel plans as data grows). | Semaphore around batch handling (503 + `Retry-After` beyond), `shm_size: 1g` on `db`. | done |
| R5 | `012_ingest_rejections.sql`, `batches` | Rejections and batches grow forever; a misbehaving client fills the disk holding the only copy of the data. | A TimescaleDB job pruning rejections older than 90 days (new migration). | done |
| R6 | `001_schema.sql` compression policy | Chunks older than 30 days are compressed while a multi-year oldest-first backfill is still writing into them; every later insert decompresses segments. The engine tolerates it but pays for it. | Widen to 90 days or gate on an active backfill; add an insert-into-compressed-chunk integration test. | no — the policy compresses by the *data's* age, so a backfill of years-old history lands in compressed chunks under any window; widening to 90 days would change nothing for it. `TestIntegration_InsertIntoCompressedChunk` now proves inserts and re-sends into a compressed chunk work |
| R7 | `PulsHealthSync/.../MergedSync.swift`, `NDJSONEncoder.swift` | ECG and heartbeat series page at the global 1,000 and are enriched (≈15k doubles per ECG) before upload: a full page is ~120 MB of doubles plus the body plus deflate, past the background jetsam limit, doubled by read-ahead. | Per-kind page size on the descriptor (ECG ≈ 20, heartbeat series ≈ 200). | done |
| R8 | `HealthSyncEngine.swift` terminal-error path | After a 400/403/413 the anchor stays put and every wake re-reads, re-encodes and re-POSTs the same doomed page. No cross-wake cooldown. | Persist a per-type cooldown (`lastErrorAt` + terminal flag already fit `TypeSyncState`); skip while cooling; surface in status. | done (the app shows a cooling type as "Paused until <time>" next to its error, with Sync Now as the way out) |
| R9 | `HealthSyncEngine.swift` `decodeAnchor` | A corrupt anchor blob (restore, downgrade) fails the type every run forever until the user finds Reset. | On decode failure, clear the anchors and reopen the backfill (safe: inserts are idempotent). | done |
| R10 | `HealthSyncEngine.swift` reconciliation | An unlimited per-month sample query held as `[UUID: HKSample]`; a Watch heart-rate month is hundreds of thousands of samples. | Cursor with a limit; keep UUIDs only; re-query only the mismatched set. | done |
| R11 | `SyncTransport.swift` | Every `URLError` retries the full 2+4+8+16 s ladder, including TLS/ATS/bad-URL failures that can never succeed; 429 ignores `Retry-After`. | Classify terminal `URLError` codes; honour `Retry-After`. | done |
| R12 | `WakeLog.swift` | `begin` and `finish` each re-encode and rewrite the full 10,000-record file synchronously, twice per wake, inside the background budget. | Cap at ~2,000 records. | done |
| R13 | `SyncStateStore.setConfiguration` | `authToken == nil` means "delete the Keychain item"; any caller that rebuilds a configuration without the token wipes the credential and stalls sync. | Separate `setAuthToken`/`clearAuthToken`; nil means keep. | done |
| R14 | `PulsHealth/Sources/BenchmarkView.swift` | The benchmark's throwaway engine uses the default `WakeLog`, which rewrites the app's real `wake-log.json` while a wake may be open; it also runs 4-wide against HealthKit with no backfill gate. Same hazard `CLAUDE.md` names for `HealthExporter`. | Pass a temporary `WakeLog`; disable while `backfillActive`. | done |
| R15 | `AppModel.swift` `applyConfiguration` | `expectBackfill()` is called before the `!isSyncingAll` guard; an Apply during a sync primes the engine for a backfill that never comes, and the new types trickle in silently. | Call `expectBackfill()` after the guard; tell the user when the backfill was deferred. | done |
| R16 | `BackgroundSyncScheduler.swift` `handleContinuedBackfill` | The iOS 26 continued-processing path never checks `isHealthDataAccessible()`; a locked phone fails every type with `errorDatabaseInaccessible` instead of `skippedLocked`. | Check at start and on per-type failure. | done |
| R17 | `AppModel.swift` continued backfill | Nothing sets `isSyncingAll` while a continued task is pending, so Sync Now and a second Start Initial Backfill can run alongside it. | A `continuedBackfillPending` flag cleared on first backfill activity. | done |
| R18 | `web/lib/db.ts`, `web/lib/queries.ts` | Pool of 4; a type page runs four `scoped()` transactions in parallel plus two session lookups. A few concurrent people exhaust it, and every query's `catch` returns **empty data silently**. | Pool size from env; surface a query failure as the `"error"` source, not an empty chart. | done |
| R19 | `server/api/store.go` `CatalogTypes` | `count/min/max` over the hypertables filtered on `user_id`, which has no index and is not the segment key: a full decompressing scan per cache miss, and the MCP's documented first call. | Serve stale while refreshing asynchronously; longer term, maintain counts from ingest. | done |
| R20 | `server/api/main.go`, `server/mcp/main.go` | The `PULS_TIME_ZONE` invariant is never checked: the API never compares its zone with `puls_time_zone()`, and the stdio MCP takes the laptop's. | API checks at startup and refuses a mismatch; expose the zone on `/v1/users`. | done |
| R21 | `server/ingest/store.go` legacy activity summary | A pre-`localDate` client's ring date is formatted in UTC, contradicting "never UTC-shifted" for phones east of UTC. | Shift by the batch's `utcOffsetSeconds`, else reject. | done (the line's `temporalContext` offset when it has one; without one the UTC date stays, since a 400 would stop that client's rings for good) |
| R22 | `server/ingest/main.go`, compose | Shutdown gives 15 s but Compose's default grace is 10 s and `pool.Close()` waits on a 5-minute insert context: every restart with a batch in flight is a SIGKILL. | `stop_grace_period: 30s`; shorter insert ceiling on shutdown. | done |
| R23 | `server/db/migrate.sh` | No mutual exclusion; `make migrate` during `up -d` can apply a pending file twice. | `pg_advisory_lock` for the run. | done |
| R24 | `server/api/health.go`, `server/ingest/health.go` | The probe runs on the request's context; a checker with a 1 s timeout cancels it and the cached `false` 503s the next poll. | Probe on `context.Background()` with its own timeout. | done |
| R25 | `server/api/main.go` | A 30 s deadline exceeded is a generic 500; `types` lists have no count cap. | Map `DeadlineExceeded` to 504; cap `types` at 50. | done |

## 3. Operations, release and onboarding

| # | Where | Finding | Fix | Status |
|---|---|---|---|---|
| O1 | `README.md` quickstart, `server/README.md` | The quickstart clones `main` but runs `PULS_VERSION=latest` = v0.2.0: migrations 015/016, `ingest qr`, accounts mode, `make web-invite` and the tunnel profile are documented and do not work on a fresh install. | Tag **v0.3.0** (the Unreleased changelog is written) and have the quickstart check out the tag the images come from. | done in the docs (quickstart on the release tag, `bootstrap.sh` pins `PULS_VERSION`); the v0.3.0 tag follows the merge to `main` |
| O2 | `.github/workflows/release.yml` | `workflow_dispatch` on a tag ref moves `latest` (contradicting its own header); per-image `fail-fast: false` can leave `latest` on mixed versions; tags are never checked to be on `main`. | `latest=false` on dispatch; all-or-nothing merge; `merge-base --is-ancestor` check. | done |
| O3 | `ci.yml` | The stack is never started in CI: no `migrate → ingest POST → API GET` path, and the built images never run. | One job on `compose.build.yml` that posts a fixture and reads it back. | done |
| O4 | `ci.yml`, test guards | Integration tests, the notebook test, the catalog-drift test and the web integration list all skip silently when their precondition is missing. | `PULS_CI_REQUIRE_INTEGRATION=1` turns skips into failures; glob the web files. | done |
| O5 | `docker-compose.yml` | No `healthcheck:` on ingest, api, web or mcp, so `restart: unless-stopped` never restarts a wedged process; no metrics. | A Go `healthcheck` subcommand (distroless has no curl); compose healthchecks. | done |
| O6 | `.github/dependabot.yml` | No `docker-compose` ecosystem: the TimescaleDB, Grafana and cloudflared pins never move; no image scan. | Add the ecosystem; Trivy in `advisories.yml`. | done |
| O7 | `.gitignore` | `.env.local`, the two Go binaries, `AuthKey_*.p8`, `ExportOptions.plist`, `*.ipa`, `*.xcarchive`, `.venv/` are not ignored, although `docs/appstore/` promises the plist never lands in the repo. | Add them. | done |
| O8 | `scripts/check-public-tree.sh` | Checks `DEVELOPMENT_TEAM =` only (not xcodegen's `:`), `/home/` not `/Users/`, one mail domain, no RFC1918 addresses, no secret-shaped patterns. | Widen; add a secret regex pass. | done (RFC 1918 addresses left out: the tests are full of example ones) |
| O9 | `server/backup/restore.sh` | A scheduled `backup` loop keeps running during a restore and can snapshot a half-restored database as the "newest" dump. | Stop the backup profile for the restore. | done |
| O10 | Three services | `TRUST_PROXY_HEADERS` is parsed three ways (ingest `ParseBool` crashes on `yes`, API `== "true"`, web accepts `on`). | One rule; fail loudly on an unparseable value. | done |
| O11 | docs | No app↔server compatibility matrix; the protocol spec keeps no history of additive v1 changes; no ops runbook. | A `## Compatibility` table in `CHANGELOG.md`; "Additive changes in v1" in the spec. | done |
| O12 | `web/lib/viewer.ts`, both READMEs | Docs say `PULS_MULTI_USER` gates the viewer's user switcher; the viewer never reads it. | Correct the docs (the switcher is a basic/open-mode feature behind the one password). | done |
| O13 | `web/lib/accounts/session.ts` | `createSession` sweeps every expired session on each sign-in. | Move into the hourly prune job. | done |

## 4. Protocol

| # | Where | Finding | Fix | Status |
|---|---|---|---|---|
| P1 | `docs/protocol/fixtures/` | Every fixture timestamp is an integer and every UUID lower-case; the app sends fractional epoch-ms and upper-case UUIDs. The reference Python receiver compares UUIDs case-sensitively and gunzips without a size cap, both against the spec. A receiver that passes the corpus can still be wrong. | Fractional timestamps and mixed-case UUIDs in fixtures 01/02; fix the reference receiver. | done |
| P2 | `docs/protocol/README.md` | Spec says the probe's `type` is the heart-rate identifier; the app sends `"probe"`. Spec shows activity summaries with explicit `null`s; the encoder omits nil fields, so an update-present-keys receiver keeps stale ring values. No fixture tests overwrite semantics. | Correct the text; a fixture with omitted summary fields and a second-pass `.expected.json`. | done |

## 4b. Found while fixing

Surfaced by the fixes above, and fixed in the second round.

| # | Where | Finding | Fix | Status |
|---|---|---|---|---|
| F1 | `server/api/main.go` shutdown | Same hazard as R22 on the API: after its 15 s `Shutdown`, `pool.Close` waits on an in-flight export's connection until SIGKILL. Cancelling must not end a truncated export as if it were complete. | Cancel the export context after `Shutdown` and abort the response (as the ceiling already does). | done |
| F2 | `016_web_signups.sql` session check | The definer functions check a session's `expires_at` only, not the new 90-day absolute cap. Every viewer request checks the session first, so this is defence in depth. | Add `created_at > now() - interval '90 days'` in a new migration replacing the check. | done |
| F3 | `SyncStateStore` read-only mode | Read-only lasts the process lifetime: a prewarmed process the user opens later shows an empty configuration, and nothing applied is saved until a relaunch. Safe, but confusing. | Reload the store when protected data becomes available, or show a banner. | done (a notice and a refused Apply, not a reload: the engine is built from the empty configuration) |
| F4 | `WakeLog`, `SyncEventLog` | Both read an unreadable file as a missing one, like the state store did. Only diagnostics are at risk. | Same read-only guard. | done |

## 5. Design and maintainability

Lower priority, listed so they are not rediscovered. None blocks production.

**Second round:** done — the shared `PassFailure` classifier for the five
pass runners; app dead code (except `TypePageView.inExportFooter`, which is
used), one search predicate and one delete-export alert; in ingest,
`strictUnmarshal` removed and `readUserID` without its header fallback; in
the API, every route's statuses documented and checked against the router;
`scripts/check-go-copies.sh` in CI; `web/lib/queries.ts` split into
`web/lib/data/` with one UUID helper and a per-request `viewerUser()`; the
diagnostics files deleted. Deferred until there is a compiler in the loop
or a test to hold them: the engine file split and `SyncKey`/`withClaim`,
`FullPassSchedule`, the `AppModel` split (its seam landed with the §6 #8
tests), merging the two type
pickers, the three duration formatters (they format different things), and
the seven ingest unnest inserts (they differ in conflict targets, joins and
`RETURNING`; only the integration suite could show a shared helper
equivalent).

- **Engine actor is ~3,600 lines over six files**, and the five pass runners copy the same four-way HealthKit `catch` and three near-identical full-pass schedulers. A `FullPassSchedule` value and a shared error classifier would remove most of it. Claims in `activeSyncs` are stringly typed (`"agg:<uuid>"`); a `SyncKey` enum and a `withClaim {}` helper would make the claim/release discipline a type rather than a convention.
- **`AppModel` (1,264 lines)** owns lifecycle, onboarding, permissions, pairing, server change, export gating, diagnostics and aggregates, and constructs its engine itself, so none of its state machine is testable. An `init(engine:scheduler:)` seam, then pairing and permissions split out, would unlock the app's biggest test blind spot.
- **App view duplication:** the type picker is implemented twice (`TypePickerView`, `ExportTypePickerView`), the search predicate four times, the delete-export alert twice, three duration formatters. Dead: `TypeKnowledge.categoryLabel/humanReadableName/defaultUnit`, `ShareBars.scale`, `TypePageView.inExportFooter`.
- **`server/ingest/store.go` (2,280 lines)** repeats the parallel-array unnest insert seven times; `strictUnmarshal` is a no-op wrapper that promises strictness it does not have; `readUserID`'s header fallback is dead in production and would silently reintroduce unauthenticated tenant selection on an unwrapped route.
- **`server/api`:** eight handlers hand-roll the 500 branch while four use `writeStoreError`, so a `requestError` from the former is a 500; `docs.go` is a 540-line hand-written OpenAPI string that tests pin only loosely (403/429 appear on no route). `apiStore` has 17 methods where the stream variants would do.
- **`ratelimit.go` / `health.go` / `isUUID` / `loadTimeZone`** exist in two to four byte-copies across modules by design. A CI step that diffs the comment-stripped copies would keep them honest without a shared module.
- **`web/lib/queries.ts` (1,095 lines)** mixes transport, caching, demo fallback and SQL; six UUID regexes of two strictnesses; three session lookups per navigation (proxy, layout, handler).
- **Diagnostics files** (`puls-wakes-*`, `puls-events-*`) are written to tmp on every Background Activity appearance and never deleted.

## 6. Test blind spots worth closing first

1. Appending-proxy `X-Forwarded-For` in all three limiters (**done** with S1).
2. An existing-but-unreadable state file (**done** with R1).
3. A stalled export reader (**done** with R3).
4. The observer coalescer and the "three unacknowledged deliveries" rule, which live only in comments (**done**: `PulsHealthSync/Tests/PulsHealthSyncTests/ObserverCoalescerTests.swift` — one wake per burst over the union of its types, a stream that cannot postpone the flush, a wake on a held type acknowledging only after the release, expiry acknowledging from the handler and only once, `stopObserving` releasing a pending burst; the flush's background runner and the protected-data check are injectable for it).
5. The HTTP retry loop itself (backoff, the observer's budget of one, 429) (**done** with R11).
6. `migrate.sh` and `restore.sh`, the two scripts that can destroy data, have no automated coverage (**done**: `server/db/test-migrate.sh`, the db-migrate job, pins migrate.sh's whole contract against a throwaway TimescaleDB — lexical order, recorded checksums, `*.sh` every run, `-- puls:rerun`, edited and missing applied files refused, a failing file rolled back, `-- puls:no-transaction`, baseline and its refusals, and the advisory lock under two concurrent runs; `server/backup/test-restore.sh`, at the end of the stack smoke test, dumps synthetic data with compressed chunks and the continuous aggregate and restores it over the live database and into a wiped volume, every table's row count identical. It found that `restore.sh` refused most real-sized dumps streamed from the backup store: its pre-flight `pg_restore --list` closes the pipe early, and pipefail counted the writer's broken pipe. And that `migrate.sh`'s advisory lock did not serialise two containerised runs: it found its lock session by `application_name` `puls-migrate-lock-$$`, and `$$` is 1 in every container, so the compose service and a `docker compose run --rm migrate` beside it shared one name. Both fixed in the same change).
7. Every `app/api/*` route and both server actions refusing without a session or admin (**done**: `web/lib/accounts/refusals.test.ts` walks every `app/api/**/route.ts` on disk and fails on one without a row: the proxy's 401, cross-origin 403 and plain-HTTP 403, each handler's own refusal with the database unreached, and the two server actions).
8. `AppModel` onboarding-flag correction, Apply gating, pairing first-wins (**done**: `PulsHealth/HostedTests/AppModelTests.swift`, over the new `AppModel.init(engine:scheduler:defaults:healthAccess:)` seam — the flags in `init`, the correction in `start()`, the Health page that holds the pager, `finishOnboarding`'s apply, staged edits, the server-change prompt, the unreadable state file, and pairing links during the flow and at launch).

## Not planned

- **A shared Go module for the limiter and health probe.** The modules are separate on purpose (each image builds from its own directory with no cross-context copy); a diff check in CI is cheaper than a module and its versioning.
- **Row-level security in the viewer.** TimescaleDB refuses it on hypertables with columnstore; the security-barrier views are the mechanism and are asserted by `099`.
- **Replacing `docs.go` with generated OpenAPI.** A route-table diff test gives most of the safety for a fraction of the churn.
