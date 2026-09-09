# PulsHealth (iOS app)

SwiftUI front end for the `PulsHealthSync` library — all sync logic lives in the
package; this app is configuration, visibility, and lifecycle wiring. See the root
`README.md` for architecture and `CLAUDE.md` for build invariants.

Shipping as
[PulsHealth](https://apps.apple.com/us/app/pulshealth/id6757657354) on the App
Store (free). The listing material and the record of what shipped are in
[`docs/appstore/`](../docs/appstore/README.md).

## Project generation

`PulsHealth.xcodeproj` is **generated** from `project.yml` by
[XcodeGen](https://github.com/yonaskolb/XcodeGen) and is **not tracked** in git
(XcodeGen copies the signing team from `Config/Local.xcconfig` into the pbxproj,
so tracking it would leak every developer's team ID). Install XcodeGen once
(`brew install xcodegen`), then generate before the first build and again after
adding/removing/renaming files:

```bash
xcodegen && xcodebuild build -scheme PulsHealth \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

Key settings (`project.yml`, `Info.plist`, `PulsHealth.entitlements`):

- Bundle ID `com.pulsHealth.PulsHealth`, iOS 17.0 target, Swift 6. That is the
  identifier on the App Store record, and a bundle identifier is immutable once
  a record exists — so `bundleIdPrefix` is fixed by the listing, not a
  preference, and only an archive carrying it can update the app.
- Entitlements: `healthkit` + `healthkit.background-delivery` (device builds need a
  paid developer team).
- Signing is per-developer and untracked. `DEVELOPMENT_TEAM` lives in
  `Config/Local.xcconfig` (gitignored), which both targets pull in via
  `configFiles`; `xcodegen` (2.43+) seeds it from the tracked
  `Config/Local.xcconfig.example` on first run, or copy it yourself. Put your
  team ID there for device builds — simulator builds need none, so the empty
  template works as-is. Forks distributing their own build must also change
  `bundleIdPrefix` in `project.yml` and must not ship under the PulsHealth name
  (see `TRADEMARK.md` at the repo root).
- `UIBackgroundModes: processing`; the permitted BG task IDs are derived from
  the bundle ID — `$(PRODUCT_BUNDLE_IDENTIFIER).healthsync.catchup` and the
  `$(PRODUCT_BUNDLE_IDENTIFIER).backfill.*` wildcard (Xcode expands build
  settings in Info.plist values, so the built app carries
  `com.pulsHealth.PulsHealth.healthsync.catchup` and
  `com.pulsHealth.PulsHealth.backfill.*`,
  the latter permitting the concrete `….backfill.run` continued-processing
  task on iOS 26). `BackgroundSyncScheduler` derives the same strings from
  `Bundle.main.bundleIdentifier`, so a fork with its own bundle ID changes
  nothing here.
- App Transport Security: `NSAllowsLocalNetworking` only — plain `http://` is
  reachable for local-network hosts (unqualified names, `*.local`, private IP
  ranges), everything else stays HTTPS-only — with the matching
  `NSLocalNetworkUsageDescription`. Settings enforces the same rule before a
  URL can be saved or tested.
- `PrivacyInfo.xcprivacy` (bundle root, listed as a resource in `project.yml`):
  no tracking, no collected data, and the one required-reason API the app uses
  — `UserDefaults` (CA92.1, the app's own flags). The `PulsHealthSync` package
  ships its own manifest for the same API (background-task schedule status).
- Usage strings declare read-only HealthKit access (the app never writes health
  data) and camera access for one purpose only — reading the pairing QR code
  (`NSCameraUsageDescription`).

## Source map

```
Sources/
├── PulsHealthApp.swift   @main. Registers BG tasks before launch finishes; scenePhase
│                         hooks: foreground → syncNow, background → schedule + persist.
├── AppModel.swift        @MainActor @Observable coordinator. Owns HealthSyncEngine +
│                         BackgroundSyncScheduler; exposes statuses, events, server
│                         stats, config; stages type toggles until Apply; handles
│                         authorization (incl. iOS 26 per-object medication auth).
├── RootView.swift        TabView (Dashboard / Data Types / Log / Settings) +
│                         DashboardView: totals, ETA, per-type rows, Sync Now.
│                         Presents OnboardingView over everything on a first run.
├── OnboardingView.swift  First run, five steps: what the app does and where the
│                         data goes; the server (scan the pairing QR or type it,
│                         then Test Connection — Continue needs a passing test,
│                         or an explicit "Continue Anyway" with a warning);
│                         Health access; the data types (the real TypePickerView,
│                         preselected with TypePresets.common); a summary whose
│                         button applies everything and starts the backfill.
│                         Nothing reaches the engine before that last tap.
│                         Settings → Diagnostics → "Show Onboarding Again"
│                         replays it (with a Close button) for testing.
├── PairingScannerView.swift  AVFoundation QR sheet feeding PairingPayload.parse.
│                         Used by onboarding and Settings → Server. Handles
│                         not-yet-asked, denied, and no-camera, each with a
│                         "Type It Instead" way out; no frame is ever stored.
├── TypePickerView.swift  ~80 types grouped by category; Common/All/None presets.
│                         Quantity rows link into TypeConfigView; other kinds keep
│                         plain toggles.
├── TypeConfigView.swift  Per-quantity-type config: raw-sync toggle + aggregate
│                         series list, plus AggregateEditorView (function picker
│                         restricted to allowedAggregateFunctions, interval,
│                         device filter, start date, settle delay, status,
│                         Sync Now / Recompute All / Delete). Identity edits
│                         reset the watermark (different server series).
├── TypeDetailView.swift  Per-type debug screen: anchor/activity/rate/ETA, volume
│                         counters, timeline, server-side counts (GET /v1/stats)
│                         and the reconcile action — both shown only when the
│                         server's capabilities advertise `stats` / `digest` +
│                         `uuids` — plus reset.
├── SettingsView.swift    Server URL + token (validated: https, or http for
│                         local-network hosts only) with Test Connection —
│                         runs against the entered, unsaved values and reports
│                         ok / no capabilities / token rejected / unsupported
│                         protocol / unreachable (TLS, DNS, timeout) / server
│                         error — start date, concurrency/batch-size tuning,
│                         backfill trigger, benchmark, reset-all, and
│                         "Validate Aggregate Functions" (runs the legal-set
│                         matrix against HealthKit on this device/runtime).
├── LogView.swift         Live filterable event stream (level + type filters);
│                         links to BackgroundActivityView (toolbar).
├── BackgroundActivityView.swift  Field-study screen: per-wake telemetry from the
│                         library's WakeLog — wakes/24h & /7d, median background
│                         gap, expired/interrupted count, per-trigger rollups, a
│                         recent-wakes list, and a ShareLink that exports wakes
│                         (CSV+JSON) + the event log (JSON) for offline analysis.
└── BenchmarkView.swift   Throughput test: reads real HealthKit data through a
                          discarding transport with temporary state — touches no
                          real sync state.

HostedTests/              XCTest bundle hosted in the app (HealthKit entitlement
                          required to execute statistics queries): probes all 372
                          aggregate type×function combos behind an ObjC exception
                          catcher and fails on any mismatch with the library's
                          allowedAggregateFunctions — run on every new iOS runtime.
```

## Behavior notes

- A fresh install opens straight into the first-run flow; an install that
  already has a server, enabled types, or a previous Apply never sees it (the
  decision is `AppModel.showsOnboarding` — see the invariant in the root
  `CLAUDE.md`). What the app promises the user on that first screen is stated
  formally in [`docs/privacy-policy.md`](../docs/privacy-policy.md), and the
  App Store material that repeats it is in
  [`docs/appstore/`](../docs/appstore/README.md).
- The most reliable sync trigger iOS offers is app-open: every foregrounding runs a
  full incremental pass, and re-reads the server's `GET /v1/capabilities` (kept
  in memory only) to decide which server-dependent controls to show.
- A newly enabled type with no anchor auto-backfills from the configured start date;
  a newly added aggregate config with no watermark does the same.
- Aggregates are independent of raw sync (a type can sync only its daily sum, no raw
  samples) — authorization and observer registration cover the union of both. A
  bucket inside its settle delay uploads on the next trigger after it settles;
  recent buckets are recomputed each run, so late Watch data self-corrects.
- Backfill on iOS 26 runs as a `BGContinuedProcessingTask` (system progress UI,
  survives backgrounding); earlier iOS keeps it foreground-resumable.
- Types the permission sheet can't determine (blood pressure on iOS 26.5,
  FB22735935) are remembered per session and skipped from auth requests, with a
  dashboard hint pointing at Settings → Privacy & Security → Health — see the
  CLAUDE.md gotcha for the retest plan.
- Live logs from a Mac: `log stream --predicate 'subsystem == "com.pulsHealth.healthsync"'`.
- **Background-time field study.** Every entry point that gives the engine
  execution time (HKObserver delivery, the catch-up `BGProcessingTask`, the iOS 26
  continued-processing backfill, foregrounding, and manual sync) opens a *wake*:
  the library's `WakeLog` (separate from the fast-rolling event ring buffer) keeps
  one durable record per wake — trigger, start/end, duration, inter-wake gap, work
  done (batches/samples/deletions/bytes/types), Low Power Mode, thermal state, and
  outcome (`completed`/`expired`/`interrupted` — a record still "running" on next
  launch means the app was killed mid-wake). It holds ~10k wakes (months), so a
  1–2 week run never loses early data. Each wake's id + trigger ride the upload as
  `X-Wake-ID`/`X-Wake-Trigger` headers, so the server's `batches` rows join back to
  the device records. Pull it all off-device from **Log → Background Activity →
  Export** (wakes CSV+JSON, events JSON via the share sheet).
