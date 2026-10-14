"""Notification-category investigations; no monitoring opportunity denominator."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from batch_support import (load_snapshot, select_rows, research_report,
                           persist_research, execute_notebooks)
from common import annotate_context, describe, overlap_mask, FOCUS_START, FOCUS_END

EVENTS = {
    'HighHeartRateEvent': 'high-heart-rate-event',
    'LowHeartRateEvent': 'low-heart-rate-event',
    'IrregularHeartRhythmEvent': 'irregular-heart-rhythm-event',
    'LowCardioFitnessEvent': 'low-cardio-fitness-event',
}
RELATED = ('HKQuantityTypeIdentifierHeartRate',
           'HKQuantityTypeIdentifierAtrialFibrillationBurden',
           'HKQuantityTypeIdentifierVO2Max')


def special(data, identifier):
    """Inspect event codes, intervals, threshold metadata and temporal neighbors."""
    rows = select_rows(data, identifier, 'category').sort_values('start_ts')
    expected = 1 if identifier.endswith('LowCardioFitnessEvent') else 0
    metadata = [json.loads(v) if isinstance(v, str) and v else {} for v in rows.get('metadata', [])]
    results = {
        'expected_category_value': expected,
        'unexpected_codes': int((rows.value != expected).sum()) if len(rows) else 0,
        'year_records': len(rows),
        'focus_records': int(((rows.start_ts >= FOCUS_START) & (rows.start_ts < FOCUS_END)).sum()) if len(rows) else 0,
        'interval_duration_seconds': describe((rows.end_ts - rows.start_ts).dt.total_seconds()) if len(rows) else None,
        'metadata_keys_present': sorted({k for m in metadata for k in m}),
        'stored_threshold_values': [m.get('HKHeartRateEventThreshold') for m in metadata],
        'monitoring_opportunity': {'status': 'unsupported', 'reason': 'Watch wear, notification enablement history, inactivity eligibility and detection attempts are not recorded by these event rows.'},
        'threshold_history': {'status': 'unsupported', 'reason': 'Event metadata can describe thresholds at recorded events, not the setting on days without notifications.'},
        'event_duration_interpretation': 'Stored interval duration is not a validated duration of bradycardia, tachycardia or AFib.',
        'rate_interpretation': 'Recorded notifications cannot establish prevalence or events per monitored hour.',
        'numeric_outliers': 'Category values encode event kind; no numeric normal range or IQR outlier analysis applies.',
        'clinical_classification': 'No diagnosis can be inferred from presence, absence or temporal neighbors.',
        'related_types': [],
    }
    if identifier.endswith('LowCardioFitnessEvent'):
        results['feature_specific_questions'] = {
            'classification': 'Low cardio fitness classification is based on VO2-max estimate history and personal characteristics, not a universal numeric cutoff.',
            'event_vs_estimate_cadence': 'Apple documents reminder notifications approximately every four months; event cadence is not VO2-max measurement cadence.',
            'triggering_estimate_metadata': [m.get('HKVO2MaxValue') for m in metadata],
            'classification_threshold_metadata': [m.get('HKLowCardioFitnessEventThreshold') for m in metadata],
            'sleep_and_workout_interpretation': 'Notification timestamp is a summary event; overlap does not establish that oxygen consumption was estimated in that interval.'}
    elif identifier.endswith('IrregularHeartRhythmEvent'):
        results['feature_specific_questions'] = {
            'detection_opportunities': 'Intermittent stillness-dependent rhythm checks, not continuous monitoring.',
            'event_vs_burden': 'Notification count and interval do not measure time in AFib.',
            'eligibility_history': 'Prior AFib diagnosis, feature availability and AFib History configuration are not established by absence of category rows.',
            'threshold': 'No user-configurable BPM threshold is defined for this irregular-rhythm category.'}
    else:
        results['feature_specific_questions'] = {
            'direction': 'below configured rate threshold' if identifier.endswith('LowHeartRateEvent') else 'above configured rate threshold',
            'inactivity': 'Apple documents apparent inactivity for at least ten minutes; exported workout absence does not independently prove this eligibility condition.',
            'threshold_vs_pulse': 'Metadata stores notification threshold, not an average measured pulse.',
            'sleep_interpretation': 'Recorded sleep overlap provides context but cannot classify a low or high pulse as benign or pathological.'}
    if len(rows):
        annotated = annotate_context(rows, data)
        results['context_records'] = annotated.context.value_counts().to_dict()
        results['local_hour_counts'] = annotated.start_ts.dt.tz_convert('America/Los_Angeles').dt.hour.value_counts().sort_index().to_dict()
    for other_id in RELATED:
        other = select_rows(data, other_id)
        neighbors = []
        for _, event in rows.iterrows():
            # A shared time interval is a comparison window, not an explicit association.
            overlap = other[overlap_mask(other, pd.DataFrame([event]))] if len(other) else other
            nearby = other[(other.start_ts >= event.start_ts - pd.Timedelta(minutes=5)) &
                           (other.start_ts <= event.end_ts + pd.Timedelta(minutes=5))] if len(other) else other
            neighbors.append({'overlapping_records': len(overlap),
                              'within_five_minutes_records': len(nearby),
                              'nearby_values': describe(nearby.value) if len(nearby) else None})
        results['related_types'].append({'identifier': other_id, 'available_records': len(other),
                                        'event_windows': neighbors,
                                        'status': 'sparse' if len(rows) and len(other) else 'absent',
                                        'reason': 'Temporal windows only; no explicit HealthKit link or causal inference.'})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = load_snapshot(str(args.input.resolve()))
    notebooks = []
    for suffix, key in EVENTS.items():
        identifier = 'HKCategoryTypeIdentifier' + suffix
        references = ['https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/' + suffix.lower(),
                      'https://support.apple.com/en-us/120276',
                      'https://support.apple.com/guide/watch/monitor-your-heart-health-apde39f5426c/watchos']
        report = research_report(data, identifier, kind='category', special_analysis=special(data, identifier),
                                 related_identifiers=RELATED, references=references)
        plot_path = args.output / key / 'event-heart-rate.png'
        setup = 'from batch1_events import special'
        figures = []
        if suffix == 'LowHeartRateEvent':
            plot_path.parent.mkdir(parents=True, exist_ok=True)
            event_figure(data, plot_path)
            setup += f'\nfrom batch1_events import event_figure\nevent_figure(data, Path({str(plot_path.resolve())!r}))'
            figures = [str(plot_path.resolve())]
        notebooks.append(persist_research(report, args.output / key, suffix,
                                         input_dir=args.input, setup_code=setup,
                                         special_code=f'special(data, {identifier!r})',
                                         related_identifiers=RELATED, references=references, figures=figures))
    execute_notebooks(notebooks)


def event_figure(data, output):
    """Plot sparse real neighbors with event-relative timing and no identity."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    events = select_rows(data, 'HKCategoryTypeIdentifierLowHeartRateEvent', 'category').sort_values('start_ts')
    heart_rate = select_rows(data, 'HKQuantityTypeIdentifierHeartRate')
    if events.empty:
        return
    fig, axes = plt.subplots(len(events), 1, figsize=(9, 7.5), sharex=True, sharey=True)
    for i, (_, event) in enumerate(events.iterrows()):
        ax = axes[i]
        nearby = heart_rate[(heart_rate.start_ts >= event.start_ts - pd.Timedelta(minutes=5)) &
                            (heart_rate.start_ts <= event.end_ts + pd.Timedelta(minutes=5))]
        minute = (nearby.start_ts - event.start_ts).dt.total_seconds() / 60
        ax.axvspan(0, (event.end_ts - event.start_ts).total_seconds() / 60, color='#b8d4ef', alpha=.35)
        ax.scatter(minute, nearby.value, color='#245c9b', s=45)
        ax.axhline(40, color='#9a5263', linestyle='--', linewidth=1.2)
        ax.set_ylabel(f'Event {i + 1}\nHeart rate (bpm)')
        ax.set_ylim(36, 44)
        ax.grid(axis='y', alpha=.2)
        ax.spines[['top', 'right']].set_visible(False)
    axes[0].set_title('Nearby heart-rate samples around three low-rate notifications', loc='left', pad=16)
    axes[-1].set_xlabel('Minutes from stored event start')
    fig.text(.1, .015, 'Shaded: stored event interval   •   Dashed: stored 40 bpm threshold   •   Dots: raw samples', fontsize=10)
    fig.tight_layout(rect=(0, .045, 1, 1))
    fig.savefig(output, dpi=160)
    plt.close(fig)


if __name__ == '__main__':
    main()
