# Roadmap — what is left

Reviewed 2026-09-08 against the tree, not against memory: every claim below was
checked in the code before it was written here.

[`open-source-plan.md`](open-source-plan.md) is the requirements document and
the record of how the project got here — its phases 0-4 are done. This file is
the shorter, current list: what is still outstanding, in the order worth doing
it, with the requirement IDs from that plan so the two stay tied together.

Nothing here is a known defect. Everything in the tree passes: Go vet, tests
and race for all five modules, the web viewer's lint/typecheck/tests/build, the
protocol corpus against the schemas and the reference receiver, shellcheck,
actionlint, the public-tree gate, both compose variants, and the marketing
site's export-count assertion.

## 1. Cut the first release — OSS-8

**Done.** `v0.1.0` was tagged on 2026-09-14 and `release.yml` published all
four images for amd64 and arm64; the packages were made public on
2026-09-18, and 0.2.0 follows (`CHANGELOG.md` has both entries). 0.x rather
than 1.0.0 deliberately, so config and schema can still change without a
major. The app's 1.4 (§2) and the protocol's 1 are two other numbers; the
changelog's header says which is which.

**Gotcha for anyone publishing from a new organization or a fork:** a
package `release.yml` creates starts private (its header comment says so),
and making it public is a by-hand step per package in its settings on
GitHub — but that step was not available until the PulsHealth
organization's package-creation policy was changed to allow public
packages. Change the organization's policy first, then flip each of the
four.

**The quickstart is verified from published images** (2026-09-18). A fresh
`git clone --branch v0.1.0` from GitHub, with no ghcr.io login and no local
`ghcr.io/pulshealth/*` images, then `scripts/bootstrap.sh --no-qr` with no
`--build`: Compose pulled all four `latest` images anonymously (the same
digests as `0.1.0`), `migrate` applied the 13 schema files and ran both
scripts, and ingest answered `/healthz` and `/v1/capabilities` with the
generated token. `smoke_test.py --url … --token …` posted the whole fixture
corpus and passed every check — expected counts, replay idempotency, the
documented rejections — and the product API read the rows back
(`/v1/profile`, `/v1/samples`, `/v1/workouts`, `/v1/activity/summary`,
`/v1/sleep/daily`), with the MCP server, the web viewer (Basic auth on) and
Grafana (datasource OK) all healthy. Its limits, stated plainly: it ran in a
scratch clone on the maintainer's Mac (Docker Desktop, arm64), not on a
separate machine; the TimescaleDB and Grafana images were already cached
there, so their cold pull was not exercised; and **no phone was paired** —
the fixture corpus stood in for the app.

What it turned up is fixed in the README: an upgrade has to move the
checkout as well as the images (the compose file and the migrations come
from it), a default run's pairing block has no URL until `--lan` or `--url`,
and the host ports are fixed. One thing is left as it is: the quickstart
clones `main`, which between releases can carry migrations the `latest`
images have not caught up with. Harmless while every migration is additive;
if one ever is not, the quickstart should clone the release tag instead.

## 2. Submit the app's 1.4 — R-STORE

