"""Source-aware audio levels and daylight; no reconstructed personal noise dose."""
from pathlib import Path
import argparse
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from batch_support import load_snapshot, select_rows, research_report, persist_research, execute_notebooks
from common import annotate_context, describe, overlap_mask, FOCUS_START, FOCUS_END

IDS = {
 'environmental-audio-exposure': ('HKQuantityTypeIdentifierEnvironmentalAudioExposure', 'quantity'),
 'environmental-sound-reduction': ('HKQuantityTypeIdentifierEnvironmentalSoundReduction', 'quantity'),
 'headphone-audio-exposure': ('HKQuantityTypeIdentifierHeadphoneAudioExposure', 'quantity'),
 'time-in-daylight': ('HKQuantityTypeIdentifierTimeInDaylight', 'quantity'),
 'audio-exposure-event': ('HKCategoryTypeIdentifierAudioExposureEvent', 'category'),
 'headphone-audio-exposure-event': ('HKCategoryTypeIdentifierHeadphoneAudioExposureEvent', 'category'),
}
RELATED = ('HKQuantityTypeIdentifierEnvironmentalAudioExposure', 'HKQuantityTypeIdentifierHeadphoneAudioExposure',
           'HKQuantityTypeIdentifierEnvironmentalSoundReduction', 'HKQuantityTypeIdentifierTimeInDaylight',
           'HKQuantityTypeIdentifierStepCount', 'HKQuantityTypeIdentifierHeartRate')

def equivalent_level(values, seconds):
    """Energy combination of positive-duration finite levels, stably in dB."""
    valid = np.isfinite(values) & np.isfinite(seconds) & (seconds > 0)
    values, seconds = np.asarray(values)[valid], np.asarray(seconds)[valid]
    if not len(values):
        return None
    peak = values.max()
    return float(peak + 10 * np.log10(np.sum(seconds * 10 ** ((values - peak) / 10)) / seconds.sum()))

def special(data, identifier, kind):
    rows = select_rows(data, identifier, kind).copy()
    result = {'year_records': len(rows), 'calendar': 'Local reporting day; raw source records, not Health app merged totals.',
              'limitations': ['Gaps do not establish silence, headphone non-use, darkness or disabled notifications.',
                              'Context overlap is temporal evidence, not a causal effect or explicit workout link.'],
              'sources': [], 'related_types': []}
    if kind == 'category':
        result.update({'expected_code': 1,
                       'category_semantics': 'Seven-day exposure notification' if identifier.endswith('HeadphoneAudioExposureEvent') else 'Deprecated loud-environment event; current environmental event stored separately.',
                       'numeric_outliers': 'Not applicable: codes have named meanings, not magnitudes.',
                       'opportunity_denominator': 'Unknown notification configuration, monitored hours and detection eligibility; no incidence or exposure prevalence can be estimated.'})
    elif identifier.endswith('TimeInDaylight'):
        result.update({'semantics': 'Cumulative minutes of recorded daylight; daily sums restricted to each source.',
                       'not_measured': ['UV dose', 'vitamin D production', 'illuminance spectrum', 'a prescribed outdoor time target']})
    else:
        result.update({'semantics': 'Logarithmic levels; quantiles summarize sample distribution, not sound dose.',
                       'energy_method': '10 log10(sum(duration * 10 ** (level/10)) / sum(duration)); positive finite durations only, separate sources. Overlaps remain flagged; not a full-day dose.',
                       'sound_reduction_note': 'Reduction values are attenuation estimates, not remaining ear-level exposure. Do not subtract asynchronous wrist and headphone samples.'})
    if identifier.endswith('SoundReduction'):
        result['energy_method'] = 'Unsupported for attenuation: matched incident sound energies are unavailable; retain reduction quantiles, not an equivalent exposure level.'
    if rows.empty:
        result['status'] = 'absent'
        result['reason'] = 'The required raw table was checked in the bounded selected-user snapshot.'
        return result
    rows = annotate_context(rows, data)
    result['metadata_keys_present'] = sorted({k for m in rows.get('metadata', []) for k in (json.loads(m) if isinstance(m, str) and m else m or {})})
    if kind == 'category':
        for other_id in RELATED[:2]:
            other = select_rows(data, other_id)
            neighbors = []
            for _, event in rows.iterrows():
                selected = other[overlap_mask(other, pd.DataFrame([event]))] if len(other) else other
                neighbors.append({'overlapping_records':len(selected),'sample_range_db':describe(selected.value) if len(selected) else None})
            result['related_types'].append({'other':other_id,'available_records':len(other),'event_windows':neighbors,'method':'Temporal interval neighbors, no explicit triggering sample link or dose reconstruction.'})
    for source, year in rows.groupby('source_group'):
        focus = year[(year.start_ts >= FOCUS_START) & (year.start_ts < FOCUS_END)].sort_values('start_ts').copy()
        duration = (focus.end_ts-focus.start_ts).dt.total_seconds()
        out = {'source': source, 'year_records': len(year), 'focus_records': len(focus), 'focus_days': int(focus.local_day.nunique()),
               'values': describe(focus.value) if kind=='quantity' else None, 'duration_seconds': describe(duration), 'nonpositive_duration': int((duration<=0).sum()),
               'contexts': {str(c): {'records':len(g),'values':describe(g.value) if kind=='quantity' else None} for c,g in focus.groupby('context')},
               'hour_counts': focus.start_ts.dt.tz_convert('America/Los_Angeles').dt.hour.value_counts().sort_index().to_dict()}
        starts = focus.start_ts.astype('int64').to_numpy()
        ends = focus.end_ts.astype('int64').to_numpy()
        out['overlap_with_previous_span'] = int((starts[1:] < np.maximum.accumulate(ends)[:-1]).sum()) if len(focus)>1 else 0
        if kind == 'category':
            out['code_counts'] = focus.value.value_counts().to_dict()
            out['unexpected_codes'] = int((focus.value != result['expected_code']).sum())
        elif identifier.endswith('TimeInDaylight'):
            out['daily_raw_sums_minutes'] = describe(focus.groupby('local_day').value.sum())
            out['minutes_exceed_stored_duration'] = int((focus.value > duration/60 + 1e-6).sum())
            out['cross_day_intervals'] = int((focus.start_ts.dt.tz_convert('America/Los_Angeles').dt.date != focus.end_ts.dt.tz_convert('America/Los_Angeles').dt.date).sum())
            primary_daily = focus.groupby('local_day').value.sum()
        else:
            out['duration_weighted_energy_level_db'] = equivalent_level(focus.value.to_numpy(), duration.to_numpy()) if not identifier.endswith('SoundReduction') else None
            out['arithmetic_sample_mean_db_for_comparison_only'] = float(focus.value.mean()) if len(focus) else None
            out['contexts_energy_level_db'] = {str(c):equivalent_level(g.value.to_numpy(),(g.end_ts-g.start_ts).dt.total_seconds().to_numpy()) for c,g in focus.groupby('context')} if not identifier.endswith('SoundReduction') else None
            out['negative_values'] = int((focus.value < 0).sum())
            primary_daily = focus.groupby('local_day').value.median()
        if kind == 'quantity':
            for other_id in RELATED:
                if other_id == identifier: continue
                other = select_rows(data, other_id)
                if other.empty: continue
                other = annotate_context(other, data)
                other = other[(other.start_ts>=FOCUS_START)&(other.start_ts<FOCUS_END)]
                for other_source, g in other.groupby('source_group'):
                    other_daily = g.groupby('local_day').value.sum() if other_id.endswith(('StepCount','TimeInDaylight')) else g.groupby('local_day').value.median()
                    pair = pd.concat([primary_daily.rename('a'),other_daily.rename('b')],axis=1).dropna()
                    result['related_types'].append({'source':source,'other':other_id,'other_source':other_source,'paired_days':len(pair),
                        'spearman': float(pair.corr(method='spearman').iloc[0,1]) if len(pair)>=10 else None,
                        'method':'Daylight/steps raw source sums; sound and heart-rate sample medians. Only jointly observed days; no adjustment for wear or activity.'})
        result['sources'].append(out)
    return result

