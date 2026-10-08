# Hosted health-data operations

The hosted service keeps the current PostgreSQL/TimescaleDB architecture.
Account isolation is not end-to-end encryption: the operator and trusted server
processes can read health records. This runbook owns the operational promises in
[the privacy policy](privacy-policy.md). It applies to hosting other people's
records; it does not change the defaults for independent self-hosters.

## Ownership and daily checks

The service operator owns access approval, private support, deletion failures,
backup expiry, restore testing and incident response. Review the local hosted
check result every day during launch and before approving additional accounts:

```sh
python3 server/ops/hosted-check.py
```

Run `server/ops/check-hosted.sh` every five minutes on the Docker host with a
user cron entry or systemd timer. It keeps only the latest private result at
`${XDG_STATE_HOME:-$HOME/.local/state}/pulshealth/hosted-check.json`; `flock`
prevents overlapping runs. Node 22.18+ is required for optional email alerts.

After the operator authorizes email, test
`node --experimental-strip-types server/ops/notify.mjs --test` and confirm it
arrives. Create `notifications-enabled` in the same private state directory
to enable alerts to the existing `WEB_ADMIN_EMAIL`, using the web container's
SES configuration. Alerts contain only check failures, repeat every six hours
if unchanged, and send one recovery notice. Send failures are retried on the
next check and logged locally. Do not mark inbox delivery verified solely
because SES accepted a message.
It is read-only, prints counts and status (no account IDs, health records or
secrets), and exits nonzero on failure. It checks:

- required services healthy and published ports restricted to loopback;
- accounts mode, scoped service roles, and shared ingest tokens disabled;
- no deletion pending over 30 minutes or with failed attempts;
- deletion, signup, OAuth and password-reset cleanup jobs scheduled and fresh;
- deletion tombstones represented in the independent persistent restore ledger;
- daily backup freshness (26-hour threshold) and strict seven-day expiry,
  allowing the hourly sweep and one minute of timestamp rounding.

A timer and a log are not proof that an alert reaches a human. During launch,
the operator must check results daily and after deployments; before unattended
operation, route failures to a monitored channel and test its delivery. Do not
send account identifiers, health data, credentials or receipt links in alerts.
Database/host unavailability must be monitored outside that host as well.

## Account lifecycle

1. Approve signups only for the supported audience and hosting terms. Keep
   account contact information distinct from the optional uploaded health profile.
2. Ordinary customers use approved self-service accounts. For a personal account
   created through an operator invitation, set `WEB_PERSONAL_USERS` and run the
   migrate service so the account can delete itself. Never use an administrator,
   household/default or public demo identity as a customer account.
3. Pair with individual device tokens. Keep `PULS_ALLOW_SHARED_TOKEN=false`,
   `WEB_ACCOUNTS=true`, the viewer on `web_app`, ingest on `ingest`, and the product
   API on `api_reader`. Static API/MCP credentials are operator secrets, not
   customer credentials. Audit every public route and consumer of the database.
4. Do not inspect health records for routine support. Start with the user's own
   report and minimal counts/status. If records are necessary, obtain the user's
   permission for that support task, restrict access, and record the reason and
   date in a private operational record without copying the health values.
5. Use unique administrative credentials, MFA for infrastructure/provider
   accounts where supported, and restricted SSH access. Do not offer administrator
   access to ordinary hosted users. Rotate exposed credentials and review access.

## Deletion: what completes, and what remains

The account page submits a deletion request. The database verifies ownership and
eligibility, disables the account, ends browser sessions and revokes phone and
OAuth renewal tokens. The web service fsyncs an independent deletion receipt
before committing that request; if the ledger is unavailable the transaction
rolls back. An immediate purge is attempted; a one-minute database worker retries
failures. The private status page reports completion only after the purge commits.
Already issued OAuth access tokens can remain usable for up to 30 minutes;
completion of database erasure removes the records they could otherwise read.

The purge removes profile/account rows, health samples and routes, aggregates,
materialized rollups, upload/rejection diagnostics, device tokens, invitations,
signup records, sessions, OAuth grants/codes and password recovery records.
It scrubs source names no other user's records still reference. A final foreign
key-protected user deletion fails the transaction if a dependent table was missed.
Tables without a user foreign key need explicit coverage whenever schema changes.
Late authenticated uploads must not recreate a deleted owner or diagnostic row.

The completed receipt loses its account reference and expires after 30 days.
A minimal user-UUID/date tombstone and independent restore receipt remain to stop
older backups from restoring deleted data. They contain no health values, email
address or name; still treat them as restricted pseudonymous information.

Deletion does not remove the source records from Apple Health, user exports,
records already delivered to an AI provider or request recipient, or selectively
rewrite infrastructure logs. Describe these limits in the policy. Never describe
SQL deletion as immediate physical secure erasure of disk blocks or backups.

### If deletion is delayed

- Investigate any failed attempt or request older than 30 minutes. Check worker
  scheduling, database locks, free disk space, compressed chunks, and error codes.
  Do not collect raw health data to diagnose the queue.
- Fix the underlying error and let the worker retry. For a confirmed eligible
  request, an operator can invoke `auth.complete_account_deletion` with its UUID
  through the private database administration channel. Do not delete queue rows,
  bypass protected-account rules, or manually mark a request completed.
