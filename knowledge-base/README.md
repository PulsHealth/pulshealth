# HealthKit Data Knowledge Base

A structured knowledge base of Apple HealthKit data types designed for **AI agents, health developers, clinicians, and researchers**. This resource focuses on clinical interpretation, health significance, and practical understanding rather than code implementation.

## Directory Structure

```
knowledge-base/
├── README.md                    # This file
├── schema.yaml                  # Reference schema with field descriptions
├── schema.json                  # JSON Schema for validation
├── validate.py                  # Validation script
├── quantity_types/
│   ├── body_measurements/       # BMI, body fat, height, weight, etc.
│   ├── vital_signs/             # Heart rate, blood pressure, SpO2, etc.
│   ├── activity/                # Steps, distance, energy, workouts
│   ├── nutrition/               # Dietary intake, vitamins, minerals
│   ├── lab_results/             # Spirometry, insulin, EDA
│   ├── mobility/                # Walking metrics, steadiness
│   └── hearing_environment/     # Audio exposure, daylight
├── category_types/
│   ├── activity_heart/          # Sleep, stand hours, heart events
│   ├── reproductive_health/     # Menstrual, fertility, pregnancy
│   ├── symptoms/                # All symptom tracking types
│   └── other/                   # Hygiene tracking
├── characteristic_types/        # Biological sex, blood type, DOB
└── correlation_types/           # Blood pressure, food correlations
```

## Data Type Coverage

| Type | Count | Description |
|------|-------|-------------|
| HKQuantityType | 111 | Numeric measurements with units |
| HKCategoryType | 59 | Categorical/enum values |
| HKCharacteristicType | 6 | Static user characteristics |
| HKCorrelationType | 2 | Grouped related samples |
| **Total** | **178** | Documented type entries |

One page per file is exported by `site/` to
`https://pulshealth.com/knowledge-base/types/<identifier>/`, and CI asserts
the two counts match — add a file and the site gains a page.

## The App's Bundled Copy

The iOS app ships a slice of the corpus (each type’s one-line description,
unit, typical range and category value names) as one JSON resource,
`PulsHealth/Sources/Resources/knowledge.json`, rendered from these YAML
files by `scripts/gen-knowledge-json.py` (python3 + PyYAML, the same
dependency `validate.py` needs) and checked in, so the app decodes it with
Foundation alone and needs no YAML parser. Never edit the JSON by hand:
change the YAML, rerun the generator and commit both.
`scripts/check-knowledge-json.sh` regenerates and diffs, and CI runs it on
every push, so a stale or hand-edited JSON fails the build. The generator's
header documents which fields are kept and how the few YAML shapes that
vary between files are normalised.

## Using This Knowledge Base

### For Health Consultants

Each YAML file contains:

1. **Clinical Ranges** - Normal, low, and high values for different populations
2. **Health Significance** - What the metric indicates about patient health
3. **Interpretation Guidelines** - How to read and contextualize values
4. **Red Flags** - When to recommend further consultation
5. **Limitations** - Accuracy considerations and caveats

### For Product Teams

Each YAML file contains:

1. **Technical Details** - Units, aggregation types, statistics options
2. **Data Sources** - Which devices can provide this data
3. **Platform Availability** - iOS/watchOS version requirements
4. **Metadata Keys** - Additional context available with samples
5. **Related Types** - Connected data types for richer analysis

## YAML File Structure

Each data type file follows a consistent schema:

```yaml
# Core Identification
identifier: "HKQuantityTypeIdentifierHeartRate"
type: "HKQuantityType"
category: "Vital Signs"
human_readable_name: "Heart Rate"

# Units & Measurement
default_unit: "count/min"
aggregation_type: "discrete"

# Clinical Context
typical_range:
  min: 40
  max: 200
clinical_ranges:
  - population: "Adults (resting)"
    normal: "60-100 BPM"

# Detailed Documentation
description: |
  ## Overview
  ...
  ## Clinical Interpretation
  ...

# References
references:
  - title: "Apple Developer Documentation"
    url: "..."
    type: "official"
```

## Validation

Run the validation script to check all YAML files:

```bash
python validate.py
```

This ensures all files conform to the required schema.

## Key Data Types by Use Case

### Cardiovascular Health
- Heart Rate, Resting Heart Rate, Heart Rate Variability
- Blood Pressure (Systolic/Diastolic)
- VO2 Max, Cardio Fitness Events

### Sleep & Recovery
- Sleep Analysis (stages, duration)
- Respiratory Rate, Blood Oxygen
- Heart Rate Recovery

### Activity & Fitness
- Step Count, Distance, Flights Climbed
- Active/Basal Energy Burned
- Exercise Time, Workouts

### Metabolic Health
- Blood Glucose
- Body Mass, BMI, Body Fat Percentage
- Dietary intake tracking

### Women's Health
- Menstrual Cycle tracking
- Fertility indicators
- Pregnancy tracking

## AI Consumption

This knowledge base is designed to be consumed by AI agents building health products. Key data for AI integration:

