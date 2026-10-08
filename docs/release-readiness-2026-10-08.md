# Accounts and Data Requests release review — 2026-10-08

**Status: code merged and deployed, store draft prepared; device/email acceptance pending. Not submitted to App Review.** This review
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

- [x] Commit the final tested candidate, complete CI, deploy migrations before
  updated servers, and verify hosted strict-retention/ledger configuration.
- [x] Verify live invite acceptance, login, pairing, reporting calendars,
  synthetic health ingestion and completed deletion with isolated test accounts.
- [ ] Complete real signup/approval-email and password-recovery delivery acceptance.
  The generic recovery response and configuration do not establish delivery.
- [x] Published and verified all eleven App Store Connect privacy disclosures.
- [x] Complete the current age-rating questionnaire: calculated 13+ globally
  (12+ before OS 26, with regional exceptions), based on occasional medical and
  alcohol references plus health/wellness content actually shown in the app.
- [x] Upload the final signed 2.0 (20) archive; verify its signature, eleven
  privacy categories and compiled-source parity after merging current main.
- [x] Inspect the processed build and select 2.0 (20) for the submission;
  confirm Testing status in the existing internal TestFlight group.
- [x] Supply an approved disposable personal review account through App Store
  Connect's private fields. The public view-only demo cannot exercise pairing
  or deletion. Keep credentials out of source control.
- [x] Upload seven refreshed iPhone and seven iPad screenshots made with
  synthetic fixtures.
- [x] Save final reviewer notes (3,488 characters), with the optional backend
  block omitted; verify live support/privacy links and browser auth pages.
- [x] Generate Xcode Organizer’s aggregate privacy report from the uploaded
  archive: eleven categories, all linked, no tracking, App Functionality only.
  Required-reason API evidence comes from the archived manifests (CA92.1).
- [ ] Complete physical-device acceptance of the actual candidate: upgrade over
  1.6, first hosted pairing, switching/disconnecting during work, locked-device
  interruption, permission denial/history widening, medication permission, QR
  scanning, and request upload/retry/cancel to a compatible HTTPS ZIP receiver.
  Observe background delivery across normal daily use; simulator tests cannot
  establish it. The request contract does not provide a hosted ZIP receiver.

Use [the submission checklist](appstore/README.md), [listing copy](appstore/listing.md)
and [review notes](appstore/review-notes.md) for the concrete submission material.

## Validation evidence

