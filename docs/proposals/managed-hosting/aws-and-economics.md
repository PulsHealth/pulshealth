# AWS deployment and $5/month economics

Exploration dated 2026-10-30. [Overview](README.md).
All prices are USD; estimates exclude tax. No resources have been purchased.

## Deployment choices

| Option | Fit | Main tradeoff |
|---|---|---|
| Lightsail VM running the existing Compose stack | Lowest-complexity individual pilot; predictable bundled transfer | Fewer infrastructure controls; check encryption of every selected storage path; do not use for HIPAA ePHI without verified service eligibility |
| EC2 + encrypted EBS + S3 recovery | Preferred common foundation when institutional hosting is likely | More setup and separately metered components; still self-managed PostgreSQL |
| Dedicated EC2 deployment per organization | Separate credentials, network boundary, backup schedule and region | Higher fixed cost; operator remains trusted unless customer controls effective access |
| Customer-owned AWS account | Institution owns data infrastructure and procurement | Installation/support fee; permissions and upgrade authority must be explicit |
| RDS PostgreSQL or another managed database | Potentially less database administration | Not a drop-in replacement: current schema depends on TimescaleDB |
| Encrypted object storage + thin relay | Operator-blind collection/vault | New protocol, key UX and client-side/customer-side querying |

AWS's [RDS extension list](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html)
does not list TimescaleDB at review time. Current migrations use hypertables,
continuous aggregates and compression. Ordinary RDS PostgreSQL requires an
explicit storage/query migration and correctness/performance work, not a changed
connection string. A managed Timescale provider needs its own quote, service terms
and data-processing review; it may be attractive when operational time dominates.

For the pilot, keep ingest, viewer, API and PostgreSQL on one machine, behind
HTTPS with database/service ports private. Run migrations through the existing
service. Build images away from the production host; pin release digests. Omit
optional Grafana/MCP processes unless needed. Use an off-host encrypted backup
and independently recoverable current deletion ledger from day one.

Do not buy a NAT gateway, load balancer or Kubernetes cluster merely to launch a
single host. A direct HTTPS endpoint with a tightly restricted security group can
avoid those fixed costs. This trades away multi-host failover; revisit networking
and separate the DB when measured load or a contract requires it. If retaining
Cloudflare termination, include it in the privacy/subprocessor design.

## Price inputs and transparent examples

Price pages checked 2026-10-30. Planning region: US East (Northern Virginia),
Linux, on demand, 730 hours/month. Reprice in the AWS calculator before purchase;
regional tables, taxes and account discounts may differ. No promotional credits
or reserved commitments are assumed.

