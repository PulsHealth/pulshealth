# PulsHealthSync

Swift package (iOS 17+, Swift 6 strict concurrency, no external dependencies) that
syncs HealthKit data to an HTTP ingest server. The PulsHealth app is a thin UI over
this library; everything sync-related lives here. See the root `README.md` for the
overall architecture and wire format, and `CLAUDE.md` for invariants.

## Source map

```
Sources/PulsHealthSync/
├── Engine/
│   ├── HealthSyncEngine.swift       Central actor: authorization (whole-catalog or
│   │                                scoped via requestAuthorization(for:) /
│   │                                authorizationNeeded(for:)), parallel backfill,
│   │                                observer-driven incremental sync, reconciliation.
│   │                                Owns per-type anchors and activity state.
│   ├── AggregateSync.swift          On-device aggregate series (HKStatisticsCollection-
│   │                                Query): per-config watermark + trailing-lookback
│   │                                recompute, calendar bucket math (AggregateBucketing),
│   │                                chunked uploads, debug matrix validation.
│   ├── ActivitySummarySync.swift    Daily activity rings (HKActivitySummaryQuery):
│   │                                Move/Exercise/Stand + goals, singleton day
│   │                                watermark + trailing lookback (today re-queried
│   │                                every run), server upserts by date.
│   ├── BackgroundSyncScheduler.swift BGProcessingTask catch-up (~4 h cadence) and the
│   │                                iOS 26 BGContinuedProcessingTask backfill wrapper.
│   ├── SeriesEnricher.swift         Second-pass queries for series data: heartbeat
│   │                                offsets, ECG voltages, workout GPS routes
│   │                                (chunked 4,000 pts/line), iOS 18 effort scores.
│   └── Reconciliation.swift         Per-UTC-month UUID XOR digests vs GET /v1/digest;
│                                    re-uploads missing samples, deletes server orphans.
├── Anchors/
│   ├── SyncStateStore.swift         Actor persisting config + per-type state (anchor
│   │                                blob, counters, timestamps, errors) as atomic JSON
│   │                                in Application Support; 250 ms debounced writes.
│   │                                Never writes the bearer token; records the
│   │                                ServerIdentity its progress belongs to and
│   │                                reports when a configuration would move it.
│   ├── TokenStore.swift             TokenStore protocol; KeychainTokenStore (generic
│   │                                password, AfterFirstUnlockThisDeviceOnly, service
│   │                                = bundle ID + ".sync-token") and InMemoryTokenStore.
│   ├── ServerIdentity.swift         Normalized host+port+path+userID the stored anchors
│   │                                were earned against; ServerIdentityChange drives
│   │                                the app's start-fresh vs keep-progress prompt.
│   └── ProtectedStateFile.swift     Atomic writes with completeUntilFirstUserAuthen-
│                                    tication protection + backup exclusion for every
│                                    state file (sync-state, event-log, wake-log).
├── Transport/
│   ├── PulsProtocol.swift           Protocol version (`PulsProtocol.version`, the
│   │                                X-Puls-Protocol header, clientVersion) and
│   │                                ServerCapabilities (GET /v1/capabilities DTO).
│   ├── SyncTransport.swift          Transport protocol + HTTPSyncTransport: gzip NDJSON
│   │                                POST /v1/batches, bearer auth, exponential backoff
│   │                                (4 retries, jittered; 4xx never retried, except 429),
│   │                                probe() (header-only batch), and TransportError
│   │                                incl. `unsupportedProtocol`; its text is scrubbed
│   │                                (ErrorScrubber) before it is shown or logged.
│   ├── ServerAPIClient.swift        Read side: GET /v1/capabilities, /v1/stats,
│   │                                /v1/digest, /v1/uuids.
│   ├── ConnectionTest.swift         ConnectionTester: capabilities → probe fallback,
│   │                                classified into ConnectionTestResult (ok, no
│   │                                capabilities, token rejected, unsupported
│   │                                protocol, unreachable, server error).
│   ├── ServerURLValidation.swift    URL rules mirroring ATS: https anywhere, http only
│   │                                for local-network hosts.
│   └── DiagnosticTransports.swift   DryRunTransport (benchmark, discards output) and
│                                    InstrumentedTransport (per-batch timing capture).
├── Models/
│   ├── SyncConfiguration.swift      User settings: types, start date, server URL/token,
│   │                                concurrency (1–8, default 4), batch size (250–5,000,
│   │                                default 1,000), aggregate configs.
│   ├── AggregateConfig.swift        One aggregate series: function/interval/device
│   │                                filter/start/settle delay. allowedAggregateFunctions
│   │                                derives the crash-safe function set per type from
│   │                                HKQuantityType.aggregationStyle.
│   ├── SyncModels.swift             Wire DTOs: SyncSample (+ ECG/StateOfMind/Medication
│   │                                detail structs), SyncDeletion, RoutePayload,
│   │                                AggregateSampleRow, ActivitySummaryRow, SyncBatch,
│   │                                SyncReason.
│   └── HealthTypeCatalog.swift      Registry of ~80 HealthKit types (79 on iOS 26;
│                                    fewer on older iOS): display name, kind, canonical
│                                    unit, group, est. samples/day (for ETA).
├── Serialization/
│   ├── NDJSONEncoder.swift          Batch → gzip NDJSON (hand-framed gzip over
│   │                                Compression's raw DEFLATE + CRC32).
│   └── SampleMapper.swift           HKSample → wire DTO; canonical-unit conversion,
│                                    metadata coercion, workout statistics.
└── Metrics/
    ├── SyncEventLog.swift           Ring buffer (2,000) + persisted file + os.Logger
    │                                mirror + AsyncStream for live UI. Messages are
    │                                scrubbed before they are kept; never sample UUIDs.
    ├── ErrorScrubber.swift          Redacts bearer/basic credentials, URL queries and
    │                                known secrets, drops control characters, caps
    │                                length — for lastError, the event log and
    │                                TransportError descriptions.
    └── WakeLog.swift                Durable per-wake telemetry: WakeTrigger,
                                     WakeContext + WakeScope (@TaskLocal propagated
                                     to nested syncs and the transport), and one
                                     WakeRecord per wake (trigger, timing, gap, work
                                     done, Low Power/thermal, outcome incl. crash-
                                     recovered `interrupted`). ~10k-record window,
                                     persisted on begin/finish; CSV/JSON export.
```

