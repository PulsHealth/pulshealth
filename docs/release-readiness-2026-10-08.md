# Accounts and Data Requests release review — 2026-10-08

**Status: final candidate validation in progress; not submitted.** This review
started from `091244a`. The recorded shipping version is 1.6 (19); the uploaded
release is 2.0 (20). Deployment and upload evidence must be recorded below
rather than inferred from local tests.

Five parallel reviews covered iOS account/pairing flows, Data Requests,
web authentication and isolation, backend/sync correctness, and submission
material. Findings below are concrete code or document issues, not a promise
that all defects have been found.

## Findings addressed

| Area | Before | Prepared fix |
|---|---|---|
| Sync destination changes | An in-flight pass could keep using its captured old transport while new database credentials and progress were applied. | Serialize configuration mutations and refuse them while sync work is active; surface retry guidance instead of reporting a successful change. Protect profile, reconciliation, aggregate and raw paths. |
| First database pairing | Save & Apply after standalone onboarding did not request the promised first backfill. | Start first-connection backfill through the supported continued-processing path. |
| Connection testing | An old response could restore success after credentials changed; testing an unapplied server changed current feature gates. | Bind displayed results to the fields/generation tested; refresh capabilities only for the applied destination. |
| Password login | A password reset during verification could be followed by an old-password session, or a legacy rehash could overwrite the replacement password. | Recheck the verified hash under the account lock and create the session in the same transaction. |
| Password changes and invite acceptance | A replacement session could be created after a concurrent reset had already revoked sessions. | Recheck the authorizing hash/session and issue replacement sessions inside the credential mutation transaction. |
| OAuth refresh | A different client presenting a replaced refresh token could revoke the original client's grant. | Scope replay revocation to the presenting client; regression-test both clients. |
| Medication requests | The request screen omitted the medication-specific permission setup requirement. | Show setup instructions when doses are requested; physical-device permission testing remains required. |
| Daily aggregate requests | A request through today could send yesterday's aggregates as complete. | Explain completed-day boundaries and record an incomplete-export issue in the ZIP manifest, requiring explicit partial-send consent. |
| Account deletion wording | Success claimed the account was deleted although the server only disabled access and requested an operator purge. | Describe removal as requested/pending. The deletion process itself remains a release gate below. |
| Submission material | Description/review notes exceeded field limits; promotional text denied accounts; route location was omitted from privacy declarations. | Shorten copy, cover accounts and requests, declare Precise Location, and refresh the submission checklist. |

## Release preparation progress

