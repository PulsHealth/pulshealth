"""Source-aware walking estimates: ratios, interval pairing and selection bias."""
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
    'walking-asymmetry-percentage': ('WalkingAsymmetryPercentage', '%'),
    'walking-double-support-percentage': ('WalkingDoubleSupportPercentage', '%'),
    'walking-speed': ('WalkingSpeed', 'm/s'),
    'walking-step-length': ('WalkingStepLength', 'm'),
}
SLUGS = {'WalkingAsymmetryPercentage':'walkingasymmetrypercentage', 'WalkingDoubleSupportPercentage':'walkingdoublesupportpercentage', 'WalkingSpeed':'walkingspeed', 'WalkingStepLength':'walkingsteplength'}

def association(frame, columns):
    """No coefficient for sparse pairs or a constant measurement."""
    pairs=frame[list(columns)].replace([np.inf,-np.inf],np.nan).dropna()
    if len(pairs)<10 or any(pairs[c].nunique()<2 for c in columns):
        return None
    return float(pairs.corr(method='spearman').iloc[0,1])

def references(suffix):
    return [f'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/{SLUGS[suffix]}', 'https://developer.apple.com/videos/play/wwdc2020/10656/']

def investigate(data, identifier):
    rows = select_rows(data, identifier)
    percent = identifier.endswith('Percentage')
    out = {'recording_selection':'Steady flat walking with iPhone near waist; opportunistic samples are not all-day gait surveillance.', 'display_conversion':'Stored HKUnit.percent ratios multiplied by 100 for plotted percentage points.' if percent else 'Canonical m/s or m; no stride-length conversion.', 'related_types':[]}
    if rows.empty:
        out.update(status='absent', note='Verified raw window contains no records; no values, cadence or associations inferred.')
        return out
    rows = annotate_context(rows, data)
    out['sources'] = []
    for source, group in rows.groupby('source_group'):
        g = group[(group.start_ts >= FOCUS_START) & (group.start_ts < FOCUS_END)]
        factor = 100 if percent else 1
        duration = (g.end_ts-g.start_ts).dt.total_seconds()
        entry = {'year_records':len(group), 'focus_records':len(g), 'focus_days':int(g.local_day.nunique()), 'display_values':describe(g.value*factor), 'duration_seconds':describe(duration), 'records_on_observed_days':describe(g.groupby('local_day').size()), 'workout_overlap':int(g.workout_overlap.sum()), 'sleep_overlap':int(g.sleep_overlap.sum()), 'zeros':int((g.value==0).sum()), 'outside_logical_bounds':int(((g.value<0)|(g.value>1)).sum()) if percent else int((g.value<0).sum()), 'source':source}
        pairs=[]
        for suffix, _ in IDS.values():
            other_id='HKQuantityTypeIdentifier'+suffix
            if other_id==identifier: continue
            other=select_rows(data, other_id)
            if other.empty:
                pairs.append({'identifier':other_id,'status':'absent'}); continue
            other=annotate_context(other,data)
            other=other[(other.source_group==source)&(other.start_ts>=FOCUS_START)&(other.start_ts<FOCUS_END)]
            # Exact interval matches, rejecting ambiguous duplicate interval candidates.
            columns=['start_ts','end_ts']
            a=g.loc[~g.duplicated(columns,keep=False), columns+['value']]
            b=other.loc[~other.duplicated(columns,keep=False), columns+['value']]
            paired=a.merge(b,on=columns,suffixes=('_a','_b'))
            daily=pd.concat([g.groupby('local_day').value.median().rename('a'),other.groupby('local_day').value.median().rename('b')],axis=1).dropna()
            pairs.append({'identifier':other_id,'unique_exact_interval_pairs':len(paired),'excluded_ambiguous_primary_records':int(g.duplicated(columns,keep=False).sum()),'exact_interval_spearman':association(paired,('value_a','value_b')),'paired_days':len(daily),'daily_median_spearman':association(daily,('a','b'))})
        entry['pairs']=pairs
        out['sources'].append(entry)
        out['related_types'].append({'primary_source':source,'relationships':pairs})
    return clean_json(out)

def make_figure(data, identifier, unit, directory):
    rows=annotate_context(select_rows(data,identifier),data)
    if rows.empty:return []
    rows=rows[(rows.start_ts>=FOCUS_START)&(rows.start_ts<FOCUS_END)]
    if rows.empty:return []
    source=rows.source_group.value_counts().index[0];g=rows[rows.source_group==source]
    factor=100 if unit=='%' else 1
    fig, axes=plt.subplots(1,2,figsize=(10,4),layout='constrained')
    axes[0].hist(g.value*factor,bins=30,color='#168fa3');axes[0].set_xlabel(f'Stored interval estimate ({unit})');axes[0].set_ylabel('Records')
    per_day=g.groupby('local_day').size()
    axes[1].hist(per_day,bins=min(20,len(per_day)),color='#557ac1');axes[1].set_xlabel('Records per observed day');axes[1].set_ylabel('Days with records')
    fig.suptitle(f'Example data · {len(g):,} records · {len(per_day)} observed days')
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    path=directory/'distribution.png';fig.savefig(path,dpi=150);plt.close(fig)
    return [path]

def run(input_dir, output, figures):
    data=load_snapshot(str(Path(input_dir).resolve()));paths=[]
    for key,(suffix,unit) in IDS.items():
        identifier='HKQuantityTypeIdentifier'+suffix;refs=references(suffix)
        report=research_report(data,identifier,special_analysis=investigate(data,identifier),references=refs)
        pics=make_figure(data,identifier,unit,Path(figures)/key)
        paths.append(persist_research(report,Path(output)/key,key,input_dir=input_dir,special_code=f'investigate(data,{identifier!r})',setup_code='from batch2_walking_metrics import investigate',references=refs,figures=pics))
    execute_notebooks(paths)
    return paths

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--figures',required=True);a=p.parse_args();run(a.input,a.output,a.figures)
