"""Sleep interval research, retaining all stages and explicit overlap policies."""
from pathlib import Path
import argparse
import json
import sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from common import (load_data, annotate_context, describe, cadence, overlap_mask,
                    input_manifest, write_notebook, TIME_ZONE, YEAR_START, YEAR_END, FOCUS_START)

STAGES = {0:'In Bed', 1:'Asleep unspecified', 2:'Awake', 3:'Core', 4:'Deep', 5:'REM'}
ASLEEP = [1,3,4,5]
COLORS = {0:'#a5adc1',1:'#858fa5',2:'#ea9c49',3:'#6484de',4:'#3346a3',5:'#b279cc'}


def union_hours(rows):
    spans = []
    for a,b in rows[['start_ts','end_ts']].dropna().sort_values('start_ts').itertuples(index=False,name=None):
        if b <= a: continue
        if spans and a <= spans[-1][1]: spans[-1][1] = max(b,spans[-1][1])
        else: spans.append([a,b])
    return sum((b-a).total_seconds() for a,b in spans)/3600


def conflict_seconds(rows):
    """Distinct detailed labels simultaneously active; unspecified not a conflict."""
    events=[]
    for r in rows[rows.value.isin([2,3,4,5])].itertuples():
        if r.end_ts>r.start_ts: events.extend([(r.start_ts,1,int(r.value)),(r.end_ts,-1,int(r.value))])
    active={}; previous=None; seconds=0
    for ts,delta,value in sorted(events):
        if previous is not None and sum(n>0 for n in active.values())>1: seconds+=(ts-previous).total_seconds()
        active[value]=active.get(value,0)+delta; previous=ts
    return seconds


def nightly(rows):
    """Noon-to-noon reporting bins labeled by ending date; split crossing intervals."""
    pieces=[]
    for r in rows.itertuples():
        if pd.isna(r.start_ts) or pd.isna(r.end_ts) or r.end_ts<=r.start_ts: continue
        a=r.start_ts; stop=r.end_ts
        while a<stop:
            local=a.tz_convert(TIME_ZONE)
            day=local.date() if local.hour<12 else (local+pd.DateOffset(days=1)).date()
            boundary=pd.Timestamp(str(day)+' 12:00',tz=TIME_ZONE).tz_convert('UTC')
            b=min(stop,boundary)
            pieces.append({'night':str(day),'start_ts':a,'end_ts':b,'value':int(r.value),'source_group':r.source_group})
            a=b
    cut=pd.DataFrame(pieces)
    records=[]
    for day,g in cut.groupby('night'):
        sleep=g[g.value.isin(ASLEEP)]
        records.append({'night':day,'asleep_union_h':union_hours(sleep),
            'asleep_row_sum_h':sum((sleep.end_ts-sleep.start_ts).dt.total_seconds())/3600,
            'all_row_sum_h':sum((g.end_ts-g.start_ts).dt.total_seconds())/3600,
            'inbed_union_h':union_hours(g[g.value==0]),'awake_union_h':union_hours(g[g.value==2]),
            'detailed_conflict_h':conflict_seconds(g)/3600,
            'rows':len(g), 'source_groups':g.source_group.nunique(),
            **{STAGES[v]+'_h':union_hours(g[g.value==v]) for v in ASLEEP}})
    return pd.DataFrame(records),cut


def episodes(rows):
    """Within-source sleep/awake episodes separated by >90 minutes; exploratory."""
    records=[]
    for source,g in rows[rows.value!=0].groupby('source_group'):
        spans=[]
        for r in g.sort_values('start_ts').itertuples():
            if r.end_ts<=r.start_ts: continue
            if spans and (r.start_ts-max(x['end_ts'] for x in spans[-1])).total_seconds()<=5400:
                spans[-1].append({'start_ts':r.start_ts,'end_ts':r.end_ts,'value':r.value})
            else: spans.append([{'start_ts':r.start_ts,'end_ts':r.end_ts,'value':r.value}])
        for span in spans:
            f=pd.DataFrame(span); first=f.start_ts.min(); last=f.end_ts.max()
            sleep=f[f.value.isin(ASLEEP)]; hours=union_hours(sleep)
            local=first.tz_convert(TIME_ZONE)
            records.append({'source_group':source,'start_ts':first,'end_ts':last,'asleep_h':hours,
                            'elapsed_h':(last-first).total_seconds()/3600,'rows':len(f),
                            'short_daytime_candidate':bool(6<=local.hour<20 and hours<3),
                            'staged':bool(f.value.isin([3,4,5]).any())})
    return pd.DataFrame(records)


