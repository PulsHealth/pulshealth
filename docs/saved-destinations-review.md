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

## Necessary release gates (reassessed 2026-10-11)

1. **Keep required CI green on the release head.** Package and hosted suites
   must retain coverage of migration, independent progress, busy upload/retry/
   backfill/GET ownership, stale responses, repeated actions and failed storage
   transitions. These checks already passed on both supported SDKs; no separate
   physical repetition of every automated case is required.
2. **One signed-host scoped-credential smoke test.** Run the existing
   `AppModelTests.testScopedKeychainCredentialsSurviveReopenAndUnpairIndividually`
   with working Keychain access. Pass means two unique fixture credentials can
   be saved, a fresh store reads each correctly, removing A leaves B readable,
   A is absent and the obsolete singleton is absent. A skip is not a pass.
   **Satisfied on Tama, 2026-10-11:** Xcode 27.0/iOS 27 iPhone simulator,
   existing generated host with `CODE_SIGNING_ALLOWED=YES`, ad-hoc
   `CODE_SIGN_IDENTITY=-` (Sign to Run Locally) and manual simulator signing.
   The focused test executed once, passed with zero skips and zero failures,
   and its existing defer cleanup removed the isolated fixture items.
   Production now uses per-destination Keychain accounts; this provides the
   actual Keychain evidence missing from the unsigned-host suites. No
   certificate, provisioning profile, account/security setting or entitlement
   was created or changed; no receiver traffic or HealthKit query was needed.

Use a signed simulator if it can access the production Keychain API; otherwise
use one signed iPhone or iPad test host. The existing test uses an isolated
random service and fixture tokens, cleans up, and never queries HealthKit or
contacts a receiver. Both device form factors are not required. No remaining
gate inherently requires Sean's physical device; his device is the practical
fallback if a signed simulator still cannot access Keychain. A physical reboot
is not necessary for the changed account scoping: the Keychain service,
accessibility and device-only policy are unchanged.

### Optional combined UI acceptance smoke

On one fixture build with two throwaway saved receivers A and B, combine the
following in one short session rather than separate release gates. Use synthetic
samples/receiver fixtures; do not run it against personal health data or a
production receiver. If receiver logs are used, record the successful switch
boundary so an in-flight request before a refused switch is not mistaken for
post-switch traffic.

- Cancel switch and unpair confirmations: selection, credentials and progress
  remain unchanged. Confirm A → B → A: one active badge and each receiver's
  own progress; relaunch retains the selected receiver.
- While an upload/retry is held, switching or active unpair is visibly refused
  and A remains active. After completion, a successful switch sends subsequent
  fixture requests only to B, with B's credential.
- Unpair inactive A: B still works. Unpair active B: no active destination or
  further sync, and relaunch does not restore B. Uploaded receiver data stays.

These pass conditions match automated state/transport assertions. The manual
smoke adds button/confirmation wiring evidence, so it is useful, but the tested
model, actual nonblank phone/tablet view renders and standard SwiftUI dialogs
make an exhaustive physical UI matrix disproportionate for this change. Any
actual wrong-receiver traffic, unintended progress loss, credential crossover
or unusable core switch discovered during this smoke is a release blocker.

### Downgraded follow-ups and rationale

- **Locked reboot/first unlock and a full background interruption matrix:**
  Keychain still uses `AfterFirstUnlockThisDeviceOnly`; observer/task scheduling
  is unchanged. Configuration exclusion and complete upload/retry/backfill/GET
  ownership are covered by deterministic tests. A physical run adds OS lifecycle
  evidence, but no specific new defect makes it a separate mandatory gate.
- **Backup-exclusion readback:** the intermittent simulator xattr limitation and
  `withKnownIssue` assertion exist in the pre-feature main baseline
  `3c7143995ab63ee4d7f965cc7fef053f06581a6a`. The protected-file writer/policy is
  unchanged. Real-device inspection adds backup metadata evidence, but this
  existing limitation is not a new saved-destination release blocker.
