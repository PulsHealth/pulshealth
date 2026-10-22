# Roadmap — what is left

**Current findings list and roadmap:** [`deep-review-2026-10.md`](deep-review-2026-10.md)
(the October 2026 deep review, with each item's status); read it first.

Reviewed 2026-10-01, after the app's 1.6 reached the App Store, and pruned the
same day to what is worth doing. This is what is still outstanding, roughly in
the order worth doing it; what was considered and dropped is under **Not
planned** at the end, with the reason, so it is not proposed again without
something new. Requirement IDs (OSS-4, APP-11, …) tie items to
[`open-source-plan.md`](open-source-plan.md), which records the decisions
behind them.

## 1. The next app release

The latest recorded candidate is **2.3 (29)**, submitted for App Review on
2026-10-22. The verified submission status is Waiting for Review, with automatic
release after approval to all users immediately. This is submission evidence;
check App Store Connect before reporting current approval or public availability.
Any replacement upload needs a build number above every build Apple has accepted;
29 is the latest accepted build recorded here. Version 2.2 (28) was separately
verified Ready for Distribution on 2026-10-22.

- The maintainer confirmed that the Explore/Export tap bug is working and the
  purchase lifecycle has been tested on 2026-10-20. Keep these confirmations
  distinct from automated test evidence.
- Unsupported HealthKit type construction found in cached 2.1 (22) crash reports
  was fixed in [#256](https://github.com/PulsHealth/pulshealth/pull/256), already
  included in the candidate. The unspecific sync crash report
  [#210](https://github.com/PulsHealth/pulshealth/issues/210) still needs the
  reporter's build and stack before it can be attributed or closed.
- The aggregate-options crash found in refreshed 2.1 (22) reports on
  2026-10-22 is fixed in the submitted 2.3 (29) build. Monitor the affected
  Same as Sync toggle and released-build reports for recurrence.
  See [crash diagnostics](appstore/crash-diagnostics.md#aggregate-options-crash-found-on-2026-10-22).
- Medication export names and installation-local UUID aliases address
  [#291](https://github.com/PulsHealth/pulshealth/issues/291) in submitted build
  2.3 (29). The maintainer reports completed testing; reporter acceptance and
  post-release verification remain separate. Existing server rows need
  a fresh phone export and the explicit, reviewed
  [historical repair plan](../tools/repair-medications/README.md); resetting
  anchors alone does not overwrite raw samples. No historical repair has run.
  Cross-device identity and clinical strength/conversion metadata remain outside
  the alias guarantee.
- After Apple approval, verify public availability and update the shipped-version
  record. Keep the review account available while a submission still needs it.
  Source, archive, test and device evidence are in
  [`appstore/README.md`](appstore/README.md#release-record); the older
  [`release-readiness-2026-10-08.md`](release-readiness-2026-10-08.md) is historical.

## 2. Standing maintenance

Not backlog — things that come due on someone else's schedule.

| Trigger | Do this |
|---|---|
| Within 90 days of the first public 2.2 release | Review retirement of the temporary early-user Pro gift in [#290](https://github.com/PulsHealth/pulshealth/issues/290); follow the [staged cleanup plan](appstore/subscriptions.md#retiring-the-gift) and honor active gifts before removing code. |
| A new iOS runtime | Re-run the app-hosted `AggregateMatrixTests` (378 type×function combos): the legal set is HealthKit's, not ours. |
| A major Xcode/iOS SDK update | Refresh `010_category_labels.sql` from `HKCategoryValues.h` and check the seed shape (`server/README.md`). |
| Never yet done on real data | The backup restore drill. CI now runs it on synthetic data (`server/backup/test-restore.sh` in the stack smoke test); the one recorded in `server/README.md` ran against a throwaway stack, and nothing yet verifies that a real install's dump restores. |
| Publishing images from a new organization or a fork | A package `release.yml` creates starts private, and it can be made public only once the organization's package-creation policy allows public packages. Change the policy first, then flip each of the four in its package settings. |
| Dependabot re-proposes eslint 10 or TypeScript 7 for `web`/`site` | Check upstream, then close against [#37](https://github.com/PulsHealth/pulshealth/issues/37). Both blockers are `eslint-config-next`'s own dependencies: `typescript-eslint` refuses TS >= 6.1 ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)), and `eslint-plugin-react` still calls `context.getFilename()`, which ESLint 10 removed. Still true against `eslint-config-next` 16.3.8 (2026-10-01). |
| A red `advisories` workflow run | Bump the dependency in its own pull request. `advisories.yml` is separate from `ci.yml` so it can go red without blocking a merge or a release; its header says when it runs and why. |

## 3. Deferred from the October 2026 deep review

Waiting for a Swift toolchain or a test to land first
(`docs/deep-review-2026-10.md` §5 and §6): splitting the engine file,
`SyncKey`/`withClaim`, `FullPassSchedule`, splitting `AppModel` (its
seam is in), merging the two type pickers and the duration formatters, the
seven ingest `unnest` inserts.

## Not planned

Decided 2026-10-01.

- **Leaving out a new aggregate series' leading empty buckets** (PR #70,
  closed). It saves only the first backfill, because the 30-day full
  recompute resends those nulls anyway. And a series that is new to the phone
  is not necessarily new to the server: a reinstall, or an aggregate deleted
  and added again with the same series identity, would leave stale server
  values until the next full pass.
- **A reinstall that sends only what the server lacks.** A reinstall re-reads
  its whole sync window and re-sends it; the server ignores what it has (one
  re-sent about 1.3M samples, 98% already there). Avoiding that means a first
  sync that drains the anchored query without uploading, reconciles against
  `GET /v1/digest`, then stores the anchor and marks the backfill complete —
  new anchor handling in the code with the most invariants, plus an
  upload-only reconcile, for a one-time saving on a rare event.
- **Device tokens by default, and phone-side enrollment** (SRV-8). Per-device
  tokens are there for whoever wants a revocable token per phone (`make
  devices`, `scripts/bootstrap.sh --issue-device`). As the default they would
  cost `make pairing` its re-print, since only a hash is stored, for no gain
  on a one-phone install. Enrollment (`POST /v1/devices/enroll`, approved on
  the server) would add an unauthenticated endpoint and an app release to
  replace pairing by QR code, which already works.
- **A per-user read token for the product API** (SRV-11). Multi-user reads are
  off by default (`PULS_MULTI_USER`), and no household has asked for one.
- **Alternative sinks** (APP-11). `HealthSyncEngine.buildTransport` hardcodes
  `HTTPSyncTransport`, and a transport set with `setTransport` lives only in
  memory, so a cold background launch rebuilds HTTP from the persisted URL
  and token. Persisting the sink choice and putting the read side behind a
  protocol is worth doing only once a second sink exists.
- **Scheduled or automatic export.** An export runs only when the user taps
  Export, in the foreground, with the phone unlocked, and always reads its
  whole range. An App Intent (which Shortcuts automations could run) would
  first have to answer three things: HealthKit is unreadable while the phone
  is locked, which is when automations tend to fire; an intent needs a
  durable place for the files, which the share sheet decides today and the
  privacy policy promises the app does not keep; and the staging directory's
  clear-at-launch rule must not delete an export an intent is writing.
- **A real-device screenshot set with real data** (OSS-4). Simulator shots
  from the demo fixtures show the same screens without anyone's health data.
