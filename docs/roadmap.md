# Roadmap — what is left

Reviewed 2026-10-01, after the app's 1.6 reached the App Store. This is what
is still outstanding, roughly in the order worth doing it. Requirement IDs
(APP-11, SRV-8, …) tie items to [`open-source-plan.md`](open-source-plan.md),
which records the decisions behind them.

## 1. The next app release

1.6 (19) is on the store. The next upload needs a `MARKETING_VERSION` above
1.6 and build 20 or later (`PulsHealth/project.yml`).

- **Device passes never run on hardware for 1.5 or 1.6:** background sync
  over several days; the iOS 26 continued-processing first run; leaving the
  app mid-backfill; an export on a device; and on iOS 27, limiting a type's
  history, widening it again, and the re-sweep that follows.
- **Reconcile with Database on a type set to None can delete server rows.**
  HealthKit answers a denied type with empty results, so
  `HealthSyncEngine.reconcile` compares an empty device against the server —
  from the type's recorded readable date, or from the sync start when none is
  recorded (which is every denied type before iOS 27) — and sends each server
  row in that range as a deletion. Manual action only, from a type's sync
  detail (`TypeDetailView`).
- **A 1.4 or 1.5 install whose backfill ran under an iOS 27 30-day limit**
  that was widened again before 1.6's first refresh cannot be detected: its
  state carries no `readableSince`, so nothing says a re-sweep is due.
  Settings → Reset All Anchors fixes it.
- **Wording from before 1.6.** Three event-log and error messages in
  `HealthSyncEngine.swift` and `MergedSync.swift` send the user to a Dashboard
  the app no longer has, and the export failure card for an empty selection
  (`ExportFailureCopy`) points at a Data Types tab it no longer has.
- **Type page:** the aggregate preview's spinner overlaps the chart's unit
  label, and "Could not compute" renders larger on iOS 27.
- **Explore's search field:** on iOS 27 a `.navigationBarDrawer` search field
  cannot both show on arrival and scroll away. A fix that makes it the list's
  first row exists on a branch, not yet on main.

## 2. Screenshots — OSS-4

The app's 1.6 App Store set and the four images in `README.md` were taken in
the simulator with the app's demo fixtures (`docs/appstore/listing.md` §
Screenshots). Still open: a real-device set with real data, and README
screenshots of the web viewer and the Grafana dashboards, taken against demo
data (`npm run dev` fills the viewer; never a real export). The site's home
page already has two viewer shots from demo data (`site/public/screenshots/`).

## 3. Per-device tokens — SRV-8

The server issues per-device tokens (`make devices`, `scripts/bootstrap.sh
--issue-device`), stores only their hash, binds each to a user, and prints
the same pairing block and QR code as the shared token. The shared
`PULS_TOKEN` stays on by default; `PULS_ALLOW_SHARED_TOKEN=false` turns it
off.

Server side, no app release needed:

- `scripts/bootstrap.sh` should issue a device token for the pairing block
  **by default** instead of generating and printing `PULS_TOKEN`. Today a
  fresh install starts on the shared token and the script's readiness probe
  authenticates with it. The switch: the first run issues a device token,
  `PULS_TOKEN` is generated only on request, and `make pairing` says plainly
  that a device token cannot be re-printed (only its hash is stored).

Client follow-ups, each needing an app release:

- Phone-side enrollment: an unauthenticated `POST /v1/devices/enroll` that
  creates a *pending* row the operator approves (`devices approve`), so the
  flow is "scan, then approve on the server" and no token is ever on a screen.
  The `status` column already admits it.
- The connection test telling a 403 (token bound to a different user ID than
  the phone's) apart from a wrong token; `ConnectionTest` treats both as a
  rejected token.

## 4. Multi-user reads — SRV-11

Every `/v1` route reads one user (`?user=`, gated by `PULS_MULTI_USER`), and
the web viewer and the MCP server choose one over the same parameter. Still
open: nothing binds the product API token to a user — with the gate on,
`PULS_API_TOKEN` reads everyone — so a per-user read token (the read-side twin
of § 3) is the next step for a household that wants a token per person.

## 5. Alternative sinks and scheduled export — APP-11

`HealthSyncEngine.buildTransport` hardcodes `HTTPSyncTransport` and a concrete
`ServerAPIClient`. `setTransport` injects an alternative for tests and
benchmarks, but only in memory: on a cold launch — a background wake above
all — `ensureTransport` rebuilds an HTTP transport from the persisted URL and
token, so a custom sink would work in the foreground and quietly stop
overnight. APP-11 is persisting the sink choice with the configuration and
putting the read side behind a protocol so reconciliation degrades instead of
breaking. Do it only when a second sink actually exists.

The Export tab (APP-12) is not a sink and does not need APP-11: it runs on a
throwaway engine because anchors have no destination dimension
([`export.md`](export.md), "On-device export"). What it lacks is
**scheduled or automatic export** — today an export runs only when the user
taps Export, in the foreground, with the phone unlocked. An App Intent is the
way in (Shortcuts automations can then run it), and it has to answer three
things first: HealthKit is unreadable while the phone is locked, which is
when automations tend to fire; an intent needs somewhere durable to put the
files, which the share sheet decides today and the privacy policy promises
the app does not keep; and the staging directory's clear-at-launch rule must
not delete an export an intent is writing. There is no incremental export
("everything since the last one") either: every export reads its whole range.

## 6. A reinstall that sends only what the server lacks

A reinstall loses the phone's anchors, which cannot be rebuilt (they are
opaque), so it re-reads its whole sync window and re-sends it. The server
ignores what it already has, so nothing is lost or doubled, but most of the
upload is wasted: one reinstall re-sent about 1.3M samples, 98% of them
already on the server.

Reconcile already compares a type month by month against `GET /v1/digest`
and uploads only what the server lacks, so a first sync could drain the
anchored query locally without uploading, reconcile, then store that anchor
and mark the backfill complete. What it needs first is an **upload-only**
reconcile: today's also deletes server rows the phone does not have, which on
a phone whose Health history is incomplete — a new phone restored without
Health data — would delete the server's copy of the missing history. That
deletion is also the root of the Reconcile item in § 1.

## 7. Smaller plan leftovers

- SRV-10: the web viewer still connects as the read-only `grafana` role; the
  viewer-scoped role the requirement names does not exist.
- SRV-13: `/v1/metrics/daily` is not paginated; a request is bounded only by
  its `start` and `end`.
- AI-4: `llms.txt` is in the repository but pulshealth.com does not serve it.

## 8. Standing maintenance

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