def analyze(input_dir, output_dir, figure_dir=None):
    output_dir=Path(output_dir); output_dir.mkdir(parents=True,exist_ok=True)
    data=load_data(input_dir); raw=data['sleep']; s=annotate_context(raw,data)
    s=s[(s.start_ts>=YEAR_START)&(s.start_ts<YEAR_END)].copy()
    if s.empty: raise ValueError('No actual sleep records; refuse completed research')
    nights,cut=nightly(s); eps=episodes(s)
    boundary_labels=[str(YEAR_START.date()),str(YEAR_END.date())]
    boundary=nights[nights.night.isin(boundary_labels)].to_dict('records')
    nights=nights[~nights.night.isin(boundary_labels)].copy()
    cut=cut[~cut.night.isin(boundary_labels)].copy()
    nights.to_csv(output_dir/'nightly-private.csv',index=False)
    eps.to_csv(output_dir/'episodes-private.csv',index=False)
    report={'identifier':'HKCategoryTypeIdentifierSleepAnalysis','status':'completed','timezone':TIME_ZONE,
        'inputs':input_manifest(input_dir), 'rows':len(s), 'excluded_boundary_nights':boundary,
        'method':{'night_bins':'local noon to next noon; ending date label; crossing rows split; UTC elapsed seconds handle DST',
                  'total_sleep':'union of categories 1,3,4,5 across available sources, no additive In Bed/Awake',
                  'stages':'per-stage union; distinct detailed labels overlapping flagged; both raw and >1ms conflicts reported; microsecond boundaries retained, no arbitrary stage precedence',
                  'episodes':'per source group, sleep+awake, gap >90 min separates exploratory episodes; short daytime <3h candidate not validated nap',
                  'relations':'per reporting night, HR/HRV median of raw samples overlapping any asleep interval; Pearson descriptive paired-bin association, sample-weighted median, no causation'},
        'validity':{'zero_duration':int((s.end_ts==s.start_ts).sum()),'reversed_duration':int((s.end_ts<s.start_ts).sum()),'unknown_category':int((~s.value.isin(STAGES)).sum()),'missing_end':int(s.end_ts.isna().sum())},
        'categories':[], 'sources':[], 'windows':{},'context':[]}
    for value,g in s.groupby('value'):
        d=(g.end_ts-g.start_ts).dt.total_seconds()/60
        q1,q3=d.quantile([.25,.75]); lo=q1-1.5*(q3-q1); hi=q3+1.5*(q3-q1)
        report.setdefault('category_duration_iqr',[]).append({'value':int(value),'bounds_minutes':[float(lo),float(hi)],'flagged_rows':int(((d<lo)|(d>hi)).sum())})
        report['categories'].append({'value':int(value),'label':STAGES.get(value,'unknown'),'rows':len(g),'duration_minutes':describe((g.end_ts-g.start_ts).dt.total_seconds()/60),'cadence':cadence(g)})
    for group,g in s.groupby('source_group'):
        report['sources'].append({'source_group':group,'rows':len(g),'versions':sorted(g.source_version.dropna().astype(str).unique().tolist()),'monthly_stage_duration_hours':[{'month':month,'version':str(version),'category':int(value),'rows':len(h),'raw_duration_h':float((h.end_ts-h.start_ts).dt.total_seconds().sum()/3600)} for (month,version,value),h in g.groupby(['local_month','source_version','value'])],'monthly_rows':{str(k):int(v) for k,v in g.groupby('local_month').size().items()},'cadence':cadence(g),'detailed_stage_conflict_seconds':conflict_seconds(g)})
    for label,start in [('year',YEAR_START),('focus',FOCUS_START)]:
        ns=nights[(nights.night>=str(start.date()))&(nights.night<str(YEAR_END.date()))]
        valid=ns[ns.asleep_union_h>0]; total_days=(YEAR_END.date()-start.date()).days
        q1,q3=valid.asleep_union_h.quantile([.25,.75]); lower=q1-1.5*(q3-q1); upper=q3+1.5*(q3-q1)
        report['windows'][label]={'calendar_days':total_days,'analyzable_bins':total_days-(1 if start==YEAR_START else 0),'nights_with_asleep_records':len(valid),'asleep_union_h':describe(valid.asleep_union_h),'inbed_union_h':describe(ns.inbed_union_h),'asleep_row_sum_excess_h':describe(ns.asleep_row_sum_h-ns.asleep_union_h),'all_row_sum_excess_h':describe(ns.all_row_sum_h-ns.asleep_union_h),'raw_overlap_nights':int((ns.detailed_conflict_h>0).sum()),'conflicting_nights_over_1ms':int((ns.detailed_conflict_h>1e-3/3600).sum()),'total_detailed_overlap_seconds':float(ns.detailed_conflict_h.sum()*3600),'iqr_duration_flags':int(((valid.asleep_union_h<lower)|(valid.asleep_union_h>upper)).sum()),'iqr_bounds_h':[float(lower),float(upper)]}
    report['episodes']={'total':len(eps),'short_daytime_candidates':int(eps.short_daytime_candidate.sum()),'staged_short_daytime_candidates':int((eps.short_daytime_candidate & eps.staged).sum()),'duration_h':describe(eps.asleep_h)}
    for c,g in s.groupby('context'):
        report['context'].append({'context':c,'rows':len(g),'duration_minutes':describe((g.end_ts-g.start_ts).dt.total_seconds()/60)})
    report['within_night_cadence']=[{'source_group':source,'nights':len(g.groupby('night')),'pooled_within_night_start_gaps_seconds':describe(pd.concat([h.sort_values('start_ts').start_ts.diff().dt.total_seconds().dropna() for _,h in g.groupby('night')]))} for source,g in cut.groupby('source_group')]
    report['time_patterns']={'month_nights':{str(k):int(v) for k,v in nights.groupby(nights.night.str[:7]).size().items()},'start_hour_rows':{str(k):int(v) for k,v in s.groupby(s.start_ts.dt.tz_convert(TIME_ZONE).dt.hour).size().items()},'weekday_asleep_hours':[]}
    nights['weekday']=pd.to_datetime(nights.night).dt.day_name()
    for day,g in nights.groupby('weekday'): report['time_patterns']['weekday_asleep_hours'].append({'weekday':day,'nights':len(g),'hours':describe(g.asleep_union_h)})
    report['stage_physiology']=[]
    report['relations']=[]; q=annotate_context(data['quantity'],data)
    for identifier in ['HKQuantityTypeIdentifierHeartRate','HKQuantityTypeIdentifierHeartRateVariabilitySDNN','HKQuantityTypeIdentifierRespiratoryRate']:
        f=q[q.identifier==identifier]; paired=[]
        for value,g in cut.groupby('value'):
            obs=f[overlap_mask(f,g)]
            report['stage_physiology'].append({'identifier':identifier,'stage':STAGES.get(value,'unknown'),'rows':len(obs),'values':describe(obs.value),'interpretation':'Any-overlap label may include transitions; observations can overlap multiple stages, no inferred stage-detection inputs.'})
        for day,g in cut[cut.value.isin(ASLEEP)].groupby('night'):
            obs=f[overlap_mask(f,g)]
            if len(obs): paired.append({'night':day,'median':float(obs.value.median()),'samples':len(obs)})
        p=pd.DataFrame(paired)
        if len(p):
            p=p.merge(nights[['night','asleep_union_h']],on='night')
            lagged=[]
            for lag in [-1,0,1]:
                shifted=p[['night','median']].copy()
                shifted['night']=(pd.to_datetime(shifted.night)+pd.Timedelta(days=-lag)).dt.strftime('%Y-%m-%d')
                aligned=shifted.merge(nights[['night','asleep_union_h']],on='night')
                lagged.append({'physiology_night_offset_days':lag,'paired_nights':len(aligned),'pearson':float(aligned[['median','asleep_union_h']].corr().iloc[0,1]) if len(aligned)>2 else None})
            report['relations'].append({'identifier':identifier,'lagged_night_relations':lagged,'paired_nights':len(p),'night_median':describe(p['median']),'samples_per_night':describe(p.samples),'pearson_with_sleep_duration':float(p[['median','asleep_union_h']].corr().iloc[0,1]) if len(p)>2 else None})
    # Previous-day workout association; reporting noon-noon windows make boundary explicit.
    w=data['workouts']; sums=[]
    for day in nights.night:
        wake=pd.Timestamp(day+' 12:00',tz=TIME_ZONE); begin=wake-pd.DateOffset(days=2); end=wake-pd.DateOffset(days=1)
        z=w[(w.start_ts>=begin)&(w.start_ts<end)]
        sums.append(float(z.duration_s.sum()/60) if 'duration_s' in z else 0.)
    nights['preceding_noon_day_workout_minutes']=sums
    report['workout_relation']={'workout_days':int((nights.preceding_noon_day_workout_minutes>0).sum()),'with_workout_sleep_h':describe(nights[nights.preceding_noon_day_workout_minutes>0].asleep_union_h),'without_recorded_workout_sleep_h':describe(nights[nights.preceding_noon_day_workout_minutes==0].asleep_union_h),'interpretation':'Previous noon-to-noon workout window, not causal; absence of a workout record not inactivity.'}
    report['limitations']=['One consenting person; not clinical sleep norms.','Union across sources resolves duplicate elapsed time, not competing stage labels or Health app source priority.','Fixed reporting timezone cannot establish travel-local sleep timing.','Noon bins and 90-minute episode gap are analyst rules, not HealthKit session identifiers.','Missing nights are missing records, not evidence of off-wrist or no sleep.','Start-filtered snapshot truncates boundary episodes; first/last reporting bins excluded from night summaries and relations.','Sample-weighted physiology medians depend on recording density; no causal/diagnostic inference.','No dedicated sleep summary aggregate is exported; compare raw row totals vs reconstructed union only.']
    # Inspect extreme nights and stage intervals without deleting any flagged rows.
    diagnostic_nights=[]
    extremes=pd.concat([nights.nsmallest(5,'asleep_union_h'),nights.nlargest(5,'asleep_union_h')]).drop_duplicates('night')
    for night in extremes.night:
        rows=cut[cut.night==night]
        diagnostic_nights.append({'night':night,'asleep_union_h':float(nights.loc[nights.night==night,'asleep_union_h'].iloc[0]),
            'source_category_composition':[{'source_group':source,'category':STAGES.get(value,'unknown'),'rows':len(g),'union_h':union_hours(g)} for (source,value),g in rows.groupby(['source_group','value'])],
            'first_interval':rows.start_ts.min().isoformat(),'last_interval':rows.end_ts.max().isoformat(),
            'interpretation':'Recorded interval extent and source/stage composition only; short duration may be incomplete capture, genuinely short sleep, or an unstaged daytime episode. No inferred device removal.'})
    diagnostic_intervals=[]
    for (source,value),rows in s.groupby(['source_group','value']):
        ordered=rows.sort_values('start_ts')
        duration=(ordered.end_ts-ordered.start_ts).dt.total_seconds()
        for index in set(duration.nsmallest(2).index)|set(duration.nlargest(2).index):
            r=s.loc[index]; stream=s[s.source_group==source].sort_values('start_ts').reset_index()
            position=int(stream.index[stream['index']==index][0])
            def neighbor(pos):
                if pos<0 or pos>=len(stream): return None
                z=stream.iloc[pos]
                return {'category':STAGES.get(z.value,'unknown'),'start':z.start_ts.isoformat(),'end':z.end_ts.isoformat(),'duration_s':float((z.end_ts-z.start_ts).total_seconds())}
            diagnostic_intervals.append({'source_group':source,'category':STAGES.get(value,'unknown'),'start':r.start_ts.isoformat(),'end':r.end_ts.isoformat(),'duration_s':float((r.end_ts-r.start_ts).total_seconds()),'context':r.context,'previous':neighbor(position-1),'next':neighbor(position+1),
                'interpretation':'Long interval means a sustained recorded category, not independent repeated measurements; short ~30s intervals are consistent with classifier epochs. Neighbor labels and gaps are retained for review; no physiological diagnosis.'})
    report['extreme_night_diagnostics']=diagnostic_nights
    report['extreme_stage_interval_diagnostics']=diagnostic_intervals
    shortest=diagnostic_nights[0]
    longest=max(diagnostic_nights,key=lambda x:x['asleep_union_h'])
    report['actual_extreme_observations']={'shortest_bin':{'hours':shortest['asleep_union_h'],'categories_present':sorted({x['category'] for x in shortest['source_category_composition']}),'interpretation':'The shortest eligible bin contains Asleep unspecified and Awake only, unlike staged overnight bins. It cannot substantiate an overnight stage deficit; the captured episode may be short or incompletely represent overnight sleep.'},'longest_bin':{'hours':longest['asleep_union_h'],'categories_present':sorted({x['category'] for x in longest['source_category_composition']}),'interpretation':'The longest bin includes detailed sleep stages plus Asleep unspecified. The noon bin combines recorded sleep categories and should not be called one uninterrupted overnight sleep session.'}}
    report['outlier_review_conclusion']={'shortest_eligible_night_h':float(nights.asleep_union_h.min()),'longest_eligible_night_h':float(nights.asleep_union_h.max()),'night_interpretation':'Extremes have valid nonreversed intervals. Noon bins may include multiple episodes; inspect episode table rather than equating bin duration with one overnight session. No clinical diagnosis or deletion.', 'stage_interpretation':'Extremes inspected with immediate chronological neighbors within source; short segments approach 30-second classification windows and long segments represent continuous estimated states. Awake extent is not all presleep/postwake wakefulness.'}
    (output_dir/'extreme-night-diagnostics.json').write_text(json.dumps(diagnostic_nights,indent=2,allow_nan=False,default=str))
    (output_dir/'extreme-stage-interval-diagnostics.json').write_text(json.dumps(diagnostic_intervals,indent=2,allow_nan=False,default=str))
    paths=make_figures(s,nights,cut,Path(figure_dir or output_dir))
    (output_dir/'findings.json').write_text(json.dumps(report,indent=2,allow_nan=False,default=str))
    return report,paths


