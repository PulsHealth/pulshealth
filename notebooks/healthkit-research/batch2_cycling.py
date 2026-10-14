"""Cycling research: cumulative distance, peripheral streams and FTP estimates."""
from pathlib import Path
import argparse
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from common import annotate_context, describe, FOCUS_START, FOCUS_END
from batch_support import load_snapshot, select_rows, research_report, persist_research, execute_notebooks, clean_json

IDS = {
    'cycling-cadence': ('CyclingCadence', 'count/min'),
    'distance-cycling': ('DistanceCycling', 'm'),
    'cycling-functional-threshold-power': ('CyclingFunctionalThresholdPower', 'W'),
    'cycling-power': ('CyclingPower', 'W'),
    'cycling-speed': ('CyclingSpeed', 'm/s'),
}
APPLE = 'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/'
SUPPORT = 'https://support.apple.com/guide/watch/go-cycling-apd4cbc876c7/watchos'
SEMANTICS = {
    'CyclingCadence': 'Discrete pedal rotations per minute; missing is not zero coasting. Peripheral cadence, not inferred wrist motion.',
    'CyclingPower': 'Discrete cycling power in watts; not running power, calories or mechanical work without valid time weighting.',
    'CyclingSpeed': 'Discrete speed; wheel calibration, terrain and indoor virtual speed can change interpretation. Missing speed is not stopped riding.',
    'CyclingFunctionalThresholdPower': 'Discrete estimated sustainable 60-minute average power; not a per-second power stream or proof of a completed 60-minute test.',
    'DistanceCycling': 'Cumulative distance amounts over stored intervals; source-specific sums, no combining overlapping sources or prorating boundaries.',
}

def investigate(data, suffix):
    identifier = 'HKQuantityTypeIdentifier' + suffix
    raw = select_rows(data, identifier)
    series = data.get('workout_series', pd.DataFrame())
    stream = series[series.identifier == identifier] if 'identifier' in series else pd.DataFrame()
    result = {'semantics': SEMANTICS[suffix], 'raw_records': len(raw), 'linked_workout_series_records': len(stream),
              'series_note': 'Dedicated workout-series rows are audited separately; never appended to raw samples as extra observations.',
              'related_types': []}
    aggregates = data.get('aggregates', pd.DataFrame())
    agg = aggregates[aggregates.identifier == identifier] if 'identifier' in aggregates else pd.DataFrame()
    result['aggregate_rows'] = len(agg)
    result['aggregate_columns'] = list(agg.columns)
    result['aggregate_limits'] = 'Daily aggregate availability does not recover raw interval durations, sensor cadence, sample outliers or within-workout/sleep patterns.'
    if len(agg):
        result['aggregate_numeric_summaries'] = [{'function': str(function), 'bucket_rows': len(group),
                                                 'nonnull_bucket_values': int(group.value.notna().sum()),
                                                 'bucket_values': describe(pd.to_numeric(group.value, errors='coerce'))}
                                                for function, group in agg.groupby('agg_func')]
    for other in IDS.values():
        other_id = 'HKQuantityTypeIdentifier' + other[0]
        if other_id == identifier:
            continue
        result['related_types'].append({'identifier': other_id, 'raw_records': len(select_rows(data, other_id)),
                                       'status': 'available' if len(raw) and len(select_rows(data, other_id)) else 'absent',
                                       'note': 'Without both streams there is no measured power-speed, cadence-power or FTP-relative association.'})
    if raw.empty:
        result['status'] = 'absent'
        result['questions_checked'] = ['Raw value ranges and nonfinite/negative/zero values', 'Source-specific recording intervals and coalescing',
                                     'Workout and sleep overlap', 'Dedicated workout-series availability',
                                     'FTP update/change cadence' if suffix == 'CyclingFunctionalThresholdPower' else 'Positive-duration and source-aware summaries']
        result['unsupported'] = 'No raw observations: empirical ranges, outlier thresholds, cadence and context differences cannot be estimated.'
        return result
    rows = annotate_context(raw, data)
    result['sources'] = []
    for source, group in rows.groupby('source_group'):
        focus = group[(group.start_ts >= FOCUS_START) & (group.start_ts < FOCUS_END)].copy()
        duration = (focus.end_ts - focus.start_ts).dt.total_seconds()
        summary = {'source': source, 'year_records': len(group), 'focus_records': len(focus),
                   'focus_days': int(focus.local_day.nunique()), 'values': describe(focus.value),
                   'zero_records': int((focus.value == 0).sum()), 'negative_records': int((focus.value < 0).sum()),
                   'nonfinite_records': int((~np.isfinite(focus.value)).sum()), 'duration_seconds': describe(duration),
                   'workout_overlap_records': int(focus.workout_overlap.sum()), 'sleep_overlap_records': int(focus.sleep_overlap.sum()),
                   'cross_midnight_records': int((focus.start_ts.dt.tz_convert('America/Los_Angeles').dt.date != focus.end_ts.dt.tz_convert('America/Los_Angeles').dt.date).sum())}
        if suffix == 'DistanceCycling':
            summary['observed_day_raw_km'] = describe(focus.groupby('local_day').value.sum(min_count=1) / 1000)
            summary['interval_amount_divided_by_duration_m_s'] = describe(focus.loc[duration > 0, 'value'] / duration[duration > 0])
            summary['rate_note'] = 'Interval average, not an observed CyclingSpeed stream; includes pauses within recorded duration.'
            summary['instantaneous_positive_distance_records'] = int(((duration == 0) & (focus.value > 0)).sum())
            summary['largest_interval_audit'] = [dict(value_m=float(row.value), duration_s=float((row.end_ts-row.start_ts).total_seconds()),
                                                      workout_overlap=bool(row.workout_overlap))
                                                   for row in focus.nlargest(5, 'value').itertuples()]
        elif suffix == 'CyclingFunctionalThresholdPower':
            ordered = group.sort_values('start_ts')
            summary['updates_with_changed_value'] = int((ordered.value.diff().dropna() != 0).sum())
            summary['estimate_changes_watts'] = describe(ordered.value.diff())
            summary['update_gaps_days'] = describe(ordered.start_ts.diff().dt.total_seconds() / 86400)
        else:
            valid = (duration > 0) & np.isfinite(focus.value)
            summary['positive_duration_weighted_mean'] = float(np.average(focus.loc[valid, 'value'], weights=duration[valid])) if valid.any() else None
            summary['weighting_note'] = 'Stored positive durations only; overlapping intervals can double-weight elapsed time, so this is not a validated workout average.'
        result['sources'].append(summary)
    return clean_json(result)

