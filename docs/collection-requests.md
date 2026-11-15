# Collection requests

Collection requests are account-backed invitations to contribute Apple Health
quantity or category data. They are separate from personal database sync and
from the existing stateless one-time ZIP [Data Requests](requests.md).

## Flows

- **Organizer:** Settings → Requests & programs → Create & manage requests, or
  the viewer's Requests page. Choose General request, Group program or Research
  study, name the organizer/contact, explain purpose and consent, and select
  required/optional metrics, individual records or daily aggregates, history,
  one-time/ongoing duration and retention. Share the generated invitation link.
- **Participant:** open an invitation, review the recipient, data use, period
  and retention, select optional metrics, and affirm consent. Sign-in and
  Health permissions are required. Free/Pro history/type limits still apply.
- **Sharing:** each enrollment has independent status, credentials and local
  anchors. Send available data, pause an ongoing request, resume with new data
  from now, or stop. One-time requests have a fixed data cutoff at approval;
  Finish contribution ends retries, including unsent records. Health permission
  denial can look like an empty data set and is never represented as full access.
- **Organizer website:** view participant codes and receipt timestamps, download
  contributions in pages of up to 1,000 NDJSON records, rotate invitation links,
  or close a request. Closing prevents further uploads for all participants.
- **Opportunities:** a secondary entry in Sharing. Website creators can submit a
  listing for administrator review. Only approved, open listings appear publicly.
  Review is not an endorsement, identity verification, or research ethics approval.

The iPhone has four tabs: Export, Sync, Sharing and Settings. Creating and
managing requests belongs in Settings; browsing is not a tab. Requests are
invitation-only by default. Definitions cannot be edited after creation: a
changed scope needs a new request and new consent. The creator is the sole
organizer with access; organization labels do not create shared administrator
accounts or a multi-user organization workspace.

## Isolation and collection protocol

This is a separate JSON protocol at the viewer, not a change to Puls Sync v1.
It requires accounts mode and migration 032 plus repeatable role grants 102.
The native client uses the existing PulsHealth account service. Custom personal
sync destinations do not affect it. A separate self-hosted native account/service
selector is not implemented.

- `POST /api/native/collections`: native account bearer session, no cookies.
- `GET|POST /api/collections`: browser session; mutations require the existing
  same-origin policy. Actions: list, create, invite, participants, export, close,
  join, pause, resume, stop, finish, credential, review-list and review.
- `GET /api/sharing`: public approved directory; `?id=<uuid>` with an
  `X-Collection-Invite` credential reviews a private invitation. Invitation
  secrets live in the link fragment, not the URL path or query on the server.
- `POST /api/sharing`: enrollment-specific bearer credential; accepts
  `{batchID, records, deletions}`. Each record has `key`, `type`, `function`
  (`raw` or catalog aggregate function), epoch-millisecond `start` and `end`,
  `value`/`category`, and canonical `unit`. Aggregate buckets are daily and must
  fit entirely within the approved range. Deletions contain raw record keys.
  The receipt returns the exact `batchID` and SHA-256 of the submitted UTF-8
  body. The phone advances anchors only after validating both.

An enrollment credential cannot query data or upload to any other enrollment.
The database rechecks session ownership, approved metric representation, dates,
status and upload deadline. Pause/stop and ingestion serialize on the enrollment
row. Upload retries are accepted for up to seven days after the data cutoff;
receipts deduplicate batch IDs. Raw keys are derived separately per enrollment;
raw inserts do not overwrite, while aggregate recomputation updates its bucket.
The general ingest/API roles have no access to the private collections schema.

Only approved scalar values and times are transmitted. Profile, source names,
device names, arbitrary metadata, routes, ECG, medication and workout payloads
are excluded. Health records remain sensitive and can be identifying even without
names. Organizers see a request-specific participant code, not account email or
personal database access.

Each iPhone enrollment has a device-bound Keychain credential, protected and
backup-excluded sync state, and its own engine, anchors and logs. Signing out
stops local sharing; re-enabling requires an explicit action. Multiple ongoing
requests register independent HealthKit observers and catch up on foreground.
iOS controls background delivery, and HealthKit is unreadable while locked;
continuous collection means best-effort updates, not a guaranteed real-time feed.

## Retention and operation

Exports exclude records past the request's retention age. An hourly TimescaleDB
job removes those records; receipts are removed after 14 days and expired grants
are disabled. Account deletion cascades through its collection contributions
and owned requests. Pausing/stopping does not erase prior contributions or recall
organizer downloads. Backups follow the operator's backup retention, and any
restoration must preserve deletion/retention obligations.

Deploy the database migration and viewer before distributing an app build that
uses collection requests. This feature does not itself provision a host, deploy
services, publish an App Store update, or provide study-specific approval forms.
Before a pilot, verify TLS, account availability, backups, the retention job and
signed-device HealthKit/background behavior. Use synthetic participants for tests.
