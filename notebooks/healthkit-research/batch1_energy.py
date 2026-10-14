"""Source-aware cumulative energy and Exercise-minute research from private CSVs."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from common import annotate_context, describe, FOCUS_START, FOCUS_END, TIME_ZONE
from batch_support import load_snapshot, research_report, persist_research, execute_notebooks, clean_json

TYPES = {
    'ActiveEnergyBurned': ('active-energy-burned', 'Active Energy Burned', 'kcal'),
    'BasalEnergyBurned': ('basal-energy-burned', 'Basal Energy Burned', 'kcal'),
    'AppleExerciseTime': ('apple-exercise-time', 'Apple Exercise Time', 'min'),
}
REFERENCES = [
    {'title': 'Apple: active energy cumulative samples', 'url': 'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned'},
    {'title': 'Apple: resting energy cumulative samples', 'url': 'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/basalenergyburned'},
    {'title': 'Apple: Exercise minutes and sensor context', 'url': 'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/appleexercisetime'},
    {'title': 'Apple: improve Watch measurements', 'url': 'https://support.apple.com/en-us/105002'},
]


def rows_for(data, suffix):
    rows = data['quantity'][data['quantity'].identifier == 'HKQuantityTypeIdentifier' + suffix].copy()
    return annotate_context(rows, data)


def selected_rows(data, suffix):
    rows = rows_for(data, suffix)
    if rows.empty:
        return rows
    watches = rows[rows.bundle_id.fillna('').str.startswith('com.apple.health.')]
    candidates = watches if not watches.empty else rows
    counts = candidates.groupby('source_group').size()
    selected = counts.idxmax()
    return rows[rows.source_group == selected].copy()


def special(data, suffix):
    rows = rows_for(data, suffix)
    if rows.empty:
        return {'status': 'absent', 'reason': 'No raw cumulative records in exported year.'}
    chosen = selected_rows(data, suffix)
    focus = chosen[(chosen.start_ts >= FOCUS_START) & (chosen.start_ts < FOCUS_END)].copy()
    chosen['duration_s'] = (chosen.end_ts - chosen.start_ts).dt.total_seconds()
    focus['duration_s'] = (focus.end_ts - focus.start_ts).dt.total_seconds()
    focus['rate_per_min'] = focus.value / (focus.duration_s / 60)
    report = {'selection': 'Largest Apple-health source group by record count; fallback largest source. Bundle/name groups source revisions, not persistent devices.',
              'selected_source': chosen.source_group.iloc[0], 'year_records': len(chosen), 'focus_records': len(focus),
              'units': sorted(rows.unit.dropna().unique().tolist()),
              'focus_days': focus.local_day.nunique(), 'all_sources': [],
              'selected_focus_values': describe(focus.value), 'selected_focus_durations_s': describe(focus.duration_s),
              'zero_or_negative_duration_records': int((focus.duration_s <= 0).sum()),
              'context': [], 'daily_relationships': [],
              'interpretation': 'Each value is an interval amount, not a daily burn or instantaneous measurement. Full amounts are assigned by start-day without prorating; cross-midnight, source overlap and HealthKit source precedence limit comparisons. Rate is an interval average, never instantaneous metabolism or sensor cadence.'}
    for source, group in rows.groupby('source_group'):
        ordered = group.sort_values(['start_ts', 'end_ts'])
        report['all_sources'].append({'source': source, 'records': len(group), 'year_sum': float(group.value.sum()),
                                      'days': group.local_day.nunique(),
                                      'within_source_overlap_previous_end_count': int((ordered.start_ts < ordered.end_ts.shift()).sum()),
                                      'cross_reporting_day_intervals': int((group.start_ts.dt.tz_convert(TIME_ZONE).dt.date != group.end_ts.dt.tz_convert(TIME_ZONE).dt.date).sum())})
    for context, group in focus.groupby('context'):
        valid = group[(group.duration_s >= 1) & np.isfinite(group.rate_per_min)]
        report['context'].append({'context': context, 'records': len(group), 'days': group.local_day.nunique(),
                                  'values': describe(group.value), 'duration_s': describe(group.duration_s),
                                  'rate_per_min_duration_at_least_1s': describe(valid.rate_per_min),
                                  'rate_denominator': len(valid)})
    daily = chosen.groupby('local_day').value.sum().rename('raw_source_sum')
    focus_daily = daily.loc[(daily.index >= '2026-07-01') & (daily.index < '2026-10-01')]
    report['daily_source_sum_year'] = describe(daily)
    report['daily_source_sum_focus'] = describe(focus_daily)
    agg = data.get('aggregates', pd.DataFrame())
    report['daily_aggregate_comparisons'] = []
    if not agg.empty:
        a = agg[(agg.identifier == 'HKQuantityTypeIdentifier'+suffix) & (agg.agg_func == 'sum') & (agg.interval_unit == 'day') & (agg.interval_value == 1)].copy()
        a['day'] = a.bucket_start.dt.tz_convert(TIME_ZONE).dt.strftime('%Y-%m-%d')
        for (series, device), group in a.groupby(['series_id', 'device_filter']):
            local_start = group.bucket_start.dt.tz_convert(TIME_ZONE)
            local_end = group.bucket_end.dt.tz_convert(TIME_ZONE)
            aligned = group[(local_start == local_start.dt.normalize()) & (local_end == local_end.dt.normalize())]
            unique = aligned[~aligned.day.duplicated(keep=False)]
            pairs = pd.concat([daily, unique.set_index('day').value.rename('aggregate')], axis=1).dropna()
            report['daily_aggregate_comparisons'].append({'series_id': int(series), 'device_filter': device,
                'paired_days': len(pairs), 'excluded_unaligned_or_duplicate_buckets': len(group)-len(unique), 'aggregate_values': describe(pairs['aggregate']),
                'raw_minus_aggregate': describe(pairs.raw_source_sum-pairs['aggregate']),
                'equal_within_0_01': int((abs(pairs.raw_source_sum-pairs['aggregate']) <= .01).sum())})
    ring_path = Path(data['_input_dir']) / 'activity_summaries.csv'
    report['rings'] = {'status': 'not_applicable' if suffix == 'BasalEnergyBurned' else 'unsupported',
                       'reason': 'Resting energy is not a ring.' if suffix == 'BasalEnergyBurned' else 'Ring table not exported.'}
    if ring_path.exists() and suffix != 'BasalEnergyBurned':
        rings = pd.read_csv(ring_path)
        col = 'move_kcal' if suffix == 'ActiveEnergyBurned' else 'exercise_min'
        pairs = pd.concat([daily, rings.set_index('date')[col].rename('ring')], axis=1).dropna()
        report['rings'] = {'status': 'measured', 'paired_days': len(pairs), 'ring_values': describe(pairs.ring),
                           'raw_minus_ring': describe(pairs.raw_source_sum-pairs.ring),
                           'equal_within_0_01': int((abs(pairs.raw_source_sum-pairs.ring) <= .01).sum()),
                           'limitation': 'Ring dates are recorded phone-local days; fixed-calendar source sums are diagnostic, not reconstruction of rings.'}
    for other_suffix in TYPES:
        if suffix == other_suffix:
            continue
        other = selected_rows(data, other_suffix)
        if other.empty:
            report['daily_relationships'].append({'identifier': other_suffix, 'status': 'absent'})
            continue
        other_daily = other.groupby('local_day').value.sum().rename('related_sum')
        pairs = pd.concat([daily, other_daily], axis=1).dropna()
        report['daily_relationships'].append({'identifier': other_suffix, 'paired_days': len(pairs),
            'spearman_daily_source_sums': pairs.corr(method='spearman').iloc[0,1] if len(pairs)>=10 else None,
            'limitation': 'Both series can share recording opportunity, profile inputs and algorithms. No adjusted/causal link.'})
    workout = data['workouts'].copy()
    if not workout.empty:
        workout['local_day'] = workout.start_ts.dt.tz_convert(TIME_ZONE).dt.strftime('%Y-%m-%d')
        workout['elapsed_min'] = (workout.end_ts-workout.start_ts).dt.total_seconds()/60
        elapsed = workout.groupby('local_day').elapsed_min.sum().rename('workout_elapsed_min')
        pairs = pd.concat([daily, elapsed], axis=1).dropna()
        report['workout_daily_comparison'] = {'paired_days': len(pairs), 'elapsed_minutes': describe(pairs.workout_elapsed_min),
            'spearman': pairs.corr(method='spearman').iloc[0,1] if len(pairs)>=10 else None,
            'source_sum_minus_elapsed': describe(pairs.raw_source_sum-pairs.workout_elapsed_min) if suffix == 'AppleExerciseTime' else None,
            'limitation': 'Workout elapsed includes pauses, duplicate workouts and non-qualifying activity; raw Exercise credit includes activity outside workouts. Neither is a reference truth.'}
    report['related_types'] = {'status': 'measured', 'reason': 'Exploratory source-selected daily cumulative sums; shared algorithms and recording opportunity confound these relationships.', 'evidence': report['daily_relationships']}
    report['extreme_intervals'] = focus.sort_values('value').iloc[list(range(min(5,len(focus)))) + list(range(max(5,len(focus)-5),len(focus)))][['value','duration_s','rate_per_min','context']].to_dict(orient='records')
    report['profile_influence'] = {'status': 'unsupported', 'reason': 'No longitudinal calibration/body-profile changes or indirect calorimetry. Observational series cannot identify Apple estimation formula or metabolic change.'}
    return clean_json(report)


def figures(data, suffix, dest, evidence_dest):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.size': 11, 'svg.fonttype': 'none'})
    rows = selected_rows(data, suffix)
    rows = rows[(rows.start_ts >= FOCUS_START) & (rows.start_ts < FOCUS_END)].copy()
    if rows.empty:
        return []
    rows['duration_s'] = (rows.end_ts-rows.start_ts).dt.total_seconds()
    rows['rate'] = rows.value/(rows.duration_s/60)
    unit = TYPES[suffix][2]
    labels, values, counts = [], [], []
    for key,label in [('other_or_unknown', 'Other / unknown'), ('workout', 'Workout overlap'), ('sleep', 'Sleep overlap')]:
        g = rows[(rows.context == key) & (rows.duration_s >= 1) & np.isfinite(rows.rate)]
        if len(g)>=10:
            labels.append(label); values.append(g.rate.to_numpy()); counts.append(len(g))
    if not values:
        return []
    fig, ax = plt.subplots(figsize=(8.8,4.8),layout='constrained')
    filename = 'context-rates'
    if suffix == 'AppleExerciseTime':
        daily = rows.groupby('local_day').value.sum().rename('exercise')
        workout = data['workouts'].copy()
        workout = workout[(workout.start_ts >= FOCUS_START) & (workout.start_ts < FOCUS_END)]
        workout['local_day'] = workout.start_ts.dt.tz_convert(TIME_ZONE).dt.strftime('%Y-%m-%d')
        workout['elapsed_min'] = (workout.end_ts-workout.start_ts).dt.total_seconds()/60
        pairs = pd.concat([daily,workout.groupby('local_day').elapsed_min.sum().rename('elapsed')],axis=1).dropna()
        ax.scatter(pairs.elapsed, pairs.exercise, color='#256B86',alpha=.7,s=30)
        limit = max(pairs.max().max(),1)*1.05
        ax.plot([0,limit],[0,limit],linestyle='--',color='#687F89',label='Equal minutes')
        ax.set_xlim(0,limit);ax.set_ylim(0,limit)
        ax.set_xlabel('Recorded workout elapsed time (minutes/day)')
        ax.set_ylabel('Selected-source Exercise credit (minutes/day)')
        ax.set_title(f'Exercise credit differs from workout elapsed time\n{len(pairs)} paired example days',loc='left',pad=12)
        ax.legend(loc='upper left',frameon=False)
        filename='daily-workout'
    else:
        ax.boxplot(values, vert=False, tick_labels=labels, showfliers=False, whis=(5,95), patch_artist=True,
                   boxprops={'facecolor':'#DCEEF5','edgecolor':'#256B86'},medianprops={'color':'#153D52','linewidth':2})
        ax.set_xlabel(f'Average interval rate ({unit}/min)')
        ax.set_title(f'{TYPES[suffix][1]}: interval amounts become rates',loc='left',pad=16)
        ax.set_yticks(range(1,len(labels)+1), [f'{label}\nn = {count:,}' for label,count in zip(labels,counts)])
    ax.grid(axis='x',alpha=.2); ax.spines[['top','right']].set_visible(False)
    dest.mkdir(parents=True,exist_ok=True)
    path=dest/f'{filename}.svg'; fig.savefig(path)
    evidence_dest.mkdir(parents=True,exist_ok=True)
    png=evidence_dest/f'{filename}.png'; fig.savefig(png, dpi=130); plt.close(fig)
    path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')
    return [str(png)]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--figures',type=Path)
    args=parser.parse_args()
    data=load_snapshot(str(args.input))
    paths=[]
    for suffix,(slug,title,unit) in TYPES.items():
        output=args.output/slug
        report=research_report(data,'HKQuantityTypeIdentifier'+suffix,special_analysis=special(data,suffix),references=REFERENCES)
        generated=figures(data,suffix, args.figures/slug if args.figures else output/'figures', output/'figures')
        paths.append(persist_research(report,output,title,input_dir=args.input,special_code=f'special(data, {suffix!r})',
            setup_code='from batch1_energy import special',references=REFERENCES,figures=generated))
    execute_notebooks(paths)
    print(json.dumps({'executed': [str(p) for p in paths]}))

if __name__=='__main__':
    main()