- Release PR [#173](https://github.com/PulsHealth/pulshealth/pull/173) merged as
  `d8dcfbd` after all 13 CI checks passed. The merged tree exactly matches tested
  candidate `1db2cf9`; app/package inputs match uploaded build 20.

- All five Go modules: module verification, vet and race-enabled tests passed.
- Protocol corpus: eight fixtures and Python receiver smoke test passed.
- Scratch TimescaleDB: merged chain of 25 SQL migrations and four scripts
  through 028 passed, including fresh and no-accounts baseline replay, both
  recording-quality and time-zone regressions, and scoped ingest/API race tests.
- An actual production backup restored successfully in an isolated scratch
  container; no live database was changed. A separate synthetic restore drill
  proved pre-deletion backups cannot revive erased users, malformed ledger data
  aborts before database replacement, and protected accounts remain protected.
- Web: final lint, typecheck, catalog check, production build, 434 unit tests
  and 88 database integration tests passed, including concurrent password changes,
  revoked-session refusal and rollback when replacement-session insertion fails.
  Database integration files run serially because compression fixtures operate
  on shared hypertables; ordinary unit tests remain parallel.
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
  is installed locally; CI independently passed the complete package and hosted
  suites on both Xcode 26.5 and 27.0.
- Public-tree, generated knowledge JSON, mirrored Go-source, shellcheck,
  whitespace, manifest syntax and 15 synthetic demo-data tests passed.
- Public production smoke checks: privacy/login/signup returned HTTP 200;
  health reported a live database; unauthenticated iPhone connect redirected to
  login with its return path and `no-store`. These checks do not establish an
  authenticated signup/pairing/deletion flow or deployed-source parity.

Remaining evidence must be collected rather than inferred: physical HealthKit
behavior, real email delivery and request delivery/retry against a compatible
HTTPS receiver. The user acknowledged the TestFlight acceptance request; that
is not a passing result. The external beta tester is added; Beta App Review
metadata is prepared and awaits the contact email/phone before submission.

## Initial deployment evidence

- The initial production deployment ran `d8dcfbd`; all four application image revision labels
  match. Migrations 026–028 applied before service recreation; database, Grafana
  and tunnel services were preserved.
- Pre-deployment and post-deployment backups completed and passed archive
  structure checks. Existing seven-day retention is preserved, strict expiration
  is enabled, and daily backups plus the independent deletion ledger are active.
- Public authenticated checks passed for invite/password login, pairing, ingest
  bearer authentication and cross-user rejection, NY/LA reporting dates, and a
  synthetic 70 bpm sample. Both disposable test users and the health fixture
  were erased; receipt pages confirmed completion, sessions/device tokens were
  revoked, and permanent ledger receipts were verified.
- Separate isolated App Store and TestFlight review accounts remain available;
  credentials are stored only in private files and Apple's private fields.
- Deletion retry runs every minute and recovery cleanup hourly; services are
  healthy with no recent application error patterns.
- The privacy/support site was published, CDN invalidation completed, and live
  privacy copy includes automatic deletion and restore protection. Actual Chrome
  signup/login/recovery pages load normally. Generic Python requests encounter
  an existing Cloudflare browser-signature rejection; the application itself
  and Chrome/iPhone Safari requests return 200. Security settings were unchanged.


## Hosted privacy and operations follow-up — 2026-10-08

PR [#178](https://github.com/PulsHealth/pulshealth/pull/178) merged as
`2de0adf2372e26799fb509b79c49394be1904ec4` after all 11 required CI checks
passed. This follow-up changed no iOS source or uploaded archive.

- **Accurate disclosures:** the live policy identifies the individual operator,
  US hosting, operator-readable storage, Cloudflare TLS termination, deletion
  processing and receipt behavior, seven-day backup expiry, manual support-mail
  cleanup, and size-rotated operational logs. Logs can contain identifiers and
  health type names; account deletion does not rewrite historical logs. Minimal
  permanent UUID/date receipts prevent restoration of deleted accounts.
- **Deletion race fixed:** rejected uploads can no longer recreate per-user
  database diagnostics after the account is erased. Ingest integration tests
  verify serialization against account deletion and rejection of orphan writes.
- **Local verification:** ingest vet and race tests, 88 web database tests,
  434 web unit tests, web lint/typecheck, site lint/14 tests/build, shellcheck,
  operations tests and the public-tree gate passed. An isolated synthetic restore
  drill proved old backups cannot resurrect erased users, protected data survives,
  and an invalid ledger stops restoration before replacement.
- **Production deployment:** a fresh pre-deployment backup passed archive checks.
  Only ingest was rebuilt/recreated; its image revision is `2de0adf` and its live
  health endpoint reports a reachable database. Other application images remain
  at the previously verified `d8dcfbd`; their code did not change in this follow-up.
- **Live deletion acceptance:** before and after deployment, two new synthetic
  accounts (invited personal and self-service) completed HTTP pairing, ingestion,
  cross-user rejection and deletion. Receipts completed, sessions and tokens
  stopped working, and every account/health table was checked for zero remaining
  fixture rows. The final host check found zero pending deletions and six
  independent restore-ledger receipts, including the earlier release fixtures.
- **Site publication:** the merged site was built and published, CDN invalidation
  completed, and live homepage/privacy HTML matched the generated artifacts.
- **Monitoring and email:** the operator explicitly authorized one synthetic
  delivery test and recurring failure alerts. The delivery test arrived in the
  operator inbox. A five-minute cron check is installed, notification delivery is
  enabled, cron is active, and the wrapper has completed successfully. It checks
  service health, account access controls, cleanup/deletion jobs, the independent
  ledger, and backup freshness/expiry. Notifications contain status only.
- **Current status:** all operator checks passed after deployment. The database
  and its backups remain on one host with no external database copies, as the
  operator confirmed. No real health data was exported for this follow-up.

Follow [the hosted operations runbook](hosted-operations.md) for daily checks,
failed-deletion response, support-mail erasure, restore drills and incidents.
Monitoring on the host cannot notify during a complete host or network outage;
an independently hosted availability alert remains an operational follow-up.
Same-host backups do not protect against loss of that host. Those limitations
must remain explicit when deciding whether to open access broadly.

**Remaining submission gates are unchanged:** actual signup/approval and recovery
email flows, physical-device acceptance of build 20 and request delivery, and
resolution of Apple's sensitive-information enrollment requirement for an
individual operator. The successful operations email is not evidence that the
signup/recovery flows passed. No App Review submission was made by this follow-up.
