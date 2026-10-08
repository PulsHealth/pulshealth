# Reproducing the blog figures

These figures describe one consenting person's stored HealthKit records. They
are teaching examples, not population estimates or clinical reference ranges.
Only the selected aggregate charts are published. Private input JSON, source
identifiers, SQL execution logs, and credentials must stay outside this repository.

## Extract summaries

Use a read-only database connection to a PulsHealth schema. Independently verify
that the selected user is the person who authorized the analysis. The SQL scopes
every fact table to that user, sets the local time zone, runs inside a read-only
transaction, and limits statements to 25 seconds. Both date bounds are required.
The start is inclusive and the end is exclusive.

```sh
psql "$DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 \
  -v owner_id="$PULS_USER_ID" \
  -v time_zone='America/Los_Angeles' \
  -v start_date='2026-09-01' -v end_date='2026-10-01' \
  -v vo2_start_date='2026-06-01' \
  -f blog/analysis/extract.sql > "$PRIVATE_ANALYSIS_DIR/analysis.json"
```

`DATABASE_URL`, `PULS_USER_ID`, and `PRIVATE_ANALYSIS_DIR` are supplied locally;
none is committed. The JSON contains derived source-level totals and is still
private. The included renderer is tailored to the stated 2026 analysis periods;
if rerunning for another period, update figure labels, captions, and assertions
alongside the query parameters.

## Render

Dependencies: Python 3, matplotlib, Pillow. The original rendering used
matplotlib 3.10.3. All outputs are WebP, 1600 pixels wide.

```sh
python3 blog/analysis/render_figures.py "$PRIVATE_ANALYSIS_DIR/analysis.json"
```

Inspect each generated figure before publishing. Source revision identities
are used only to construct intermediate grouped totals and never appear in
charts. Existing output files with the same names will be replaced.

## Methods and limits

All calendar dates below use America/Los_Angeles. Reads were performed on
October 8, 2026. These are snapshots of the stored database, not a guarantee of
complete HealthKit history or comparisons with the Health app's screen.

- **HRV:** September 1 through September 30, selected by sample start. 402 SDNN
  samples on 30 dates, 11–15 samples per day, median daily count 14. The chart
  plots each day's sample median and sample count; daily medians range from
  40.78 to 78.17 milliseconds. The sampling is intermittent and may be affected
  by recording conditions. Time-of-day counts were explored but are not used
  to claim a physiological circadian pattern.
- **Sleep:** Same start-time window. 886 intervals: Core 404, REM 160, Deep
  117, Awake 205. The count chart intentionally does not convert record counts
  into sleep duration. Three source-revision records contributed; this does
  not imply three devices. A chronological check found seven intervals whose
  starts preceded the preceding interval's end. That check detects some
  overlap, not a full interval-union or sleep deduplication algorithm. No
  deduplicated nightly duration or sleep-stage percentage is asserted. The
  start-time selection can include intervals ending after the date boundary.
- **Cardio fitness:** June 1 through September 30, selected by sample start.
  36 VO₂ max samples on 35 dates: June 8, July 8, August 9, September 11. The
  figure counts samples, not workouts. Missing estimates do not imply zero
  fitness; daily averages were explored but not used as clinical categories.
- **Steps:** September 1 through September 30. Sum raw quantity values by
  sample start date across all source revisions, compared with `metric_daily`.
  All 30 daily rows have `source = 'aggregate'`, so this example uses canonical
  all-device HealthKit daily sum buckets, not the rollup fallback. Raw sum:
  413,146; daily aggregate sum: 230,642.0004878909 (displayed as 230,642). Source
  overlap and interval allocation are possible differences, and no attempt
  was made to attribute all of the excess to duplicates. Fractional step
  aggregates are retained until display rounding. Six source-revision IDs
  contributed raw records; they are not six distinct devices.

The source tables and daily-view resolution order are documented in
[`docs/database-guide.md`](../../docs/database-guide.md). Charts are descriptive
of this selected individual and period; they must not be used to infer causes,
diagnoses, accuracy against clinical equipment, or typical population values.