- **Process termination exactly between Keychain and JSON writes:** inspect
  recovery fixtures rather than require a physical crash-injection campaign.
  Unpair intentionally removes the selected receiver's local credentials and
  progress; before JSON commit, an interruption can instead retain its entry
  and progress with no credential. On restart no transport is built, another
  receiver is not selected, and re-pairing the same identity restores its
  preserved anchors. Other receivers and uploaded data remain intact. This is
  recoverable incomplete unpairing, not silent data loss, credential disclosure
  or wrong-receiver traffic. Separate stores are not crash-atomic; retain the
  limitation and make atomicity/clearer recovery UI a follow-up, not a gate.
- **External pairing links, navigation, repeated taps and VoiceOver:** pairing
  staging and canceled server-change behavior have hosted coverage; repeated
  switch/unpair and stale responses have deterministic coverage. Saved-row
  switch/unpair confirmation cancellation is covered by the optional smoke,
  not claimed as automated UI coverage. Broader VoiceOver/navigation and
  physical iPhone plus iPad checks remain useful product QA; no demonstrated
  core usability failure currently makes them mandatory for this feature.

No test was removed or weakened and no production behavior changed to reduce
this checklist. A credible regression in data/progress safety, credential
isolation, post-switch receiver ownership or basic switching still blocks release.

## Apple validation record (2026-10-11)

The implementation targets 2.1 (22) source, following accepted 2.0 (21).
Xcode 27.0 (27A266a) compiled the package and generated app with Swift 6
concurrency checking. Both iOS 26.5 and 27 simulator package runs passed:
521 tests in 79 suites. The older runtime skips three catalog checks for
types only present in the newer runtime; those checks run on iOS 27.
The iOS 27 iPhone and iPad app-hosted runs each passed 61 tests with one
explicit skip: their unsigned simulator hosts cannot access the real Keychain.
The aggregate-function matrix passed. The real Database screen was rendered
at phone and tablet sizes and visually inspected; its capture test asserts
nonblank content. The marketing privacy page passed lint, 14 tests, production static
generation and the export checker (178 type pages, 14 documentation pages).

Repairs found by Apple validation included missing actor awaits and a sending
closure in test code, obsolete singleton-credential expectations, and a real
cooldown regression: unchanged configuration must retain an existing cooldown.
The hosted state-machine harness now records Apply's HealthKit work through
the same engine protocol used in production, avoiding permission-dependent
observer and query waits in tests. GitHub Xcode 26.5 exposed a semaphore
blocking URLProtocol's shared loading thread in the parallel GET ownership test.
An asynchronous response gate now waits for the request deterministically
without blocking other requests; both stats/capabilities ownership cases remain
covered.

Storage fixtures model termination after a first-pair credential write and
after credential removal before JSON commit. Stable credential IDs permit
repair. An interrupted unpair can leave a saved entry without its credential;
it has no upload transport and must be paired again explicitly. Automatic
cross-store rollback after process death is not claimed. Complete legacy-state
migration fixtures retain raw/recent anchors, counters, aggregates, rings and
both enrichment full-pass cursors through switching and relaunch.

Final [Apple CI](https://github.com/PulsHealth/pulshealth/actions/runs/38164550839)
on `01ff58f306b7a423247fc83b53a79ed7b80e7942` passed the Xcode 26.5/iOS 26.5
and Xcode 27/iOS 27 SDK builds: each 521 package tests in 79 suites and 61
hosted tests executed, with one Keychain skip and zero unexpected failures.
Aggregate matrices probed 372/378 combinations. Both package runs recorded
one existing known simulator backup-exclusion readback issue. All 13 PR checks,
including [aggregate CI](https://github.com/PulsHealth/pulshealth/actions/runs/38164550838),
passed. Local iPhone/iPad validation remains evidence for the production
view layout. The focused ad-hoc signed simulator test subsequently passed
`testScopedKeychainCredentialsSurviveReopenAndUnpairIndividually`: one executed,
zero skipped, zero failures. Evidence is `keychain-signed-simulator.xcresult`
and its log in the Tama task workspace. Both necessary acceptance items are
satisfied at the tested source head; retain required CI on subsequent release
heads. No outstanding feature-specific gate requires Sean's physical device.
No archive, upload, submission, merge or deployment was made.

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
