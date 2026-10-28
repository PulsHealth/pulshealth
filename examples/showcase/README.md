# Make something with your Apple Health history

Five interactive projects at [pulshealth.com/inspiration](https://pulshealth.com/inspiration/):

- **Your health year in review:** monthly workout distances by activity, workout count and recorded time.
- **The road to race day:** 16 calendar weeks of running, with total distance and longest run. The selected race workout stays separate.
- **Activity as art:** individually fitted route tiles or a shared geographic composition, with SVG download.
- **Your activity atlas:** walks, runs and rides in shared bounds, filtered by activity.

The examples use recorded history with permission. They contain no names,
account identities, geographic labels, source UUIDs, or exact dates for the
training block. Training weeks and runs are relative to the event. Route shapes
are normalized into drawing coordinates; recognizable shapes can still reveal
places. The display fixture is generated from privately retained input files.

The year report combines workouts with daily steps, main sleep, exercise minutes,
resting heart rate and HRV. It offers post, square and story PNG exports. Route
art adds collection, layered and orbit compositions; the atlas supports activity
and month filters, pan, zoom and route inspection. The marathon view supports
weekly drill-down, run-day calendars, unit switching and a training poster.

## Use your own files

Python 3.9+ with IANA time-zone data is required; no packages to install.

1. From the app, export **workouts as CSV**, with the default separate-datasets
   layout. For route art/atlas, also enable workout routes to get the separate
   **workout_routes CSV**. Alternatively, export workouts as **JSONL** using the
   [server export CLI](../../docs/export.md). The adapter accepts either format
   by file extension. App JSON/NDJSON contains protocol objects and is not
   accepted here; neither is Apple's XML.
2. Convert the files locally. Pick your reporting calendar and year. Race date
   affects only the marathon view. Use `--race-id` to identify the exact race
   workout; date alone does not exclude other runs that day.

   ```bash
   python3 examples/showcase/prepare.py /private/path/workouts.csv \
     --routes /private/path/workout_routes.csv \
     --time-zone Europe/London --year 2025 --race-date 2025-10-19 \
     --race-id YOUR_RACE_WORKOUT_UUID \
     --output /private/path/showcase.json
   ```

   Omit `--routes` for the year or marathon views. Omit `--race-id` when no race
   workout is selected; the demo then explicitly says the race is not excluded.
   The adapter refuses to overwrite an existing output file.
3. On an example page, choose **Open your JSON**. Processing stays in memory
   in that browser. No file upload, browser storage, basemap, or AI call is used.
   Reload or choose **Reset example** to discard the loaded data.

For a whole calendar year you need that history available in your export.
Files are limited to 10 MB, 5,000 workouts and 200,000 route points. Artwork
shows 12, 24, or 48 matching routes in collection mode; layers and orbit use
up to 185. The atlas uses up to 500 available route shapes. Use a smaller export window for large histories. Exports can
contain overlapping recordings from different apps; resolve those before
interpreting totals. Duplicate UUIDs are rejected rather than silently counted.

## Routes from your own database

GPS route points are stored in the database but are not exposed by the current
public product API or MCP tools. `hasRoute` in a workout export is a flag,
not the coordinates. For a self-hosted database, use the included read-only
query through your existing local connection or private tunnel:

```bash
psql "$READ_ONLY_DATABASE_URL" -X -q -A -t \
  -v user_id="$PULS_USER_ID" \
  -v start_ts='2025-01-01T00:00:00Z' \
  -v end_ts='2026-01-01T00:00:00Z' \
  -f examples/showcase/routes.sql > /private/path/workout_routes.jsonl
```

Load connection settings locally; keep credentials out of prompts and Git.
Use explicit timestamp bounds matching your selected reporting calendar. The
query also clips route points to those bounds, so an activity crossing a bound
can have a partial route. No elevated database access is required or created.
See the [database guide](../../docs/database-guide.md).

## Add the full health year

Export `daily_metrics` for StepCount, ActiveEnergyBurned, RestingHeartRate and
HeartRateVariabilitySDNN, plus the server `sleep` and `activity` datasets. Pass
those CSV/JSONL files to `prepare.py` as `--daily-metrics`, `--sleep` and
`--activity`. They are optional; unsupported sections are omitted from the full
report. `daily_metrics` values are already deduplicated daily surfaces, while
sleep sessions use the database's source-selection rules.

PNG export renders the current SVG into a local browser canvas at 1080 pixels
wide. Sharing uses the browser's file-sharing API where supported and otherwise
downloads the image. No image or health file is uploaded by the example.

## File format

The adapter emits one JSON object:

```json
{
  "year": 2025,
  "raceDate": "2025-10-19",
  "raceId": "race-workout-id",
  "workouts": [
    {"id": "race-workout-id", "date": "2025-10-19", "activity": "Running", "distanceM": 42195, "durationS": 14520,
     "route": [{"lat": 0.01, "lon": 0.01}, {"lat": 0.02, "lon": 0.02}]}
  ]
}
```

`raceId` and each `route` are optional. `distanceM: null` means unknown;
it is counted as missing, not an observed zero. Durations are the stored
workout durations, not finish minus start. Activities are Running, Walking,
Cycling, or Other. Dates are assigned from epoch-millisecond start timestamps
in the zone passed to the adapter. The demo uses these calendar dates without
converting them again. Marathon weeks start Monday and include the race date;
workouts after that day are omitted. No-record weeks are not proof of rest.

Optional `--daily-metrics`, `--sleep`, and `--activity` files enrich the year
report. Daily metrics must come from the server's daily summary export; the
phone's raw quantity samples must not be summed across devices. Sleep files use
the server's derived sleep dataset; the adapter keeps the longest recorded
session per wake-up day, without adding overlapping devices or naps. Missing
observations remain null. The display report uses ordinal days within the year;
training uses relative weeks and weekdays. The marathon view describes recorded training and does not
prescribe mileage or infer injury, recovery, or the reason for a gap.

## How the route examples work

The compositor adapts the earlier route-art experiment's two approaches:
independently fitting each route into a tile, or fitting all routes into one
shared set of bounds. The shared projection scales longitude by cosine of
mid-latitude, keeps north up, and preserves aspect ratio for local-area tracks.
Collection tiles intentionally normalize scale: equal-looking tiles do not mean
equal distances. This simple projection is intended for local routes; tracks
crossing the date line or covering polar/global areas need preprocessing.

Only the rendering approach is carried forward. No private connection settings,
route records, or data-bearing artifacts from that experiment are included.
Even normalized route artwork can disclose familiar places. Inspect before
sharing or publishing an SVG.

## Run and change the examples

```bash
cd site
bun install --frozen-lockfile
bun run dev
```

Open `/inspiration/`. Rendering and browser interactions live in
`site/src/components/examples/`; sample generation, validation, training
aggregation and projection live in `site/src/lib/example-data.ts`.

```bash
python3 -m unittest discover -s examples/showcase -p 'test_*.py'
cd site && bun test tests/examples.test.ts
```

## Prepare recorded display data

With an owner-authorized private showcase JSON already prepared, run:

```bash
bun examples/showcase/record.ts /private/path/showcase.json /private/path/display.json
```

The builder requires an explicit `raceId` and `timeZone` in its input so the
published race exclusion and calendar remain verifiable. It computes annual/monthly workout summaries and the 16-week race
window, then chooses the largest local route area and emits normalized path
geometry. Check the year, reporting calendar, route coverage, and race exclusion
against the private source before placing reviewed display data into the site.
Never put the input health export in the repository. Existing output files are
preserved. Update these recorded-example counts when replacing the fixture.

Race workout records can include optional `metrics`: `heartRate` (bpm), `powerW` (W), `steps`, `activeKcal`, `strideM` (m), `groundContactMs` (ms), and `verticalCm` (cm). Supply only measured values. The display defaults to miles, feet and inches; the training view can switch to metric. Raw source units remain canonical.

Deep workout analysis matches geographically similar running routes in the selected year: at least 1 km, eight GPS points, recorded distances within 8%, endpoints within 150 m, ordered route anchors within 400 m, and 95% of sampled points within 75 m of the other track in both directions. Each match is compared with the original reference route. Matching uses up to 96 points per route, at most 500 candidate runs and 20 repeated-route groups. The output includes normalized overlays and measured duration, distance, heart rate and power where present. These are approximate route matches, not controlled fitness comparisons.