- **Metric Context**: Every data type includes clinical significance, typical ranges, and interpretation guidelines that give AI agents the context needed to reason about health data accurately.
- **Recording behavior**: The [recording guide](../docs/recording-behavior.md) explains cadence, interval duration, context, source identity and coverage across types. Six pilot entries have structured, sourced `recording_behavior` sections; other entries link to the shared guide on the site.
- **Historical resolution**: Inspect the actual stored intervals and source history. This corpus does not establish a universal HealthKit compaction schedule.
- **Clinical Grounding**: Each metric includes clinical ranges, red flags, and limitations that help AI agents avoid hallucinating health information and provide accurate, grounded responses.

Nothing in this repository reads these files as model context yet; the MCP server answers from the database instead. They are written to be usable that way, and to be read directly by anyone building on health data.

## References

- [Apple HealthKit Documentation](https://developer.apple.com/documentation/healthkit)
- [Apple Health App Support](https://support.apple.com/guide/iphone/health-iph47e6eacee/ios)
- [HealthKit WWDC Sessions](https://developer.apple.com/videos/frameworks/healthkit)

## Recording guidance and review scope

`recording_behavior` is optional; when present, all fields in `schema.json` are required, including primary-source links and a `reviewed_on` date. This date applies to recording guidance, not an independent clinical review of the whole article. Keep raw measurements, identifying source names and external identifiers in private profiles. User-approved, deidentified case figures and clearly labeled one-person summaries may illustrate recording behavior on public pages. Do not derive population thresholds from one person's observations.

The site renders the full recording guidance. The app's generated resource intentionally remains its documented compact slice; these additions do not silently expand the app's data model. Validate all entries and regenerate/check the slice after edits.

Validation rejects duplicate YAML keys, duplicate identifiers/category values and malformed dates or reference URLs. Run `python -m unittest discover -s knowledge-base/tests` for the validator regression tests.

## Empirical research and completion tracking

The initial research examples cover heart rate (`heart-rate`), heart-rate
variability SDNN (`hrv-sdnn`), sleep (`sleep-analysis`), steps (`step-count`)
and running vertical oscillation (`running-vertical-oscillation`). These keys
identify research artifacts; the existing HealthKit identifier still defines
the page URL and relationships.

A research notebook must run against the actual selected data before its
article is revised. Keep reusable analysis code and unexecuted notebook
sources public; persist executed notebooks, query results and detailed
outputs privately outside the source tree. The public extraction entry point is `notebooks/healthkit-research/extract.py`:

```bash
python3 notebooks/healthkit-research/extract.py --host <host> --container <database-container> \
  --owner-name <selected-owner> --start <date> --end <date> \
  --timezone <iana-zone> --output <private-output-directory>
```

Resolve real connection and owner arguments privately; never commit them.
For this first batch, executed notebooks are stored in the Git common
directory under `pulshealth/knowledge-research/2026-10-14/<artifact_key>/research.ipynb`.
That private location is outside the tracked source tree.

Bind each run to its artifact key,
window, timezone, calculation version and refresh date. Do not embed private
absolute paths or account identifiers in public metadata.

Each type uses the same investigation facets:

| Facet | Questions to answer |
|---|---|
| Provenance | Which database snapshot, window, units and selection rules were used? |
| Coverage | How many records, calendar days and observed days? What is unavailable? |
| Sources | Are sources, devices or revisions distinguishable? Do they overlap? |
| Values | What are the distributions and relevant categorical/interval equivalents? |
| Outliers | What does an explicit statistical rule flag, and what remains unexplained? |
| Cadence | What are start-to-start gaps, durations, duplicates and per-day counts? |
| Workout context | How do values and cadence differ within matched workouts? |
| Sleep context | How do values and cadence differ within resolved sleep intervals? |
| Time patterns | Do local time, day and longer-term patterns change the picture? |
| Related types | Which aligned measurements support useful descriptive comparisons? |
| Type-specific | What special counting, overlap or measurement rules matter here? |

A facet is complete when it has been investigated, including documenting an
unavailable comparison. Use interval/category analysis in place of numeric
value summaries where appropriate. Correlations are descriptive; timestamp
matching and one person's repeated records do not establish causality or
population norms.

Set optional `data_research.status: complete` only after the notebook is
executed and persisted and the article incorporates relevant findings.
`reviewed_on` is the empirical/editorial completion date, not clinical
certification. `workflow_version: "1"` identifies this checklist. `facets`
contains all eleven keys; `limitations` states unavailable data and inferred
context. An absent `data_research` means this workflow has not been completed,
not that the page is untrustworthy or that no earlier review occurred.

Optional `figures` provide same-origin SVG, PNG or WebP assets under
`/knowledge-base/figures/<artifact-key>/`. Every figure needs a meaningful
`alt`, `title`, `caption` and `methods`, including denominator, exclusions and
context rules. Optional `section` matches the exact level-two Markdown heading text; omitted
figures follow the overview. Label measured figures as example user data,
use anonymous source labels and relative dates where practical, and retain
raw evidence privately. Generated illustrations may explain concepts but
must never impersonate measured data. `seo_title` can describe the question a
page answers without changing its identifier or URL.

## Last Updated

2026-10-08
