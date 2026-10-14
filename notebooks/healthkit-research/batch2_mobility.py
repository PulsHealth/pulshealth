"""Mobility estimates, stair-bout recording and source-matched daily comparisons."""
from pathlib import Path
import argparse
import json
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from common import annotate_context, describe, cadence, FOCUS_START, FOCUS_END
from batch_support import load_snapshot, select_rows, research_report, persist_research, execute_notebooks, clean_json

IDS = {
 'apple-walking-steadiness': ('HKQuantityTypeIdentifierAppleWalkingSteadiness', '%'),
 'six-minute-walk-test-distance': ('HKQuantityTypeIdentifierSixMinuteWalkTestDistance', 'm'),
 'stair-ascent-speed': ('HKQuantityTypeIdentifierStairAscentSpeed', 'm/s'),
 'stair-descent-speed': ('HKQuantityTypeIdentifierStairDescentSpeed', 'm/s'),
}
DOC = 'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/'
REFS = {key:[DOC+identifier.removeprefix('HKQuantityTypeIdentifier').lower()] for key,(identifier,unit) in IDS.items()}
REFS['apple-walking-steadiness'] += ['https://developer.apple.com/videos/play/wwdc2021/10287/','https://support.apple.com/en-us/102504']
REFS['six-minute-walk-test-distance'] += ['https://www.apple.com/healthcare/docs/site/Using_Apple_Watch_to_Estimate_Six_Minute_Walk_Distance.pdf','https://developer.apple.com/videos/play/wwdc2021/10287/']
RELATED = ['HKQuantityTypeIdentifierStairAscentSpeed','HKQuantityTypeIdentifierStairDescentSpeed','HKQuantityTypeIdentifierWalkingSpeed','HKQuantityTypeIdentifierWalkingStepLength','HKQuantityTypeIdentifierWalkingAsymmetryPercentage','HKQuantityTypeIdentifierWalkingDoubleSupportPercentage','HKQuantityTypeIdentifierFlightsClimbed']

def investigate(data, identifier):
 rows = select_rows(data,identifier)
 semantics = ('Weekly composite estimate: percent canonical values are ratios 0–1, display multiplied by 100; no hand-built classification thresholds.' if identifier.endswith('AppleWalkingSteadiness') else 'Type can hold measured clinical tests or historical Apple Watch estimates. Source/metadata distinguish methods; estimated values cap at 500 m and are not completed tests. Record overlap does not identify a workout.' if identifier.endswith('SixMinuteWalkTestDistance') else 'Discrete stair-bout speed; not number of stairs or flights, and no conversion to flights without independent geometry.')
 result={'semantics':semantics,'status':'absent' if rows.empty else 'observed','records':len(rows)}
 if rows.empty:
  result['note']='Verified raw quantity coverage has no records in the selected year; no empirical values, cadence or relationships inferred.'
  return result
 rows=annotate_context(rows,data)
 result['sources']=[]
 for source,g in rows.groupby('source_group'):
  f=g[(g.start_ts>=FOCUS_START)&(g.start_ts<FOCUS_END)]
  special={'source':source,'year_records':len(g),'focus_records':len(f),'focus_days':int(f.local_day.nunique()),'focus_values':describe(f.value),'focus_cadence':cadence(f),'context_counts':f.context.value_counts().to_dict(),'monthly_records':g.local_month.value_counts().sort_index().to_dict(),'nonpositive_values':int((g.value<=0).sum())}
  if identifier.endswith('AppleWalkingSteadiness'):
   special['outside_ratio_domain']=int(((g.value<0)|(g.value>1)).sum())
   special['focus_display_percent']=describe(f.value*100)
  if identifier.endswith('SixMinuteWalkTestDistance'):
   special['metadata_key_counts']={key:sum(key in x for x in g.metadata) for key in sorted(set().union(*(x.keys() for x in g.metadata)))} if 'metadata' in g else {}
   special['repeated_value_fraction']=float(g.value.duplicated().mean())
  daily=f.groupby('local_day').value.median().rename('primary')
  relationships=[]
  for other_id in RELATED:
   if other_id==identifier: continue
   other=select_rows(data,other_id)
   if other.empty:
    relationships.append({'identifier':other_id,'status':'absent'});continue
   other=annotate_context(other,data)
   other=other[(other.source_group==source)&(other.start_ts>=FOCUS_START)&(other.start_ts<FOCUS_END)]
   measure=other.groupby('local_day').value.sum(min_count=1) if other_id.endswith('FlightsClimbed') else other.groupby('local_day').value.median()
   pair=pd.concat([daily,measure.rename('related')],axis=1).dropna()
   relationships.append({'identifier':other_id,'paired_days':len(pair),'spearman':pair.corr(method='spearman').iloc[0,1] if len(pair)>=10 and pair.nunique().min()>1 else None,'method':'Same source-group reporting-day medians; flights use raw daily sums. Exploratory co-occurrence only; no bout or clinical linkage.'})
  special['daily_relationships']=relationships
  result['sources'].append(special)
 result['related_types']=[{'source':s['source'],'relationships':s['daily_relationships']} for s in result['sources']]
 return clean_json(result)

def make_figure(data, identifier, unit, dest):
 rows=select_rows(data,identifier)
 if rows.empty:return []
 rows=annotate_context(rows,data)
 rows=rows[(rows.start_ts>=FOCUS_START)&(rows.start_ts<FOCUS_END)]
 if rows.empty:return []
 source=rows.source_group.value_counts().index[0]
 rows=rows[rows.source_group==source].sort_values('start_ts')
 display=rows.value*100 if unit=='%' else rows.value
 fig,axes=plt.subplots(1,2,figsize=(10,4),layout='constrained')
 axes[0].hist(display,bins=25,color='#06a6b7');axes[0].set_xlabel(f'Stored estimate ({unit})' if unit=='%' or unit=='m' else f'Stair-bout speed ({unit})');axes[0].set_ylabel('Records')
 gaps=rows.start_ts.diff().dt.total_seconds().dropna();gaps=gaps[gaps>0]/3600
 axes[1].hist(gaps,bins=25,color='#467fc7');axes[1].set_xlabel('Positive start-to-start interval (hours)');axes[1].set_ylabel('Pairs of records')
 fig.suptitle(f'Example recording pattern · {len(rows):,} records')
 dest=Path(dest);dest.mkdir(parents=True,exist_ok=True)
 fig.savefig(dest/'recording.png',dpi=150);plt.close(fig)
 return [dest/'recording.png']

def run(input_dir,output,figures):
 data=load_snapshot(str(Path(input_dir).resolve()));paths=[]
 for key,(identifier,unit) in IDS.items():
  report=research_report(data,identifier,special_analysis=investigate(data,identifier),related_identifiers=RELATED,references=REFS[key])
  pics=make_figure(data,identifier,unit,Path(figures)/key)
  paths.append(persist_research(report,Path(output)/key,key,input_dir=input_dir,special_code=f'investigate(data,{identifier!r})',setup_code='from batch2_mobility import investigate',related_identifiers=RELATED,references=REFS[key],figures=pics))
 execute_notebooks(paths)
 return paths

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--figures',required=True);a=p.parse_args();run(a.input,a.output,a.figures)
