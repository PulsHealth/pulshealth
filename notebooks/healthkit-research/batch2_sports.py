"""Swimming interval pairing and downhill run evidence from private snapshots."""
from pathlib import Path
import argparse
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from common import annotate_context, describe, cadence, overlap_mask
from batch_support import load_snapshot, select_rows, research_report, persist_research, execute_notebooks, clean_json

IDS = {
    'distance-downhill-snow-sports': 'HKQuantityTypeIdentifierDistanceDownhillSnowSports',
    'distance-swimming': 'HKQuantityTypeIdentifierDistanceSwimming',
    'swimming-stroke-count': 'HKQuantityTypeIdentifierSwimmingStrokeCount',
}
BASE = 'https://developer.apple.com/documentation/healthkit/'
REFS = {
    'distance-downhill-snow-sports': [BASE+'hkquantitytypeidentifier/distancedownhillsnowsports', BASE+'receiving-downhill-skiing-and-snowboarding-data'],
    'distance-swimming': [BASE+'hkquantitytypeidentifier/distanceswimming', 'https://support.apple.com/guide/watch/go-for-a-swim-apd09135915f/watchos', BASE+'hkmetadatakeylaplength'],
    'swimming-stroke-count': [BASE+'hkquantitytypeidentifier/swimmingstrokecount', BASE+'hkmetadatakeyswimmingstrokestyle', BASE+'hkswimmingstrokestyle', 'https://support.apple.com/guide/watch/go-for-a-swim-apd09135915f/watchos'],
}

def investigate(data, identifier):
    rows = select_rows(data, identifier)
    snow = identifier.endswith('DistanceDownhillSnowSports')
    workouts = data['workouts']
    relevant = workouts[workouts.activity_type.str.contains('ski|snow' if snow else 'swim', case=False, na=False)]
    result = {'records': len(rows), 'matching_activity_workouts': len(relevant),
              'semantics': 'Cumulative interval amounts; stored intervals and source-specific sums do not establish lap/run events or explicit workout linkage.',
              'workout_event_records': int(relevant.events.map(bool).sum()),
              'workout_stats_detail_records': int(relevant.stats_detail.map(bool).sum()),
              'workout_metadata_keys': sorted({key for meta in relevant.metadata for key in meta}),
              'no_inference': 'Absence is not zero activity. No season trend, fatigue, efficiency, or lift detection can be established without corresponding observations.'}
    if rows.empty:
        result['status'] = 'absent'
        result['special_checks'] = ('Run-ending distance, segments, lift/pause separation, elevation descent and source definition unavailable.' if snow else 'Pool/open-water provenance, configured length, lap pairing, stroke style, rests, and SWOLF cannot be measured without raw rows.')
        return result
    rows = annotate_context(rows, data)
    result['sources'] = []
    for source, group in rows.groupby('source_group'):
        durations = (group.end_ts-group.start_ts).dt.total_seconds()
        entry = {'source': source, 'records': len(group), 'days': int(group.local_day.nunique()),
                 'values': describe(group.value), 'source_raw_total': float(group.value.sum()),
                 'duration_seconds': describe(durations), 'cadence': cadence(group),
                 'nonpositive_duration_rows': int((durations<=0).sum()),
                 'fractional_amount_rows': int((~np.isclose(group.value%1, 0)).sum()),
                 'negative_amount_rows': int((group.value<0).sum()),
                 'matching_activity_overlap_records': int(overlap_mask(group,relevant).sum()),
                 'all_workout_overlap_records': int(group.workout_overlap.sum()),
                 'asleep_overlap_records': int(group.sleep_overlap.sum()),
                 'sample_metadata_keys': sorted({key for meta in group.metadata for key in meta}),
                 'stroke_style_raw_counts': pd.Series([str(meta.get('HKSwimmingStrokeStyle','missing')) for meta in group.metadata]).value_counts().to_dict(),
                 'observed_daily_raw_sums': describe(group.groupby('local_day').value.sum())}
        result['sources'].append(entry)
    if not snow:
        distance = annotate_context(select_rows(data,IDS['distance-swimming']),data)
        strokes = annotate_context(select_rows(data,IDS['swimming-stroke-count']),data)
        keys = ['start_ts','end_ts','source_group']
        result['swim_metadata'] = [{key: meta[key] for key in ('HKLapLength','HKSwimmingLocationType') if key in meta} for meta in relevant.metadata]
        if len(distance) and len(strokes):
            eligible_d = distance[~distance.duplicated(keys,keep=False)]
            eligible_s = strokes[~strokes.duplicated(keys,keep=False)]
            paired = eligible_d.merge(eligible_s,on=keys,suffixes=('_distance','_strokes'),validate='one_to_one')
            positive = paired[(paired.value_distance>0)&(paired.value_strokes>0)]
            result['interval_pairing'] = {'exact_unique_source_interval_pairs': len(paired),
                'ambiguous_distance_rows_excluded': len(distance)-len(eligible_d),
                'ambiguous_stroke_rows_excluded': len(strokes)-len(eligible_s),
                'positive_pairs': len(positive),
                'metres_per_recorded_stroke': describe(positive.value_distance/positive.value_strokes),
                'note': 'Same-source exact interval alignment is a descriptive pairing, not verified HealthKit lap membership. No SWOLF: lap event/timing evidence required.'}
        else:
            result['interval_pairing'] = {'status':'absent','distance_records':len(distance),'stroke_records':len(strokes)}
        result['related_types'] = result['interval_pairing']
    return clean_json(result)

def make_figure(data, identifier, output):
    rows = annotate_context(select_rows(data,identifier),data)
    if rows.empty:
        return []
    source = rows.source_group.value_counts().index[0]
    rows = rows[rows.source_group==source].sort_values('start_ts')
    unit = 'strokes' if identifier.endswith('SwimmingStrokeCount') else 'm'
    fig, axes = plt.subplots(1,2,figsize=(10,4),layout='constrained')
    elapsed = (rows.start_ts-rows.start_ts.min()).dt.total_seconds()/60
    if rows.local_day.nunique()==1:
        axes[0].scatter(elapsed,rows.value,s=22,color='#059ca8')
        axes[0].set_xlabel('Minutes since first stored interval')
    else:
        axes[0].hist(rows.value,bins=20,color='#059ca8')
        axes[0].set_xlabel(f'Amount per interval ({unit})')
    axes[0].set_ylabel(f'Amount per interval ({unit})' if rows.local_day.nunique()==1 else 'Records')
    duration = (rows.end_ts-rows.start_ts).dt.total_seconds()
    axes[1].hist(duration,bins=20,color='#467fc7')
    axes[1].set_xlabel('Stored interval duration (seconds)');axes[1].set_ylabel('Records')
    fig.suptitle(f'Example data · {len(rows)} intervals · {rows.local_day.nunique()} recording day(s)')
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    path=output/'intervals.png';fig.savefig(path,dpi=150);plt.close(fig)
    return [path]

def run(input_dir, output, figures):
    data=load_snapshot(str(Path(input_dir).resolve()));paths=[]
    for slug,identifier in IDS.items():
        special=investigate(data,identifier)
        report=research_report(data,identifier,special_analysis=special,references=REFS[slug])
        pics=make_figure(data,identifier,Path(figures)/slug)
        paths.append(persist_research(report,Path(output)/slug,slug,input_dir=input_dir,
            setup_code='from batch2_sports import investigate',special_code=f'investigate(data,{identifier!r})',references=REFS[slug],figures=pics))
    execute_notebooks(paths)
    return paths

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);parser.add_argument('--figures',required=True)
    args=parser.parse_args();run(args.input,args.output,args.figures)
