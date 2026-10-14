"""Movement interval research, source-specific cumulative totals and stand codes."""
from pathlib import Path
import argparse
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from common import annotate_context, describe, FOCUS_START, FOCUS_END
from batch_support import load_snapshot, select_rows, research_report, persist_research, execute_notebooks, clean_json

IDS = {
 'apple-stand-time': ('HKQuantityTypeIdentifierAppleStandTime', 'quantity', 'min'),
 'apple-stand-hour': ('HKCategoryTypeIdentifierAppleStandHour', 'category', 'category'),
 'distance-walking-running': ('HKQuantityTypeIdentifierDistanceWalkingRunning', 'quantity', 'm'),
 'flights-climbed': ('HKQuantityTypeIdentifierFlightsClimbed', 'quantity', 'count'),
}
REFS = {
 'apple-stand-time': ['https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/applestandtime', 'https://support.apple.com/guide/watch/track-daily-activity-apd3bf6d85a6/watchos'],
 'apple-stand-hour': ['https://developer.apple.com/documentation/healthkit/hkcategoryvalueapplestandhour','https://developer.apple.com/documentation/healthkit/hkactivitysummary/applestandhours'],
 'distance-walking-running': ['https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/distancewalkingrunning','https://support.apple.com/en-us/105048'],
 'flights-climbed': ['https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/flightsclimbed'],
}

def investigate(data, identifier, kind):
 rows = select_rows(data, identifier, kind)
 if rows.empty:
  return {'status':'absent','note':'Required raw table checked; no records in selected year. No ranges or context estimates invented.'}
 rows = annotate_context(rows, data)
 report = {'records':len(rows),'semantics':'Category frequencies, not numeric averages.' if kind=='category' else 'Cumulative interval amounts; source-specific sums only, no prorating across boundaries.', 'sources':[]}
 for source,g in rows.groupby('source_group'):
  focus=g[(g.start_ts>=FOCUS_START)&(g.start_ts<FOCUS_END)].copy()
  dur=(focus.end_ts-focus.start_ts).dt.total_seconds()
  out={'source':source,'year_records':len(g),'focus_records':len(focus),'focus_days':int(focus.local_day.nunique()),'duration_seconds':describe(dur),'cross_midnight_records':int((focus.start_ts.dt.tz_convert('America/Los_Angeles').dt.date!=focus.end_ts.dt.tz_convert('America/Los_Angeles').dt.date).sum())}
  if kind=='category':
   out['code_counts']={str(k):int(v) for k,v in focus.value.value_counts().items()}
   out['unexpected_codes']=int((~focus.value.isin([0,1])).sum())
   out['stood_hours_per_observed_day']=describe(focus[focus.value==0].groupby('local_day').size().reindex(focus.local_day.unique(),fill_value=0))
   out['duplicate_start_code_records']=int(focus.duplicated(['start_ts','value']).sum())
  else:
   daily=focus.groupby('local_day').value.sum(min_count=1)
   out['daily_raw_sums']=describe(daily)
   out['interval_values']=describe(focus.value)
   out['amount_per_second_positive_duration']=describe(focus.loc[dur>0,'value']/dur[dur>0])
   out['interval_amount_exceeds_duration_minutes']=int((focus.value>dur/60+1e-8).sum()) if identifier.endswith('AppleStandTime') else None
   out['fractional_count_records']=int((focus.value%1!=0).sum()) if identifier.endswith('FlightsClimbed') else None
   related=[]
   for other_id in ('HKQuantityTypeIdentifierStepCount','HKQuantityTypeIdentifierDistanceWalkingRunning','HKQuantityTypeIdentifierAppleStandTime'):
    if other_id==identifier: continue
    other=select_rows(data,other_id)
    if other.empty: related.append({'identifier':other_id,'status':'absent'});continue
    other=annotate_context(other,data)
    other=other[(other.start_ts>=FOCUS_START)&(other.start_ts<FOCUS_END)]
    for other_source,other_rows in other.groupby('source_group'):
     paired=pd.concat([daily.rename('a'),other_rows.groupby('local_day').value.sum(min_count=1).rename('b')],axis=1).dropna()
     related.append({'identifier':other_id,'source':other_source,'paired_days':len(paired),'spearman_daily_raw_sums':paired.corr(method='spearman').iloc[0,1] if len(paired)>=10 else None})
   out['daily_relationships']=related
  report['sources'].append(out)
 if kind=='category':
  stand=select_rows(data,'HKQuantityTypeIdentifierAppleStandTime')
  report['stand_time_pairing']={'available_records':len(stand),'note':'Stood code is threshold success, not hours of continuous standing; stand minutes are a separate cumulative quantity.'}
  if len(stand):
   stand=annotate_context(stand,data)
   for a_source,a in rows.groupby('source_group'):
    for b_source,b in stand.groupby('source_group'):
     pair=pd.concat([a[a.value==0].groupby('local_day').size().reindex(a.local_day.unique(),fill_value=0).rename('stood'),b.groupby('local_day').value.sum(min_count=1).rename('minutes')],axis=1).dropna()
     report.setdefault('stand_daily_relationships',[]).append({'category_source':a_source,'quantity_source':b_source,'paired_days':len(pair),'spearman':pair.corr(method='spearman').iloc[0,1] if len(pair)>=10 else None})
 ring_path=Path(data['_input_dir'])/'activity_summaries.csv'
 if ring_path.exists():
  rings=pd.read_csv(ring_path)
  report['ring_rows']=len(rings)
  report['rings_note']='Daily Activity summaries are a separate stored stream; neither raw source sums nor category-row counts are assumed identical to the ring.'
  if kind=='category' and 'stand_hours' in rings:
   rings=rings.set_index('date')
   comparisons=[]
   for source,g in rows.groupby('source_group'):
    raw=g[g.value==0].groupby('local_day').size().reindex(g.local_day.unique(),fill_value=0).rename('raw_stood_count')
    paired=pd.concat([raw,rings.stand_hours],axis=1).dropna()
    comparisons.append({'source':source,'paired_days':len(paired),'days_equal':int((paired.raw_stood_count==paired.stand_hours).sum()),'raw_minus_ring':describe(paired.raw_stood_count-paired.stand_hours)})
   report['stand_ring_comparison']=comparisons
 report['related_types']=report.get('stand_daily_relationships', [dict(primary_source=x['source'], relationships=x.get('daily_relationships',[])) for x in report['sources']])
 return clean_json(report)