def figure(data, identifier, output):
    """Actual per-source distributions; never fabricate unavailable records."""
    rows=select_rows(data,identifier)
    if rows.empty:return False
    rows=annotate_context(rows,data)
    rows=rows[(rows.start_ts>=FOCUS_START)&(rows.start_ts<FOCUS_END)]
    if rows.empty:return False
    source=rows.source_group.value_counts().index[0]
    rows=rows[rows.source_group==source]
    daylight=identifier.endswith('TimeInDaylight')
    fig,ax=plt.subplots(figsize=(9,4.8))
    if daylight:
        daily=rows.groupby('local_day').value.sum()
        ax.hist(daily,bins=18,color='#267d87',edgecolor='white')
        ax.set_xlabel('Recorded daylight minutes per observed day')
        ax.set_ylabel('Observed days')
        ax.set_title('Daylight totals vary across observed days',loc='left')
        note=f'{len(rows):,} intervals • {len(daily)} observed days • largest source • raw sums'
    else:
        groups=[(str(c),g) for c,g in rows.groupby('context')]
        for c,g in groups:
            ax.hist(g.value,bins=np.linspace(rows.value.min(),rows.value.max()+.1,35),alpha=.55,label=f'{c} (n={len(g):,})')
        ax.set_xlabel('Sound reduction (dB)' if identifier.endswith('SoundReduction') else 'Sound level (dB(A))')
        ax.set_ylabel('Records')
        ax.legend(frameon=False,fontsize=9)
        ax.set_title('Recorded levels by workout and sleep context',loc='left')
        note=f'{len(rows):,} intervals • {rows.local_day.nunique()} observed days • largest source • sample counts, not dose'
    ax.spines[['top','right']].set_visible(False)
    ax.grid(axis='y',alpha=.15)
    fig.text(.09,.025,note,fontsize=9)
    fig.tight_layout(rect=(0,.06,1,1))
    output.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(output,dpi=160)
    fig.savefig(output.with_suffix('.svg'))
    plt.close(fig)
    return True

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    data=load_snapshot(str(args.input.resolve()))
    paths=[]
    for key,(identifier,kind) in IDS.items():
        component='hkcategorytypeidentifier' if kind=='category' else 'hkquantitytypeidentifier'
        suffix=identifier.split('Identifier')[1].lower()
        refs=[f'https://developer.apple.com/documentation/healthkit/{component}/{suffix}']
        if 'Audio' in identifier:refs.append('https://support.apple.com/en-us/108968' if 'Headphone' in identifier else 'https://support.apple.com/en-us/102315')
        setup='from batch2_hearing import special'
        figs=[]
        image=args.output/key/'distribution.png'
        if kind=='quantity' and figure(data,identifier,image):
            figs=[str(image.resolve())]
            setup+=f'\nfrom batch2_hearing import figure\nfigure(data,{identifier!r},Path({str(image.resolve())!r}))'
        report=research_report(data,identifier,kind=kind,special_analysis=special(data,identifier,kind),related_identifiers=RELATED,references=refs)
        paths.append(persist_research(report,args.output/key,key,input_dir=args.input,setup_code=setup,special_code=f'special(data,{identifier!r},{kind!r})',related_identifiers=RELATED,references=refs,figures=figs))
    execute_notebooks(paths)

if __name__=='__main__':main()
