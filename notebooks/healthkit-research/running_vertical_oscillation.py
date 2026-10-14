"""Research running vertical oscillation from a private single-person snapshot.

No database connection; public figures omit dates, source names and identifiers.
Run with --input and --output. Research is persisted before article editing.
"""
from pathlib import Path
import argparse
import json

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from common import (FOCUS_START, FOCUS_END, annotate_context, cadence, describe,
                    input_manifest, load_data, standard_analysis, write_notebook)

IDENTIFIER = 'HKQuantityTypeIdentifierRunningVerticalOscillation'
RELATED = {'speed': 'HKQuantityTypeIdentifierRunningSpeed',
           'stride': 'HKQuantityTypeIdentifierRunningStrideLength',
           'contact': 'HKQuantityTypeIdentifierRunningGroundContactTime',
           'heart_rate': 'HKQuantityTypeIdentifierHeartRate'}


def assign_runs(frame, runs):
    result = frame.copy()
    result['run_uuid'] = None
    result['run_start'] = pd.Series(pd.NaT, index=result.index, dtype='datetime64[ns, UTC]')
    result['ambiguous_run_count'] = 0
    for run in runs.itertuples():
        match = (result.start_ts >= run.start_ts) & (result.start_ts < run.end_ts)
        result.loc[match, 'ambiguous_run_count'] += 1
        result.loc[match, 'run_uuid'] = str(run.uuid)
        result.loc[match, 'run_start'] = run.start_ts
    result.loc[result.ambiguous_run_count > 1, 'run_uuid'] = None
    return result