Wake telemetry: each entry point that gives the engine execution time
(`HealthSyncEngine.beginWake`/`finishWake`) opens a wake and runs its work inside
`WakeScope.$current.withValue(ctx)`. The task-local context propagates to every
nested sync task (so uploaded batches are attributed via `WakeLog.record`) and to
`HTTPSyncTransport` (which stamps `X-Wake-ID`/`X-Wake-Trigger` headers), giving a
device↔server join key. `finish` is idempotent so a background task's expiration
handler and its work task can't clobber each other's outcome.

Tests (`Tests/PulsHealthSyncTests/`, Swift Testing): catalog integrity (unique
identifiers, unit parsing), serialization (NDJSON line structure, gzip framing
+ CRC, metadata round-trip), the state store (token migration and Keychain
hand-off, server-identity change detection and reset, scrubbed error text), and
the protocol surface (`ProtocolTests.swift`: header version fields, request
headers, protocol-rejection parsing, capabilities decoding, URL validation, and
the connection test end to end against an in-process `URLProtocol`). HealthKit
itself isn't mockable, so engine behavior is exercised in the app via the
benchmark and diagnostics screens.

## Secrets and state at rest

The bearer token is the one secret the package holds. It lives in the Keychain
(`KeychainTokenStore`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` so
background wakes after a reboot can still build a transport, and never restored
onto another device) and is held in memory on `SyncConfiguration.authToken`;
`SyncConfiguration.encode(to:)` refuses to write it and `SyncStateStore` fills it
back in on load. A state file from a build that kept the token inline is migrated
on first load: the token moves to the Keychain and the file is rewritten without
it. Pass an `InMemoryTokenStore` to `SyncStateStore(directory:tokenStore:)` for
tests and throwaway engines.

`sync-state.json`, `event-log.json`, `wake-log.json` and any quarantined copy are
written with `FileProtectionType.completeUntilFirstUserAuthentication` and
excluded from backup (`ProtectedStateFile`): anchors are opaque, device-specific
`HKQueryAnchor` blobs that mean nothing on another device.

Persisted progress is tied to a `ServerIdentity` (normalized host, port, path and
user ID). `SyncStateStore.serverIdentityChange(applying:)` is non-nil when a new
configuration would point that progress at a different server or user while
there is progress to strand; the app then asks whether to start fresh
(`resetAll()`, then `configure(_:confirmServerIdentity: true)`) or keep going
(confirm without the reset). The identity is recorded only with that
confirmation, so a launch after an interrupted change finds the mismatch again
(`pendingServerIdentityChange()`).

Error text that is persisted or logged goes through `ErrorScrubber`: bearer and
basic credentials, URL query strings and the configured token are redacted,
control characters dropped, and `lastError` is capped at 120 characters. The
event log never names sample UUIDs. This covers every `TransportError`,
including a server's rejection body and the `unsupportedProtocol` message.

## Wire protocol version

The wire format is versioned so a receiver can refuse what it does not
understand instead of mis-storing it, and so a server can tell which app build
produced a batch.

- **Batch header.** The first NDJSON line of every batch carries
  `"schemaVersion": 1` (an integer, `PulsProtocol.version`) and
  `"clientVersion": "<marketing version> (<build>)"` (`"unknown"` when the
  host bundle has no version), ahead of the existing `batchID` / `deviceID` /
  `type` / `reason` / `exportedAt` / per-line-type counts.
- **Request header.** Every request — batch uploads and the read endpoints
  alike — carries `X-Puls-Protocol: 1`.
- **Rejection.** A server that does not accept the version answers HTTP 400
  with `{"error":"unsupported protocol version","supportedVersions":[…]}`.
  Both transports parse that body into `TransportError.unsupportedProtocol`
  (never retried) so the app can say "this server does not support this app
  version" rather than surfacing a bare 400. Any other 400 stays a
  `serverError` with its body.
- **Capabilities.** `GET /v1/capabilities` (bearer auth) answers
  `{"protocolVersions":[1],"features":[…],"server":"…","version":"…"}`. The
  reference server advertises `batches`, `stats`, `digest`, `uuids`,
  `aggregates`, `activitySummaries`, `routes`, `series`, `profile`. The
  endpoint is optional: a third-party receiver may answer 404/405, and every
  field but `protocolVersions` may be omitted. The app hides reconciliation
  unless `digest` and `uuids` are both advertised, and server statistics
  unless `stats` is; unknown capabilities hide both.
- **Connection test.** `ConnectionTester` calls capabilities first; if the
  endpoint is missing it POSTs a header-only batch (`type` `"probe"`, `reason`
  `"manual"`, every count 0) with no retries — any 2xx is success. 401/403 is
  reported as a rejected token, a network failure as unreachable with the
  cause (TLS, DNS, timeout, refused, ATS), anything else as a server error.
  Nothing about the test is persisted.

## How a sync runs

1. `HealthSyncEngine.syncAll` fans out over enabled types with a `TaskGroup`
   (default 4 concurrent — HealthKit query throughput degrades beyond that).
2. Per type: `HKAnchoredObjectQuery` pages from the stored anchor (nil anchor +
   start-date predicate = backfill), 1,000 samples/page.
3. `SampleMapper` converts to DTOs; `SeriesEnricher` fills in series payloads;
   `NDJSONEncoder` produces a gzip batch.
4. `HTTPSyncTransport` uploads. **Only on success** does `recordUploadedBatch`
   advance the anchor and counters — the transactional pattern that makes the
   pipeline crash-safe (server dedupes re-sent pages by UUID).
5. Deletions arrive as anchored-query tombstones and ride along in the same batch.

Incremental sync is the same loop, triggered by one multi-type `HKObserverQuery`
with `.immediate` background delivery, plus a `BGProcessingTask` safety net and a
full pass on every foreground open — with two differences, both added 2026-08-14
after two months of wake telemetry (`Engine/MergedSync.swift`):

**Observer callbacks are coalesced.** HealthKit does not deliver one callback per
change: bursts of up to 93 callbacks inside five seconds were recorded, and 77%
of all observer wakes arrived in clusters of five or more. Each used to become
its own wake, with its own queries and its own upload. Callbacks now accumulate
for `observerCoalesceWindow` (default 2s, measured from the burst's *first*
callback so a continuous stream cannot starve the flush) and run as one wake over
the deduped union of types. Every collected completion handler is released
afterwards — HealthKit stops waking the app after three unacknowledged deliveries.

**Incremental uploads merge across types.** Uploading was 94% of sync wall time
against 6% for the HealthKit queries, because the median page carried 7 samples
in 1.2 KB and still cost ~1.5s of round trip; 83% of pages carried under 50
samples yet consumed 79% of all upload time. Incremental runs now fetch one page
per type and pack pages into shared batches up to `maxMergedBatchSamples`.
Anchor-after-ack is unchanged: the budget is clamped up to `batchSize` so **a
page is never split across batches**, one page maps to exactly one ack, and a
failed upload leaves every anchor in that pack untouched for an idempotent replay.
Backfill deliberately keeps the per-type path — its pages are already full, and
four independent type pipelines overlap query and upload better than a
fetch-all-then-upload-all pass.

**Background wakes check the lock screen first.** HealthKit is unreadable while
the device is locked, and iOS runs `BGProcessingTask` when the device is idle —
overnight, locked. 156 such wakes over two months produced 59 samples in total,
154 of them completely empty, each having walked ~80 types and logged a warning
per type. Background paths now test `ProtectedData.isAvailable` up front and
record the wake as `skippedLocked` instead.

## How aggregates run

Aggregate configs (`SyncConfiguration.aggregates`, quantity types only) are
computed on-device with one-shot `HKStatisticsCollectionQueryDescriptor` runs —
no anchors exist for statistics, so each config keeps a `computedThrough`
watermark instead (advanced only after the server acks, like anchors):

1. Window = `[max(start, watermark − lookback), bucketFloor(now − settleDelay))`,
   where lookback = `max(7 d, 3×interval)` re-covers buckets late Watch data may
   have changed, and `settleDelay` holds back buckets that are still filling.
   First run (and a ~monthly full pass that repairs older edits/deletes) starts
   from the start date instead.
2. The window is split into ≤2,000-bucket chunks (`AggregateBucketing` — all
   boundaries are `Calendar`-computed, so day/month buckets survive DST).
3. Every bucket in a chunk uploads as an `{"aggregate": …}` NDJSON line — empty
   buckets carry an explicit `null` so the server upsert clears stale values.

Triggers are shared with raw sync: the observer covers the *union* of raw-enabled
and aggregate types (aggregate-only types never get a raw sync), and
`syncAllEnabled` runs aggregates after the raw pass.

Function legality is the sharp edge: HealthKit raises an uncatchable
NSInvalidArgumentException at query *execution* for illegal option×type combos.
`HealthTypeCatalog.allowedAggregateFunctions(for:)` (cumulative → sum/mostRecent/
duration; any discrete style → average/min/max/mostRecent/duration) is enforced
in the UI and re-checked in the engine, and verified against all 372 combos by
the app-hosted `AggregateMatrixTests`.

## How activity rings run

The "Activity Rings" type (`HealthTypeCatalog.activitySummaryIdentifier`) exports
daily `HKActivitySummary` objects — Move (active energy or, in `appleMoveTime`
mode, move minutes), Exercise, and Stand, each with the user's goal. These aren't
`HKSample`s: no UUID, one per *local calendar day*, and the current day keeps
changing. So they mirror the aggregate model — a `HKActivitySummaryQueryDescriptor`
over a day window, a *singleton* `computedThrough` watermark
(`SyncStateStore.activitySummaryState`) advanced only after ack, and a trailing
lookback (today is always re-queried). Each day uploads as an
`{"activitySummary": …}` line; the server upserts by `date`.

Differences from raw/aggregate sync: `HKActivitySummaryType` is an `HKObjectType`,
not an `HKSampleType`, so its catalog entry has `sampleType == nil` (kept out of
`bulkReadAuthorizationSampleTypes` and the observer) and the engine unions
`HKObjectType.activitySummaryType()` into the read-auth set separately. There is
**no observer / no background delivery** for summaries, so they ride other wakes:
`syncAllEnabled` (foreground/periodic/scheduled, after the aggregate pass), and
since 2026-08-14 also `refreshActivitySummaryIfStale()` at the tail of every
observer wake.

That second path is load-bearing, not a nicety. The scheduled path runs from the
`BGProcessingTask`, which iOS starts while the device is idle and therefore
locked — so *every* ring refresh from 2026-08-11 onward failed with
`errorDatabaseInaccessible`, and the newest ring row on the server was three days
stale before anyone noticed. An observer wake is by definition a moment when
HealthKit is readable. The refresh is rate-limited to hourly via
`ActivitySummaryState.lastComputedAt`, because today's ring mutates all day and
observer wakes are frequent.

## Testing

```bash
xcodebuild test -scheme PulsHealthSync \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```
