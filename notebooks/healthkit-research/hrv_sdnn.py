"""SDNN research plugin. Reads a scoped snapshot and retains all observations."""
from pathlib import Path
import json
import numpy as np
import pandas as pd
from common import (load_data, annotate_context, standard_analysis, describe, cadence,
                    input_manifest, FOCUS_START, FOCUS_END, YEAR_START, TIME_ZONE)

IDENTIFIER = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'


def episodes(intervals, bridge_seconds=0):
    merged = []
    for start, end in intervals[['start_ts', 'end_ts']].dropna().sort_values('start_ts').itertuples(index=False, name=None):
        if end <= start:
            continue
        if merged and start <= merged[-1][1] + pd.Timedelta(seconds=bridge_seconds):
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    return merged


def episode_report(frame, intervals):
    spans = episodes(intervals)
    assignment = pd.Series(-1, index=frame.index)
    counts, gaps, end_gaps = [], [], []
    crossing = 0
    for i, (start, end) in enumerate(spans):
        # Fully contained measurements only; crossing measurements separate.
        overlap = (frame.start_ts < end) & (frame.end_ts > start)
        crossing += int((overlap & ~((frame.start_ts >= start) & (frame.end_ts <= end))).sum())
        inside = frame[(frame.start_ts >= start) & (frame.end_ts <= end) & (frame.start_ts < end)].copy()
        counts.append(len(inside))
        assignment.loc[inside.index] = i
        for _, rows in inside.groupby('source_group'):
            rows = rows.sort_values('start_ts')
            gaps.extend(rows.start_ts.diff().dt.total_seconds().dropna().tolist())
            end_gaps.extend((rows.start_ts - rows.end_ts.shift()).dt.total_seconds().dropna().tolist())
    return {'episodes': len(spans), 'episodes_with_records': int(sum(n > 0 for n in counts)),
            'records_per_episode_including_empty': describe(counts),
            'within_episode_source_start_gaps_seconds': describe(gaps),
            'within_episode_source_end_gaps_seconds': describe(end_gaps),
            'crossing_record_episode_overlaps': crossing}, assignment


def paired(a, b, label):
    rows = pd.concat([a.rename('a'), b.rename('b')], axis=1).dropna()
    return {'alignment': label, 'paired_days': len(rows),
            'spearman_rho': float(rows.a.corr(rows.b, method='spearman')) if len(rows) >= 10 and rows.a.nunique() > 1 and rows.b.nunique() > 1 else None,
            'interpretation': 'Descriptive one-person association; source, time of day, recording opportunity and repeated days confound inference. Minimum 10 paired days; no causal claim or significance test.'}