def make_figure(data, output, suffix='DistanceCycling'):
    rows = annotate_context(select_rows(data, 'HKQuantityTypeIdentifier' + suffix), data)
    if rows.empty:
        return []
    rows = rows[(rows.start_ts >= FOCUS_START) & (rows.start_ts < FOCUS_END)]
    if rows.empty:
        return []
    rows = rows[rows.source_group == rows.source_group.value_counts().index[0]]
    daily = rows.groupby('local_day').value.sum(min_count=1) / 1000
    duration = (rows.end_ts - rows.start_ts).dt.total_seconds()
    fig, axes = plt.subplots(1, 2, figsize=(10, 4), layout='constrained')
    axes[0].hist(daily if suffix == 'DistanceCycling' else rows.value * 3.6, bins=20, color='#079cab')
    axes[0].set_xlabel('Raw distance sum per observed day (km)' if suffix == 'DistanceCycling' else 'Cycling speed per stored record (km/h)')
    axes[0].set_ylabel('Days with recorded distance' if suffix == 'DistanceCycling' else 'Records')
    axes[1].hist(duration, bins=30, color='#467fc7')
    axes[1].set_xlabel('Stored interval duration (seconds)')
    axes[1].set_ylabel('Records')
    fig.suptitle(f'Example cycling {"distance" if suffix == "DistanceCycling" else "speed"} · {len(rows):,} records · {len(daily)} observed days')
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    filename = 'distance-and-intervals.png' if suffix == 'DistanceCycling' else 'speed-and-intervals.png'
    fig.savefig(output / filename, dpi=150)
    plt.close(fig)
    return [output / filename]

def run(input_dir, output, figures):
    data = load_snapshot(str(Path(input_dir).resolve()))
    paths = []
    for key, (suffix, unit) in IDS.items():
        identifier = 'HKQuantityTypeIdentifier' + suffix
        refs = [APPLE + suffix.lower(), SUPPORT]
        report = research_report(data, identifier, special_analysis=investigate(data, suffix), references=refs)
        pics = make_figure(data, Path(figures) / key, suffix) if suffix in ('DistanceCycling', 'CyclingSpeed') else []
        paths.append(persist_research(report, Path(output) / key, key, input_dir=input_dir,
                     special_code=f'investigate(data, {suffix!r})', setup_code='from batch2_cycling import investigate',
                     references=refs, figures=pics))
    execute_notebooks(paths)
    return paths

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True); parser.add_argument('--output', required=True); parser.add_argument('--figures', required=True)
    args = parser.parse_args(); run(args.input, args.output, args.figures)
