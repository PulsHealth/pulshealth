# Research and enterprise hosting proposal

Exploration dated 2026-10-30. [Overview](README.md).
This proposes a second product tier, not bulk access to personal accounts.

## Deployment and privacy choices

| Model | Who operates it / reads records | Suitable use | Tradeoff |
|---|---|---|---|
| Shared study tenant | PulsHealth operates; approved study staff read their participants; operator remains trusted | Lower-cost non-regulated pilot after study authorization exists | Cheapest, largest shared application failure domain |
| Dedicated organization deployment | Separate AWS account or VM/database/credentials; PulsHealth manages | Institution buying managed collection and analysis | More isolation and configurable region/retention, but operator access remains |
| Customer-owned AWS account | Institution owns infrastructure and keys; PulsHealth receives scoped temporary management access | Organization requiring ownership, procurement control and an exit path | Customer must participate in IAM, upgrades and incident response |
| Encrypted collection relay | Participant phone encrypts to institution keys; institution decrypts in its own environment | Institution wants PulsHealth unable to read participant content | Existing hosted SQL/dashboard cannot analyze that ciphertext |

Propose a dedicated EC2 environment or customer-owned account for the first
institutional engagement. A separate database on a shared host limits some
mistakes but still shares host administrators, backups and resources. A separate
AWS account improves policy and billing boundaries; if PulsHealth has broad
cross-account administration it still has practical access to records. Restrict
data, key, deployment and support permissions according to the actual promise.

## What must be added to the product

The current system authorizes personal users and broad account reads. An
organization is not just a shared login or `PULS_MULTI_USER=true`.

Proposed logical model, to be designed in a later implementation:

```text
organization → study → enrollment → study participant identity
staff membership → role + permitted studies
enrollment → consent version + permitted types/date range + status
export job → requesting staff + authorization snapshot + delivery/expiry record
```

Keep study identifiers separate from personal account identifiers. For an initial
pilot, a separate study destination with its own participant identity and device
credential is simpler than granting access to the participant's complete personal
history. Reuse saved-destination infrastructure only after testing its sync-state
isolation. Do not share anchors, tokens or deletion policy across destinations.

The collection workflow should be:

1. Institution defines purpose, region, participants, required types/history,
   approved protocol, retention and withdrawal handling.
2. Participant sees a study invitation and versioned consent describing the
   institution, recipient access and data requested. HealthKit permission alone
   is not research consent. Joining is explicit and separate from personal sync.
3. Server binds a study credential to one enrollment; enforce permitted types,
   dates and active status at ingest. Do not trust client-supplied organization
   or user selectors. For opaque encrypted payloads, enforcement of inner content
   belongs to the trusted client/recipient; the relay cannot inspect it.
4. Staff see enrollment and collection status. Analysts receive only authorized
   study data; coordinators can manage enrollment without automatically reading
   health values. Audit access and exports without duplicating health payloads.
5. Participant pauses or withdraws; stop future collection, revoke grants and
   execute the agreed retention/deletion process. Explain retained study records
   and already-delivered exports. Do not promise withdrawal erases every copy.
6. At study end, hand over authorized exports, revoke access and verify retention
   expiry or deletion, including recovery copies and the deletion ledger.

Collection status must distinguish no new samples, phone offline, device locked,
limited history and stalled sync. HealthKit background delivery is opportunistic;
do not sell continuous real-time collection or treat absent data as participant
noncompliance. Use the existing recorded-data semantics and preserve missingness.

New authorization tests need multiple organizations, studies, staff roles and
participants: cross-study reads, forged selectors, exports, revocation, withdrawal,
recovery and late uploads. The gateway's broad `health:read` scope and limited
route set do not yet provide study-specific access or general cohort exports.

## Data minimization and researcher access

Let the institution hold the mapping from participant codes to real identities
where possible. Exclude uploaded names, email, birth dates, device/source names,
routes and unneeded record types by default for a study, with protocol-specific
exceptions. Exact timestamps, routes and longitudinal patterns can identify people
even after names are removed: describe this as pseudonymization, not anonymity.