- Aim to resolve a delayed request within 24 hours. If that is not possible,
  contact the requester privately when authorized and explain the delay. Do not
  promise completion until the receipt and database checks agree.
- Verify zero rows for that user in every health/derived/diagnostic table and no
  account, session, recovery link or sync token. Verify other users are unchanged.
  Verify the independent ledger before closing the incident.
- For a support deletion request, authenticate ownership without requesting health
  records or tokens; direct the person to self-service where possible. Check for
  signup-notification emails and support copies. Delete those copies as part of
  handling the request; the database worker cannot erase the operator's mailbox.

## Retention and backup inventory

Hosted settings: daily dumps, `PULS_BACKUP_KEEP_DAYS=7`, and
`PULS_BACKUP_STRICT_RETENTION=true`. Expiry runs at least hourly while the backup
service is running, even if new dumps fail. A backup can therefore persist for
seven days plus the next sweep; monitor outages and remove overdue archives on
recovery. Successful upload metadata stays with the account; rejection records
expire after 90 days or account deletion. Cleanup workers own the shorter account,
session, OAuth and recovery lifetimes described in the policy.

The operator confirmed at launch that the primary host is in the United States
and there are no additional external database copies. Keep a private inventory
of every database volume, dump, replica, cloud/VM/filesystem snapshot, downloaded
archive and restore-test copy. Before adding a copy, establish its encryption,
access, retention and deletion-ledger recovery process and update the policy.
Do not add health records to general-purpose laptop or cloud backups accidentally.

Resolve support cases with minimal data. Review signup emails and resolved support
material daily; erase them within 30 days (including trash where applicable).
Keep only a minimal record that a request was handled, not attached health data.
Provider-controlled operational records follow the provider's applicable terms.
Container logs rotate by size, not age; review their content and do not claim an
age-based erasure guarantee. Restrict logs like other personal operational data.

Current backups are compressed database dumps, not cryptographically protected
archives. The service is not end-to-end encrypted. Restrict physical and host
access; verify storage encryption separately rather than infer it from HTTPS.
A database and its backups on one host do not survive loss of that host. Offsite
encrypted recovery is a separate readiness decision and must include the current
independent deletion ledger, not just old database snapshots.

## Restore without resurrecting deleted users

Never restore over production as a test. Monthly, and after deletion/schema/backup
changes, run the synthetic isolated drill:

```sh
server/backup/test-restore-ledger.sh --scratch
```

The test creates its own project and volumes, verifies that invalid receipts are
rejected, restores a pre-deletion snapshot, and proves deleted data does not
reappear while a protected user's records survive.

For a real incident:

1. Stop application access and preserve the current independent deletion ledger.
   A ledger recovered from the same old database snapshot is insufficient.
2. Inventory the chosen backup and every deletion accepted since it was made.
   If the current ledger is missing or its completeness cannot be established,
   keep the restored service offline until that is resolved.
3. Use `server/backup/restore.sh --deletion-ledger-ready --no-start <archive>`
   (plus `--build` for a source-built deployment). The flag is an operator
   attestation that the independent ledger is current, not a way to skip it.
4. Restore tooling validates receipts, restores TimescaleDB, reapplies role ACLs,
   and replays deletions before reopening. If replay fails, keep access closed.
5. Verify the erased users are absent, protected accounts survive, jobs run,
   scoped access still holds, and services are healthy before reopening access.
6. Resume backup/expiry checks, remove scratch copies, and record the revision,
   archive date, test outcome and incident timeline without health data.

## Incident response

On suspected unauthorized access: restrict affected access, revoke credentials,
preserve only the evidence needed for investigation under restricted access,
determine which users/data/providers were affected, and assess notification
requirements promptly with qualified advice. Do not erase evidence blindly or
publish health records in a public issue. Restore access only after containment
and a verified fix. Review the FTC Health Breach Notification Rule and applicable
state/international requirements for the actual audience; do not assume HIPAA is
the only relevant law or claim compliance without an assessment.

## Synthetic hosted smoke check

On the host, `python3 server/ops/test-hosted-deletion.py --synthetic` creates two
new synthetic accounts and one synthetic measurement per account, exercises HTTP
pairing/sync/deletion, then verifies revoked access and zero remaining rows. It
sends no email and never reads another user's health records. Run only deliberately;
it is not the recurring monitor. On failure, a private stderr message identifies
any test fixture needing cleanup. Retain its restore tombstone like any deletion.

## Launch acceptance

Record evidence in the release-readiness document; an unchecked item is not a
pass. Before opening hosted access broadly, confirm:

- synthetic signup, pairing, tenant isolation, sync, deletion and receipt completion;
- invited personal accounts can delete; protected admin/demo accounts cannot;
- interrupted purge retries, late uploads fail, and old backups cannot restore users;
- actual signup/approval and recovery email delivery to a test inbox;
- real-device TestFlight upgrade, permissions, background sync and Data Requests;
- current live policy, App Store declarations, reviewer access and archive match;
- legal operator/account enrollment and launch territories are appropriate;
- access security, monitoring response ownership, and recovery risks are accepted.

Apple's sensitive-information enrollment rule needs a separate decision when the
operator is enrolled as an individual. Technical checks do not resolve it.
