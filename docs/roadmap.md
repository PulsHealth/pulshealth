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

**This is the one thing that blocks a stranger following the README.**
`server/docker-compose.yml` pulls `ghcr.io/pulshealth/<name>:${PULS_VERSION:-latest}`,
`.github/workflows/release.yml` has never run, and there are no tags, so
`latest` does not exist and the documented quickstart cannot pull. Only
`scripts/bootstrap.sh --build` works today. The README says so honestly, which
is the right stopgap and not a substitute.

**0.1.0 is chosen and written up**: `CHANGELOG.md` carries the entry, dated
2026-09-09 — move the date if the tag slips. 0.x rather than 1.0.0 deliberately,
so config and schema can still change without a major. The app's 1.4 (§2) and
the protocol's 1 are two other numbers; the changelog's header says which is
which.

What is left:

- push `v0.1.0`, and let `release.yml` publish all four images for amd64 and
  arm64;
- flip each new package's visibility to public **once**, by hand, in the GitHub
  package settings — `release.yml` creates them private (its header comment
  says so, and nothing in CI can do it for you);
- run `scripts/bootstrap.sh` on a scratch machine with no `--build`, and get to
  a paired, syncing stack from published images alone. Until someone has
  actually done that, the quickstart is unverified;
- drop the "images are not published yet" bullet from `README.md`'s
  pre-release block, which stops being true the moment the images exist.

## 2. Submit the app's 1.4 — R-STORE, maintainer only

`PulsHealth/project.yml` is at `MARKETING_VERSION 1.4` / `CURRENT_PROJECT_VERSION 14`;
`docs/appstore/README.md` § Release record shows **1.3** on the store. So first-run
onboarding with QR pairing, Keychain token storage, per-server sync state, the
capabilities-gated UI and the published type vocabulary are all built and not in
anyone's hands.

The procedure already exists — work `docs/appstore/README.md`'s submission
checklist top to bottom. The steps that need a person with the developer
account are: confirming the team and `Local.xcconfig`, capturing the 6.9"
screenshot set on a real device, standing the review backend up
(`review-backend.md`) and filling the four placeholders in `review-notes.md`,
archiving and uploading, submitting, and afterwards tearing the review instance
down and rotating its token. Add the 1.4 row to the Release record when it goes
live, and re-read the privacy policy against the build before submitting —
`docs/appstore/README.md` § Keeping these documents true lists what a change
would have invalidated.

## 3. Screenshots — OSS-4

There is not one screenshot in the repository. A stranger deciding whether to
self-host a health-data stack gets no picture of the app, the web viewer or the
Grafana dashboards. The 6.9" set from §2 covers the app; the viewer and the
dashboards need their own, taken against demo data (`npm run dev` fills the
viewer; never a real export). `README.md` § Components is where they belong.

## 4. Per-device tokens — SRV-8

The weakest part of a published ingest surface, and the one the README and the
protocol spec both already admit: one static `PULS_TOKEN` (`server/ingest/main.go`),
and `X-User-ID` is unauthenticated tenant selection, so anyone holding the token
can write — or delete — as any user. Failed-auth rate limiting narrows guessing;
it does nothing about a leaked token.

The shape the plan settled on: enroll → pending → approve from the CLI, hashed
at rest, last-seen recorded, revocable, and **bound to a user id** so the header
stops being a free choice. The shared token keeps working through the
transition. This is a schema change (a new `NNN_` migration), an ingest change,
and a protocol documentation change in the same pull request — it does not move
`schemaVersion`, because a v1 receiver is unaffected by how the server chose to
issue tokens.

## 5. Multi-user reads — SRV-11

Half of this requirement dissolved on inspection and the plan and both READMEs
have been corrected: **writes were never the problem.** Every schema this
repository can build has `user_id` from migration 000, and `ensureUser` creates
whatever id the header carries, so a second phone's rows land in a populated
database with no wipe.

What is missing is reading them back. `server/api` and `web` are each
configured with a single `PULS_USER_ID` and answer for that user alone; only
Grafana's health dashboard has a `user` variable. The work is to scope the API
per request — most naturally by the token of §4, which is why that comes first —
and to give the viewer a way to choose. Until then the honest workaround is a
second API/viewer pair on a different `PULS_USER_ID`.