Tracking issue: [#172](https://github.com/PulsHealth/pulshealth/issues/172).
The selected release is **2.0 (20)**. App Store Connect was checked on
2026-10-08: the latest completed upload was 1.6 (19). A 2.0 draft now exists,
with accounts/request copy and manual release selected. The signed 2.0 (20)
archive uploaded successfully on 2026-10-08. It has not been submitted for review.
The merged candidate preserves the concurrently released recording-quality
changes from main; its compiled app/package inputs are identical to the upload.

The earlier code blockers have been implemented:

- **Account calendars:** migration 026 adds a per-user reporting zone; only newly
  approved hosted accounts initialize it from their first phone upload. Existing
  self-hosted defaults remain unchanged. Users can explicitly change their zone;
  API, MCP, viewer and Grafana agree. Phone aggregate/ring dates retain their
  recorded calendar meaning during travel. DST and fractional-offset midnight
  have database regressions.
- **Deletion:** migration 027 adds durable requests, automatic fair retries and
  private status receipts. Sessions, sync tokens and OAuth grants are revoked
  at acceptance; already-issued OAuth access tokens expire within 30 minutes.
  Eligible personal accounts are fully purged, including compressed samples and
  account metadata. Operator-managed personal invitations are explicitly
  allowlisted; administrator, default and demo users remain protected.
- **Backup safety:** authorized deletion writes a permanent UUID/date receipt
  to an independent durable volume before database acceptance. Strict retention
  expires old backups even when dumps fail. Restore validates that independent
  ledger and replays deletions before any application service can restart;
  invalid receipts fail before dropping the database. Restored function ACLs
  are rebuilt and checked explicitly.
- **Recovery:** migration 028 adds generic-response, rate-limited recovery,
  hashed expiring single-use reset tokens and atomic credential/session changes.
  Email delivery occurs after the response. Auth inputs avoid iPhone focus zoom.
- **Privacy:** local manifest and submission guidance now declare eleven types,
  including route location, signup notes, optional sensitive profile content,
  authenticated sync interactions and technical diagnostics. All are linked,
  used only for App Functionality, and not used for tracking.

## Submission gates

These require recorded evidence before calling the release ready:

- [ ] Commit the final tested candidate, complete CI, deploy migrations before
  updated servers, and verify hosted strict-retention/ledger configuration.
- [ ] Verify live signup/recovery/pairing and deletion using disposable synthetic
  accounts, with no personal health data in test artifacts.
- [x] Published and verified all eleven App Store Connect privacy disclosures.
- [ ] Verify the current age-rating questionnaire.
- [x] Upload the final signed 2.0 (20) archive; verify its signature, eleven
  privacy categories and compiled-source parity after merging current main.
- [ ] Inspect the processed build and select it for the 2.0 submission.
- [ ] Supply an approved disposable personal review account through App Store
  Connect's private fields. The public view-only demo cannot exercise pairing
  or deletion. Keep credentials out of source control.
- [ ] Upload the refreshed iPhone/iPad screenshots made with synthetic fixtures
  and final reviewer notes. Confirm support/privacy links and reviewer steps.
- [ ] Complete physical-device acceptance of the actual candidate: upgrade over
  1.6, first hosted pairing, switching/disconnecting during work, locked-device
  interruption, permission denial/history widening, medication permission, QR
  scanning, and request upload/retry/cancel to a compatible HTTPS ZIP receiver.
  Observe background delivery across normal daily use; simulator tests cannot
  establish it. The request contract does not provide a hosted ZIP receiver.

Use [the submission checklist](appstore/README.md), [listing copy](appstore/listing.md)
and [review notes](appstore/review-notes.md) for the concrete submission material.

## Validation evidence

- All five Go modules: module verification, vet and race-enabled tests passed.
- Protocol corpus: eight fixtures and Python receiver smoke test passed.
- Scratch TimescaleDB: final migration chain through 025, migrator contract,
  scoped-role ingest/API race tests, and time-zone SQL regressions passed.
- An actual production backup restored successfully in an isolated scratch
  container; no live database was changed. A separate synthetic restore drill
  proved pre-deletion backups cannot revive erased users, malformed ledger data
  aborts before database replacement, and protected accounts remain protected.
- Web: final lint, typecheck, catalog check, production build, 434 unit tests
  and 88 database integration tests passed, including concurrent password changes,
  revoked-session refusal and rollback when replacement-session insertion fails.
  Existing instrumentation Edge-runtime warnings remain unchanged.
- Swift package: 501 tests across 78 suites passed on iOS 27, including
  configuration isolation, request time zones and receipt validation. An earlier
  observer test configured an already-active engine; it was updated to establish
  its configuration before claiming work, consistent with the new busy contract.
  Hosted partial-send consent passed in the full iOS 27 app suite.
- Site: lint, 14 tests, production build and export checks passed (178 knowledge
  pages, 14 documentation pages and 12 published blog pages; 226 total pages).
- iOS app: all 50 hosted tests passed on iOS 27, including 378 legal HealthKit
  aggregate combinations. An iOS 26.5 simulator build and 38 focused runtime tests passed. Only Xcode 27
  is installed locally; the older compiler/SDK CI leg remains unverified here.
- Public-tree, generated knowledge JSON, mirrored Go-source, shellcheck,
  whitespace, manifest syntax and 15 synthetic demo-data tests passed.
- Public production smoke checks: privacy/login/signup returned HTTP 200;
  health reported a live database; unauthenticated iPhone connect redirected to
  login with its return path and `no-store`. These checks do not establish an
  authenticated signup/pairing/deletion flow or deployed-source parity.

Remaining evidence must be collected rather than inferred: App Store Connect
state, physical HealthKit behavior, reviewer credentials, authenticated live
flows, and processed-build selection. Local simulator and scratch DB tests do
not substitute for those checks.
