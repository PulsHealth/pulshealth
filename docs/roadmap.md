# Roadmap — what is left

Reviewed 2026-10-01, after the app's 1.6 reached the App Store, and pruned the
same day to what is worth doing. This is what is still outstanding, roughly in
the order worth doing it; what was considered and dropped is under **Not
planned** at the end, with the reason, so it is not proposed again without
something new. Requirement IDs (OSS-4, SRV-13, …) tie items to
[`open-source-plan.md`](open-source-plan.md), which records the decisions
behind them.

## 1. The next app release

1.6 (19) is on the store. The next upload needs a `MARKETING_VERSION` above
1.6 and build 20 or later (`PulsHealth/project.yml`).

- **Reconcile with Database on a type set to None can delete server rows.**
  HealthKit answers a denied type with empty results, so
  `HealthSyncEngine.reconcile` compares an empty device against the server —
  from the type's recorded readable date, or from the sync start when none is
  recorded (which is every denied type before iOS 27) — and sends each server
  row in that range as a deletion. Manual action only, from a type's sync
  detail (`TypeDetailView`).
- **Device passes never run on hardware for 1.5 or 1.6:** background sync
  over several days; the iOS 26 continued-processing first run; leaving the
  app mid-backfill; an export on a device; and on iOS 27, limiting a type's
  history, widening it again, and the re-sweep that follows.
- **Wording from before 1.6.** Three event-log and error messages in
  `HealthSyncEngine.swift` and `MergedSync.swift` send the user to a Dashboard
  the app no longer has, and the export failure card for an empty selection
  (`ExportFailureCopy`) points at a Data Types tab it no longer has.
- **Type page:** the aggregate preview's spinner overlaps the chart's unit
  label, and "Could not compute" renders larger on iOS 27.
- **Explore's search field:** on iOS 27 a `.navigationBarDrawer` search field
  cannot both show on arrival and scroll away. A fix that makes it the list's
  first row exists on a branch, not yet on main.
- **The connection test** (`ConnectionTest`) reports a 403 — a device token
  bound to a different user ID than the phone's — as a rejected token, the
  same as a wrong one. It should say which.

## 2. Screenshots — OSS-4

The app's 1.6 App Store set and the four images in `README.md` come from the
simulator with the app's demo fixtures (`docs/appstore/listing.md` §
Screenshots), and that is how they stay: no screenshot carries anyone's real
health data. Still open: README screenshots of the web viewer and the Grafana
dashboards, taken against demo data (`npm run dev` fills the viewer; never a
real export). The site's home page already has two viewer shots from demo
data (`site/public/screenshots/`) the README can reuse.

## 3. Smaller leftovers

- SRV-13: `/v1/metrics/daily` is not paginated; a request is bounded only by
  its `start`, `end` and `types`. `server/api/docs.go` says a page size bounds
  it, which is not yet true.

## 4. Standing maintenance

Not backlog — things that come due on someone else's schedule.

| Trigger | Do this |
|---|---|
| A new iOS runtime | Re-run the app-hosted `AggregateMatrixTests` (372 type×function combos): the legal set is HealthKit's, not ours. |
| A major Xcode/iOS SDK update | Refresh `010_category_labels.sql` from `HKCategoryValues.h` and check the seed shape (`server/README.md`). |
| Never yet done on real data | The backup restore drill. The one recorded in `server/README.md` ran against a throwaway stack; nothing else verifies that a dump restores. |
| Publishing images from a new organization or a fork | A package `release.yml` creates starts private, and it can be made public only once the organization's package-creation policy allows public packages. Change the policy first, then flip each of the four in its package settings. |
| A schema migration that is not additive | The quickstart clones `main`, which between releases can carry migrations the `latest` images have not caught up with. Harmless while every migration is additive; before one is not, point the quickstart at the release tag. |
| Dependabot re-proposes eslint 10 or TypeScript 7 for `web`/`site` | Check upstream, then close against [#37](https://github.com/PulsHealth/pulshealth/issues/37). Both blockers are `eslint-config-next`'s own dependencies: `typescript-eslint` refuses TS >= 6.1 ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)), and `eslint-plugin-react` still calls `context.getFilename()`, which ESLint 10 removed. Still true against `eslint-config-next` 16.3.8 (2026-10-01). |
| A red `advisories` workflow run | Bump the dependency in its own pull request. `advisories.yml` is separate from `ci.yml` so it can go red without blocking a merge or a release; its header says when it runs and why. |

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
- **A viewer-scoped database role** (SRV-10). The viewer already reads as the
  read-only `grafana` role, which cannot see `device_tokens`; a second
  read-only role over the same tables would separate almost nothing.
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
