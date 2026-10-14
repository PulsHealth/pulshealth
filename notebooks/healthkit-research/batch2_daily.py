"""Movement minutes, wheelchair interval semantics and estimated METs research."""
from pathlib import Path
import argparse
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from common import annotate_context, describe, cadence, FOCUS_START, FOCUS_END
from batch_support import load_snapshot, select_rows, research_report, persist_research, execute_notebooks, clean_json

IDS = {'apple-move-time': 'AppleMoveTime', 'physical-effort': 'PhysicalEffort',
       'distance-wheelchair': 'DistanceWheelchair', 'push-count': 'PushCount'}
SEMANTICS = {
 'AppleMoveTime': 'Cumulative full active movement minutes for younger-user Move mode; not the wheelchair Roll ring or exercise minutes.',
 'PhysicalEffort': 'Discrete estimated metabolic power in METs; not perceived effort, workout effort score, measured oxygen uptake, or mechanical watts.',
 'DistanceWheelchair': 'Cumulative wheelchair distance; source-specific interval sums, no step conversion or inferred propulsion efficiency.',
 'PushCount': 'Cumulative wheelchair pushes; source-specific sums, not steps or heartbeats; assisted movement and coasting complicate distance-per-push interpretation.'}

def references(suffix):
 urls = ['https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/'+suffix.lower()]
 if suffix == 'AppleMoveTime': urls.append('https://developer.apple.com/documentation/healthkit/hkactivitysummary/applemovetime')
 if suffix == 'PhysicalEffort': urls.append('https://developer.apple.com/documentation/healthkit/hkmetadatakeyphysicaleffortestimationtype')
 return urls

def investigate(data, suffix):
 rows = select_rows(data, 'HKQuantityTypeIdentifier'+suffix)
 result = {'semantics': SEMANTICS[suffix], 'records': len(rows), 'status': 'measured' if len(rows) else 'absent',
           'absent_note': 'No records does not mean no movement, wheelchair use or effort.', 'sources': []}
 if suffix == 'AppleMoveTime':
  rings = data.get('activity_summaries', pd.DataFrame())
  result['ring_schema'] = {'rows': len(rings), 'move_mode_counts': rings.move_mode.value_counts().to_dict() if 'move_mode' in rings else {},
       'move_time_minutes': describe(rings.move_time_min) if 'move_time_min' in rings else {},
       'note': 'Daily summary mode and minute fields are separate from raw quantity samples; zeros in another Move mode are not observed inactivity.'}
 if rows.empty:
  result['analysis_plan'] = ['Inspect source, duration, unit and overlap before cumulative sums.', 'Compare wheelchair distance and pushes only in aligned, source-compatible periods; retain coasting and assisted movement as confounders.'] if 'Wheelchair' in suffix or suffix == 'PushCount' else ['Verify Move mode before comparing time with energy or exercise; no empirical range or cadence can be estimated.']
  return clean_json(result)
 rows = annotate_context(rows, data)
 for source, group in rows.groupby('source_group'):
  focus = group[(group.start_ts>=FOCUS_START)&(group.start_ts<FOCUS_END)].copy()
  out = {'source':source,'year_records':len(group),'focus_records':len(focus),'focus_days':focus.local_day.nunique(),
         'focus_values':describe(focus.value),'contexts':{},'monthly':{m:{'records':len(g),'values':describe(g.value),'cadence':cadence(g)} for m,g in group.groupby('local_month')}}
  for context,g in focus.groupby('context'):
   out['contexts'][context] = {'records':len(g),'days':g.local_day.nunique(),'values':describe(g.value),'cadence':cadence(g)}
  out['nonpositive_values'] = int((focus.value<=0).sum())
  out['metadata_keys'] = sorted({k for item in focus.get('metadata',[]) if isinstance(item,dict) for k in item})
  out['estimation_type_counts'] = pd.Series([m.get('HKPhysicalEffortEstimationType',m.get('HKMetadataKeyPhysicalEffortEstimationType','not_recorded')) for m in focus.metadata]).astype(str).value_counts().to_dict() if 'metadata' in focus else {}
  related=[]
  for other_suffix in ('HeartRate','RunningPower','CyclingPower','ActiveEnergyBurned','AppleExerciseTime'):
   other=select_rows(data,'HKQuantityTypeIdentifier'+other_suffix)
   if other.empty: related.append({'identifier':other_suffix,'status':'absent'});continue
   other=annotate_context(other,data);other=other[(other.start_ts>=FOCUS_START)&(other.start_ts<FOCUS_END)]
   for other_source,g in other.groupby('source_group'):
    # Use day medians for discrete metrics, sums for cumulative energy/time.
    daily=g.groupby('local_day').value.sum(min_count=1) if other_suffix in ('ActiveEnergyBurned','AppleExerciseTime') else g.groupby('local_day').value.median()
    paired=pd.concat([focus.groupby('local_day').value.median().rename('effort'),daily.rename('other')],axis=1).dropna()
    related.append({'identifier':other_suffix,'source':other_source,'paired_days':len(paired),'spearman':paired.corr(method='spearman').iloc[0,1] if len(paired)>=10 and paired.nunique().min()>1 else None,'weighting':'one source-specific reporting day; effort median versus related daily median or cumulative raw sum'})
  out['related_daily']=related
  result['sources'].append(out)
 result['related_types']=[{'primary_source':x['source'],'comparisons':x['related_daily']} for x in result['sources']]
 result['limits']='No causal interpretation: recording opportunity, source algorithms, activity mix and physiology confound associations. Equal sample weights favor densely recorded workouts. Extreme values retained; no invented MET ceiling.'
 return clean_json(result)

