"""Cardio-summary research: retain extremes, inspect provenance and temporal associations.

Public plots use relative reporting-day positions and anonymous source labels.
No clinical inference, device identity or causal effect is estimated.
"""
from pathlib import Path
from collections import Counter
import json
import numpy as np
import pandas as pd
from common import annotate_context, describe, YEAR_START, YEAR_END, FOCUS_START, FOCUS_END, TIME_ZONE

IDS = ['VO2Max', 'RestingHeartRate', 'WalkingHeartRateAverage', 'HeartRateRecoveryOneMinute', 'HeartRateVariabilityRMSSD']

def frame_for(data, identifier):
    q = data.get('quantity', pd.DataFrame())
    rows = annotate_context(q[q.identifier == identifier], data)
    if rows.empty:
        return rows
    return rows[(rows.start_ts >= YEAR_START) & (rows.start_ts < YEAR_END)].sort_values('start_ts')

def analyze(data, identifier):
    rows = frame_for(data, identifier)
    report = {'definition_caveat': 'Derived summary timestamps/intervals are not continuous measurements during their entire intervals. Context overlap is temporal only.',
              'interpretation': 'Example observational associations; source selection, summary construction and shared dates confound comparisons.'}
    if rows.empty:
        report.update(status='verified_no_exported_records', unavailable='No empirical range, outliers, intervals, source changes, workout/sleep contrasts or correlations can be measured for this identifier; SDNN cannot substitute for RMSSD.')
        report['related_available_counts'] = {i:len(frame_for(data,'HKQuantityTypeIdentifier'+i)) for i in IDS + ['HeartRateVariabilitySDNN']}
        return report
    focus = rows[(rows.start_ts >= FOCUS_START) & (rows.start_ts < FOCUS_END)]
    report['metadata_keys'] = dict(Counter(k for m in rows.metadata for k in m))
    report['metadata_values'] = {k: dict(Counter(str(m[k]) for m in rows.metadata if k in m)) for k in report['metadata_keys']}
    report['source_focus'] = {s:{'records':len(g),'days':g.local_day.nunique(),'values':describe(g.value), 'duration_seconds':describe((g.end_ts-g.start_ts).dt.total_seconds()), 'records_per_day':describe(g.groupby('local_day').size()), 'positive_gap_hours':describe(g.start_ts.diff().dt.total_seconds().loc[lambda x:x>0]/3600)} for s,g in focus.groupby('source_group')}
    report['focus_context'] = {s:{'records':len(g),'values':describe(g.value)} for s,g in focus.groupby('context')}
    report['source_monthly_history'] = [{'source_group':source,'month':month,'records':len(g),'days':g.local_day.nunique(),'values':describe(g.value),'source_versions':sorted(g.source_version.dropna().astype(str).unique().tolist()),'positive_gap_hours':describe(g.start_ts.diff().dt.total_seconds().loc[lambda x:x>0]/3600)} for (source,month),g in rows.groupby(['source_group','local_month'])]
    report['within_episode_cadence_caveat'] = 'For daily summaries, workout/sleep interval membership reflects broad summary duration, not observation cadence during an episode. For VO2 and recovery points, nearest-workout opportunity and test metadata are inspected; isolated points do not establish within-workout physiological sampling frequency.'
    report['same_day_sources'] = {'days_multiple_source_groups':int((focus.groupby('local_day').source_group.nunique()>1).sum()),'days_multiple_records':int((focus.groupby('local_day').size()>1).sum())}
    report['extremes_with_neighbors'] = []
    for ix in dict.fromkeys(rows.nsmallest(3,'value').index.tolist()+rows.nlargest(3,'value').index.tolist()):
        row = rows.loc[ix]; source = rows[rows.source_group == row.source_group]; pos = source.index.get_loc(ix)
        report['extremes_with_neighbors'].append({'value':float(row.value),'timestamp':str(row.start_ts),'context':row.context,'metadata':row.metadata,'source_group':row.source_group,'neighbors':[{'value':float(r.value),'gap_hours':float((r.start_ts-row.start_ts).total_seconds()/3600)} for r in source.iloc[max(0,pos-1):pos+2].itertuples()]})
    report['daily_relationships'] = {}
    for other in ['RestingHeartRate','WalkingHeartRateAverage','VO2Max','HeartRateRecoveryOneMinute','HeartRateVariabilitySDNN','HeartRateVariabilityRMSSD','AppleExerciseTime']:
        full = 'HKQuantityTypeIdentifier'+other
        if full == identifier: continue
        related = frame_for(data, full)
        comparisons = {}
        if not related.empty:
            related = related[(related.start_ts>=FOCUS_START)&(related.start_ts<FOCUS_END)]
            for s,g in focus.groupby('source_group'):
                b=related[related.source_group==s]
                pair=pd.concat([g.groupby('local_day').value.median().rename('a'),b.groupby('local_day').value.median().rename('b')],axis=1).dropna()
                rho=pair.a.corr(pair.b,method='spearman') if len(pair)>=10 and pair.a.nunique()>1 and pair.b.nunique()>1 else None
                comparisons[s]={'paired_days':len(pair),'spearman_rho':float(rho) if rho is not None and np.isfinite(rho) else None}
        report['daily_relationships'][full]={'method':'Same source-group reporting-day medians; daily association does not imply equivalent windows or causation. Exercise-time median is not total exercise time. Minimum10pairs.', 'by_source':comparisons,'status':'investigated' if not related.empty else 'unavailable'}
    matches=[]
    work=data.get('workouts',pd.DataFrame())
    if not work.empty:
        for r in focus.itertuples():
            same=work[work.bundle_id==r.bundle_id]
            if same.empty: continue
            # Interval distance, allowing point summaries near a workout end.
            dist=np.maximum((same.start_ts-r.end_ts).dt.total_seconds(),(r.start_ts-same.end_ts).dt.total_seconds()).clip(lower=0)
            ix=dist.idxmin(); w=same.loc[ix]
            matches.append({'value':float(r.value),'distance_seconds':float(dist.loc[ix]),'start_minus_end_seconds':float((r.start_ts-w.end_ts).total_seconds()),'activity_type':str(w.activity_type),'sample_duration_seconds':float((r.end_ts-r.start_ts).total_seconds())})
    report['nearest_workout_same_bundle']={'method':'Nearest interval by same bundle; no UUID association inferred. Zero distance includes broad summary intervals overlapping exercise.', 'matches':matches,'within_10_minutes':sum(m['distance_seconds']<=600 for m in matches)}
    return report

