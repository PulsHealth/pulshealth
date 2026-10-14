"""Source-aware BP, glucose and AFib evidence; read private snapshots only."""
import argparse
import json
from pathlib import Path

import pandas as pd

from batch_support import (load_snapshot, select_rows, research_report,
                           persist_research, execute_notebooks, clean_json)

PREFIX = 'HKQuantityTypeIdentifier'
IDENTIFIERS = [PREFIX + name for name in ('BloodPressureSystolic', 'BloodPressureDiastolic',
               'BloodGlucose', 'AtrialFibrillationBurden')] + ['HKCorrelationTypeIdentifierBloodPressure']
REFERENCES = [
    'https://developer.apple.com/documentation/healthkit/hkcorrelationtypeidentifier/bloodpressure',
    'https://www.heart.org/en/health-topics/high-blood-pressure/monitoring-your-blood-pressure-at-home',
    'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/bloodglucose',
    'https://www.niddk.nih.gov/health-information/diabetes/overview/tests-diagnosis',
    'https://www.niddk.nih.gov/health-information/diabetes/overview/managing-diabetes/continuous-glucose-monitoring',
    'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/atrialfibrillationburden',
    'https://support.apple.com/en-us/108375',
    'https://developer.apple.com/documentation/healthkit/hkunit/percent()',
]


def special(data, identifier):
    """Explicit component linkage and measurement-context limits, including absence."""
    rows = select_rows(data, identifier)
    result = {'records': len(rows), 'measurement_context': 'Unknown unless explicitly recorded in metadata.',
              'workout_sleep_caveat': 'Overlap is descriptive; no standardized measurement opportunity denominator.'}
    if 'BloodPressure' in identifier:
        systolic = select_rows(data, PREFIX + 'BloodPressureSystolic')
        diastolic = select_rows(data, PREFIX + 'BloodPressureDiastolic')
        keys = ['start_ts', 'end_ts', 'source_id']
        paired = systolic.merge(diastolic, on=keys, suffixes=('_systolic', '_diastolic')) if len(systolic) and len(diastolic) else pd.DataFrame()
        result.update({'systolic_records': len(systolic), 'diastolic_records': len(diastolic),
                       'candidate_timestamp_source_pairs': len(paired),
                       'correlation_membership': 'unsupported: no correlation object or membership table is stored',
                       'pairing_method': 'Exact start, end and source ID match; candidate associations only, never confirmed HKCorrelation membership.',
                       'posture_cuff_technique': 'Not established from sample values; no inference from hour or heart rate.'})
        if len(paired):
            unique = not systolic.duplicated(keys).any() and not diastolic.duplicated(keys).any()
            result['candidate_pair_keys_unique'] = unique
            result['systolic_less_or_equal_diastolic_candidates'] = int((paired.value_systolic <= paired.value_diastolic).sum()) if unique else 'unsupported: nonunique candidate keys'
            result['candidate_pulse_pressure_summary'] = paired.value_systolic.sub(paired.value_diastolic).describe().to_dict() if unique else 'unsupported: nonunique candidate keys'
    elif 'BloodGlucose' in identifier:
        metadata = [v if isinstance(v, dict) else json.loads(v) if isinstance(v, str) and v.startswith('{') else {} for v in rows.get('metadata', [])]
        result.update({'meal_time_metadata_records': sum('HKMetadataKeyBloodGlucoseMealTime' in m or 'mealTime' in m for m in metadata),
                       'fasting_classification': 'unsupported: meal timing alone does not establish an eight-hour fast or laboratory test conditions',
                       'units': rows.unit.value_counts().to_dict() if len(rows) else {},
                       'display_conversion': 'Canonical mg/dL divided by 18.0182 gives mmol/L; no conversion applied to already canonical values.',
                       'sensor_modality': 'Requires source/device documentation; cadence alone does not prove CGM versus meter.',
                       'cgm_follow_up': 'Check source-specific gaps and contiguous coverage before time-in-range; no interpolation across missing sensor periods.'})
    else:
        durations = (rows.end_ts - rows.start_ts).dt.total_seconds() if len(rows) else pd.Series(dtype=float)
        result.update({'units': rows.unit.value_counts().to_dict() if len(rows) else {},
                       'interval_days_summary': (durations / 86400).describe().to_dict() if len(rows) else {},
                       'weekly_interpretation': 'A multi-day estimate cannot localize AFib to a workout or asleep interval.',
                       'aggregation': 'Do not sum percentages or infer continuous monitored minutes from calendar duration; unequal overlapping intervals require denominator evidence.',
                       'read_only': True, 'no_zero_inference': 'No sample is not 0%; Health display reports 2% or less at its lower floor.'})
        result['raw_percent_semantics'] = 'HKUnit.percent represents 0–1; canonical raw 0.05 would display as 5%. This snapshot has no observed AFib burden values.'
    result['retained_extremes'] = rows.sort_values('value').iloc[list(dict.fromkeys([0, len(rows)-1]))][['value', 'unit', 'start_ts', 'end_ts', 'metadata']].to_dict('records') if len(rows) else []
    return clean_json(result)


def plot_bp(data, output):
    """Independent component distributions; no inferred systolic/diastolic pairs."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4), layout='constrained')
    for ax, metric in zip(axes, ('BloodPressureSystolic', 'BloodPressureDiastolic')):
        rows = select_rows(data, PREFIX + metric)
        ax.hist(rows.value, bins=8, color='#526d91', edgecolor='white')
        ax.set(title=metric.replace('BloodPressure', '') + f' · {len(rows)} records', xlabel='mmHg', ylabel='Recorded samples')
        ax.spines[['top', 'right']].set_visible(False)
    fig.suptitle('Example blood-pressure components · year-window records')
    path = output / 'component-distributions.png'
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--public-figures', type=Path)
    args = parser.parse_args()
    data = load_snapshot(args.input)
    if args.public_figures:
        plot_bp(data, args.public_figures)
    notebooks = []
    for identifier in IDENTIFIERS:
        kind = 'correlation' if identifier.startswith('HKCorrelation') else 'quantity'
        if 'BloodGlucose' in identifier:
            related = (PREFIX + 'DietaryCarbohydrates', PREFIX + 'InsulinDelivery')
        elif 'AtrialFibrillation' in identifier:
            related = (PREFIX + 'AppleExerciseTime', PREFIX + 'BodyMass')
        else:
            related = (PREFIX + 'BloodPressureDiastolic', PREFIX + 'RestingHeartRate') if 'Systolic' in identifier else (PREFIX + 'BloodPressureSystolic', PREFIX + 'BodyMass')
        report = research_report(data, identifier, kind=kind, special_analysis=special(data, identifier), related_identifiers=related, references=REFERENCES)
        private_figure = plot_bp(data, args.output / identifier) if 'BloodPressure' in identifier else None
        setup = 'from batch1_clinical import special, plot_bp'
        if private_figure:
            setup += f'\nplot_bp(data, {str(private_figure.parent)!r})'
        notebooks.append(persist_research(report, args.output / identifier, identifier, input_dir=args.input,
            setup_code=setup, special_code=f'special(data, {identifier!r})',
            related_identifiers=related, references=REFERENCES, figures=[str(private_figure)] if private_figure else ()))
    execute_notebooks(notebooks)


if __name__ == '__main__':
    main()