def figures(data, suffix, output):
 if suffix != 'PhysicalEffort': return []
 rows=annotate_context(select_rows(data,'HKQuantityTypeIdentifier'+suffix),data)
 rows=rows[(rows.start_ts>=FOCUS_START)&(rows.start_ts<FOCUS_END)]
 if rows.empty:return []
 rows=rows[rows.source_group==rows.source_group.value_counts().index[0]]
 fig,axes=plt.subplots(1,2,figsize=(10,4),layout='constrained')
 groups=[(c,g) for c,g in rows.groupby('context') if len(g)>=10]
 axes[0].boxplot([g.value for _,g in groups],tick_labels=[c.replace('_',' ')+'\n'+f'n={len(g):,}' for c,g in groups],whis=(5,95),showfliers=False)
 axes[0].set_ylabel('Estimated physical effort (METs)');axes[0].tick_params(axis='x',labelsize=8)
 duration=(rows.end_ts-rows.start_ts).dt.total_seconds()
 axes[1].hist(duration[duration>=0],bins=35,color='#06a6b7');axes[1].set_xlabel('Stored interval duration (seconds)');axes[1].set_ylabel('Records')
 fig.suptitle(f'Example data · {len(rows):,} source-selected records · July–September 2026')
 output=Path(output);output.mkdir(parents=True,exist_ok=True)
 fig.savefig(output/'context-and-duration.png',dpi=130)
 fig.savefig(output/'context-and-duration.svg');plt.close(fig)
 return [output/'context-and-duration.png']

def run(input_dir,output,figure_dir):
 data=load_snapshot(str(Path(input_dir).resolve()));paths=[]
 for slug,suffix in IDS.items():
  report=research_report(data,'HKQuantityTypeIdentifier'+suffix,special_analysis=investigate(data,suffix),references=references(suffix))
  pics=figures(data,suffix,Path(figure_dir)/slug)
  paths.append(persist_research(report,Path(output)/slug,slug,input_dir=input_dir,special_code=f'investigate(data,{suffix!r})',setup_code='from batch2_daily import investigate',references=references(suffix),figures=pics))
 execute_notebooks(paths)
 return paths

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);parser.add_argument('--figures',required=True)
 args=parser.parse_args();run(args.input,args.output,args.figures)