def make_figures(s,nights,cut,directory):
    directory.mkdir(parents=True,exist_ok=True)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False,'savefig.facecolor':'white'})
    # Prefer a real night with In Bed and stages, closest to median sleep duration.
    candidates=nights[(nights.inbed_union_h>0)&(nights.asleep_union_h>3)&(nights.detailed_conflict_h==0)]
    if candidates.empty: candidates=nights[nights.asleep_union_h>3]
    day=candidates.iloc[(candidates.asleep_union_h-candidates.asleep_union_h.median()).abs().argmin()].night
    g=cut[cut.night==day]; origin=g.start_ts.min()
    fig,ax=plt.subplots(figsize=(11,4.5))
    for value in [0,2,5,3,4,1]:
        for r in g[g.value==value].itertuples():
            ax.broken_barh([((r.start_ts-origin).total_seconds()/3600,(r.end_ts-r.start_ts).total_seconds()/3600)],(value-.32,.64),facecolors=COLORS[value])
    ax.set_yticks([0,1,2,3,4,5],[STAGES[x] + (' (not recorded)' if x==0 and not (g.value==0).any() else '') for x in range(6)]); ax.set_xlabel('Elapsed hours from first recorded interval'); ax.set_title('One recorded night: sleep stages are intervals'); ax.grid(axis='x',alpha=.18)
    ax.text(0,-.24,'Example sleep data · no dates or device identity shown',transform=ax.transAxes,color='#586174',fontsize=9)
    fig.tight_layout(); p=directory/'stage-timeline.png'; fig.savefig(p,dpi=180,bbox_inches='tight'); plt.close(fig)
    focus=nights[(nights.night>=str(FOCUS_START.date()))&(nights.night<str(YEAR_END.date()))].copy().reset_index(drop=True)
    fig,ax=plt.subplots(figsize=(11,4.5)); x=np.arange(1,len(focus)+1)
    ax.plot(x,focus.all_row_sum_h,color='#e09b51',lw=1.5,label='All row durations added (includes Awake)')
    ax.plot(x,focus.asleep_row_sum_h,color='#aa70bd',lw=1.3,label='Asleep rows added (can include overlaps)')
    ax.plot(x,focus.asleep_union_h,color='#385bad',lw=2,label='Asleep interval union')
    ax.set_xlabel('Observed reporting night in focus window'); ax.set_ylabel('Recorded hours'); ax.set_title('Why row totals and time asleep can differ'); ax.legend(fontsize=9,loc='upper left'); ax.grid(alpha=.18)
    ax.text(0,-.25,'Example data · noon-to-noon bins · elapsed time · missing nights omitted',transform=ax.transAxes,color='#586174',fontsize=9)
    fig.tight_layout(); p2=directory/'nightly-interval-union.png'; fig.savefig(p2,dpi=180,bbox_inches='tight'); plt.close(fig)
    return [str(p),str(p2)]


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--input',required=True,type=Path); parser.add_argument('--output',required=True,type=Path); parser.add_argument('--figures',type=Path); args=parser.parse_args()
    report,paths=analyze(args.input,args.output,args.figures)
    code='from pathlib import Path\nimport sys, json\n'+f"sys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\nfrom sleep_analysis import analyze\nreport, figures = analyze(Path({str(args.input)!r}), Path({str(args.output)!r}))\nprint(json.dumps(report, indent=2, allow_nan=False))"
    write_notebook(args.output/'sleep-analysis.ipynb','Sleep: intervals, stages, coverage and physiology',[
        {'heading':'Questions and methods','markdown':'Investigate values, durations, robust outliers, source revisions, start/start and end/next cadence, workout and sleep contexts, local-hour/week/month changes, related physiology and sleep-specific overlaps. Every category is retained; In Bed and Awake never count as asleep. Stage conflicts are flagged, not resolved by guessed priority. Complete findings and input SHA-256 receipts are printed below.'},
        {'heading':'Rerun the complete analysis','code':code,'output':report,'figures':paths},
        {'heading':'Primary references','markdown':'[Apple sleep categories](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis) documents intentional In Bed overlaps and incomplete edge Awake records. [Apple 2025 sleep-stage validation](https://www.apple.com/health/pdf/Estimating_Sleep_Stages_from_Apple_Watch_Oct_2025.pdf) describes accelerometer-derived staging, validation and version-dependent behavior. Neither source establishes an individual clinical diagnosis from these records.'}])
    import nbformat
    notebook_path=args.output/'sleep-analysis.ipynb'
    notebook=nbformat.read(notebook_path,as_version=4)
    figure_index=0
    for cell in notebook.cells:
        if cell.cell_type=='code' and cell.source.startswith('# Figure'):
            cell.source=f'from IPython.display import Image, display\ndisplay(Image(filename=figures[{figure_index}]))'
            figure_index+=1
    from nbclient import NotebookClient
    NotebookClient(notebook, timeout=180, kernel_name='python3').execute()
    nbformat.write(notebook,notebook_path)
    print(json.dumps({'rows':report['rows'],'windows':report['windows'],'figures':paths},indent=2))

if __name__=='__main__': main()