Keep billing/contact identity separate from health datasets. Define whether
researcher access includes raw data, approved aggregates or both. Prefer scoped,
expiring export jobs and institution service accounts over direct database
credentials. Any AI processing is a separate, explicit recipient/data-use choice.

With encrypted relay mode, the institution must authenticate its public key to
participants and control key recovery/rotation. PulsHealth can manage storage and
delivery while the institution runs a decrypted database, dashboard and API. If
PulsHealth also controls that decrypted environment or can silently replace its
client software, the stronger privacy claim no longer follows automatically.

## Applicable requirements change with the customer

Determine responsibilities with the institution before accepting records.
Encryption is one control, not a certification.

- **HIPAA:** applicability depends on the parties and activity; not every health
  app or study is covered. HHS says that storing ePHI on behalf of a covered
  entity/business associate can make a cloud provider a business associate even
  without the decryption key. Where applicable, establish the BAA chain and
  required operational safeguards. See [HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html).
- **AWS:** EC2, EBS, S3 and KMS appear on AWS's eligible-services reference;
  Lightsail was not listed when checked. Exclude Lightsail from an ePHI design
  unless eligibility is subsequently confirmed. An AWS BAA and eligible services
  do not alone make PulsHealth compliant. Review every processor, including TLS
  proxies, monitoring, support and email. See [AWS eligibility](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/).
- **Consumer health privacy:** a direct-to-consumer service can have FTC health
  breach obligations even outside HIPAA. Assess applicable state/territory rules,
  incident response and truthful disclosures for the launch audience. See
  [FTC guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0).
- **Research and Apple:** Apple requires informed consent and independent ethics
  review for apps conducting health-related human-subject research. Verify the
  protocol, review evidence, app submission/entity requirements and specific
  HealthKit data uses before enabling recruitment. See
  [App Review Guidelines 5.1](https://developer.apple.com/app-store/review/guidelines/#privacy).
- **Cross-border hosting:** choose region, controller/processor roles, transfer
  arrangements, lawful basis and retention with qualified review before expanding
  beyond the initial territory. A US-only data disk does not prove all support,
  telemetry, backup or subprocessor handling stays in the US.

## Pricing proposal

Do not offer an institution the consumer plan multiplied by participant count
with unlimited operational commitments. Quote a setup fee, a monthly platform
minimum, participant/storage/egress allowances, and explicitly priced additions
for support hours, security reviews, SSO, audit reporting, custom exports and
availability/recovery targets. Customer-owned AWS can be pass-through cloud cost
plus a management fee. No price here is a published offer.

Illustrative quote floor: $150 infrastructure + three support/operations hours
valued at $75/hour = $375/month before compliance, insurance, development, taxes
and margin. Even 100 participants at $5 yields only $500 before payment costs;
it leaves little room for commitments. These are planning assumptions, not an
AWS quote, a market-price survey or a measured workload. Interview initial
customers about cohort size, historical backfill, study duration and response
expectations before setting the minimum.

## Acceptance before either paid launch

| Gate | Individual pilot | Institutional study |
|---|---|---|
| Scope and terms | Hosting vs app entitlement, usage limits, cancellation/export/deletion | Plus protocol, organization roles, consent, retention and signed service responsibilities |
| Access | Two-user isolation, scoped API credentials, restricted support access | Plus cross-study/organization tests, staff lifecycle and audit review |
| Operations | Encrypted off-host recovery, current deletion ledger, monitored failures, tested restore | Plus contracted RPO/RTO, incident contacts, region/subprocessor inventory and any required BAAs |
| Evidence | Synthetic load and real-device pilot; verify running revision/configuration | Plus enrollment/withdrawal/late-upload tests and institutional acceptance |
| Claims | Publish only protections actually deployed and tested | Plus key-custody proof if claiming operator-blind collection |

The existing [hosted runbook](../../hosted-operations.md) remains the starting
point. A proposal review or successful synthetic test does not establish that
any customer data has been migrated, any legal condition met, or any service launched.
