"""Mindful intervals, occasional waist measurements and steadiness notifications."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from batch_support import (load_snapshot, select_rows, research_report,
                           persist_research, execute_notebooks, clean_json)
from common import annotate_context, describe, TIME_ZONE

TYPES = {
    'MindfulSession': ('category', 'mindful-session'),
    'WaistCircumference': ('quantity', 'waist-circumference'),
    'AppleWalkingSteadinessEvent': ('category', 'apple-walking-steadiness-event'),
}
REFERENCES = {
    'MindfulSession': [
        'https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/mindfulsession',
        'https://support.apple.com/en-ie/guide/watch/apd371dfe3d7/27/watchos/27'],
    'WaistCircumference': [
        'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/waistcircumference',
        'https://www.nhs.uk/conditions/overweight-and-obesity/',
        'https://www.nhs.uk/health-assessment-tools/calculate-your-waist-to-height-ratio'],
    'AppleWalkingSteadinessEvent': [
        'https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/applewalkingsteadinessevent',
        'https://developer.apple.com/documentation/healthkit/hkcategoryvalueapplewalkingsteadinessevent',
        'https://developer.apple.com/videos/play/wwdc2021/10287/',
        'https://support.apple.com/guide/iphone/monitor-your-walking-steadiness-iphff1bf03ed/ios'],
}


def interval_union_minutes(rows):
    """Elapsed union of valid intervals; overlapping imports count once."""
    merged = []
    for start, end in rows[['start_ts', 'end_ts']].dropna().sort_values('start_ts').itertuples(index=False, name=None):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    return sum((end-start).total_seconds()/60 for start, end in merged)


def special(data, identifier):
    suffix = identifier.replace('HKCategoryTypeIdentifier', '').replace('HKQuantityTypeIdentifier', '')
    kind = TYPES[suffix][0]
    rows = select_rows(data, identifier, kind)
    result = {'records': len(rows), 'related_types': [],
              'absence_interpretation': 'No rows means unavailable observations, not zero practice, a normal waist or no fall risk.'}
    if suffix == 'MindfulSession':
        result.update({'allowed_codes': [0], 'category_meaning': 'notApplicable; duration comes from timestamps, not category value.',
                       'quality_and_engagement': 'A timed record does not measure attention, stress, session completion or a treatment response.',
                       'duration_semantics': 'Elapsed stored intervals, not a validated dose; union totals avoid overlapping imports.'})
    elif suffix == 'WaistCircumference':
        result.update({'canonical_unit': 'm', 'display_unit': 'cm', 'display_factor': 100,
                       'measurement_method': 'Identifier does not specify anatomical site, breathing phase, tape tension or calibration; compare consistent methods.',
                       'timing': 'Occasional measurements have logging cadence; sleep/workout overlap does not measure physiological changes within either.',
                       'reference_context': 'NHS waist-to-height guidance is a screening aid with age, BMI and pregnancy exclusions, not a universal HealthKit reference range.'})
    else:
        result.update({'allowed_codes': [1, 2, 3, 4],
                       'event_semantics': 'Initial low/very-low or repeat low/very-low notification; not a fall, percentile or emergency diagnosis.',
                       'documented_cadence': 'Apple WWDC21 describes initial notifications about a month after low/very-low classification, repeats about every three months while classification persists; not a fixed measurement frequency.',
                       'opportunity_denominator': 'Notification settings, eligible phone carry and detection attempts are unavailable; absence cannot establish an OK classification.',
                       'interval_semantics': 'Stored event span cannot establish duration of instability or a physical fall.'})
    related = {'MindfulSession': ['HeartRateVariabilitySDNN', 'HeartRate'],
               'WaistCircumference': ['BodyMass', 'BodyMassIndex', 'Height'],
               'AppleWalkingSteadinessEvent': ['AppleWalkingSteadiness', 'WalkingSpeed']}[suffix]
    if rows.empty:
        for other in related:
            other_rows = select_rows(data, 'HKQuantityTypeIdentifier'+other)
            result['related_types'].append({'identifier': 'HKQuantityTypeIdentifier'+other,
                                           'available_records': len(other_rows), 'paired_records': 0,
                                           'status': 'absent', 'reason': 'Primary type has no records; no relationship estimate is supported.'})
        return result
    a = annotate_context(rows, data)
    duration = (a.end_ts-a.start_ts).dt.total_seconds()/60
    result['interval_minutes'] = describe(duration)
    result['negative_durations'] = int((duration < 0).sum())
    result['zero_durations'] = int((duration == 0).sum())
    result['metadata_keys'] = sorted({k for raw in a.metadata for k in (json.loads(raw) if isinstance(raw, str) and raw else raw if isinstance(raw, dict) else {})})
    if kind == 'category':
        result['unexpected_codes'] = int((~a.value.isin(result['allowed_codes'])).sum())
    if suffix == 'MindfulSession':
        result['raw_minutes_sum'] = float(duration.clip(lower=0).sum())
        result['union_minutes'] = interval_union_minutes(a)
        result['source_patterns'] = []
        for source, g in a.groupby('source_group'):
            d = (g.end_ts-g.start_ts).dt.total_seconds()/60
            result['source_patterns'].append({'source': source, 'records': len(g), 'observed_days': int(g.local_day.nunique()),
                                             'duration_minutes': describe(d), 'sessions_per_observed_day': describe(g.groupby('local_day').size()),
                                             'positive_start_gap_days': describe(g.start_ts.sort_values().diff().dt.total_seconds().div(86400).loc[lambda v: v>0])})
        for other in related:
            b = annotate_context(select_rows(data, 'HKQuantityTypeIdentifier'+other), data)
            per_session = []
            for _, session in a.iterrows():
                for source, g in b.groupby('source_group'):
                    before = g[(g.start_ts >= session.start_ts-pd.Timedelta(minutes=5)) & (g.start_ts < session.start_ts)]
                    during = g[(g.start_ts >= session.start_ts) & (g.start_ts < session.end_ts)]
                    after = g[(g.start_ts >= session.end_ts) & (g.start_ts < session.end_ts+pd.Timedelta(minutes=5))]
                    per_session.append({'source': source, 'before_count': len(before), 'during_count': len(during), 'after_count': len(after),
                                        'before_median': float(before.value.median()) if len(before) else None,
                                        'during_median': float(during.value.median()) if len(during) else None,
                                        'after_median': float(after.value.median()) if len(after) else None})
            eligible = [r for r in per_session if r['before_count'] and r['after_count']]
            result['related_types'].append({'identifier': 'HKQuantityTypeIdentifier'+other, 'available_records': len(b),
                                           'source_session_windows': len(per_session), 'before_after_pairs': len(eligible),
                                           'median_changes': describe(pd.Series([r['after_median']-r['before_median'] for r in eligible], dtype=float)),
                                           'window_counts': per_session, 'limitation': 'Five-minute before/after windows select opportunistic samples; breathing alters HRV and no causal or stress inference is justified.'})
    elif suffix == 'WaistCircumference':
        result['display_cm'] = describe(a.value*100)
        result['nonpositive_values'] = int((a.value<=0).sum())
        result['observed_days'] = int(a.local_day.nunique())
        result['method_provenance'] = 'No anatomical measurement protocol can be independently verified from the quantity identifier.'
        for other in related:
            b = annotate_context(select_rows(data, 'HKQuantityTypeIdentifier'+other), data)
            pairs = pd.concat([a.groupby('local_day').value.median().rename('waist_m'), b.groupby('local_day').value.median().rename('other')], axis=1).dropna()
            result['related_types'].append({'identifier':'HKQuantityTypeIdentifier'+other, 'same_reporting_day_pairs':len(pairs),
                                           'status':'sparse' if len(pairs) else 'absent', 'reason':'Same-day medians do not establish contemporaneous measurements or a verified measurement method.'})
    else:
        for other in related:
            b = select_rows(data, 'HKQuantityTypeIdentifier'+other)
            counts = [int(((b.start_ts >= e.start_ts-pd.Timedelta(days=7)) & (b.start_ts < e.start_ts)).sum()) for _, e in a.iterrows()]
            result['related_types'].append({'identifier':'HKQuantityTypeIdentifier'+other, 'available_records':len(b),
                                           'prior_seven_day_counts':counts, 'reason':'Temporal neighbors do not identify the triggering score or establish a fall.'})
    return clean_json(result)


def figures(data, destination, private):
    rows = annotate_context(select_rows(data, 'HKCategoryTypeIdentifierMindfulSession', 'category'), data)
    if rows.empty:
        return []
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    destination.mkdir(parents=True, exist_ok=True)
    private.mkdir(parents=True, exist_ok=True)
    rows = rows.sort_values('start_ts')
    days = (rows.start_ts-rows.start_ts.min()).dt.total_seconds()/86400
    minutes = (rows.end_ts-rows.start_ts).dt.total_seconds()/60
    fig, ax = plt.subplots(figsize=(9.6, 4.1), layout='constrained')
    ax.scatter(days, minutes, s=35, color='#1c7986', alpha=.75)
    ax.set(xlabel='Days since first recorded session', ylabel='Stored session duration (minutes)', title='Recorded mindfulness sessions vary in duration and spacing')
    ax.grid(alpha=.15)
    ax.spines[['top', 'right']].set_visible(False)
    fig.savefig(destination/'session-pattern.svg', metadata={'Date':None})
    fig.savefig(private/'session-pattern.png', dpi=150)
    plt.close(fig)
    path=destination/'session-pattern.svg'
    path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')
    return [private/'session-pattern.png']


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--figures',type=Path,required=True)
    args=p.parse_args()
    data=load_snapshot(str(args.input.resolve()))
    paths=[]
    for suffix,(kind,key) in TYPES.items():
        identifier=('HKQuantityTypeIdentifier' if kind=='quantity' else 'HKCategoryTypeIdentifier')+suffix
        refs=[{'url':u,'reviewed_on':'2026-10-14'} for u in REFERENCES[suffix]]
        report=research_report(data,identifier,kind=kind,special_analysis=special(data,identifier),references=refs)
        pngs=figures(data,args.figures/key,args.output/key) if suffix=='MindfulSession' else []
        paths.append(persist_research(report,args.output/key,suffix+' research',input_dir=args.input,
                                     setup_code='from batch2_misc import special',special_code=f'special(data, {identifier!r})',references=refs,figures=pngs))
    execute_notebooks(paths)
    print(json.dumps({'executed':len(paths)}))


if __name__=='__main__':
    main()