def make_figures(data, identifier, output_dir):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    rows=frame_for(data,identifier)
    focus=rows[(rows.start_ts>=FOCUS_START)&(rows.start_ts<FOCUS_END)] if not rows.empty else rows
    if focus.empty:return []
    output_dir=Path(output_dir);output_dir.mkdir(parents=True,exist_ok=True)
    fig,axes=plt.subplots(1,2,figsize=(12,4.8),gridspec_kw={'width_ratios':[1.6,1]})
    colors=['#286c93','#d47735','#638252']
    for n,(source,g) in enumerate(focus.groupby('source_group')):
        day=(g.start_ts.dt.tz_convert(TIME_ZONE).dt.normalize()-FOCUS_START).dt.days+1
        label=f'Source {n+1} (n={len(g)})';c=colors[n%len(colors)]
        axes[0].scatter(day,g.value,s=24,alpha=.8,color=c,label=label)
        gap=g.start_ts.diff().dt.total_seconds()/3600;gap=gap[gap>0]
        if len(gap): axes[1].hist(gap,bins=14,alpha=.6,color=c,label=f'Source {n+1}')
    name=identifier.removeprefix('HKQuantityTypeIdentifier')
    unit='mL/kg/min' if name=='VO2Max' else 'ms' if 'Variability' in name else 'bpm'
    axes[0].set(xlabel='Reporting day in 92-day example window',ylabel=f'Recorded value ({unit})',title='Values and source continuity');axes[0].legend(fontsize=8)
    axes[1].set(xlabel='Positive start-to-start gap (hours)',ylabel='Intervals',title='Recording opportunities');axes[1].legend(fontsize=8)
    for ax in axes:ax.grid(axis='y',alpha=.2);ax.spines[['top','right']].set_visible(False)
    fig.suptitle('Example Apple Health data · July–September 2026',fontsize=13);fig.tight_layout()
    path=output_dir/'values-and-cadence.svg';fig.savefig(path);fig.savefig(output_dir/'values-and-cadence.png',dpi=100);plt.close(fig)
    path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')
    return [{'file':path.name,'width':1200,'height':480,'records':len(focus),'sources':focus.source_group.nunique()}]