| Input | Value used | Source / qualification |
|---|---:|---|
| Lightsail 4 GB / 80 GB disk / 4 TB transfer / public IPv4 | $24/month | [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/) |
| Lightsail 8 GB / 160 GB disk / 5 TB transfer / public IPv4 | $44/month | Same pricing page; transfer allowances vary in some regions |
| EC2 t3.medium, 4 GiB | $0.0418/hour = $30.51/month | [AWS T3 table](https://aws.amazon.com/ec2/instance-types/t3/) |
| EC2 t3.large, 8 GiB | $0.0835/hour = $60.96/month | Same Linux US East table |
| gp3 disk | $0.08/GB-month planning input | [EBS pricing example](https://aws.amazon.com/ebs/pricing/); verify target region, baseline IOPS/throughput only |
| EC2 public IPv4 | $0.005/hour = $3.65/month | [VPC pricing](https://aws.amazon.com/vpc/pricing/) |
| S3 Standard backup storage | $0.023/GB-month | [AWS regional cost example](https://aws.amazon.com/blogs/database/automate-postgresql-audit-log-extraction-and-analysis-with-amazon-s3/); requests/transfer extra |
| One customer-managed KMS key | $1/month before requests/rotation additions | [KMS pricing](https://aws.amazon.com/kms/pricing/); one service key in this illustration, not one per user |

Illustrations below assume **seven full compressed daily dumps**, no extra
snapshots or versions, and 20 GB (small) or 50 GB (larger) per dump. These are
synthetic budget assumptions, not measurements of customer records. Backup
storage is therefore 140 or 350 GB, costing $3.22 or $8.05/month. Keeping seven
full backups costs roughly seven times one compressed dump, not one copy.

| Monthly line item | Lightsail 4 GB | Lightsail 8 GB | EC2 4 GiB | EC2 8 GiB |
|---|---:|---:|---:|---:|
| Compute bundle/instance | 24.00 | 44.00 | 30.51 | 60.96 |
| gp3 disks, total root + data | Included | Included | 8.00 (100 GB) | 16.00 (200 GB) |
| Public IPv4 | Included | Included | 3.65 | 3.65 |
| Seven off-host dumps | 3.22 | 8.05 | 3.22 | 8.05 |
| KMS key | 1.00 | 1.00 | 1.00 | 1.00 |
| Small allowance: DNS, email, monitoring, requests | 5.00 | 8.00 | 5.00 | 8.00 |
| **Illustrative total** | **33.22** | **61.05** | **51.38** | **97.66** |

The allowance is a budget placeholder, not a quoted bundle or spend cap. Internet
egress above included/account allowances, T3 Unlimited CPU credits, extra snapshots,
restore-test compute, paid monitoring/support, billing software, legal work and
labor are additional. AWS documents Lightsail disk/snapshot encryption with
service-managed keys; verify coverage of the selected root/data/temp layout, and
add any necessary encrypted attached-disk cost before accepting the table as a
launch budget. See [Lightsail storage FAQ](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-block-storage.html).

Choose 4 GB only for a measured small pilot; 8 GB provides more memory headroom.
These figures imply **no supported user count**. Backfills, long-range charts,
compression, deletion and backups compete for CPU/I/O. Lightsail and T3 have
burstable CPU behavior, so test beyond a short burst; see
[Lightsail baselines](https://docs.aws.amazon.com/lightsail/latest/userguide/baseline-cpu-performance.html).
Graviton is another cost experiment after verifying the pinned images, restore
tooling and workloads on arm64.

## Can $5 work?

As a payment-only illustration, US domestic online card processing at
[Stripe's listed 2.9% + $0.30](https://stripe.com/pricing) leaves
`5 - (5 × 0.029 + 0.30) = $4.555` per successful monthly payment. This excludes
Stripe Billing or other subscription tooling, refunds, disputes, tax, acquisition,
support and infrastructure. An annual $60 payment reduces the fixed payment fee
per month but creates a longer service obligation; it is an option, not an offer.

| Paying users | Gross monthly revenue | After illustrative payment processing | Less $65 infrastructure | Less $100 infrastructure |
|---|---:|---:|---:|---:|
| 10 | $50 | $45.55 | -$19.45 | -$54.45 |
| 25 | $125 | $113.88 | $48.88 | $13.88 |
| 50 | $250 | $227.75 | $162.75 | $127.75 |
| 100 | $500 | $455.50 | $390.50 | $355.50 |

These are contribution scenarios, not profit forecasts or capacity claims. At
$65/month, infrastructure-only break-even is 15 paying users; at $100 it is 22.
If variable cost/support reserve averages $1/user, those thresholds become 19
and 29. Four hours/month valued at an illustrative $50/hour adds $200: with $65
fixed infrastructure and the same $1 reserve, break-even becomes 75 users.
The expensive part of a small service can be the operator's time.

Payment channel is undecided. A 15% or 30% platform-fee sensitivity would leave
$4.25 or $3.50 respectively before other costs; these are scenarios, not a claim
of applicable App Store fees. Review the actual purchase flow, storefront rules
and program eligibility before choosing checkout. Hosting and app Pro currently
have separate entitlements; do not silently change existing purchase benefits.

## Capacity, limits and a useful experiment

Measure synthetic cohorts with light, typical and heavy histories, including
routes and workout series. No personal health records are needed for sizing.

Use these budget equations rather than promising unlimited history:

```text
live bytes = users × (initial history bytes + months × monthly growth bytes)
provisioned disk >= (live bytes + WAL + temp + local backup staging + OS) / 0.70
backup bytes ~= retained dumps × compressed dump bytes + retained versions
monthly cost = fixed infrastructure + storage + requests + egress + operations
```

For sensitivity only: 50 users × 1 GB/history is 50 GB; 50 × 5 GB is 250 GB.
The latter already exceeds the small instance's disk before overhead. Indexes,
rollups, compression and deletion work change these numbers; measure physical
storage, not just uploaded gzip bytes. A single ECG/route-heavy user may differ
substantially from a daily-summary user.

Pilot admission sequence: 5, then 10, then 25 synthetic accounts; add concurrent
backfills, dashboard reads, exports, a deletion and backup. Record p95 read and
ingest latency, queue growth, sustained CPU/credits, memory, disk/WAL growth and
restore duration. Suggested engineering targets to validate: ordinary 30-day
dashboard reads under 2 seconds p95, no OOMs, >30% free disk, no monotonically
growing queue. These are test targets, not customer SLAs.

Start with explicit storage and read/export quotas once measurements establish
safe values. Show usage and notify before an enforced limit; pause/retry uploads
without acknowledging unpersisted records. Preserve export/deletion access and
define a grace period for failed payments. Bound successful authenticated traffic
as well as failed logins; present API rate limits are not a complete cost control.

A daily backup implies up to roughly 24 hours of recovery-point loss, potentially
more after a failed backup. Measure restore time rather than promising an RTO.
Adopt WAL/PITR and a standby when a contract requires lower loss/downtime, and
include their retention, deletion handling and cost. Budget alerts alone do not
stop spending. Define an admission/usage response before launch.

## Timescale licensing is a launch gate

The pinned database image contains TimescaleDB 2.29.2. Its
[TSL license](https://github.com/timescale/timescaledb/blob/2.29.2/tsl/LICENSE-TIMESCALE)
distinguishes value-added applications from database-as-a-service. The value-added
permission has conditions, including customer notice and restrictions on schema
modification. A paid health application with fixed APIs may qualify; that is a
design inference requiring review of the actual offering, not legal clearance.
Merely renaming a hosted database does not resolve the license. Confirm the
image's features/licenses and proposed access model before sales, especially
before giving customers SQL or schema control. If needed, obtain commercial
terms or evaluate a compatible alternative; the repository's Apache license does
not override dependency licenses.
