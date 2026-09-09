# HealthKit Data Knowledge Base

A comprehensive, structured knowledge base of Apple HealthKit data types designed for **AI agents, health developers, clinicians, and researchers**. This resource focuses on clinical interpretation, health significance, and practical understanding rather than code implementation.

## Directory Structure

```
healthkit_knowledge_base/
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
| HKQuantityType | ~85 | Numeric measurements with units |
| HKCategoryType | ~55 | Categorical/enum values |
| HKCharacteristicType | 6 | Static user characteristics |
| HKCorrelationType | 2 | Grouped related samples |
| **Total** | **~150** | All HealthKit data types |

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
- **Cross-Device Comparisons**: How the same metric (e.g., heart rate, step count, VO2 Max) differs across Apple Watch, Fitbit, Garmin, Oura, and other devices — sensor placement, sampling rates, algorithm differences.
- **Compaction Policies**: How HealthKit compacts historical data over time, affecting data availability and granularity for long-term analysis.
- **Clinical Grounding**: Each metric includes clinical ranges, red flags, and limitations that help AI agents avoid hallucinating health information and provide accurate, grounded responses.

The PulsHealth AI Health Agent uses this knowledge base as its primary grounding source. You can also integrate it directly into your own AI agent for clinical context.

## References

- [Apple HealthKit Documentation](https://developer.apple.com/documentation/healthkit)
- [Apple Health App Support](https://support.apple.com/guide/iphone/health-iph47e6eacee/ios)
- [HealthKit WWDC Sessions](https://developer.apple.com/videos/frameworks/healthkit)

## Last Updated

2026-01-27
