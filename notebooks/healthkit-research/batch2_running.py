"""Running quantities: recording morphology and equally weighted workout pairs."""
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

TYPES = {
 'running-ground-contact-time': ('RunningGroundContactTime', 'Ground contact time', 'ms'),
 'running-power': ('RunningPower', 'Running power', 'W'),
 'running-speed': ('RunningSpeed', 'Running speed', 'm/s'),
 'running-stride-length': ('RunningStrideLength', 'Running stride length', 'm'),
}
PREFIX = 'HKQuantityTypeIdentifier'
SUPPORT = 'https://support.apple.com/guide/watch/apd1f24d4d35/watchos'

def references(suffix):
 return ['https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/'+suffix.lower(), SUPPORT]

def focus_rows(data, identifier):
 rows = select_rows(data, identifier)
 if rows.empty: return rows
 rows = annotate_context(rows, data)
 return rows[(rows.start_ts >= FOCUS_START) & (rows.start_ts < FOCUS_END)].copy()

def workout_pairs(data, identifier):
 """One median per source and workout; retain only uniquely overlapping runs."""
 workouts = data['workouts']
 running = (workouts.activity_type.astype(str).str.lower() == 'running') | (pd.to_numeric(workouts.activity_type,errors='coerce') == 37)
 runs = workouts[running & (workouts.start_ts >= FOCUS_START) & (workouts.start_ts < FOCUS_END)]
 all_frames = {name: focus_rows(data, PREFIX + name) for name in ['RunningGroundContactTime','RunningPower','RunningSpeed','RunningStrideLength','HeartRate']}
 result = []
 primary = all_frames[identifier.removeprefix(PREFIX)]
 for source, group in primary.groupby('source_group'):
  for workout in runs.itertuples():
   entry = {'workout_uuid':workout.uuid,'source':source}
   for suffix, frame in all_frames.items():
    if frame.empty: continue
    subset = frame[(frame.source_group == source) & (frame.start_ts >= workout.start_ts) & (frame.start_ts < workout.end_ts) & (frame.end_ts <= workout.end_ts)]
    # Do not count a record twice if two workout spans overlap.
    competing = runs[runs.uuid != workout.uuid]
    if len(competing) and len(subset):
     from common import overlap_mask
     subset = subset[~overlap_mask(subset, competing)]
    entry[suffix] = float(subset.value.median()) if len(subset) else None
    entry[suffix+'_n'] = len(subset)
    primary_suffix=identifier.removeprefix(PREFIX)
    if suffix==primary_suffix and len(subset):
     points=subset[subset.start_ts==subset.end_ts]
     fraction=(points.start_ts-workout.start_ts).dt.total_seconds()/(workout.end_ts-workout.start_ts).total_seconds()
     early=points.loc[fraction<1/3,'value'];late=points.loc[fraction>=2/3,'value']
     entry['early_point_n']=len(early);entry['late_point_n']=len(late)
     entry['late_minus_early_point_median']=float(late.median()-early.median()) if len(early)>=5 and len(late)>=5 else None
   if entry.get(identifier.removeprefix(PREFIX)+'_n',0): result.append(entry)
 return pd.DataFrame(result)