def analyze(input_dir):
    data = load_data(input_dir)
    report = standard_analysis(data, IDENTIFIER)
    report['input_manifest'] = input_manifest(input_dir)
    frame = annotate_context(data['quantity'][data['quantity'].identifier == IDENTIFIER], data)
    frame = frame[(frame.start_ts >= YEAR_START) & (frame.start_ts < FOCUS_END)].sort_values('start_ts')
    focus = frame[(frame.start_ts >= FOCUS_START) & (frame.start_ts < FOCUS_END)].copy()
    if focus.empty:
        report['type_specific'] = {'status': 'no focus records'}
        return report, frame, focus, data
    sleep = data['sleep']
    sleep = sleep[sleep.value.isin([1, 3, 4, 5])].copy()
    work = data['workouts']
    report['type_specific'] = {
        'definition': 'SDNN is dispersion of normal interbeat intervals, not beats/min, RMSSD or a full-day SDNN reconstructed from short estimates.',
        'focus_context_values': {context: describe(rows.value) for context, rows in focus.groupby('context')},
        'focus_context_cadence_conditioned_not_episode': {context: cadence(rows) for context, rows in focus.groupby('context')},
        'metadata_key_counts': {},
        'algorithm_versions': {},
        'source_versions_focus': [],
        'hourly_focus': [{'hour': int(hour), 'records': len(rows), 'values': describe(rows.value)} for hour, rows in focus.groupby(focus.start_ts.dt.tz_convert(TIME_ZONE).dt.hour)]}
    specific = report['type_specific']
    for metadata in frame.metadata:
        for key in metadata:
            specific['metadata_key_counts'][key] = specific['metadata_key_counts'].get(key, 0) + 1
    for version, rows in frame.groupby(frame.metadata.map(lambda m: str(m.get('HKMetadataKeyAlgorithmVersion', m.get('HKAlgorithmVersion', 'missing'))))):
        specific['algorithm_versions'][version] = {'records': len(rows), 'values': describe(rows.value), 'durations_seconds': describe((rows.end_ts-rows.start_ts).dt.total_seconds())}
    for source, rows in focus.groupby('source_group'):
        for version, revision in rows.groupby('source_version', dropna=False):
            specific['source_versions_focus'].append({'source_group': source, 'source_version': str(version), 'records':len(revision), 'values':describe(revision.value), 'cadence':cadence(revision)})
    focus_sleep = sleep[(sleep.end_ts > FOCUS_START) & (sleep.start_ts < FOCUS_END)]
    focus_work = work[(work.end_ts > FOCUS_START) & (work.start_ts < FOCUS_END)]
    specific['within_sleep_episodes'], _ = episode_report(focus, focus_sleep)
    specific['within_workout_episodes'], _ = episode_report(focus, focus_work)
    # Extremes remain intact. Neighbors do not establish artifact or physiology.
    extreme_indexes = list(dict.fromkeys(focus.nsmallest(5, 'value').index.tolist()+focus.nlargest(5, 'value').index.tolist()))
    specific['extreme_neighbors'] = []
    for ix in extreme_indexes:
        row = focus.loc[ix]
        source_rows = frame[frame.source_group == row.source_group].sort_values('start_ts')
        position = source_rows.index.get_loc(ix)
        nearby = source_rows.iloc[max(0, position-1):position+2]
        specific['extreme_neighbors'].append({'value': float(row.value), 'timestamp': str(row.start_ts), 'context': row.context,
            'duration_seconds': float((row.end_ts-row.start_ts).total_seconds()),
            'neighbors': [{'value':float(r.value), 'gap_minutes':float((r.start_ts-row.start_ts).total_seconds()/60), 'context':r.context} for r in nearby.itertuples()]})
    q1, q3 = focus.value.quantile([.25, .75])
    flagged = (focus.value < q1-1.5*(q3-q1)) | (focus.value > q3+1.5*(q3-q1))
    specific['outlier_sensitivity_retained'] = {'iqr_flags':int(flagged.sum()), 'all_values':describe(focus.value), 'unflagged_values_for_sensitivity_only':describe(focus.loc[~flagged, 'value'])}
    daily = focus.groupby('local_day').value.median()
    specific['related_types'] = {}
    for identifier in ['HKQuantityTypeIdentifierHeartRate', 'HKQuantityTypeIdentifierRestingHeartRate', 'HKQuantityTypeIdentifierRespiratoryRate', 'HKQuantityTypeIdentifierHeartRateVariabilityRMSSD']:
        related = annotate_context(data['quantity'][data['quantity'].identifier == identifier], data)
        if related.empty:
            specific['related_types'][identifier] = {'status':'unavailable in snapshot; not treated as zero'}
            continue
        related = related[(related.start_ts >= FOCUS_START)&(related.start_ts < FOCUS_END)]
        specific.setdefault('related_types_by_source', {})[identifier] = {source: paired(rows.groupby('local_day').value.median(), related[related.source_group == source].groupby('local_day').value.median(), 'Same source-group and local-day recorded medians; contexts and recording opportunities can differ.') for source, rows in focus.groupby('source_group')}
        specific['related_types'][identifier] = paired(daily, related.groupby('local_day').value.median(), 'SDNN and related raw-record medians on the same account-local day, all available contexts; no simultaneous-measurement implication.')
        if identifier == 'HKQuantityTypeIdentifierHeartRate':
            for context in ['sleep', 'other_or_unknown']:
                specific['related_types'][identifier+'_'+context] = paired(focus[focus.context == context].groupby('local_day').value.median(), related[related.context == context].groupby('local_day').value.median(), 'Same-day context-specific raw-record medians; intervals do not imply simultaneous readings.')
    # Union exact sleeping intervals first. Bridge short awake periods only for
    # episode assignment; sum sleeping intervals, never the bridged envelope.
    intervals = episodes(focus_sleep)
    nights = episodes(focus_sleep, 7200)
    night_hours = {}
    for start, end in nights:
        key = end.tz_convert(TIME_ZONE).strftime('%Y-%m-%d')
        duration = sum((min(b,end)-max(a,start)).total_seconds() for a,b in intervals if a<end and b>start)/3600
        night_hours[key] = night_hours.get(key, 0)+duration
    sleep_daily = pd.Series(night_hours, dtype=float)
    daytime = focus[~focus.sleep_overlap].groupby('local_day').value.median()
    specific['previous_sleep_relationship'] = paired(daytime, sleep_daily, 'SDNN not overlapping recorded sleep on wake-day vs union of asleep intervals in sleep episodes ending that local day. Episodes bridge <=2-hour awake gaps solely for assignment; bridged awake time excluded from asleep duration. Naps ending on same day included.')
    mindful = data.get('mindful', pd.DataFrame())
    if mindful.empty:
        specific['mindfulness'] = {'status':'zero mindful-session records in supplied full-year snapshot; cannot attribute clusters to Breathe or mindfulness', 'exported_records':0}
    else:
        from common import overlap_mask
        specific['mindfulness'] = {'status':'temporal overlap only; not proof a session generated HRV', 'exported_records':len(mindful), 'focus_overlap_records':int(overlap_mask(focus, mindful).sum()), 'focus_overlap_values':describe(focus.loc[overlap_mask(focus, mindful), 'value'])}
    specific['limitations'] = ['No beat-level RR series supplied; cannot validate optical artifacts, ectopic-beat filtering, or recompute SDNN.', 'Sleep/workout overlap is temporal context only; sleep source union may combine differing writers.', 'Source revision IDs are not permanent device identities.', 'Raw sample span is stored interval, not a guarantee of validated underlying RR observation length.']
    return report, frame, focus, data


