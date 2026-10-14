"""Body-measurement research from an immutable, scoped HealthKit snapshot.

Records retain source-specific logging schedules. Cross-type exact-time matching
checks consistency, never establishes a stored correlation or a verified formula.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from batch_support import (load_snapshot, select_rows, research_report,
                           persist_research, execute_notebooks, clean_json)
from common import annotate_context, describe, TIME_ZONE

TYPES = {
    'BodyMass': 'body-mass', 'BodyMassIndex': 'body-mass-index',
    'BodyFatPercentage': 'body-fat-percentage', 'Height': 'height',
    'LeanBodyMass': 'lean-body-mass',
}
APPLE = 'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/'
REFERENCES = {
    'BodyMass': [APPLE+'bodymass', 'https://www.england.nhs.uk/long-read/how-to-record-your-weight/'],
    'BodyMassIndex': [APPLE+'bodymassindex', 'https://www.cdc.gov/bmi/adult-calculator/bmi-categories.html', 'https://www.cdc.gov/bmi/about/index.html'],
    'BodyFatPercentage': [APPLE+'bodyfatpercentage', 'https://developer.apple.com/documentation/healthkit/hkunit/percent()', 'https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/diabetes-endocrinology-obesity-branch/metabolic-clinical-research-unit/metabolic-testing', 'https://support.withings.com/hc/en-us/articles/218970957-Body-How-does-the-scale-measure-my-body-composition'],
    'Height': [APPLE+'height', 'https://www.cdc.gov/bmi/child-teen-calculator/measure-child-height-weight.html'],
    'LeanBodyMass': [APPLE+'leanbodymass', 'https://support.withings.com/hc/en-us/articles/218970957-Body-How-does-the-scale-measure-my-body-composition', 'https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/diabetes-endocrinology-obesity-branch/metabolic-clinical-research-unit/metabolic-testing'],
}
RELATED = tuple('HKQuantityTypeIdentifier'+s for s in TYPES)

def exact_pairs(data):
    """One-to-one source/time pairing, preserving ambiguous groups separately."""
    a = annotate_context(select_rows(data, RELATED[0]), data)
    b = annotate_context(select_rows(data, RELATED[1]), data)
    if a.empty or b.empty:
        return pd.DataFrame(), 0
    keys = ['start_ts', 'source_group']
    ambiguous = int(a.duplicated(keys, keep=False).sum()+b.duplicated(keys, keep=False).sum())
    a = a[~a.duplicated(keys, keep=False)]
    b = b[~b.duplicated(keys, keep=False)]
    pairs = a.merge(b, on=keys, suffixes=('_mass', '_bmi'), validate='one_to_one')
    pairs = pairs[(pairs.value_mass > 0) & (pairs.value_bmi > 0)].copy()
    pairs['implied_height_m'] = np.sqrt(pairs.value_mass/pairs.value_bmi)
    return pairs, ambiguous

def special(data, identifier):
    suffix = identifier.removeprefix('HKQuantityTypeIdentifier')
    rows = select_rows(data, identifier)
    result = {
        'questions': ['Are repeated entries distinct measurements or repeated imports?',
                      'Does logging reflect a weigh-in schedule rather than automatic sensing?',
                      'Can paired measurements support a consistency check?',
                      'Are workout/sleep overlaps meaningful for an occasional body measurement?'],
        'raw_count': len(rows), 'unit_contract': {'BodyMass':'kg','BodyMassIndex':'count','BodyFatPercentage':'%','Height':'m','LeanBodyMass':'kg'}[suffix],
        'context_interpretation': 'Overlap describes when a stored measurement occurs; these are not continuous workout or sleep sensors.',
        'measurement_method': 'HealthKit quantity identifier alone does not verify scale method, height used for BMI, body-composition algorithm, or measurement accuracy.',
    }
    if rows.empty:
        result['empirical_status'] = 'absent_in_verified_snapshot'
        result['unavailable_questions'] = ['No measured ranges/outliers/gaps/intervals/source shifts or workout/sleep comparisons can be computed for this type.', 'No paired raw records support a relationship estimate.']
        result['aggregate_records'] = int((data['aggregates'].identifier == identifier).sum()) if 'identifier' in data['aggregates'] else 0
        result['type_considerations'] = {
            'Height': 'An adult profile height can predate this window; no rows here does not establish that a source app lacks height. Repeated identical values would be profile updates rather than proof of growth.',
            'BodyFatPercentage': 'HealthKit percent scalar 0.20 is displayed as 20%; exporting a percent symbol does not change the scalar. Check producer and display conversion exactly once. BIA-derived estimates are method dependent.',
            'LeanBodyMass': 'Lean mass is not synonymous with skeletal muscle. Check whether the producer derives it from weight and body fat; no such provenance is verified here.',
        }[suffix]
        return result
    rows = annotate_context(rows, data)
    result['metadata_user_entered_counts'] = pd.Series([str(m.get('HKWasUserEntered','missing')) for m in rows.metadata]).value_counts().to_dict()
    result['same_source_start_duplicate_rows'] = int(rows.duplicated(['source_group','start_ts'],keep=False).sum())
    result['durations_seconds'] = describe((rows.end_ts-rows.start_ts).dt.total_seconds())
    result['recorded_context_counts'] = rows.context.value_counts().to_dict()
    result['source_monthly_observations'] = [{'source':s,'month':m,'records':len(g),'observed_days':int(g.local_day.nunique()),'median':float(g.value.median())} for (s,m),g in rows.groupby(['source_group','local_month'])]
    result['source_daily_weighting'] = []
    for source,g in rows.groupby('source_group'):
        daily=g.groupby('local_day').value.median()
        gaps = g.sort_values('start_ts').start_ts.diff().dt.total_seconds()/86400
        result['source_daily_weighting'].append({'source':source,'records':len(g),'observed_days':len(daily),'record_mean':float(g.value.mean()),'equal_observed_day_mean':float(daily.mean()),'daily_medians':describe(daily),'positive_gaps_days':describe(gaps[gaps>0]),'largest_gap_days':float(gaps.max()) if len(g)>1 else None})
    # Exact-time same-source pairing checks the formula's implied denominator;
    # independently recorded height is deliberately not carried forward.
    pairs,ambiguous=exact_pairs(data)
    result['bmi_weight_consistency']={'paired_records':len(pairs),'ambiguous_rows_excluded':ambiguous,'matching':'Unique exact start timestamp and source bundle/display-name group; positive kg and BMI values only.', 'height_raw_records':len(select_rows(data,'HKQuantityTypeIdentifierHeight')), 'implied_height_m':describe(pairs.implied_height_m) if len(pairs) else {},'limitation':'This is a derived consistency check, not a measured height or proof that the producer used this formula.'}
    if suffix=='BodyMassIndex':
        result['adult_screening_band_counts']={'below18_5':int((rows.value<18.5).sum()),'18_5_to_below25':int(((rows.value>=18.5)&(rows.value<25)).sum()),'25_to_below30':int(((rows.value>=25)&(rows.value<30)).sum()),'30_and_above':int((rows.value>=30).sum())}
        result['adult_band_limitation']='Adult screening bands are not an individual diagnosis; pediatric BMI requires age/sex percentiles. No age classification is inferred from this snapshot.'
    return clean_json(result)

def figures(data, suffix, destination, private):
    if suffix not in ('BodyMass','BodyMassIndex'):
        return []
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    rows=annotate_context(select_rows(data,'HKQuantityTypeIdentifier'+suffix),data)
    source=rows.source_group.value_counts().index[0]
    selected=rows[rows.source_group==source].sort_values('start_ts')
    destination.mkdir(parents=True,exist_ok=True)
    private.mkdir(parents=True,exist_ok=True)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False})
    fig,ax=plt.subplots(figsize=(9.6,4.1),layout='constrained')
    days=(selected.start_ts-selected.start_ts.min()).dt.total_seconds()/86400
    ax.scatter(days,selected.value,s=18,color='#1c7986',alpha=.7,label='Recorded values')
    daily=pd.DataFrame({'day':days.to_numpy(),'value':selected.value.to_numpy()})
    # Explicit 30-day bins; omit bins with no records. No interpolation.
    daily['bin']=(daily.day//30).astype(int)
    groups=daily.groupby('bin')
    for _,g in groups:
        ax.hlines(g.value.median(),g.day.min(),g.day.max(),color='#233b53',lw=3)
    ax.plot([],[],color='#233b53',lw=3,label='Median within each 30-day bin')
    ax.set(xlabel='Days since first recorded observation',ylabel='Weight (kg)' if suffix=='BodyMass' else 'BMI (kg/m²)',title='An example measurement schedule leaves gaps')
    ax.grid(alpha=.15);ax.legend(frameon=False,loc='best')
    fig.savefig(destination/'recording-pattern.svg',metadata={'Date':None})
    fig.savefig(private/'recording-pattern.png',dpi=150);plt.close(fig)
    path=destination/'recording-pattern.svg'
    path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')
    return [private/'recording-pattern.png']

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--figures',type=Path,required=True)
    args=p.parse_args();data=load_snapshot(str(args.input.resolve()));paths=[]
    for suffix,key in TYPES.items():
        identifier='HKQuantityTypeIdentifier'+suffix
        refs=[{'url':u,'reviewed_on':'2026-10-14'} for u in REFERENCES[suffix]]
        other=[i for i in RELATED if i!=identifier]
        report=research_report(data,identifier,special_analysis=special(data,identifier),related_identifiers=other,references=refs)
        pngs=figures(data,suffix,args.figures/key,args.output/key)
        paths.append(persist_research(report,args.output/key,suffix+' research',input_dir=args.input,setup_code='from batch1_body import special',special_code=f'special(data, {identifier!r})',related_identifiers=other,references=refs,figures=pngs))
    execute_notebooks(paths)
    print(json.dumps({'executed':len(paths),'paths':[str(p) for p in paths]},indent=2))

if __name__=='__main__':
    main()
