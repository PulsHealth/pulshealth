# HealthKit research notebooks

Reusable analysis code for knowledge-base articles. The source tree contains
methods, not personal observations. Keep CSV snapshots, notebooks with outputs,
JSON reports, and diagnostic figures outside the tracked tree in private Git
metadata or another private research directory. Public figures require a separate
editorial review and should expose only the data needed to explain the metric.

Install `requirements.txt` in a virtual environment, then run from this directory:

```sh
python run.py --input /private/snapshot/input --output /private/research/heart-rate --identifier HKQuantityTypeIdentifierHeartRate
```

The runner writes a strict JSON report and executes a rerunnable notebook with
persisted results. Run `python archive.py --root /private/research --execute` after all type studies
finish. It preserves the exact code beside the notebooks, redirects regenerated
figures to private storage, reruns the notebooks, writes integrity receipts and
creates a private `index.html` with readable HTML versions. This keeps evidence
rerunnable after a temporary task checkout is removed. Input CSV hashes provide provenance; never replace snapshots in place.
Type-specific scripts build on `load_data`, `annotate_context`, `describe`,
`cadence`, and `standard_analysis`. Persist their own methods, relationship
checks, diagnostics, conclusions, unsupported questions, and limitations before
rewriting the entry.

`standard_analysis` accepts explicit timezone, year_start/year_end and
focus_start/focus_end keyword arguments with timezone-aware bounds for future
snapshots. `annotate_context` accepts an explicit timezone too. Defaults match
the initial study window; never reuse those defaults silently for another year.
Coverage bounds must be midnight in the configured reporting calendar; partial
local days are rejected rather than producing an invalid day denominator.

## Standard facets

- Coverage: calendar-day denominator, observed days, records per observed day,
  missingness, year and July–September windows, monthly source changes.
- Values: units, finite/missing values, zero and negative counts, min/max,
  mean, standard deviation, p1/p5/p25/p50/p75/p95/p99.
- Outliers: descriptive 1.5 IQR flags within each source/context; retained in all
  analyses. Small groups and constant-valued groups need individual review.
- Timing: interval duration, positive start-to-start gaps, simultaneous starts,
  end-to-next gaps, overlapping intervals, and local-hour density.
- Provenance: source revisions retained and grouped by bundle plus source name;
  neither source revision nor that grouping proves persistent device identity.
- Context: time overlap with workouts and asleep sleep categories 1/3/4/5,
  overlapping both, and other/unknown; comparisons imply no causal link.
- Type-specific follow-up: sampling selection, cumulative versus discrete
  semantics, overlapping device streams, stage durations, derived metrics,
  exercise subtype, relevant paired metrics and confounding.

The standard report explicitly marks completed facets and requires a separate
cross-type relationship analysis. Absence of raw quantity data is unsupported,
not zero. Sleep category research uses its own interval and episode analysis.
Results from one person are examples, never clinical reference intervals.

## Snapshot contract

`quantity.csv`: uuid, identifier, unit, start_ts, end_ts, value, source_id,
metadata, source_name, bundle_id, source_version, start_timezone.
`sleep.csv`: category records with start_ts, end_ts and HealthKit numeric value.
`mindful.csv`: optional mindful-session category records with the same intervals.
`workouts.csv`: start_ts, end_ts, activity_type and optional duration_s,
distance_m, energy_kcal, stats_detail, events.
`aggregates.csv`: identifier, series_id, agg_func, interval_value, interval_unit,
device_filter, unit, bucket_start, bucket_end, value.
`workout_series.csv`: workout_uuid, identifier, unit, ts, value.

Timestamps accept PostgreSQL ISO timestamps or epoch milliseconds. All CSVs
must already be scoped to exactly one participant by the authorized extractor.
The fixed analysis calendar is America/Los_Angeles; travel-local recorded days
may differ. Windows are start-inclusive and end-exclusive. For raw quantity
facets, a record belongs to a window by start timestamp. Sleep episodes require
clipping across boundaries in their type-specific analysis.

## Pilot runners

`heart_rate.py`, `hrv_sdnn.py`, `sleep_analysis.py`, `step_count.py` and
`running_vertical_oscillation.py` accept `--input` and `--output`; use `--help`
for optional public figure destinations. Each runner actually executes its
notebook before the article can be marked complete. A failed or unsupported
comparison is recorded explicitly rather than turned into a zero result.

For a new entry, run the shared facets, add its type-specific analysis, inspect
retained extremes and contextual neighbors, persist and execute the notebook,
review selected figures and source claims, then revise the article and set its
completion metadata. Never update a completion date before the research finishes.

## Remaining-entry rollout

The [four-batch plan](../../docs/knowledge-base-rollout.md) assigns all remaining
entries by reader priority. `rollout-batches.json` contains exact identifiers and
source paths; completion continues to come from each entry’s `data_research`
metadata. Refresh the catalog-wide coverage inventory before researching a new
batch; the pilot extract does not include every quantity type.

## Batch 1 research

The eight `batch1_*.py` family runners (nutrition uses
`newbatch1_nutrition.py`) cover the 36 entries in rollout batch 1. They use
`batch_support.py` for cached snapshot loading, eleven explicit evidence facets,
raw-coverage checks, duplicate/interval-overlap candidates, and per-entry
executed notebooks. Family modules add the measurement-specific questions.
The current study uses the reporting window and focus constants in `common.py`;
use matching extraction bounds, and review those constants before a new study.

`extract.py --identifiers <private-identifiers.json>` accepts a JSON list or a
newline-delimited list of full HealthKit identifiers; `--all-types` exports all
observed quantities. Fresh coverage inventories are independent of the chosen
quantity export, so a missing export is distinct from a verified zero-row count.
`--owner-file <private-owner.csv>` reuses and verifies exactly one privately
selected profile. Keep all connection, selection and output arguments private.

Per-entry findings distinguish measured, sparse, absent, unsupported and
not-applicable evidence. Categories use frequencies and interval semantics;
HealthKit correlation membership is never inferred from component timestamps.
A missing raw type can still have aggregate evidence, which does not recover
raw cadence or ranges. Missing entries do not mean zero intake or zero symptoms.

After every family is stable, archive and re-execute all reports efficiently:

```sh
python archive.py --root <private-batch-directory> --execute --shared-kernel
```

Archival copies the exact methods and referenced images, redirects notebook
source paths to that private copy, checks the immutable input hashes, and
persists self-contained HTML with execution and integrity receipts. The notebook
index and findings remain private. Publication uses only reviewed source prose
and deidentified figures; source `data_research` remains the completion flag.

## Batch 2 research

The nine `batch2_*.py` family runners cover the 39 fitness, mobility and everyday
tracking entries. Each entry gets the shared eleven facets and a separate
measurement-specific investigation before its article is revised. Running and
walking relationships use source-matched records or workout summaries; swimming
interval matches are descriptive and do not reconstruct lap membership. Audio
levels require logarithmic energy calculations, while attenuation is a difference
in level. Category codes are labels, not continuous measurements.

Snapshot loaders accept `.csv.gz` when the corresponding `.csv` is absent, and
hash the actual compressed files for integrity. Fresh coverage inventories must
still match the rows loaded for every requested identifier. A coverage inventory
can include types omitted from a filtered export: fetch those missing rows before
researching them. Aggregate rows with empty values are not measured observations.
Retain the provenance of any reused immutable inputs and freshly fetched types
in the private snapshot manifest. Archive and re-execute with the command above
after all family methods and review corrections have settled.