def make_figures(focus, output_dir):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    output = Path(output_dir); output.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({'font.size':11, 'axes.spines.top':False, 'axes.spines.right':False, 'svg.fonttype':'none', 'svg.hashsalt':'pulshealth-hrv-sdnn'})
    relative = (focus.start_ts.dt.tz_convert(TIME_ZONE)-FOCUS_START).dt.total_seconds()/86400
    palette={'sleep':'#6956bc','workout':'#d4652e','other_or_unknown':'#267e88','workout_and_sleep':'#a64f7e'}
    fig, ax = plt.subplots(figsize=(10,4.8), layout='constrained')
    for context, rows in focus.groupby('context'):
        ax.scatter(relative.loc[rows.index],rows.value,s=13,alpha=.5,color=palette[context],label={'sleep':'Recorded sleep overlap','workout':'Workout overlap','other_or_unknown':'Other / unknown','workout_and_sleep':'Sleep + workout overlap'}[context])
    daily = pd.DataFrame({'day':relative.astype(int), 'value':focus.value}).groupby('day').value.median()
    ax.plot(daily.index+.5,daily.values,color='#173e4b',linewidth=1.6,label='Daily recorded-value median')
    ax.set(xlabel='Relative day in 92-day observation window',ylabel='SDNN (ms)',title='Short SDNN estimates fluctuate within each day')
    ax.legend(loc='upper right',fontsize=9); ax.grid(alpha=.15)
    paths=[]
    for suffix in ['svg','png']:
        path=output/f'values.{suffix}'; fig.savefig(path,dpi=160,metadata={'Date':None,'Creator':'PulsHealth research'} if suffix == 'svg' else {'Software':'PulsHealth research'}); paths.append(str(path))
    plt.close(fig)
    counts = pd.Series(1,index=relative.astype(int)).groupby(level=0).sum().reindex(range(92),fill_value=0)
    fig, axes=plt.subplots(1,2,figsize=(10,4.4),layout='constrained')
    axes[0].bar(counts.index+.5,counts.values,color='#267e88',width=.9)
    axes[0].set(xlabel='Relative day',ylabel='SDNN records',title='Recording opportunity varies by day')
    gaps=focus.sort_values('start_ts').start_ts.diff().dt.total_seconds().dropna()/60
    positive=gaps[gaps>0]
    axes[1].hist(positive,bins=np.geomspace(max(positive.min(),.01),positive.max()*1.001,25),color='#6956bc')
    axes[1].set_xscale('log');axes[1].set(xlabel='Start-to-start gap (minutes, log scale)',ylabel='Record pairs',title='No universal sampling interval')
    for ax in axes:ax.grid(alpha=.15)
    for suffix in ['svg','png']:
        path=output/f'cadence.{suffix}';fig.savefig(path,dpi=160,metadata={'Date':None,'Creator':'PulsHealth research'} if suffix == 'svg' else {'Software':'PulsHealth research'});paths.append(str(path))
    plt.close(fig)
    return paths


