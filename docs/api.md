# Product API

The product API is the read-only HTTP interface to everything a PulsHealth
server holds: daily metrics, Activity rings, workouts and their per-second
streams, sleep, raw samples, State of Mind, a chat-ready summary and bulk
export. It is how your own scripts, dashboards, notebooks and AI assistants
read your health data, and it is the API the
[MCP server](../server/mcp/README.md) and the
[`puls-export` CLI](export.md#the-puls-export-cli) are built on.

This page covers what is common to every endpoint. The
[API reference](../server/api/openapi.json) documents each endpoint's
parameters, responses and fields. It is rendered from the same OpenAPI 3.1
document the service serves at `GET /openapi.json`, so it never describes a
different API from the one you are running.

| At a glance | |
|---|---|
| **Base URL** | `http://127.0.0.1:8081` on the server; your HTTPS proxy's URL from anywhere else |
| **Authentication** | `Authorization: Bearer <PULS_API_TOKEN>` |
| **Format** | JSON (UTF-8); `/v1/export` streams CSV or JSONL |
| **Methods** | `GET` only. Nothing in this API writes |
| **Timestamps** | Epoch milliseconds, UTC |
| **Spec** | [`openapi.json`](https://pulshealth.com/openapi.json) (OpenAPI 3.1) |

## Quickstart

The API is one of the services `docker compose up -d` starts (see
[Server setup](../server/README.md)). `scripts/bootstrap.sh` generates its
token and writes it to `server/.env` as `PULS_API_TOKEN`.

**1. Check that it is up.** `/healthz` needs no token:

```bash
curl -s http://127.0.0.1:8081/healthz
# {"db":true,"ok":true}
```

**2. Make an authenticated call.** List the data types the server holds:

```bash
export PULS_API_BASE_URL=http://127.0.0.1:8081
export PULS_API_TOKEN=...   # from server/.env

curl -s -H "Authorization: Bearer $PULS_API_TOKEN" \
  "$PULS_API_BASE_URL/v1/catalog/types"
```

```json
{
  "types": [
    {
      "identifier": "HKQuantityTypeIdentifierStepCount",
      "kind": "quantity",
      "unit": "count",
      "rows": 184211,
      "rawRows": 171032,
      "aggregateRows": 13179,
      "earliest": 1514764800000,
      "latest": 1759449600000
    }
  ]
}
```

**3. Ask a real question.** Here are daily step totals for January 2026:

```bash
curl -s -H "Authorization: Bearer $PULS_API_TOKEN" \
  "$PULS_API_BASE_URL/v1/metrics/daily?types=HKQuantityTypeIdentifierStepCount&start=1767225600000&end=1769904000000"
```

```json
{
  "metrics": [
    {
      "identifier": "HKQuantityTypeIdentifierStepCount",
      "unit": "count",
      "days": [
        { "date": "2026-01-01", "value": 8412 },
        { "date": "2026-01-02", "value": 11930 }
      ]
    }
  ],
  "nextOffset": 31
}
```

## Reaching the API

The service listens on **loopback only** (`127.0.0.1:8081`). That is
deliberate: it serves every health record in the database, and its token is
not a substitute for TLS. To call it from another machine, put an
authenticating HTTPS proxy in front of it. Tailscale is the shortest route:

```bash
tailscale serve --bg --https=8444 http://localhost:8081
# then: https://<machine>.<tailnet>.ts.net:8444
```

Any TLS-terminating proxy works (Caddy, nginx, a Cloudflare Tunnel).
[Exposing the server](../server/README.md#exposing-the-server) covers the
options. When the proxy is the only thing that can reach port 8081, set
`TRUST_PROXY_HEADERS=true`. The failed-login limit then counts each real
client address (the **last** `X-Forwarded-For` entry, the one the proxy
appended, since a client can write whatever it likes in front of it), and
`/openapi.json` names the proxy's host (`X-Forwarded-Host`) as its server URL.
Without that setting, both use what the service sees itself.

## Authentication

Every `/v1` endpoint needs the API token as a bearer credential:

```http
Authorization: Bearer <PULS_API_TOKEN>
```

`PULS_API_TOKEN` is a single static secret set in `server/.env`. It is
**not** the phone's ingest token. Ingest tokens can only upload, and this
token can only read. `/`, `/docs`, `/openapi.json` and `/healthz` answer
without it.

A wrong or missing token gets `401` with `WWW-Authenticate: Bearer`.
Successful requests are never throttled. Failed ones are (see
[Rate limits](#rate-limits-and-timeouts)). Every authenticated response
carries `Cache-Control: no-store`.

The service refuses to start while `PULS_API_TOKEN` is still the
`change-me` placeholder from `.env.example`.

To rotate the token, set a new value in `server/.env` and run
`docker compose up -d api mcp`, then update your clients.
[Rotating secrets](../server/README.md#rotating-secrets) has the details.

## Choosing the user

A server can hold several people's data. Every `/v1` request is answered for
exactly one user:

- With no `user` parameter, the answer is for the deployment's default user
  (`PULS_USER_ID`, the seeded default when unset).
- `user=<uuid>` on any `/v1` route selects someone else. This works only
  when the server runs with `PULS_MULTI_USER=true`. Otherwise, naming any
  other user is a `403 {"error":"multi-user reads are disabled"}`, never a
  quiet answer for the default user.
- `GET /v1/users` lists the users this deployment answers for (only the
  default user while multi-user reads are off), with their last sync time
  and upload counts. It also reports `timeZone`, the server's
  `PULS_TIME_ZONE` (see [Conventions](#conventions)).

```bash
curl -s -H "Authorization: Bearer $PULS_API_TOKEN" "$PULS_API_BASE_URL/v1/users"
curl -s -H "Authorization: Bearer $PULS_API_TOKEN" \
  "$PULS_API_BASE_URL/v1/profile?user=<uuid>"
```

Turning `PULS_MULTI_USER` on widens what the one token reads from one person
to everyone on the server. An id the server has never seen reads as a user
with no data.

## Conventions

- **Timestamps** are epoch milliseconds (UTC) everywhere: in parameters and
  in responses. Accepted values run from `0` to `253402300799999`
  (9999-12-31). Anything else is a `400`.
- **Ranges** are half-open, `[start, end)`, and `end` must be after `start`.
  Raw-record endpoints filter on each record's start time.
- **Calendar days** follow the server's `PULS_TIME_ZONE`, which must match
  the phone's zone. A day-grained endpoint (`/v1/metrics/daily`,
  `/v1/activity/summary`, `/v1/sleep/daily`, `/v1/state-of-mind`) returns
  every local day that `[start, end)` touches, so a range that grazes one
  minute of a day returns that whole day. `date` fields are `YYYY-MM-DD`.
  `GET /v1/users` reports the zone as `timeZone` (`UTC` when unset), and the
  service refuses to start when `PULS_TIME_ZONE` disagrees with the zone
  stored in the database.
- **Units** are canonical per type and never the device's own: `count/min`
  for heart rate, `kcal` for energy, `m` for distance, `%` as a fraction
  (blood oxygen `0.97`). Each answer names its `unit`. The full table is the
  [type catalog](protocol/catalog.json).
- **Identifiers** are HealthKit's, e.g. `HKQuantityTypeIdentifierStepCount`.
  `GET /v1/catalog/types` lists the ones that hold data. A `types` list names
  at most 50 of them; more is a `400`.
- **Absent values** are `null`. An empty result is an empty array, never a
  `404`. Only a missing workout or profile is a `404`.
- **Deduplication.** An iPhone and an Apple Watch often record the same
  minutes. The daily surfaces (`/v1/metrics/daily`, `/v1/summary`, sleep) are
  already deduplicated. `/v1/samples` returns raw records as synced, so
  **summing raw samples double counts**.
- **Daily metrics come from the phone's aggregates.** A type appears in
  `/v1/metrics/daily` only if the app syncs an aggregate for it. In the
  catalog, those types have non-zero `aggregateRows`.

## Pagination

The list endpoints page with `limit` and `offset` and return `nextOffset`.
To read every page, pass `nextOffset` back as `offset` until a page comes back
shorter than `limit`. A `limit` over the cap is clamped, not rejected.

| Endpoint | Unit of `limit` | Default | Maximum | Range cap |
|---|---|---|---|---|
| `/v1/metrics/daily` | day rows across all requested types | 10,000 | 50,000 | none |
| `/v1/workouts` | workouts | 50 | 200 | none |
| `/v1/samples` | samples | 1,000 | 5,000 | 31 days |

The other range endpoints answer in one document: `/v1/sleep/daily` and
`/v1/state-of-mind` take at most 366 days per request, and
`/v1/activity/summary` has no cap. `/v1/workouts/{uuid}/series` caps points
per stream with `maxPoints` (default 500, at most 5,000).

```python
import os, requests

base, token = os.environ["PULS_API_BASE_URL"], os.environ["PULS_API_TOKEN"]
params = {
    "type": "HKQuantityTypeIdentifierHeartRate",
    "start": 1767225600000, "end": 1769904000000,
    "limit": 5000, "offset": 0,
}
samples = []
while True:
    page = requests.get(f"{base}/v1/samples", params=params,
                        headers={"Authorization": f"Bearer {token}"}, timeout=60).json()
    samples += page["samples"]
    if len(page["samples"]) < params["limit"]:
        break
    params["offset"] = page["nextOffset"]
```

For a whole range in one request, use `/v1/export` instead. It streams
the rows as a file and needs no paging. [Bulk export](export.md) covers it.

## Errors

Every error from a JSON route is a JSON object with one field:

```json
{ "error": "range must not exceed 31 days" }
```

The message is for people and logs. Branch on the status code:

| Status | Meaning |
|---|---|
| `400` | A parameter is missing, malformed or out of range (more than 50 `types`, say), or a type has never been synced. The message names the problem. |
| `401` | The bearer token is missing or wrong. |
| `403` | `user` names someone else while multi-user reads are off. |
| `404` | The workout or profile does not exist for this user. |
| `429` | Too many failed authentications from your address. Wait `Retry-After` seconds. |
| `500` | The query failed. The cause is logged on the server, never returned. |
| `503` | `/v1/export`: two exports are already running (`Retry-After: 60`). `/healthz`: the database is not answering. |
| `504` | The query ran past its 30 seconds. Narrow the range or page smaller. Not on `/v1/export`. |

A failure partway through a `/v1/export` download aborts the connection
instead of ending the file cleanly, and so do its own limits (30 minutes, or
a client that stops reading for a minute) and a server shutdown past its
15-second grace. A cut-off file always shows up as a failed download.

## Rate limits and timeouts

- **Failed authentications are throttled per client address**: a burst of 10,
  refilling at 10 per minute. When the bucket is empty, the request is refused
  with `429` and `Retry-After` *before* the token is checked, so a guesser
  learns nothing. Successful requests never draw from the bucket, so a client
  polling with the right token is never slowed down.
- **Each request has 30 seconds of database time.** Past that it is a `504`.
  Narrow the range or page smaller. `/v1/export` is exempt: it streams for as
  long as the download takes, up to its own limits below.
- **At most two exports run at once.** Each holds a database connection for
  the length of its download. An export ends after **30 minutes**, and one
  whose client stops reading for **a minute** is dropped.
- **A `types` list names at most 50 identifiers.** Each one is its own scan.
- `/v1/catalog/types` is cached per user for five minutes. After that the
  cached answer is still served (for up to an hour) while one background
  refresh replaces it, so new uploads can take a little longer than five
  minutes to appear in it.

## Endpoints

| Endpoint | What it returns |
|---|---|
| [`GET /v1/users`](../server/api/openapi.json#listUsers) | The users this deployment answers for |
| [`GET /v1/profile`](../server/api/openapi.json#getProfile) | Name, e-mail, date of birth, biological sex |
| [`GET /v1/catalog/types`](../server/api/openapi.json#listCatalogTypes) | Every type with data: kind, unit, row counts, time span |
| [`GET /v1/metrics/latest`](../server/api/openapi.json#getLatestMetrics) | The newest reading of each requested type |
| [`GET /v1/metrics/daily`](../server/api/openapi.json#getDailyMetrics) | One deduplicated value per day per type |
| [`GET /v1/activity/summary`](../server/api/openapi.json#getActivitySummary) | Activity rings by day |
| [`GET /v1/workouts`](../server/api/openapi.json#listWorkouts) | Workout summaries, newest first |
| [`GET /v1/workouts/{uuid}`](../server/api/openapi.json#getWorkout) | One workout with statistics, events and activities |
| [`GET /v1/workouts/{uuid}/series`](../server/api/openapi.json#getWorkoutSeries) | Heart rate, power, speed, cadence streams, downsampled |
| [`GET /v1/sleep/daily`](../server/api/openapi.json#getSleepNights) | One row per sleep session with stage minutes |
| [`GET /v1/samples`](../server/api/openapi.json#getSamples) | Raw records of one type |
| [`GET /v1/state-of-mind`](../server/api/openapi.json#getStateOfMind) | Emotions and moods with valence and labels |
| [`GET /v1/summary`](../server/api/openapi.json#getSummary) | The last 7 to 90 days as a short markdown page or JSON |
| [`GET /v1/export`](../server/api/openapi.json#exportDataset) | A whole range as a CSV or JSONL file |

## Client libraries

There is no SDK to install: the OpenAPI document is the contract, and any
generator turns it into a typed client. Generate from your own deployment's
`/openapi.json`, which names your server as the base URL:

```bash
# TypeScript types
npx openapi-typescript https://<your-api-host>/openapi.json -o puls-api.d.ts
# A Python client
openapi-python-client generate --url https://<your-api-host>/openapi.json
```

Every operation has a stable `operationId` (`getDailyMetrics`,
`listWorkouts`, `exportDataset` and so on), which generators use as the
method name. The same document turns the API into a ChatGPT Action, and
[Use it with AI](ai.md) walks through that and through the MCP server for
Claude, Cursor and other MCP clients.

## Versioning

Every data route is under `/v1`, and changes within `v1` are additive: new
endpoints, new optional parameters and new response fields. Write clients to
ignore fields they do not know. Removing or renaming a field, or changing a
type, unit or limit, is a breaking change and would need a new version
prefix. The API ships in the `api` image, versioned with the rest of the
server stack (`PULS_VERSION`), and its changes are listed in the
[changelog](../CHANGELOG.md).

## Security

- The API is **read-only** and connects to Postgres as `api_reader`, a role
  with `SELECT` on an exact list of tables and nothing else. It cannot read
  ingest tokens or web-viewer accounts.
- Anyone holding `PULS_API_TOKEN` can read every record the deployment
  serves, including the name, e-mail and date of birth in `/v1/profile`.
  Treat it like a password, keep the API behind TLS, and rotate the token
  after handing it to a third party.
- Report vulnerabilities privately, as described in the
  [security policy](../SECURITY.md).
