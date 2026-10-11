# Saved sync destinations: investigation and acceptance plan

## Scope

Save several paired databases on the phone, but sync with exactly one active
receiver. Show the active receiver and offer switching and individual unpairing.
Unpairing removes the phone's saved connection and local progress; it does not
revoke a server-issued credential or erase data already uploaded to that server.

This targets iOS 2.1 after accepted iOS 2.0 (21). The accepted 2.0 archive
does not contain this feature. No 2.1 archive or submission is authorized by
this implementation task; a future archive needs a verified unused build
number and its own verification and submission decision.

## Historical failure mechanism

The 1.6 (19) source recorded at `daabda31c8aadacccd0556e304ffdb30b667520d`
has two distinct routes that can look like unsuccessful server switching:

1. Accepting a pairing link only fills a draft. `AppModel.confirmPairingLink`
   logs that nothing was applied; `ServerSettingsView.apply` separately commits
   it via Save & Apply. A successful connection test is not activation.
2. If configuration is applied while a backfill is running,
   `HealthSyncEngine.configure` replaces the engine's transport property, but
   `runSync` has already captured the previous transport in a local constant.
   That loop continues uploading with the old URL/token and advances shared
   progress after its acknowledgements. Replacing the property does not cancel
   or redirect its HTTP retries. This is a source-confirmed defect, not proof
   that a particular support report took that route.

References at that revision:

- `PulsHealth/Sources/AppModel.swift:592-603,815-822`
- `PulsHealth/Sources/ServerSettingsView.swift:182-194`
- `PulsHealthSync/Sources/PulsHealthSync/Engine/HealthSyncEngine.swift:166-187,715-727,824-840`

The submitted 2.0 candidate already includes configuration-use exclusion:
`HealthSyncEngine.configure` refuses configuration changes while a sync holds
its destination, and `ConfigurationIsolationTests` covers captured transports.
That prevents reporting a successful change while an old sync still owns the
transport. It does not provide a saved-database list or per-destination history.
An HTTP 503 alone cannot determine which host produced it or its server-side
cause. No reset or deletion of backfill progress is required to investigate.

## Safety requirements

- The active marker changes only after the configuration/progress/credential
  transition succeeds. A busy backfill gives a clear retry-later result.
- Each normalized server/user identity owns its raw and recent anchors,
  aggregates, rings and workout-enrichment progress. Switching A → B → A
  resumes A; adding B does not mark A's samples as delivered to B.
- Credentials stay scoped to their destination. Normal storage is Keychain;
  any write-failure fallback retains the existing protected-file and backup
  exclusion guarantees. Tokens never appear in diagnostics, exports or labels.
- Failed migration, unreadable state, failed credential operations and failed
  persistence must not silently activate another receiver or destroy progress.
- Inactive entries perform no sync. Background work, foreground work,
  reconciliation, profile uploads and retry loops use only the active target.
- A response to an old receiver's stats/capability request must not repaint the
  new receiver's status.
- Re-pairing the same normalized server/user updates one saved entry. HTTP →
  HTTPS normalization retains the existing server-identity convention.
- Explore and Export remain independent of saved sync destinations.

## Required acceptance before release

Automated checks must cover:

- Upgrade from a real pre-profile state fixture, retaining device ID, token,
  raw/recent anchors, counters, all aggregate/ring/enrichment watermarks and
  interrupted-pass markers.
- A → B → A round-trip, including cold relaunch, and empty new-server state.
- Same host with a different user ID; same identity with a rotated credential;
  equivalent URLs; credential failure and protected-file write failure.
- Paused old upload / HTTP retry / claimed backfill: switch and active unpair
  fail visibly until the prior owner is finished; subsequent uploads use only B.
- Unpair inactive B while A remains selected; unpair active A leaves no active
  target, never implicitly activates B; relaunch does not resurrect A.
- Repeated switch/unpair taps and overlapping applies are serialized.
- Cancel pairing, cancel unpair and navigate back without applying: no change.
- Stale stats/capability responses are discarded after switching.

Run the package and app-hosted suites with the supported Xcode CI matrix.
Generate the app project with `xcodegen` before Xcode validation. Exercise the
Database screen on iPhone and iPad, including background backfill, interruption,
relaunch, external pairing links and VoiceOver. Run the public-tree and
whitespace gates. Linux-only static checks are not an iOS compilation or
HealthKit/device acceptance result.

## Apple validation record (2026-10-11)

The implementation targets 2.1 (22) source, following accepted 2.0 (21).
Xcode 27.0 (27A266a) compiled the package and generated app with Swift 6
concurrency checking. Both iOS 26.5 and 27 simulator package runs passed:
521 tests in 79 suites. The older runtime skips three catalog checks for
types only present in the newer runtime; those checks run on iOS 27.
The iOS 27 app-hosted run passed 61 tests with one explicit skip: its unsigned
simulator host cannot access the real Keychain. The aggregate-function matrix
passed. The marketing privacy page passed lint, 14 tests, production static
generation and the export checker (178 type pages, 14 documentation pages).

Repairs found by Apple validation included missing actor awaits and a sending
closure in test code, obsolete singleton-credential expectations, and a real
cooldown regression: unchanged configuration must retain an existing cooldown.
The hosted state-machine harness now records Apply's HealthKit work through
the same engine protocol used in production, avoiding permission-dependent
observer and query waits in tests.

Storage fixtures model termination after a first-pair credential write and
after credential removal before JSON commit. Stable credential IDs permit
repair. An interrupted unpair can leave a saved entry without its credential;
it has no upload transport and must be paired again explicitly. Automatic
cross-store rollback after process death is not claimed. Complete legacy-state
migration fixtures retain raw/recent anchors, counters, aggregates, rings and
both enrichment full-pass cursors through switching and relaunch.

Before release, use dedicated physical iPhone/iPad fixtures for locked-device
and first-unlock Keychain behavior, real foreground/background/backfill
interruption and retries, termination between Keychain/JSON operations,
external pairing links, cancellation/navigation and VoiceOver. No available
physical iPhone or iPad was connected for this task. Simulator ownership and
failure-path tests do not replace those checks. A build with the Xcode 26.5 SDK
also remains a CI check; local compilation used the Xcode 27 SDK for both
runtime versions. No archive, upload, submission, merge or deployment was made.

## Simultaneous syncing feasibility

Multiple simultaneous receivers are feasible, but not a flag on the current
single-engine flow. Destination-scoped storage is the foundation, not the whole
feature. A follow-up design needs:

- Independent acknowledgements, cursors, backoff and failures per receiver.
- One coordinated HealthKit observer and bounded query budget, rather than
  N independent observers multiplying expensive reads and background work.
- Fair scheduling so an offline/large-history receiver cannot starve another.
- Per-receiver status, consent, pause/unpair behavior and background expiration
  accounting; no UI aggregate that disguises one receiver's failure.
- A decision about per-receiver type/history settings and whether to read once
  and fan out with durable delivery state or read independently. Fan-out must
  not advance one receiver's cursor when only another acknowledges.

Recommendation: validate and ship the single-active foundation first. Treat
simultaneous sync as a separate feature with dedicated device/background tests.