def main():
    import argparse
    import nbformat
    from nbclient import NotebookClient
    from common import write_notebook
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    setup = ('import sys, json\nfrom pathlib import Path\n'
             f'sys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\n'
             'from hrv_sdnn import analyze, make_figures\n'
             f'INPUT_DIR = Path({str(args.input.resolve())!r})\n'
             f'OUTPUT_DIR = Path({str(args.output.resolve())!r})\n'
             'report, frame, focus, data = analyze(INPUT_DIR)\n'
             '(OUTPUT_DIR / "findings.json").write_text(json.dumps(report, indent=2, allow_nan=False))\n'
             'print(json.dumps({"input_manifest": report["input_manifest"], "windows": report["windows"], "limitations": report["limitations"]}, indent=2))')
    sections = [
        {'heading':'Scope, source and reproducibility', 'markdown':'Read-only single-person Grey export: full year for source/season checks, 92-day focus for examples. CSV hashes identify the inputs. Account calendar is America/Los_Angeles. Start-selected export omits records beginning before the full-year boundary; first-day context is incomplete. Context uses any half-open overlap of recorded asleep intervals or workouts, not an explicit HealthKit association. No exclusions for extreme values. Missing time is not zero HRV.', 'code':setup},
        {'heading':'Coverage, values and cadence', 'code':'print(json.dumps({k:report[k] for k in ["year","focus","units","invalid_timestamps"]}, indent=2))'},
        {'heading':'Sources, versions, context and outliers', 'code':'print(json.dumps({k:report[k] for k in ["source_revisions","by_source_context","monthly","local_hour_record_counts"]}, indent=2))'},
        {'heading':'SDNN-specific analysis and relationships', 'markdown':'Within-episode gaps require fully contained records and matching source group; spanning measurements are reported separately. Context-conditioned global gaps can cross episodes and are not measurement frequency inside an episode. IQR flags remain descriptive. Sleep joins use exact asleep-interval union and wake-date attribution. Same-day medians are not simultaneous measurements. Mindful-session availability and any temporal overlaps are reported explicitly; breathing/session causation is not inferred.', 'code':'print(json.dumps(report["type_specific"], indent=2))'},
        {'heading':'Real-data examples', 'code':'from IPython.display import display, Image\npaths = make_figures(focus, OUTPUT_DIR)\nfor path in paths:\n    if path.endswith(".png"):\n        display(Image(filename=path))'},
        {'heading':'Interpretation and source checks', 'markdown':'No beat-level RR series was supplied, so artifact rejection, normal-beat selection and SDNN computation cannot be independently verified. Automatic records are discrete estimates, not a fixed schedule. Stored interval duration is not proof of the validated RR recording length. Short SDNN estimates and 24-hour Holter SDNN have different meanings; no fixed clinical thresholds or conversion are applied. RMSSD is a distinct metric introduced to HealthKit in iOS/watchOS27; no matching RMSSD observations in a snapshot is not absence of HRV. Primary references: [Apple SDNN](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn), [Apple RMSSD](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilityrmssd), [2024 Society for Psychophysiological Research committee report](https://pmc.ncbi.nlm.nih.gov/articles/PMC11539922/), [1996 task force](https://www.escardio.org/static-file/Escardio/Guidelines/Scientific-Statements/guidelines-Heart-Rate-Variability-FT-1996.pdf). Apple structured documentation checked on review date confirms discrete time-unit SDNN and RMSSD availability; no UI display name inferred.'}]
    notebook_path=args.output/'research.ipynb'
    write_notebook(notebook_path, 'Heart-rate variability (SDNN): executed data research', sections)
    notebook=nbformat.read(notebook_path,as_version=4)
    NotebookClient(notebook,timeout=600,kernel_name='python3').execute()
    nbformat.write(notebook,notebook_path)


if __name__ == '__main__':
    main()