## 6. Surface the ingest response in the client — PROTO-8

The smallest item here. The server already answers with `{"accepted","duplicates"}`
(`server/ingest/store.go`, specified in `docs/protocol/README.md`), and
`HTTPSyncTransport.upload` throws the body away —
`UploadResult` carries only `bytesSent` and `duration`
(`PulsHealthSync/Sources/PulsHealthSync/Transport/SyncTransport.swift`). Decoding
it would let the app's log say how much of a batch was new rather than only how
much it sent, which is exactly what a user re-running a backfill wants to know.
Optional field, tolerant decoding, no protocol bump.

## 7. Put the documentation on the site — Phase 2 leftover

`site/` exports the marketing pages, the blog and the knowledge-base viewer; its
loaders read `knowledge-base/` and `blog/` and nothing else. The protocol spec,
the self-hosting guide, `docs/ai.md` and `docs/export.md` are readable only on
GitHub. The plan put a docs site on `pulshealth.com` in Phase 2 and it did not
happen — the `/sync` marketing page links to the repository instead.

Worth doing after §1, when there is a released thing to document, and worth
doing as a third content source in the existing static export rather than a
second site.

## 8. Alternative sinks and local export — APP-11, APP-12

`HealthSyncEngine.buildTransport` hardcodes `HTTPSyncTransport` and a concrete
`ServerAPIClient`, and `apiClient` is typed as that concrete class rather than a
protocol. `setTransport` injects an alternative for tests and benchmarks, but
the transport lives only in memory: on a cold launch — a background wake above
all — `ensureTransport` finds it nil and rebuilds an HTTP one from the persisted
URL and token. So a custom sink would work in the foreground and quietly stop
overnight, which is worse than not offering one. APP-11 is persisting the sink choice with the
configuration and putting the read side behind a protocol so reconciliation
degrades instead of breaking; APP-12 is a share-sheet NDJSON/CSV export of the
health data (today's `ShareLink` exports the diagnostics bundle, not samples).

Both are "later" for a reason: the HTTP path is what everyone uses. Do APP-11
only when a second sink actually exists to justify it.

## 9. AI extras — AI-6, AI-8

- **AI-6, `GET /v1/summary?range=7d` returning compact markdown.** Cheap, and
  useful for pasting into a chat that has no MCP connection.
- **AI-8, reframe the exploration notebook.** `notebooks/healthkit_database_exploration.ipynb`
  is still framed as a database tour; the plan wanted an "analyze your data"
  version with an LLM section.

**AI-7 (a raw-SQL MCP tool) should be dropped rather than deferred.** It
contradicts the standing invariant that `server/mcp` is a read-only client of
the product API and never holds a database URL. Anyone who wants SQL has
`psql` and `docs/database-guide.md`.

## 10. Standing maintenance

Not backlog — things that come due on someone else's schedule.

| Trigger | Do this |
|---|---|
| A new iOS runtime after 26.5 | Retest the blood-pressure permission bug (FB22735935) on a fresh simulator, per the gotcha in `CLAUDE.md`. Xcode 26.6 still ships only the iOS 26.5 SDK, so this is not actionable yet. |
| A new iOS runtime, again | Re-run the app-hosted `AggregateMatrixTests` — 372 type×function combos — since the legal set is HealthKit's, not ours. |
| A major Xcode/iOS SDK update | Refresh `010_category_labels.sql` from `HKCategoryValues.h` and check the seed shape (`server/README.md`). |
| Never yet done on real data | The backup restore drill. The one recorded in `server/README.md` ran against a throwaway stack; nothing else verifies that a dump restores. |
| Dependabot re-proposes eslint 10 or TypeScript 7 for `web`/`site` | Check upstream first, then close as before. Both are blocked by `eslint-config-next`'s own dependencies, not by this repository: `typescript-eslint` refuses TS >= 7.0 ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)), and `eslint-plugin-react` still calls `context.getFilename()`, which ESLint 10 removed. |
| A red `advisories` workflow run | Bump the dependency in its own pull request. `advisories.yml` is a separate workflow precisely so it can go red without blocking a merge — or a release, which now calls `ci.yml` and would otherwise be gated on it. |
| `tests/test_healthkit_notebook.py` | Referenced by no workflow, so it only runs by hand. Either wire it into CI or say in the file that it is manual. |