def investigate(data, identifier):
 rows = select_rows(data, identifier)
 if rows.empty: return {'status':'absent','note':'Raw quantities checked; no observed ranges invented.', 'related_types':[]}
 rows = annotate_context(rows, data)
 focus = focus_rows(data, identifier)
 output = {'semantic_note':'Discrete records, not footfalls or independent people. Running stride length uses Apple single-step definition.', 'year_records':len(rows), 'focus_records':len(focus), 'monthly_shape':[], 'focus_sources':[], 'related_types':[]}
 for (source, month), group in rows.groupby(['source_group','local_month']):
  duration = (group.end_ts-group.start_ts).dt.total_seconds()
  output['monthly_shape'].append({'source':source,'month':month,'records':len(group),'point_records':int((duration==0).sum()),'duration_seconds':describe(duration)})
 for source, group in focus.groupby('source_group'):
  output['focus_sources'].append({'source':source,'records':len(group),'values':describe(group.value),'cadence':cadence(group), 'context_counts':group.context.value_counts().to_dict(),'nonpositive_values':int((group.value<=0).sum()),'duration_seconds':describe((group.end_ts-group.start_ts).dt.total_seconds())})
 pairs = workout_pairs(data, identifier)
 suffix = identifier.removeprefix(PREFIX)
 if not pairs.empty:
  output['run_median_values'] = describe(pairs[suffix])
  output['runs_with_primary'] = len(pairs)
  output['within_run_late_minus_early']={'values':describe(pairs.late_minus_early_point_median),'method':'Last versus first elapsed-time thirds; at least five point readings in each. Interval records excluded. Pace, grade and pauses uncontrolled; not fatigue evidence.'}
  for source, group in pairs.groupby('source'):
   for other in ['RunningSpeed','RunningStrideLength','RunningGroundContactTime','RunningPower','HeartRate']:
    if other==suffix or other not in group: continue
    p = group[[suffix,other]].dropna()
    output['related_types'].append({'identifier':PREFIX+other,'source':source,'paired_runs':len(p),'spearman_run_medians':p.corr(method='spearman').iloc[0,1] if len(p)>=10 and p.nunique().min()>1 else None,'method':'One raw median per uniquely overlapping running workout; same source; no causal interpretation.'})
 series = data['workout_series']
 series = series[(series.identifier==identifier)&(series.ts>=FOCUS_START)&(series.ts<FOCUS_END)] if 'identifier' in series else pd.DataFrame()
 output['series'] = {'records':len(series),'workouts':int(series.workout_uuid.nunique()) if len(series) else 0,'values':describe(series.value) if len(series) else {},'note':'Workout-linked series is a separate representation, not additional independent observations.'}
 comparisons=[]
 if len(series) and len(pairs):
  for row in pairs.itertuples(index=False):
   s = series[series.workout_uuid == row.workout_uuid]
   if len(s): comparisons.append({'raw_records':getattr(row,suffix+'_n'),'series_records':len(s),'raw_median':getattr(row,suffix),'series_median':float(s.value.median()),'median_difference':float(s.value.median())-getattr(row,suffix)})
 output['series_vs_raw_runs'] = comparisons
 if suffix=='RunningSpeed':
  output['pace_minutes_per_km_positive_records'] = describe(1000/(60*focus.loc[focus.value>0,'value']))
  output['pace_note']='Pace is nonlinear. Median transformed positive readings is not moving-time workout pace; zero readings are retained in speed summaries and excluded only from division.'
 return clean_json(output)

def make_figure(data, identifier, title, unit, destination):
 rows=focus_rows(data,identifier)
 if rows.empty:return []
 source=rows.source_group.value_counts().index[0]
 rows=rows[rows.source_group==source]
 pairs=workout_pairs(data,identifier)
 pairs=pairs[pairs.source==source]
 suffix=identifier.removeprefix(PREFIX)
 fig,axes=plt.subplots(1,2,figsize=(10,4),layout='constrained')
 axes[0].hist(rows.value,bins=30,color='#079ca8')
 axes[0].set_xlabel(f'{title} ({unit})');axes[0].set_ylabel('Stored records')
 axes[0].set_title(f'July–September: {len(rows):,} records')
 other='RunningPower' if suffix=='RunningSpeed' else 'RunningSpeed'
 if other in pairs:
  p=pairs[[suffix,other]].dropna()
  axes[1].scatter(p[other],p[suffix],s=45,color='#3b72b5')
  axes[1].set_xlabel('Run median power (W)' if other=='RunningPower' else 'Run median speed (m/s)')
  axes[1].set_ylabel(f'Run median {title.lower()} ({unit})')
  axes[1].set_title(f'{len(p)} paired runs; each gets one point')
 else: axes[1].set_visible(False)
 for ax in axes:ax.spines[['top','right']].set_visible(False);ax.grid(axis='y',alpha=.18)
 destination.mkdir(parents=True,exist_ok=True)
 path=destination/'distribution-and-runs.png'
 fig.savefig(path,dpi=150);plt.close(fig)
 return [path]

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
 args=parser.parse_args();data=load_snapshot(args.input);notebooks=[]
 for slug,(suffix,title,unit) in TYPES.items():
  identifier=PREFIX+suffix;out=args.output/slug
  figures=make_figure(data,identifier,title,unit,out/'figures')
  report=research_report(data,identifier,special_analysis=investigate(data,identifier),references=references(suffix))
  path=persist_research(report,out,title,input_dir=args.input,setup_code='from batch2_running import investigate',special_code=f'investigate(data, {identifier!r})',references=references(suffix),figures=figures)
  notebooks.append(path)
 execute_notebooks(notebooks)
 print(json.dumps({'executed':[str(p) for p in notebooks]}))

if __name__=='__main__':main()
