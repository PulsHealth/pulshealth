"""Reproducible dietary logging research; private snapshot inputs only."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import pandas as pd
from batch_support import load_snapshot, select_rows, research_report, persist_research, execute_notebooks, clean_json
from common import annotate_context, describe, FOCUS_START, FOCUS_END

IDS = {k: 'HKQuantityTypeIdentifier' + v for k, v in {
    'dietary-water': 'DietaryWater', 'dietary-caffeine': 'DietaryCaffeine',
    'dietary-energy-consumed': 'DietaryEnergyConsumed', 'dietary-protein': 'DietaryProtein',
    'dietary-carbohydrates': 'DietaryCarbohydrates', 'dietary-fat-total': 'DietaryFatTotal'}.items()}


def special_analysis(data, identifier):
    rows = select_rows(data, identifier)
    related = {key: len(select_rows(data, val)) for key, val in IDS.items()}
    related['body_mass'] = len(select_rows(data, 'HKQuantityTypeIdentifierBodyMass'))
    result = {'related_raw_record_counts': related, 'interpretation': [
        'Cumulative amounts are recorded contributions, not continuously sensed intake.',
        'Missing days do not establish fasting, zero caffeine, dehydration or nutrient deficiency.',
        'Timestamps and interval overlap describe logging; actual ingestion time is unverified.',
        'Do not add competing sources without reviewing duplicate food/serving entries.',
        'The 4/4/9 comparison is exploratory bookkeeping, not a reconstruction of app calorie calculations.']}
    if rows.empty:
        result['status'] = 'absent'
        result['unsupported_questions'] = ['serving size and meal metadata', 'source-specific daily intake sums',
            'within-day logging gaps and durations', 'simultaneous entries and duplicate candidates',
            'workout and asleep overlap', 'daily macro energy agreement', 'body-mass adjusted protein',
            'caffeine-before-sleep timing and water-to-activity association']
        return result
    a = annotate_context(rows, data)
    result['source_daily_sums'] = []
    for source, g in a.groupby('source_group'):
        focus = g[(g.start_ts >= FOCUS_START) & (g.start_ts < FOCUS_END)]
        daily = g.groupby('local_day').value.sum(min_count=1)
        fdaily = focus.groupby('local_day').value.sum(min_count=1)
        result['source_daily_sums'].append({'source_group': source, 'year_logged_days': len(daily),
            'year_days': 365, 'focus_logged_days': len(fdaily), 'focus_days': 92,
            'year_sums_on_logged_days': describe(daily), 'focus_sums_on_logged_days': describe(fdaily),
            'daily_sums': daily.to_dict()})
    result['duration_seconds'] = describe((a.end_ts-a.start_ts).dt.total_seconds())
    result['identical_amount_time_other_source_candidates'] = int(a.duplicated(['start_ts','end_ts','value'], keep=False).sum())
    result['timestamp_context_counts'] = a.context.value_counts().to_dict()
    metadata = a.metadata if 'metadata' in a else []
    result['metadata_key_counts'] = pd.Series([k for m in metadata if isinstance(m, dict) for k in m]).value_counts().to_dict()
    result['largest_records_retained'] = a.nlargest(5, 'value')[['start_ts','end_ts','value','source_group']].to_dict(orient='records')
    result['daily_related_sums'] = []
    for other_id in [v for v in IDS.values() if v != identifier]:
        other = select_rows(data, other_id)
        if other.empty:
            result['daily_related_sums'].append({'identifier': other_id, 'status': 'absent', 'paired_days': 0})
            continue
        b = annotate_context(other, data)
        for sa, ga in a.groupby('source_group'):
            for sb, gb in b.groupby('source_group'):
                pairs = pd.concat([ga.groupby('local_day').value.sum(min_count=1).rename('a'), gb.groupby('local_day').value.sum(min_count=1).rename('b')], axis=1).dropna()
                result['daily_related_sums'].append({'identifier': other_id, 'primary_source': sa, 'related_source': sb,
                    'paired_days': len(pairs), 'spearman': pairs.corr(method='spearman').iloc[0,1] if len(pairs)>=10 else None,
                    'status': 'measured' if len(pairs)>=10 else 'sparse'})
    macro = []
    for key in ('dietary-protein','dietary-carbohydrates','dietary-fat-total','dietary-energy-consumed'):
        m = select_rows(data, IDS[key])
        if m.empty:
            break
        m = annotate_context(m, data)
        macro.append(m.groupby(['source_group','local_day']).value.sum(min_count=1).rename(key))
    if len(macro) == 4:
        pairs = pd.concat(macro, axis=1).dropna()
        derived = 4*pairs['dietary-protein'] + 4*pairs['dietary-carbohydrates'] + 9*pairs['dietary-fat-total']
        result['macro_449_agreement'] = {'source_days': len(pairs), 'difference_kcal': describe(derived-pairs['dietary-energy-consumed']),
                                       'note': 'Same-source recorded-day totals only; fiber, alcohol, labels, rounding and incomplete logs can differ.'}
    else:
        result['macro_449_agreement'] = {'status': 'absent', 'reason': 'One or more required nutrient types absent.'}
    return clean_json(result)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    data = load_snapshot(args.input)
    paths=[]
    for key, identifier in IDS.items():
        refs = ['https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/' + identifier.removeprefix('HKQuantityTypeIdentifier').lower(),
            'https://developer.apple.com/documentation/healthkit/nutrition-type-identifiers',
            'https://support.apple.com/en-us/108779',
            'https://www.fda.gov/food/nutrition-facts-label/whats-nutrition-facts-label',
            'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.9']
        if key == 'dietary-water':
            refs.append('https://www.cdc.gov/healthy-weight-growth/water-healthy-drinks/')
        if key == 'dietary-caffeine':
            refs.append('https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much')
        special = special_analysis(data, identifier)
        report = research_report(data, identifier, special_analysis=special, related_identifiers=tuple(IDS.values()), references=refs)
        paths.append(persist_research(report, args.output/key, key, input_dir=args.input,
            special_code=f'special_analysis(data, {identifier!r})', related_identifiers=tuple(IDS.values()),
            setup_code='from newbatch1_nutrition import special_analysis', references=refs))
    execute_notebooks(paths)
    print(json.dumps({key: json.loads((args.output/key/'findings.json').read_text())['facets']['coverage']['evidence'] for key in IDS}, indent=2))

if __name__ == '__main__':
    main()
