# Export your health data

Choose the source first:

| You want to export | Use |
|---|---|
| Data directly from your iPhone, without a server | [The app's Export tab](#on-device-export-no-server) |
| Data already synced to your database | [The server API](#parameters) or [puls-export CLI](#the-puls-export-cli) |
| A selection someone has asked you to share once | [Data Requests](requests.md) |

For spreadsheets, start with CSV. Use JSON or JSONL on the phone when you
need full record details. Server exports support CSV and JSONL. A server
export contains only data already uploaded; it cannot read more from HealthKit.

`GET /v1/export` on the product API returns a whole range of one dataset as a
**file** — CSV for a spreadsheet, JSONL for a notebook or a chat attachment —
instead of the JSON document the other endpoints return. It streams: the rows
go out as they are read, so an export of a busy type is bounded by the disk it
lands on rather than by the server's memory.

`tools/puls-export` is a small client for it. Everything below works equally
with `curl`. Install the [CLI](#the-puls-export-cli), then load your trusted
local `server/.env` from the repository root. Keep tokens out of chats:

```bash
set -a
. server/.env
set +a
export PULS_API_URL=http://127.0.0.1:8081
```

Run on the server or use a reachable HTTPS API URL. The examples below use
fixed illustrative dates; choose a range where you have synced data. CLI date
bounds use `$PULS_TIME_ZONE` (UTC if unset); set `--time-zone` to the account
reporting zone when it differs.

```bash
# a year of sleep, as a spreadsheet
puls-export --dataset sleep --start 2026-01-01 --end 2027-01-01 -o sleep.csv

# a week of raw heart rate, one JSON object per line
puls-export --dataset samples --type HKQuantityTypeIdentifierHeartRate \
  --format jsonl --start 2026-01-01 --end 2026-01-08 > heart-rate.jsonl

# the same thing with curl; -OJ takes the filename from the response
curl -fL -H "Authorization: Bearer $PULS_API_TOKEN" -OJ \
  "$PULS_API_URL/v1/export?format=csv&dataset=sleep&start=1767225600000&end=1798761600000"
```

## Parameters

| Parameter | Required | Meaning |
|---|---|---|
| `format` | yes | `csv` or `jsonl` |
| `dataset` | yes | one of the six below |
| `start`, `end` | yes | epoch milliseconds, `[start, end)` |
| `types` | `daily_metrics` only | comma-separated HealthKit identifiers |
| `type` | `samples` only | exactly one HealthKit identifier |
| `activityType` | `workouts` only | keep one activity type |
| `user` | no | the user to export, a UUID (see *Whose data* below) |

`limit` and `offset` do not apply: an export is bounded by its range, not by a
page size, and `workouts` returns the whole range rather than one page.

**Whose data.** Every export is one user's. Without `user` it is the server's
default (`PULS_USER_ID`), as every other endpoint. `user=<uuid>` asks for
someone else — `GET /v1/users` lists who exists — and the server allows that
only with `PULS_MULTI_USER=true`; otherwise it answers `403
{"error": "multi-user reads are disabled"}` rather than quietly exporting the
default user's data under another name. A value that is not a UUID is a
`400`. Neither refusal counts against the failed-authentication limit.

**Range caps.** `samples` keeps the **31 days** `/v1/samples` enforces — a
busy type runs to hundreds of thousands of rows a month. Every other dataset
is capped at **366 days**, like `/v1/sleep/daily` and `/v1/state-of-mind`.
That is stricter than `/v1/metrics/daily` and `/v1/workouts`, which page
instead (and `/v1/activity/summary`, one small row per day): a file is
bounded only by its range, so it needs a cap. The cap measures the instant span; the day-grained datasets also
reject a range that touches more than 366 local calendar days, with their own
message. Either way it is a `400` naming the limit, before the first byte of
the file, in the JSON endpoints' shape:
`{"error": "range must not exceed 31 days"}`.

**At most two exports run at once.** Each holds a database connection for the
length of the download, and the pool is small, so a third request is refused
immediately with a `503` and a `Retry-After` header rather than queued behind
them — waiting would tie up the connection the limit exists to protect.

## Datasets and their columns

The CSV header row and the JSONL object keys are the same list, in the same
order, so the two formats can never describe different rows. Field names are
the JSON endpoints' names; where an endpoint nests, the export flattens — the
identifying fields repeat on every row, and a nested field is named by its
path.

| `dataset` | From | Columns |
|---|---|---|
| `daily_metrics` | `/v1/metrics/daily` | `identifier`, `unit`, `date`, `value` |
| `samples` | `/v1/samples` | `type`, `unit`, `uuid`, `start`, `end`, `value`, `label`, `source` |
| `workouts` | `/v1/workouts` | `uuid`, `activityType`, `start`, `end`, `durationS`, `distanceM`, `energyKcal`, `hasRoute`, `availableMetrics` |
| `sleep` | `/v1/sleep/daily` | `date`, `start`, `end`, `inBedMinutes`, `asleepMinutes`, `stages.core`, `stages.deep`, `stages.rem`, `stages.unspecified`, `stages.awake`, `sources` |
| `activity` | `/v1/activity/summary` | `date`, `moveKcal`, `moveGoalKcal`, `exerciseMin`, `exerciseGoalMin`, `standHours`, `standGoalHours`, `moveMode`, `moveTimeMin`, `moveTimeGoalMin` |
| `state_of_mind` | `/v1/state-of-mind` | `uuid`, `date`, `timestamp`, `kind`, `valence`, `valenceClassification`, `labels`, `associations` |

Values follow the same rules as the JSON endpoints — epoch milliseconds for
instants, `YYYY-MM-DD` calendar days in the selected account's reporting
zone for raw-day grouping, preserved phone dates for rings and daily phone
aggregates, and canonical units — with two format-specific conventions:

- **A null is an empty CSV cell** and an explicit `null` in JSONL, never a
  zero and never a missing key. Every line of a dataset has the same shape.
- **A list** (`availableMetrics`, `labels`, `associations`) is comma-joined
  inside its quoted CSV cell and stays a JSON array in JSONL.

`samples` is *not* deduplicated across devices, exactly like `/v1/samples`: if
an iPhone and an Apple Watch recorded the same minutes, both rows are there.
Use `daily_metrics` for totals.

One thing to know before double-clicking a CSV: cells are written verbatim, so
a value that begins with `=`, `+`, `-` or `@` is a formula to a spreadsheet.
Text fields such as source names and labels may come from other apps. Import
the file as text — or use JSONL — if you do not trust every app that has ever
written to your Health store.

## How it streams

The response carries no `Content-Length`, so it is framed
`Transfer-Encoding: chunked` and the file starts arriving before the query has
finished. The first push happens before any row is read — it carries the CSV
header row, or for JSONL just the response head — and rows follow in flush
windows. Nothing is buffered to the length of the export, on either side:
`puls-export` copies the body straight through to the file.

A failure once the body is on the wire **aborts the connection** rather than
closing a short file cleanly, so a truncated export is always a visibly failed
download (`curl: (18) transfer closed`, `puls-export: the download stopped
early`) and never a file that quietly stops halfway. The same goes for the
export's own limits: it ends after **30 minutes**, a client that stops
reading for **a minute** is dropped, and a server shutdown past its grace
cuts it off. Everything that can be
rejected — an unknown `dataset` or `format`, a missing filter, an identifier
that has never been synced, a range over the cap — is checked *before* the
first byte, and comes back as the usual JSON `400`.

The response is an attachment named
`puls-<dataset>-<start>-<end>.<csv|jsonl>`.

## The `puls-export` CLI

Build from the same checkout as your server. From the repository root,
with Go 1.26 or newer:

```bash
mkdir -p "$HOME/.local/bin"
(cd tools/puls-export && go build -o "$HOME/.local/bin/puls-export" .)
export PATH="$HOME/.local/bin:$PATH"
puls-export --version
```

The subshell keeps your terminal at the repository root. Add that bin directory
to your shell's PATH for later sessions, or invoke the binary by its full path.

It is a thin client: it builds the query, sends the bearer token, and copies
the response through. Everything the server can reject is left to the server
and its message is printed verbatim, so the binary cannot drift out of step
with the endpoint.

| Flag | Default | |
|---|---|---|
| `--url` | `$PULS_API_URL`, else `http://127.0.0.1:8081` | product API base URL |
| `--token` | `$PULS_API_TOKEN` | bearer token, from `server/.env` |
| `--dataset` | — | required |
| `--format` | `csv` | `csv` or `jsonl` |
| `--start`, `--end` | — | `YYYY-MM-DD` or epoch milliseconds; the range is half-open |
| `--types`, `--type`, `--activity-type` | — | the per-dataset filters above |
| `--time-zone` | `$PULS_TIME_ZONE`, else UTC | the zone a `YYYY-MM-DD` bound is read in |
| `--user` | `$PULS_USER_ID`, else none | the user to export; none leaves it to the server's default |
| `-o` | standard output | write to this file |
| `--version` | | print the version and exit |

`--start 2026-01-01 --end 2026-02-01` is the whole of January. Exit status is
`0` on success, `2` for a mistake in the command line, `1` for a failed
download; the output file named by `-o` is created only once the server has
answered `200`, so a rejected request never truncates the previous export.
A `403` is explained the way a `401` is: the server only exports its
`PULS_USER_ID` unless it runs with `PULS_MULTI_USER=true`.

## On-device export (no server)

Open **Export** in the app to create files directly from HealthKit. No
server or account is required. Available history depends on your app access
and Health permissions; see [Free and Pro](https://pulshealth.com/pricing/).
Export uses isolated state and never advances your database sync.

**In the app it is the Export tab**, a builder. Pick the data types (raw
samples), the aggregated types — the same Aggregates picker and type pages as
Sync: each type starts with its daily total or average, and its page adds
hourly, weekly, monthly or per-device values — a time range (last 30 days,
90 days, a year, all time, or your own start and end date), CSV, JSON or JSONL,
a CSV layout, and whether to zip it. The draft starts from what Sync sends, as applied —
the same raw types, aggregates and workout route/stream switches. What you change in it is
this export's alone, never the sync's, and the sync start date in Settings
plays no part.

The app’s custom **End** picker is the **last included local day**. To export
all of September, select September 1 through September 30. The app converts
that last day into the start of the following day internally: October 1 at
local midnight. A selection reaching today exports through now.

When set, the manifest’s `endDate` and the engine’s boundary are **exclusive**, as are
server API `end` and CLI `--end` (so the CLI uses September 1 through October
1 for the same month). Records are selected by start time before the boundary;
activity-ring dates must precede its local day. Routes and streams follow the
selected workouts. An aggregate bucket crossing the boundary is omitted
rather than written as a partial value.

When it finishes, **Share or Save to Files** opens the iOS share sheet with
every file of the export, manifest included. With **Zip into one file** on,
it shares one `puls-export-<yyyyMMdd-HHmmss>.zip` holding a folder of that
name with the same files, unchanged. iOS's own archiver (`NSFileCoordinator`)
builds the zip after the files are written, so the manifest's byte counts are
the uncompressed sizes. The app deletes its staged copy once the share sheet
reports the files were handed over, when you tap Delete Export, when you
start another export, and at every launch — so save the files somewhere
before moving on.

Keep the app open and the phone unlocked while it runs: HealthKit cannot be
read on a locked phone, and an export that runs into a lock finishes
**incomplete** and says which types it could not read. Large histories can
contain millions of records; start with a short range before exporting years.

The app offers CSV, JSON and JSONL. The server API above still offers CSV
and JSONL. The detailed formats and CSV are not symmetrical:

**JSONL preserves full details and is directly replayable.** The file
(`puls-export-<yyyyMMdd-HHmmss>.jsonl`) is a concatenation of
[Puls Sync Protocol](protocol/README.md) batches exactly as they would have
gone over the wire, uncompressed: each batch's header line, then its sample,
deletion, route, series, aggregate and activity-summary lines. Nothing about it
is export-specific — it is the format `docs/protocol/schema/` specifies and the
fixture corpus tests — so every field of every kind is there, and a file can be
fed to a server later: split it before each header line (the only lines whose
top-level object has a `batchID`), gzip each piece if you like, and `POST` it to
`/v1/batches` with the bearer token and `X-User-ID`. Ingest is idempotent, so
replaying into a server that already holds some of it is safe. Three things to
know:

- The user is an HTTP header on the wire, not part of the body, so the JSONL
  does not say whose data it is. The manifest (below) does.
- There is no `{"profile":…}` line. The name, e-mail, date of birth and sex on
  that line are the app's settings rather than HealthKit data, and an export
  leaves them out of a file that is about to be shared.
- Deletion lines are kept. HealthKit can return the tombstones it still holds
  even to a first query, and a replay should apply them.

[`tools/protocol-check`](../tools/protocol-check) validates one batch per file,
so split an export the same way before checking it.

**JSON is one complete document with the same detailed data as JSONL.**
`puls-export-<yyyyMMdd-HHmmss>.json` is an array containing the exact JSONL
objects in the same order: batch header, records, next batch header, records.
It includes raw samples, aggregates, routes, streams, ECG traces, heartbeat
series, deletion tombstones and time-zone/source/metadata fields when available.
It omits the configured identity profile, like JSONL. The exporter writes it
incrementally and closes the array only after the data is written; failed or
cancelled exports are removed. The whole export is not buffered in memory.

For example, simplified record excerpts inside an array look like:

```json
[
  {"batchID": "11111111-1111-4111-8111-111111111111", "sampleCount": 1},
  {"type": "HKQuantityTypeIdentifierHeartRate", "kind": "quantity", "value": 62, "unit": "count/min"},
  {"batchID": "22222222-2222-4222-8222-222222222222", "aggregateCount": 1},
  {"aggregate": {"type": "HKQuantityTypeIdentifierStepCount", "func": "sum", "value": 8421, "unit": "count"}}
]
```

The actual objects contain the full protocol fields. For receiver replay,
iterate the array, write each object as one JSONL line, then split into batches
at header objects exactly as described above. JSON is not posted directly to
`/v1/batches`. Both detailed formats include a separate JSON manifest and can
be packaged into a ZIP. CSV layout and detail controls apply only to CSV.

**CSV is a flattened view**. Its default layout writes one file per dataset that has rows
(`puls-export-<yyyyMMdd-HHmmss>-<dataset>.csv`; a dataset with no rows gets no
file). In the default layout without optional detail columns, datasets shared
with the server use the same header row and order, epoch-millisecond instants, `YYYY-MM-DD` local
days, canonical units, a null as an empty cell, a list comma-joined inside its
quoted cell, lowercase UUIDs, floats without an exponent — and the same
spreadsheet-formula caveat, because cells are written verbatim here too.

| `dataset` | On the server too? | Columns |
|---|---|---|
| `samples` | yes | `type`, `unit`, `uuid`, `start`, `end`, `value`, `label`, `source` |
| `workouts` | yes | `uuid`, `activityType`, `start`, `end`, `durationS`, `distanceM`, `energyKcal`, `hasRoute`, `availableMetrics` |
| `activity` | yes | `date`, `moveKcal`, `moveGoalKcal`, `exerciseMin`, `exerciseGoalMin`, `standHours`, `standGoalHours`, `moveMode`, `moveTimeMin`, `moveTimeGoalMin` |
| `state_of_mind` | yes | `uuid`, `date`, `timestamp`, `kind`, `valence`, `valenceClassification`, `labels`, `associations` |
| `aggregates` | no — device only | `type`, `func`, `intervalValue`, `intervalUnit`, `deviceFilter`, `bucketStart`, `bucketEnd`, `value`, `unit` |
| `workout_routes` | no — device only | `workoutUUID`, `t`, `lat`, `lon`, `alt`, `hAcc`, `vAcc`, `speed`, `course` |
| `workout_series` | no — device only | `workoutUUID`, `type`, `unit`, `t`, `value` |
| `medication_doses` | no — device only | `uuid`, `start`, `end`, `medication`, `medicationID`, `status`, `scheduledAt`, `doseQuantity`, `doseUnit`, `source` |

### CSV layouts and optional details

The Export tab's **Layout** picker appears only for CSV:

| Layout | Files and rows |
|---|---|
| Separate datasets (default) | The dataset tables above; all selected quantity and category types share `samples.csv`. |
| One file per data type | One `…-type-<HealthKit identifier>.csv` per type, containing its raw samples, aggregates and workout stream points. A `dataset` column distinguishes records; inapplicable cells are empty. Workout route points share the workout file. Activity rings, mood and medication doses each have their own type file. |
| One combined table | One `…-records.csv`, with a `dataset` column followed by the union of CSV columns. Each source row remains one row; columns that do not apply are empty. This does not join, sum or deduplicate records. Use `dataset` and `type` when filtering; raw samples and aggregate values must not be added together. |
| Daily summary | One `…-daily-summary.csv` with `date,timeZone,bucketStart,bucketEnd`, then one column per aggregate series. Requires at least one aggregate, all at a 1-day interval. Selected raw data and other datasets still get their ordinary dataset files. |

Summary column names preserve the full series identity and unit, for example
`HKQuantityTypeIdentifierHeartRate|average|1|day|watch|count/min`.
Rows preserve exact bucket boundaries: series with different boundaries are not
merged just because they share a date label. Missing values are empty, zero is
`0`, and completed buckets are ordered by start time. The summary does not
compute new totals from raw samples. It pivots the same HealthKit aggregates.
A summary is bounded to one million series/bucket entries; a larger
selection is rejected with a suggestion to shorten the range or use dataset files.

**More options** is collapsed by default. Source and device details add
`sourceBundleID,sourceVersion,device` to samples, workouts, mood entries and
medication doses. Sample metadata adds a `metadata` column containing JSON
(`null` when absent), with normal CSV quoting. Basic sample and medication
source-name columns stay as before. These options do not change the JSONL
protocol or include identity profile fields.

**Split large tables** is off by default. Choose 100,000 or 1,000,000 data rows
per file. CSV files gain `-part-0001`, `-part-0002`, etc.; every part repeats its
header. Splitting counts complete records, including a cell with quoted
newlines as one record. It applies to every CSV layout, including summaries.
It does not split JSON or JSONL. ZIP remains independent of layout and splitting.

Illustrative CSV records (epoch milliseconds, UTC bucket):

```csv
type,unit,uuid,start,end,value,label,source
HKCategoryTypeIdentifierSleepAnalysis,,11111111-1111-4111-8111-111111111111,1767225600000,1767229200000,3,asleepCore,Apple Watch
```

```csv
type,func,intervalValue,intervalUnit,deviceFilter,bucketStart,bucketEnd,value,unit
HKQuantityTypeIdentifierStepCount,sum,1,day,all,1767225600000,1767312000000,8421,count
```

JSONL is a sequence of independent JSON objects, one per line, whereas a JSON
file is one complete JSON document (often an array). The on-device JSONL is
also framed as protocol batches, with headers between groups of records; it
is not a single JSON array. JSONL supports streaming without loading the whole
export. The manifest is an ordinary JSON document in either format.

The device-only files use the wire format's own keys, in wire order, one row
per bucket, GPS fix, stream datapoint or dose. How the two sides differ:

- **`samples` holds every selected quantity and category type in one file**,
  in the default layout, where the server exports one type per request.
  The app fills `label` with the bundled knowledge base's category enum name
  when known (for example `asleepCore`); unknown values leave it empty. The
  server obtains its labels from `category_labels`. A category sample's
  `value` is always HealthKit's raw integer on both sides.
- **`daily_metrics` and `sleep` do not exist on the device.** Both are views the
  server computes over what it has stored (per-day totals deduplicated across
  devices; nights assembled from sleep-stage samples). The device's counterpart
  to `daily_metrics` is `aggregates`, the statistics HealthKit itself computes
  for whatever aggregate series are configured; sleep stages are rows of
  `samples`.
- **On-device local days are the phone's.** `activity.date` and
  `state_of_mind.date` use the phone's time zone. The server preserves ring
  dates and recorded daily aggregate dates; raw records and mood entries are
  grouped in the account reporting zone. Travel can therefore produce different
  local-day labels between an on-device export and a server raw-data export.
- **What CSV leaves out.** Unless enabled under More options, metadata,
  device, source bundle and version. Per-sample time-zone context and a
  workout's statistics, events and sub-activities have no column. ECG voltage traces, beat-to-beat heartbeat
  series and deletion tombstones have no file at all; the result the package
  returns counts them so the app can say so and suggest JSON or JSONL.

All three formats come with `puls-export-<yyyyMMdd-HHmmss>-manifest.json`: the user
ID, the device ID, the requested range (`startDate`, `null` = all time;
`endDate`, `null` = now), the format, the protocol `schemaVersion` and the app
version, the time zone local days were computed in, the exported `types` and
`aggregates` (each series as `type|func|intervalValue|intervalUnit|deviceFilter`),
and per-file and per-dataset row counts. `csvOptions` records the CSV layout,
detail switches and split limit. Per-file `rows` counts actual data rows in that
file or part; per-type files also record their `type`. Dataset counts retain the original record/bucket counts (a summary
row can contain several aggregate buckets). `warnings` records extraction caveats
for ordinary exports as well as requests. `complete` describes extraction; check
`notRepresented` for CSV omissions and `warnings` for missing optional details,
even when extraction completed. Its main job is `"complete": false`
with a `failures` list whenever a selected type could not be read to the end
(for example, the phone locked part-way through) or a sample
could not be converted to its canonical unit. A file that stops short looks
exactly like the file of someone with less data; the manifest tells them
apart. HealthKit can return no records when read access is denied, so
`complete: true` does not prove that every expected record was accessible.

On iOS 27, Health access can be limited to recent history (the permission
sheet's "Past 30 Days and Future Data", or Limited Access under Settings →
Privacy & Security → Health). HealthKit then reads a type only from an
earliest date on, and `limitedHistory` maps each type whose date falls after
the export's start to that date (epoch milliseconds). The files hold nothing
of those types before it, so that export is incomplete too; choose Full
Access and export again to get the rest.

One caveat for replaying **aggregate** lines. Bucket boundaries are counted
from the start of the series, so an export aligns each series to the grid the
app's own sync uses, and a replay overwrites the server's buckets rather than
adding a second, offset set. That alignment is exact for day, week and month
buckets and for hour or minute intervals that divide a day evenly. It can be
off for intervals that do not (5 hours, 7 minutes) and for a month series that
starts on the 29th–31st; replay those with the aggregate lines filtered out and
let the phone's next sync recompute them.

## See also

- The [API reference](../server/api/openapi.json) and the
  [product API guide](api.md); on the running server, `GET /docs` and the
  machine-readable `/openapi.json`.
- [`docs/database-guide.md`](database-guide.md) — what the columns mean and
  which trap each dataset avoids.
- [`docs/ai.md`](ai.md) — the same data through an MCP client or a ChatGPT
  Action.

## One-time requests

The app can also generate a ZIP from a reviewed Data Request. These exports use
an isolated engine, fresh random user and device IDs, and no configured identity
profile. Their manifest additionally includes `dataRequest` and `submissionID`.
They can be handed to the share sheet or sent directly to an explicitly approved
HTTPS receiver. See [Data Requests](requests.md). Normal exports are unchanged.

### Medication names and previously exported rows

Medication exports resolve the HealthKit concept's display name from the
medications the person authorized, including archived medications. If a concept
cannot be resolved, `medication` is empty in CSV and null/omitted in JSON rather
than an object description containing a memory address. Names are labels, not
stable identifiers: two medications can share a name and a name can change.
The dose unit is HealthKit's unit; `count` supplies no tablet/spoon-to-mass
conversion. Do not infer milligrams or grams from it.

Older files containing `<HKHealthConceptIdentifier: 0x…>` can be replaced by a
fresh export after installing the corrected app, within its Health permissions
and export-history allowance. That address cannot recover medication identity.
Existing self-hosted raw rows are insert-only: resetting anchors and syncing
again does **not** update them. Preserve a backup and use a separately reviewed,
user-scoped repair keyed on exact event UUIDs and timestamps from a corrected
export using [the historical repair tool](../tools/repair-medications/README.md).
It defaults to a private reviewable plan and applies only that plan with explicit
opt-in and original-value checks; there is no automatic rewrite or deletion.

`medicationID` is a random UUID alias for the opaque concept, persisted within
this app installation and shared across sync and exports (including Data Requests).
It groups equal concepts independently of names. It survives ordinary sync resets
and receiver changes, but is not stable across devices, reinstalls or loss of the
local registry. Clinical coding/strength metadata and cross-device identity remain
outside this field's guarantee. Apple's public concept identifier has no exposed
raw string, and `count` alone cannot establish a mass conversion.
