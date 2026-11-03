# Managed PulsHealth hosting: options for discussion

Status: exploration, not an approved architecture, offer, or privacy policy.
Prepared 2026-10-30 against `f993cb53eff502177e079e09793f0dc0908e5659`.
Tracking: [issue #430](https://github.com/PulsHealth/pulshealth/issues/430).

## Proposed direction

Offer managed PulsHealth accounts with phone sync, a browser dashboard, and
authenticated read access. A shared service around **$5/month** is plausible
for individuals if storage, API use, and support are bounded. Offer research
organizations a separately priced service with study-specific access and
operations. A dedicated machine for every $5 customer is not economical.

For an initial service, use TLS, encrypted storage and backups, account isolation,
and tightly controlled operator access. Describe it as encrypted managed hosting.
**Do not promise that PulsHealth cannot read the records:** the present query
engine and dashboard require server access to plaintext.

If an institution requires privacy from PulsHealth itself, propose either
customer-controlled infrastructure with restricted management access, or a new
encrypted collection service whose keys stay with the institution. The latter
can prevent our storage service from decrypting records, but analysis moves to
the institution's environment. See the conditions in the privacy proposal.

## Three proposals

| Proposal | Intended customer | What they get | Principal tradeoff | Recommendation |
|---|---|---|---|---|
| A. Shared managed accounts | Individuals around $5/month | Existing sync and dashboard, supported account API, backups/export/deletion | Operator and trusted application can read records; shared failure domain | First pilot, after readiness gates |
| B. Dedicated study service | Research organizations and enterprises | Separate deployment, participant enrollment and study permissions, contracted retention/support | More engineering and operational responsibility; dedicated hosting alone does not hide data from operator | Sell as a separately scoped engagement |
| C. Encrypted vault or collection relay | Users or institutions requiring operator-blind content storage | Phone encrypts; user/researcher holds keys; encrypted cloud storage and retrieval | Existing server queries and remote MCP cannot operate on ciphertext | Separate prototype only if demand justifies it |

Read the [AWS and $5 economics proposal](aws-and-economics.md),
[privacy and encryption options](privacy-options.md), and
[research and enterprise proposal](research-hosting.md).

## What exists in this repository

This is source inspection, not verification of the running service.

| Existing capability | Authority and limitation |
|---|---|
| PostgreSQL 17 / TimescaleDB, ingest, product API, viewer, MCP | [Compose](../../../server/docker-compose.yml), [server guide](../../../server/README.md). One Compose host is not a highly available cluster, despite the database image's `-ha` name. |
| Account sign-in, approval, phone pairing and account-scoped viewer | [Viewer accounts](../../../web/README.md#accounts-mode). Security-barrier views filter using a transaction-local identity. Compromised viewer code can change that identity; this is not isolation from application compromise. |
| Customer-facing OAuth health API | [Gateway implementation](../../../web/app/api/health/v1/[...path]/route.ts). Six route families: users, catalog/types, metrics/daily, activity/summary, sleep/daily, workouts. Identity is token-bound and live grant/account state is checked. Date queries require a range no longer than 31 days. This is a subset of the full product API. |
| Full read API and MCP | [Product API](../../api.md), [AI access](../../ai.md). The underlying static API token is an operator credential; enabling multi-user reads expands its reach. Never distribute it to customers. MCP grants currently cover the account broadly. |
| Deletion, retry, retention and restore protection | [Hosted runbook](../../hosted-operations.md). Current documented backups are compressed dumps, not encrypted archives; offsite recovery is a readiness gap. AWS migration must implement and verify encryption and restore handling. |
| Explicit operator-trusted security model | [Threat model](../../../SECURITY.md#threat-model), [privacy policy](../../privacy-policy.md). Existing promises must be updated alongside any actual infrastructure or processing change. |

A study model, organization roles, versioned research consent, study-limited
exports, hosting billing/quotas, and end-to-end encrypted ingestion are new work.
Existing personal-account approval and OAuth consent do not provide those features.

## Decisions before implementation

1. Choose the promise: protected managed hosting, or content unreadable to us.
2. Choose the pilot audience and region. Default proposal: US adult individual
   users; evaluate regulated studies separately before accepting their records.
3. Decide whether $5 includes only hosting or also app Pro. The current app
   entitlement and hosting are separate; preserve existing purchasers' access.
4. Select measurable storage/API allowances after a synthetic load pilot.
5. Resolve Timescale licensing for the actual product and access offered.
6. For research, choose who holds keys, who controls identifiable participant
   records, and where analysis executes before designing enrollment.

Suggested next work is a synthetic deployment experiment and a small usability
pilot, followed by an implementation issue with measured capacity and acceptance
criteria. This branch provisions no AWS resources and changes no running service.