def make_figure(data, identifier, kind, unit, dest):
 rows=select_rows(data,identifier,kind)
 if rows.empty:return []
 rows=annotate_context(rows,data)
 rows=rows[(rows.start_ts>=FOCUS_START)&(rows.start_ts<FOCUS_END)]
 if rows.empty:return []
 selected=rows.source_group.value_counts().index[0]
 rows=rows[rows.source_group==selected]
 fig,axes=plt.subplots(1,2,figsize=(10,4),layout='constrained')
 if kind=='category':
  counts=rows.value.value_counts().reindex([0,1],fill_value=0)
  axes[0].bar(['Stood','Idle'],counts,color=['#06a6b7','#a4b2bd']);axes[0].set_ylabel('Recorded hourly entries')
 else:
  axes[0].hist(rows.value,bins=30,color='#06a6b7');axes[0].set_xlabel(f'Amount per stored interval ({unit})');axes[0].set_ylabel('Records')
 duration=(rows.end_ts-rows.start_ts).dt.total_seconds()/60
 axes[1].hist(duration,bins=30,color='#467fc7');axes[1].set_xlabel('Stored interval duration (minutes)');axes[1].set_ylabel('Records')
 fig.suptitle(f'Example data · {len(rows):,} records · July–September 2026')
 dest=Path(dest);dest.mkdir(parents=True,exist_ok=True)
 fig.savefig(dest/'intervals.png',dpi=150);plt.close(fig)
 return [dest/'intervals.png']

def run(input_dir,output,figures):
 data=load_snapshot(str(Path(input_dir).resolve()));paths=[]
 for key,(identifier,kind,unit) in IDS.items():
  special=investigate(data,identifier,kind)
  report=research_report(data,identifier,kind=kind,special_analysis=special,references=REFS[key])
  pics=make_figure(data,identifier,kind,unit,Path(figures)/key)
  paths.append(persist_research(report,Path(output)/key,key,input_dir=input_dir,special_code=f'investigate(data,{identifier!r},{kind!r})',setup_code='from batch1_movement import investigate',references=REFS[key],figures=pics))
 execute_notebooks(paths)
 return paths

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--figures',required=True);a=p.parse_args();run(a.input,a.output,a.figures)
