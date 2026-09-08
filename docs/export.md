# Bulk export

`GET /v1/export` on the product API returns a whole range of one dataset as a
**file** — CSV for a spreadsheet, JSONL for a notebook or a chat attachment —
instead of the JSON document the other endpoints return. It streams: the rows
go out as they are read, so an export of a busy type is bounded by the disk it
lands on rather than by the server's memory.

`tools/puls-export` is a small client for it. Everything below works equally
with `curl`.

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

`limit` and `offset` do not apply: an export is bounded by its range, not by a
page size, and `workouts` returns the whole range rather than one page.

**Range caps** match the endpoint each dataset comes from: **31 days** for
`samples` (a busy type runs to hundreds of thousands of rows a month),
**366 days** for everything else. Over the cap is a `400` naming the limit,
the same shape the JSON endpoints use:
`{"error": "range must not exceed 31 days"}`.

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
instants, `YYYY-MM-DD` local calendar days (in the server's `PULS_TIME_ZONE`)
for days, canonical units — with two format-specific conventions:

- **A null is an empty CSV cell** and an explicit `null` in JSONL, never a
  zero and never a missing key. Every line of a dataset has the same shape.
- **A list** (`availableMetrics`, `labels`, `associations`) is comma-joined
  inside its quoted CSV cell and stays a JSON array in JSONL.

`samples` is *not* deduplicated across devices, exactly like `/v1/samples`: if
an iPhone and an Apple Watch recorded the same minutes, both rows are there.
Use `daily_metrics` for totals.

## How it streams

The response carries no `Content-Length`, so it is framed
`Transfer-Encoding: chunked` and the file starts arriving before the query has
finished. The header row is pushed on its own and rows follow in flush
windows. Nothing is buffered to the length of the export, on either side:
`puls-export` copies the body straight through to the file.

A failure once the body is on the wire **aborts the connection** rather than
closing a short file cleanly, so a truncated export is always a visibly failed
download (`curl: (18) transfer closed`, `puls-export: the download stopped
early`) and never a file that quietly stops halfway. Everything that can be
rejected — an unknown `dataset` or `format`, a missing filter, an identifier
that has never been synced, a range over the cap — is checked *before* the
first byte, and comes back as the usual JSON `400`.

The response is an attachment named
`puls-<dataset>-<start>-<end>.<csv|jsonl>`.

## The `puls-export` CLI

```bash
go install github.com/PulsHealth/pulshealth/tools/puls-export@latest
# or, from a checkout
go build -o puls-export ./tools/puls-export
```

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
| `-o` | standard output | write to this file |

`--start 2026-01-01 --end 2026-02-01` is the whole of January. Exit status is
`0` on success, `2` for a mistake in the command line, `1` for a failed
download; the output file named by `-o` is created only once the server has
answered `200`, so a rejected request never truncates the previous export.

## See also

- The endpoint reference on the running server: `GET /docs`, and the
  machine-readable [`/openapi.json`](../server/api/docs.go).
- [`docs/database-guide.md`](database-guide.md) — what the columns mean and
  which trap each dataset avoids.
- [`docs/ai.md`](ai.md) — the same data through an MCP client or a ChatGPT
  Action.