**Done. 1.4 (15) approved 2026-09-19 and released automatically.** Build 14
was rejected the same day under 5.2.5 (the subtitle "Apple Health to your
server" counts as the app name; no "Apple" allowed there) and 5.1.1(iv) (the
pre-permission screen's "Grant Health Access" button and "Skip for Now" link);
#71 fixed both and build 15 went through. The review instance is torn
down, its volume, env file, bare repo and `review.pulshealth.com` record
deleted, and the Release record has the row. Worked from
`docs/appstore/README.md`'s checklist, plus what the checklist did not
anticipate:

- **Upload validation failed twice, both fixed in #64.** The store record has
  been universal since 1.3, but `project.yml` targeted iPhone only, and an
  update may not drop a device family (QA1623); and the primary 1024px icon
  carried an alpha channel.
- **Walking `review-notes.md` on an erased iOS 26.5 simulator against the live
  review instance** (fixed in #66): iOS 26's Health app has no Browse tab, so
  the round-trip step was wrong, and the filled-in notes were over App Store
  Connect's 4000-character limit.
- **The store listing still described 1.3**, a CSV/JSON export app that could
  request data from others by QR code, which 1.4 does not do. The subtitle,
  description, promotional text and keywords now come from
  [`docs/appstore/listing.md`](appstore/listing.md); the Support URL (which
  returned 404) and the Privacy Policy URL point at `/support` and `/privacy`;
  the screenshots are the four first-run screens (see `listing.md` §
  Screenshots).

Still owed: the real-data screenshot set (dashboard, type detail, background
activity) — § 3.

## 3. Screenshots — OSS-4

**The app half is done.** Four screens from the maintainer's phone (dashboard,
a type's detail, background activity, the log) plus three first-run screens
from the simulator make up the App Store set submitted with 1.4, and four of
them are in `README.md` § Components (`docs/images/app/`). Still missing: the
web viewer and the Grafana dashboards, taken against demo data (`npm run dev`
fills the viewer; never a real export).

## 4. Per-device tokens — SRV-8

**Server side shipped in 0.2.0.** The ingest server issues per-device
tokens from the CLI (`make devices ARGS='issue|list|rename|revoke …'`,
`server/ingest/devices_cli.go`), stores only their SHA-256
(`014_device_tokens.sql`), binds each to a user so `X-User-ID` must be absent
or equal (403 otherwise, `server/ingest/auth.go`), records last use, revokes
one at a time, and stamps every batch with the device that wrote it. The
shared `PULS_TOKEN` keeps working and is on by default;
`PULS_ALLOW_SHARED_TOKEN=false` turns it off, which is the setting that
closes the `X-User-ID` hole. `schemaVersion` did not move: a v1 receiver is
unaffected by how a server chose to issue tokens, and the protocol spec now
says a receiver MAY bind a token to a user.

**Pairing with one is now a scan, not typing.** `scripts/bootstrap.sh
--issue-device <label>` (`make issue-device NAME=…`) mints a token in the
running stack and prints the same block the shared token gets — URL, token,
user ID and the `puls://pair?…` QR code the app already scans — and `make
devices ARGS='issue …'` prints the code too. The URL a container cannot work
out for itself (the proxy in front of it, or the host's LAN address under
`--lan`) is handed in by the script and the Makefile, from `--url` or
`PULS_PUBLIC_URL` otherwise. The code is drawn by the ingest binary itself
(`ingest qr`, payload on stdin), so nothing here needs `qrencode` on the
host any more, and a server with the shared token off prints that command
instead of ending its pairing block without a word.

What is left on the server side, needing no app release:

- `scripts/bootstrap.sh` issuing a device token for the pairing block **by
  default** instead of generating and printing `PULS_TOKEN`. A fresh install
  still starts on the shared token and the script's readiness probe
  authenticates with it. The switch is: first run issues a device token,
  `PULS_TOKEN` is generated only on request, and `make pairing` says plainly
  that a device token cannot be re-printed (only its hash is stored) rather
  than re-printing a shared one.

What was deliberately left for a **client follow-up**, since each needs an
app release:

- Phone-side enrollment — an unauthenticated `POST /v1/devices/enroll` that
  creates a *pending* row the operator approves (`devices approve`), so the
  pairing flow is "scan, then approve on the server" and no token is ever on
  a screen, rather than "issue on the server, then scan it". The plan's
  enroll → pending → approve shape; the `status` column already admits it.
- The app's connection test telling a 403 (token bound to a different user
  ID than the one configured on the phone) apart from a wrong token.

## 5. Multi-user reads — SRV-11

Half of this requirement dissolved on inspection and the plan and both READMEs
have been corrected: **writes were never the problem.** Every schema this
repository can build has `user_id` from migration 000, and `ensureUser` creates
whatever id the header carries, so a second phone's rows land in a populated
database with no wipe.

What was missing was reading them back. **The API side is done** (2026-09):
every `/v1` route takes `?user=<uuid>`, defaulting to `PULS_USER_ID`; naming
anyone else is gated by `PULS_MULTI_USER` (default off, 403 otherwise — never a
quiet answer for the default user); `GET /v1/users` lists who exists with
their upload counts; `puls-export --user` and the OpenAPI document carry the
parameter; `api_reader` reads `batches` for it. Built on that contract: the
**web viewer** (merged alongside) lets you choose a user per session over the
same parameter, and the **MCP server** (merged too) takes the user as a tool
argument, lists users, and can be pinned to one person. Still open: nothing
binds the product API token to a user — with the gate on, `PULS_API_TOKEN`
reads everyone — so a per-user read token (the read-side twin of §4) is the
next step if a household wants a token per person rather than one for the
server.

## 6. Put the documentation on the site — Phase 2 leftover

**Done** (2026-09), as a third content source in the existing static export
rather than a second site: `site/src/lib/docs.ts` holds an explicit manifest
of five repository files — the protocol spec, `server/README.md`, `docs/ai.md`,
`docs/export.md` and `docs/database-guide.md` — rendered at
`pulshealth.com/docs/<slug>/` from the markdown as it is on `main`, with the
spec's own heading anchors preserved and relative links rewritten to the site
route or to the file on GitHub. The `/sync` page, the header and the footer
point at those pages now, and the `site` CI job asserts the docs count
alongside the other two. What is not rendered (the JSON Schemas, the fixture
corpus, `catalog.md`, the Swift package and MCP READMEs) stays on GitHub, one
link away from the index.

## 7. Alternative sinks and local export — APP-11, APP-12

`HealthSyncEngine.buildTransport` hardcodes `HTTPSyncTransport` and a concrete
`ServerAPIClient`, and `apiClient` is typed as that concrete class rather than a
protocol. `setTransport` injects an alternative for tests and benchmarks, but
the transport lives only in memory: on a cold launch — a background wake above
all — `ensureTransport` finds it nil and rebuilds an HTTP one from the persisted
URL and token. So a custom sink would work in the foreground and quietly stop
overnight, which is worse than not offering one. APP-11 is persisting the sink choice with the
configuration and putting the read side behind a protocol so reconciliation
degrades instead of breaking.

**APP-12 is done** (2026-09): Settings → Export Data writes the applied
selection to JSONL or CSV and hands the files to the share sheet, with no
server configured or contacted (`HealthExporter`,
[`docs/export.md`](export.md), "On-device export"). It did not need APP-11,
and deliberately is not a *sink*: an export runs on a throwaway engine with
its own state, because anchors have no destination dimension and a file
transport on the real engine would mark every exported sample as delivered to
the server.

What is **not** built, and is the natural follow-up for someone using the app
with no server: **scheduled or automatic export**. An export runs only when
the user taps Export, in the foreground, with the phone unlocked — there is no
App Intent, no Shortcuts action and no background export. An App Intent would
be the way in (Shortcuts automations can then run it on a schedule), and it
has to answer three things first: HealthKit is unreadable while the phone is
locked, which is when automations tend to fire; an intent needs somewhere
durable to put the files, which the share sheet currently decides and the
privacy policy currently promises the app does not keep; and the staging
directory's clear-at-launch rule must not delete an export an intent is
writing. Nor is there an incremental export ("everything since the last
one") — every export is a full read of its time range.

APP-11 stays "later" for a reason: the HTTP path is what everyone uses. Do it
only when a second sink actually exists to justify it.

## 8. AI extras

Nothing outstanding. **AI-8 is done** (2026-09):
`notebooks/healthkit_database_exploration.ipynb` analyzes one user's synced
data — coverage, activity trends, resting heart rate and HRV, sleep,
workouts, correlations — over the daily surfaces the product API serves,
and ends by rendering the `GET /v1/summary` page from the frames with the
three ways to hand it to an assistant (paste, `curl`, MCP) and an optional
`anthropic` SDK cell that stays skipped unless `ANTHROPIC_API_KEY` is set.
The schema tour it used to be lives in `docs/database-guide.md`.

**AI-7 (a raw-SQL MCP tool) is dropped**, not deferred: it contradicts the
standing invariant that `server/mcp` is a read-only client of the product API
and never holds a database URL. Anyone who wants SQL has `psql` and
`docs/database-guide.md`.

## 9. Standing maintenance

Not backlog — things that come due on someone else's schedule.

| Trigger | Do this |
|---|---|
| A new iOS runtime after 26.5 | Retest the blood-pressure permission bug (FB22735935) on a fresh simulator, per the gotcha in `CLAUDE.md`. Xcode 26.6 still ships only the iOS 26.5 SDK, so this is not actionable yet. |
| A new iOS runtime, again | Re-run the app-hosted `AggregateMatrixTests` — 372 type×function combos — since the legal set is HealthKit's, not ours. |
| A major Xcode/iOS SDK update | Refresh `010_category_labels.sql` from `HKCategoryValues.h` and check the seed shape (`server/README.md`). |
| Never yet done on real data | The backup restore drill. The one recorded in `server/README.md` ran against a throwaway stack; nothing else verifies that a dump restores. |
| Dependabot re-proposes eslint 10 or TypeScript 7 for `web`/`site` | Check upstream first, then close against [#37](https://github.com/PulsHealth/pulshealth/issues/37), which records the state of both blockers. Both are `eslint-config-next`'s own dependencies, not this repository: `typescript-eslint` refuses TS >= 7.0 ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)), and `eslint-plugin-react` still calls `context.getFilename()`, which ESLint 10 removed. Still true against `eslint-config-next` 16.3.5 (2026-09-14). |
| Dependabot re-proposes `lucide-react` 1.x for `site` | Close against [#39](https://github.com/PulsHealth/pulshealth/issues/39). v1 removed the brand marks (`Github`, `Twitter`, `Facebook`, `Linkedin`) that the header, footer and share links draw, and they are not coming back; landing it means choosing replacement marks, which is a visual change, not a bump. Land the rest of the group by hand, as #38 and #45 did. |
| A red `advisories` workflow run | Bump the dependency in its own pull request. `advisories.yml` is a separate workflow precisely so it can go red without blocking a merge — or a release, which now calls `ci.yml` and would otherwise be gated on it. It runs on the Monday schedule, on `workflow_dispatch`, and on pull requests that touch a lockfile — not on every push, because the finding describes the dependency tree rather than the commit, and re-reporting it per push mails a failure notice for news that has not changed. |
