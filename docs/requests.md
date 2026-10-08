# PulsHealth Requests v1

One-time, participant-reviewed exports. Create requests in **Settings → Create
Request**. Specify the title, requester, purpose, contact, inclusive dates, data
types and CSV or JSONL. Select individual records or an allowed daily aggregate
for each type. Delivery defaults to the iOS share sheet. Optionally supply a named
compatible HTTPS receiver. Create Link & QR Code shares either representation.

The participant opens the link or scans it with Settings → Open or Scan Request,
reviews its scope and recipient, then taps **Generate & Share** or **Generate &
Send**. The latter generates and uploads in a single action. A partial extraction
stops for **Send Available Data**; a failed upload allows manual retry of the same
file. No data is sent just by opening a link. Requests wait through onboarding.

Defaults: CSV in a ZIP, last 30 days through today, 30-day link expiry, no selected
metrics, no destination, no workout routes or extra streams. Dates resolve in the
participant's time zone, including daylight saving changes. Today is necessarily
partial. Daily aggregates include completed days only: a request through today
omits today’s aggregate, records that limitation in the ZIP summary, and requires
**Send Available Data** before uploading. Medication Doses needs its separate
permission picker, currently available after Apply under Sync → Raw Samples;
the request review screen explains this setup requirement. HealthKit may return no records for denied access; completeness describes
extraction, not proof of available permissions or expected records.

## Link format

`puls://request?data=<base64url-json>` uses unpadded UTF-8 JSON encoded as base64url.
Only this one query parameter is accepted. Maximum encoded link: 2,800 bytes.
The custom scheme requires a compatible installed app. Install PulsHealth and
reopen the link if necessary; there is no hosted landing page or deferred link.
The current App Store version does not gain this feature until a release ships.

Example decoded payload (UUIDs and dates are illustrative):

```json
{
  "version": 1,
  "id": "fc4060c4-3049-4656-aa4a-85f4c50c7c87",
  "title": "Monthly activity",
  "requester": "Example study team",
  "purpose": "Compare daily activity",
  "contact": "study@example.org",
  "startDay": "2026-09-01",
  "endDay": "2026-09-30",
  "expiresAt": 1793491200000,
  "metrics": [{"type": "HKQuantityTypeIdentifierStepCount", "function": "sum"}],
  "format": "csv",
  "destination": {"name": "Example study", "url": "https://example.org/requests/upload"}
}
```

Omit `destination` for share-sheet delivery. Omit a metric's `function` for raw
records. The Swift catalog defines types and legal functions. Version 1 allows
1–30 unique types, validates support on the participant's OS, and rejects ECG
and heartbeat series in CSV. Text is bounded; a request with many long type
names may reach the QR size limit before 30 types. Expired, future-dated,
unsupported or malformed requests are rejected before any health read.

Links are reusable templates, not single-use enrollment credentials. Anyone
with a link can read or alter it. Names are not verified. There is no hosted
revocation, participant roster, scheduled collection or persistent request
history. Research consent and institutional review are outside this feature.

## Receiver contract

This is a **ZIP upload contract**, separate from Puls Sync Protocol `/v1/ingest`
and the read-only product API. A folder link, email address, or existing ingest
endpoint will not work. A compatible receiver must be provided by the requester.

The app POSTs the archive itself to the exact reviewed HTTPS URL:

```http
Content-Type: application/zip
Accept: application/json
X-Puls-Request-ID: <lowercase request UUID>
Idempotency-Key: <lowercase submission UUID>
X-Puls-SHA256: <lowercase hex SHA-256 of ZIP bytes>
```

There are no cookies, sync bearer tokens, or configured identity headers. URL
credentials, query parameters and fragments are prohibited; redirects are not
followed. Request timeout is 60 seconds, total resource timeout 10 minutes.

After durably accepting the exact bytes, return HTTP 200 or 201 and JSON:

```json
{"submissionID":"<submission UUID>","sha256":"<ZIP checksum>","receipt":"<short receipt reference>"}
```

The body must be at most 16 KiB and the receipt 1–200 UTF-8 bytes without control
characters. The echoed submission and checksum must match. Anything else is
**receipt not confirmed**, not evidence that the upload failed to arrive.

Receivers must stream and verify the checksum, bound file sizes, and atomically
store an idempotency record keyed by request and submission ID. Repeating the
same ID and checksum must return the original receipt without duplicating the
submission. Reusing an ID for different bytes must fail. Do not acknowledge
before durable storage. Avoid extracting untrusted ZIP paths. Request IDs are
not secrets or authentication; do not use them as proof of patient identity.
Receiver access controls, enrollment, abuse prevention, retention, deletion and
any organizational obligations are the receiver operator's responsibility.

The manifest includes `dataRequest`, `submissionID` and `requestWarnings` alongside dates, time zone,
counts and extraction limitations. Request exports mint fresh user/device IDs,
omit configured profile and sync credentials, and use throwaway export state.
They still contain health/sample/source information and are not anonymous.

Retry is manual and uses the same file and submission ID for the current
session. Regenerating creates a new submission. Files disappear on confirmed
receipt, completed share handoff, deletion, closing the request or next launch.
Closing after an unconfirmed upload cannot recall a received copy.

## Verification

`DataRequestTests` validates link round-trips, scope, malformed input, dates/DST,
expiry, unsupported types, CSV limitations and receipts. `RequestUploadIntegrationTests`
exercises URLSession upload and oversized response rejection using a synthetic
URLProtocol receiver. Hosted `DataRequestModelTests` covers combined generation
and delivery, partial review, retry identity, isolated credentials, cancellation,
first-request-wins and temporary-file cleanup. Physical camera scanning and real
HealthKit extraction still require an unlocked device with representative data.
