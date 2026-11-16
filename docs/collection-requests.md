# Data requests

Data requests are account-backed invitations to contribute Apple Health
quantity or category data. They share the Data requests tools with one-time
[file exports](requests.md). Personal database sync remains separate.

## Flows

- **Organizer:** Connections → + → Data requests → Create request, Settings → Data requests, or
  the viewer's Data requests page. Choose General request, Group program or Research
  study. Every type supports one-time or ongoing sharing. The iPhone creator
  also offers Export a file for one-time requests; file delivery uses the share
  sheet or a compatible receiver without a PulsHealth account. Hosted collection
  is available in both the app and the website. Name the
  organizer/contact and explain the purpose. Hosted delivery also asks for
  consent, required/optional metrics, individual records or daily aggregates,
  a fixed start/end window for ongoing sharing, history for one-time sharing,
  and retention. File delivery asks for dates, metrics,
  file format and an optional receiver. Share the generated invitation link.
- **Participant:** use Open or scan request under Settings → Data requests, or
  Open request under Connections → + → Data requests, for either file-export
  links or hosted invitations. Hosted requests require sign-in:
  review the recipient, data use, period and retention, select optional metrics,
  and affirm consent. File requests need no account: review the data, dates
  and destination, then generate and share or send the file. Both delivery
  methods require Health permissions; Free/Pro history/type limits still apply.
- **Connections:** the list has no general sign-in prompt. Only hosted request
  review or creation asks for a PulsHealth account. File requests, including
  compatible external receivers, remain account-free. Personal database setup
  starts with scanning, with manual details available as an alternative.
  Each enrollment has independent status, credentials and local
  anchors. Send available data, pause an ongoing request, resume with new data
  from now, or stop. One-time requests have a fixed data cutoff at approval;
  Finish contribution ends retries, including unsent records. Health permission
  denial can look like an empty data set and is never represented as full access.
- **Organizer website:** view participant codes and receipt timestamps, download
  contributions in pages of up to 1,000 NDJSON records, rotate invitation links,
  or close a request. Closing prevents further uploads for all participants.
- **Opportunities:** a secondary entry in Add a connection. Website creators can submit a
  listing for administrator review. Only approved, open listings appear publicly.
  Review is not an endorsement, identity verification, or research ethics approval.

The iPhone has four tabs: Explore, Export, Connections and Settings. Connections
lists saved personal databases, joined requests and data requests you organize. The plus
opens Your database, PulsHealth database and Data requests (open or create).
Browsing stays inside Add a connection. Creating and managing requests is also
available under Settings → Data requests. Data requests are
invitation-only by default. Definitions cannot be edited after creation: a
changed scope needs a new request and new consent. The creator is the sole
organizer with access; organization labels do not create shared administrator
accounts or a multi-user organization workspace.

## Native management and deletion

Organizer rows show Open, Awaiting participants or Closed, counts and the latest
contribution. The native detail includes participant codes, invitation rotation,
paged contribution downloads (at most 1,000 records per file) and closing the
request. Closing stops future contributions from everyone. Your own contribution
is separate and requires explicit review/consent, even when you created the request.
An owner can review/join without rotating the public invitation. Existing
invitations open the existing connection rather than enrolling a second time.

Save & close preserves an unfinished request definition on this iPhone in a
protected, backup-excluded draft. Creation uses the existing PulsHealth collection
service. Custom ongoing request servers are not supported; a compatible custom
receiver remains available through one-time file delivery. Only the selected
personal database receives automatic personal sync; other saved databases are
shown as Inactive and retain their independent sync progress.

Withdraw stops future contributions. Request deletion records a pending request,
optionally also withdrawing (selected by default). The organizer's Delete &
confirm action stops uploads and deletes server contribution records/receipts
before recording confirmation. It cannot erase downloaded copies or backups.
The deletion status and request/completion timestamps remain until account
deletion. A pending request never appears as confirmed. Completed/withdrawn
entries appear in history; Remove from this iPhone hides a resolved entry locally,
without deleting recipient copies. Pending deletion requests cannot be hidden.

## Ongoing request dates

New ongoing requests specify an exact start and end date/time, displayed in the
creator’s local time zone and stored as epoch milliseconds (`startAt`, `endAt`).
The same instants apply to every participant, regardless of when or where they
join. A past start includes history (subject to plan and Health permissions);
a future start allows enrollment now and collection later. The end must follow
the start and be in the future when creating or joining. Fixed windows are not
limited to the previous 365-day relative duration.

Joining must acknowledge the exact dates shown in review; earlier clients that
do not support those dates cannot silently join a wider window. Both the phone
and server reject uploads before the start and records outside the approved
window. After the end, the existing seven-day retry allowance can deliver only
data from inside that window. Pausing and resuming starts at the later of now
or the original start, without extending the end. iOS controls delivery timing;
future scheduling is not a promise of an upload at an exact time. Older requests
without explicit dates retain their original history/duration behavior.

## Isolation and collection protocol

Hosted delivery uses a separate JSON protocol at the viewer, not a change to Puls Sync v1.
It requires accounts mode and migrations 032–033, privilege reset 098 and repeatable role grants 102.
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
uses data requests. This feature does not itself provision a host, deploy
services, publish an App Store update, or provide study-specific approval forms.
Before a pilot, verify TLS, account availability, backups, the retention job and
signed-device HealthKit/background behavior. Use synthetic participants for tests.

### Connection screen behavior

The active personal database opens directly into its data, activity and sync
controls. Inactive saved databases retain the explicit switch action. Removal
uses a full-screen confirmation and retains the engine’s sync-in-progress and
state-readability checks. Connection and setup pages use individual cards rather
than a settings-style list. Request/account metadata errors are scoped to known
request connections; they do not represent personal database sync health.

Personal database connections use their server address as a default name (or
PulsHealth database for the active hosted connection). Connection settings lets
you save an optional local name; clearing it restores the default. Names do not
change the destination, credentials, selected data or sync progress. Adding a
database and editing an existing connection are separate flows; connection
settings no longer repeats the saved-database list or destination chooser.