def paired_metric(frame, quantity, identifier):
    """Nearest starts within 5 seconds, same unique run and bundle/name group.

    Sample-level pairs are observational and can reuse a related sample. They
    are not independent subjects and no significance tests are interpreted.
    """
    rows = []
    related = quantity[quantity.identifier == identifier]
    for (run, source), left in frame.dropna(subset=['run_uuid']).groupby(['run_uuid', 'source_group']):
        right = related[(related.run_uuid == run) & (related.source_group == source)]
        if right.empty:
            continue
        paired = pd.merge_asof(left.sort_values('start_ts'),
            right[['start_ts', 'value']].rename(columns={'value':'related_value', 'start_ts':'related_ts'}).sort_values('related_ts'),
            left_on='start_ts', right_on='related_ts', direction='nearest', tolerance=pd.Timedelta(seconds=5))
        paired['pair_offset_s'] = (paired.start_ts-paired.related_ts).dt.total_seconds().abs()
        rows.append(paired.dropna(subset=['related_value']))
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def analyze(input_dir, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    data = load_data(input_dir)
    report = standard_analysis(data, IDENTIFIER)
    report['inputs'] = input_manifest(input_dir)
    report['sources_reviewed'] = [
        {'url':'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/runningverticaloscillation', 'claim':'Discrete length samples; outdoor-running automatic collection on supported Apple Watch.'},
        {'url':'https://support.apple.com/en-ie/guide/watch/apd1f24d4d35/watchos', 'claim':'Torso movement in cm; speed, stride length and ground contact complement the metric.'},
        {'url':'https://pubmed.ncbi.nlm.nih.gov/28263283/', 'claim':'Observational running biomechanics/economy study; no universal wearable diagnostic threshold.'}]
    if report['status'] != 'completed':
        return report, []
    quantity = annotate_context(data['quantity'], data)
    workouts = data['workouts']
    runs = workouts[(workouts.activity_type.astype(str).str.lower() == 'running') | (pd.to_numeric(workouts.activity_type, errors='coerce') == 37)].copy()
    quantity = assign_runs(quantity, runs)
    frame = quantity[quantity.identifier == IDENTIFIER].copy()
    focus = frame[(frame.start_ts >= FOCUS_START) & (frame.start_ts < FOCUS_END)].copy()
    report['running_context'] = {'run_workouts':len(runs), 'records_with_unique_run_overlap':int(frame.run_uuid.notna().sum()),
        'records_with_ambiguous_overlap':int((frame.ambiguous_run_count>1).sum()),
        'records_without_run_overlap':int((frame.ambiguous_run_count==0).sum()),
        'method':'Point/start overlap, running=37 verified against HealthKit SDK. Not explicit sample-workout association.',
        'workout_events_present':int(workouts.events.map(bool).sum()) if 'events' in workouts else None,
        'workout_duration_vs_wall_seconds':describe((runs.end_ts-runs.start_ts).dt.total_seconds()-runs.duration_s) if 'duration_s' in runs else None,
        'sleep_overlap_start_count':int(focus.sleep_overlap.sum()),
        'within_run_cadence':[{'records':len(group), 'cadence':cadence(group)} for _,group in focus.dropna(subset=['run_uuid']).groupby(['run_uuid','source_group'])]}
    report['representation_by_month'] = [
        {'month':month, 'records':len(group), 'point_records':int((group.start_ts==group.end_ts).sum()),
         'duration_seconds':describe((group.end_ts-group.start_ts).dt.total_seconds())}
        for month,group in frame.groupby('local_month')]
    report['run_weighted_focus_medians'] = describe(focus.dropna(subset=['run_uuid']).groupby('run_uuid').value.median())
    event_types = {}
    for events in runs.events if 'events' in runs else []:
        if isinstance(events,list):
            for event in events:
                key=event.get('type','unknown');event_types[key]=event_types.get(key,0)+1
    report['running_event_types'] = event_types
    report['boundary_limitation'] = 'Context records beginning before the annual export boundary are absent; boundary context is incomplete.'
    report['related_types'] = {}
    pairs = {}
    for label, identifier in RELATED.items():
        pair = paired_metric(focus, quantity, identifier)
        pairs[label] = pair
        valid = pair[np.isfinite(pair.value)&np.isfinite(pair.related_value)] if not pair.empty else pair
        report['related_types'][label] = {'identifier':identifier, 'pairs':len(valid),
            'runs':int(valid.run_uuid.nunique()) if len(valid) else 0,
            'pairing':'Nearest start <=5s, same unique overlapping run, same source bundle and display name; reusable related observations.',
            'spearman':float(valid.value.corr(valid.related_value, method='spearman')) if len(valid)>=30 and valid.related_value.nunique()>1 and valid.value.nunique()>1 else None,
            'offset_seconds':describe(valid.pair_offset_s) if len(valid) else {},
            'related_units':sorted(quantity.loc[quantity.identifier==identifier,'unit'].dropna().unique().tolist()),
            'unsupported_reason':None if len(valid)>=30 else 'Insufficient matches for descriptive correlation (minimum 30).'}
    speed = pairs['speed']
    if not speed.empty:
        speed = speed[(speed.related_value > 0) & np.isfinite(speed.related_value)].copy()
        speed['pace_min_km'] = 1000/(60*speed.related_value)
        speed['pace_band'] = pd.cut(speed.pace_min_km,[0,4,5,6,7,8,10,np.inf])
        report['pace_strata'] = [{'pace_min_km':str(band),'pairs':len(group),'runs':group.run_uuid.nunique(),'oscillation_cm':describe(group.value)} for band,group in speed.groupby('pace_band',observed=True)]
        early_late = []
        end_map = runs.set_index('uuid').end_ts
        for run_id,group in speed.groupby('run_uuid'):
            run_end=end_map.get(run_id)
            if run_end is None: continue
            fraction=(group.start_ts-group.run_start).dt.total_seconds()/(run_end-group.run_start).dt.total_seconds()
            for band,matched in group.assign(phase=np.select([fraction<=.25,fraction>=.75],['early','late'],default='middle')).groupby('pace_band',observed=True):
                early=matched[matched.phase=='early'].value;late=matched[matched.phase=='late'].value
                if len(early)>=10 and len(late)>=10:
                    early_late.append({'pace_band':str(band),'early_n':len(early),'late_n':len(late),'late_minus_early_median_cm':float(late.median()-early.median())})
        report['pace_matched_early_late']={'comparisons':early_late,'minimum_per_phase':10,'method':'First/last wall-time quartile within same run and same 1-min/km pace band. No fatigue diagnosis; grade, pauses and effort unmeasured.'}
        report['within_run_speed_spearman'] = [{'pairs':len(group),'spearman':float(group.value.corr(group.related_value,method='spearman'))} for _,group in speed.groupby('run_uuid') if len(group)>=30 and group.value.nunique()>1 and group.related_value.nunique()>1]
    if report['related_types']['speed']['related_units'] != ['m/s']:
        raise ValueError('Running speed must be canonical m/s for pace conversion')
    stride = pairs['stride']
    if not stride.empty:
        if sorted(frame.unit.dropna().unique()) != ['cm'] or report['related_types']['stride']['related_units'] != ['m']:
            raise ValueError('Vertical ratio needs oscillation cm and stride m')
        stride = stride[stride.related_value>0].copy()
        # Canonical length is meters for stride and centimeters for oscillation.
        stride['vertical_ratio_percent'] = stride.value / stride.related_value
        report['vertical_ratio_percent'] = describe(stride.vertical_ratio_percent)
        report['vertical_ratio_method'] = '100*(oscillation_cm/100)/stride_m; matched samples, no optimal threshold.'
    outlier_diagnostics = []
    annual_speed = paired_metric(frame, quantity, RELATED['speed'])
    speed_by_uuid = annual_speed.set_index('uuid') if not annual_speed.empty else pd.DataFrame()
    for (source,context),group in frame.groupby(['source_group','context']):
        q1,q3=group.value.quantile([.25,.75]);lo=q1-1.5*(q3-q1);hi=q3+1.5*(q3-q1)
        flagged=group[(group.value<lo)|(group.value>hi)]
        for row in flagged.itertuples():
            episode=frame[(frame.run_uuid==row.run_uuid)&(frame.source_group==source)].sort_values('start_ts')
            neighbors=episode[(episode.start_ts>=row.start_ts-pd.Timedelta(seconds=30))&(episode.start_ts<=row.start_ts+pd.Timedelta(seconds=30))]
            prior=episode[episode.start_ts<row.start_ts].tail(1)
            following=episode[episode.start_ts>row.start_ts].head(1)
            match=speed_by_uuid.loc[row.uuid] if row.uuid in speed_by_uuid.index else None
            if isinstance(match,pd.DataFrame):match=match.iloc[0]
            outlier_diagnostics.append({'uuid':str(row.uuid),'start':row.start_ts.isoformat(),'value_cm':float(row.value),
                'source_group':source,'context':context,'run_uuid':row.run_uuid,
                'duration_seconds':(row.end_ts-row.start_ts).total_seconds(),
                'same_run_median_cm':float(episode.value.median()) if len(episode) else None,
                'neighbor_window_seconds':30,'neighbor_values_cm':neighbors.value.tolist(),
                'prior_start_gap_seconds':(row.start_ts-prior.start_ts.iloc[0]).total_seconds() if len(prior) else None,
                'next_start_gap_seconds':(following.start_ts.iloc[0]-row.start_ts).total_seconds() if len(following) else None,
                'matched_speed_m_s':float(match.related_value) if match is not None else None,
                'speed_offset_seconds':float(match.pair_offset_s) if match is not None else None})
    report['outlier_diagnostics']={'method':'Annual source/context 1.5 IQR flags retained. Same-source unique run neighbors +/-30s, episode median and speed paired <=5s. No diagnosis or exclusion.',
        'flagged_records':outlier_diagnostics,'interpretation':'Review isolated excursions against neighboring observations, interval shape and pace. Neither IQR flags nor local disagreement proves error or injury.'}
    report['type_specific_limitations'] = [
        'Same source group is not proof of same persistent device. Unit conversions depend on canonical catalog.',
        'Cadence between stored samples is not step cadence. There is no running-step-cadence quantity type in this snapshot.',
        'Pauses and workout duration require separate event semantics; wall-time figures do not imply active running time.',
        'No route, grade, footwear, body geometry or oxygen-consumption measurements establish running economy.',
        'Quarter distributions and pace correlations are repeated samples from one person, not independent participant estimates.',
        'Workout series and quantity samples are alternate representations and are never combined for record counts.',
        'Sleep/nonworkout absence cannot establish a physiological range for that context.']
    series = data['workout_series']
    report['workout_series_comparison'] = {'records':int((series.identifier==IDENTIFIER).sum()) if 'identifier' in series else 0, 'policy':'Separate representation; not unioned with raw quantities.'}
    figures = []
    plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white'})
    if not focus.empty:
        fig,ax=plt.subplots(figsize=(9,4.8))
        ax.hist(focus.value.dropna(),bins=35,color='#19816f',edgecolor='white')
        ax.set(xlabel='Vertical oscillation (cm)',ylabel='Stored observations',title='Running bounce varies within one person’s data')
        fig.text(.12,.015,'One person · July–September 2026 · sample counts, not steps or clinical thresholds',fontsize=9,color='#555')
        fig.tight_layout(rect=(0,.05,1,1)); path=output_dir/'distribution.png';fig.savefig(path,dpi=170);plt.close(fig);figures.append(path)
    if not speed.empty:
        # One representative session: most paired records, tie broken lexically.
        chosen=speed.groupby('run_uuid').size().sort_values(ascending=False).index[0]
        selected=speed[speed.run_uuid==chosen].sort_values('start_ts').copy()
        selected['elapsed_min']=(selected.start_ts-selected.run_start).dt.total_seconds()/60
        fig,(a,b)=plt.subplots(2,1,figsize=(9,6),sharex=True)
        a.scatter(selected.elapsed_min,selected.value,s=7,color='#19816f'); a.set(ylabel='Oscillation (cm)',title='One run: bounce and pace change together')
        b.scatter(selected.elapsed_min,selected.pace_min_km,s=7,color='#7253a2');b.set(xlabel='Elapsed workout time (minutes)',ylabel='Pace (min/km)');b.invert_yaxis()
        fig.text(.12,.015,'Nearest start ≤5 seconds · same source and run overlap · elapsed time includes pauses',fontsize=9,color='#555')
        fig.tight_layout(rect=(0,.04,1,1));path=output_dir/'one-run.png';fig.savefig(path,dpi=170);plt.close(fig);figures.append(path)
        report['public_session_selection']={'method':'Maximum Q3 matched speed pairs; no dates or IDs on figure.','pairs':len(selected),'elapsed_minutes':describe(selected.elapsed_min),'oscillation_cm':describe(selected.value),'pace_min_km':describe(selected.pace_min_km)}
    # Ensure strict JSON even when numpy computes NaN for small groups.
    report=json.loads(json.dumps(report,default=lambda x:int(x) if isinstance(x,np.integer) else str(x)))
    def clean(obj):
        if isinstance(obj,float) and not np.isfinite(obj): return None
        if isinstance(obj,dict): return {k:clean(v) for k,v in obj.items()}
        if isinstance(obj,list): return [clean(v) for v in obj]
        return obj
    report=clean(report)
    (output_dir/'research.json').write_text(json.dumps(report,indent=2,allow_nan=False))
    return report, figures


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report,figures=analyze(args.input,args.output)
    code=('from pathlib import Path\nimport sys,json\n'
          f'FRAMEWORK_DIR=Path({str(Path(__file__).resolve().parent)!r})\n'
          'sys.path.insert(0,str(FRAMEWORK_DIR))\nfrom running_vertical_oscillation import analyze\n'
          f'report,figures=analyze(Path({str(args.input)!r}),Path({str(args.output)!r}))\n'
          'print(json.dumps(report,indent=2,allow_nan=False))')
    write_notebook(args.output/'research.ipynb','Running vertical oscillation — recorded values, cadence and running context',[
        {'heading':'Questions and analysis contract','markdown':'All common facets are evaluated before editing the article. Related metrics use nearest starts within five seconds, unique running-workout overlap and matching source group. Running workout type 37 is checked against the HealthKit SDK. Sample intervals are not individual strides. Context overlap is not an explicit HealthKit association. Pauses remain on the elapsed-time axis. All outliers remain in the research and plotted distributions.'},
        {'heading':'Execute the complete research','code':code,'output':report,'figures':figures},
        {'heading':'Interpretation limits','markdown':'Single-person descriptive examples, not clinical ranges. Correlations between repeated observations do not demonstrate causation, improved fitness, fatigue or injury risk. No oxygen consumption, route/grade or controlled pace comparison supports an economy conclusion. Unsupported contexts and insufficient matches are reported explicitly.'}])
    # Keep figures executable so nbclient retains newly generated embedded PNGs.
    import nbformat
    notebook_path=args.output/'research.ipynb'
    notebook=nbformat.read(notebook_path,as_version=4)
    figure_index=0
    for cell in notebook.cells:
        if cell.cell_type=='code' and cell.source.startswith('# Figure generated'):
            cell.source='from IPython.display import Image, display\ndisplay(Image(filename='+repr(str(figures[figure_index]))+'))'
            figure_index+=1
    from nbclient import NotebookClient
    NotebookClient(notebook,timeout=300,kernel_name='python3').execute()
    nbformat.write(notebook,notebook_path)
    print(json.dumps({'status':report['status'],'figures':list(map(str,figures))}))

if __name__=='__main__': main()
