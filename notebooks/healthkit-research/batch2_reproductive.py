"""Reproductive category evidence: logging, categorical meaning and missingness."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from batch_support import (load_snapshot, select_rows, research_report,
                           persist_research, execute_notebooks)
from common import describe, TIME_ZONE

TYPES = {
    'CervicalMucusQuality': ('cervical-mucus-quality', {1: 'dry', 2: 'sticky', 3: 'creamy', 4: 'watery', 5: 'eggWhite'}),
    'MenstrualFlow': ('menstrual-flow', {1: 'unspecified', 2: 'light', 3: 'medium', 4: 'heavy', 5: 'none'}),
    'OvulationTestResult': ('ovulation-test-result', {1: 'negative', 2: 'luteinizingHormoneSurge', 3: 'indeterminate', 4: 'estrogenSurge'}),
    'Pregnancy': ('pregnancy', {0: 'notApplicable'}),
    'PregnancyTestResult': ('pregnancy-test-result', {1: 'negative', 2: 'positive', 3: 'indeterminate'}),
    'SexualActivity': ('sexual-activity', {0: 'notApplicable'}),
}
RELATED = ('HKCategoryTypeIdentifierMenstrualFlow', 'HKCategoryTypeIdentifierCervicalMucusQuality',
           'HKCategoryTypeIdentifierOvulationTestResult', 'HKCategoryTypeIdentifierPregnancyTestResult',
           'HKCategoryTypeIdentifierPregnancy', 'HKCategoryTypeIdentifierSexualActivity',
           'HKQuantityTypeIdentifierBasalBodyTemperature', 'HKQuantityTypeIdentifierAppleSleepingWristTemperature')


def special(data, identifier):
    suffix = identifier.removeprefix('HKCategoryTypeIdentifier')
    rows = select_rows(data, identifier, 'category').sort_values('start_ts')
    codes = TYPES[suffix][1]
    metadata = [json.loads(m) if isinstance(m, str) and m else {} for m in rows.get('metadata', [])]
    result = {
        'allowed_codes': codes,
        'code_semantics_source': 'Apple HealthKit category documentation and SDK category enumeration declarations.',
        'code_counts': rows.value.value_counts().to_dict() if len(rows) else {},
        'unexpected_codes': int((~rows.value.isin(codes)).sum()) if len(rows) else 0,
        'interval_duration_seconds': describe((rows.end_ts - rows.start_ts).dt.total_seconds()) if len(rows) else None,
        'metadata_keys_present': sorted({k for m in metadata for k in m}),
        'logging_opportunity': {'status': 'unsupported', 'reason': 'No record of tests performed, observation opportunities or completeness of manual logging.'},
        'missingness': 'No entry is unknown, not a negative result, no bleeding, no sexual activity or no pregnancy.',
        'numeric_analysis': 'Category codes have no numeric physiological range; do not average codes or apply numeric outlier thresholds.',
        'context_interpretation': 'Workout and sleep overlap locates a recorded interval; it does not establish cause or physiological change.',
        'related_types': [],
    }
    for related in RELATED:
        if related == identifier:
            continue
        kind = 'category' if related.startswith('HKCategory') else 'quantity'
        other = select_rows(data, related, kind)
        same_days = 0
        if len(rows) and len(other):
            days = set(rows.start_ts.dt.tz_convert(TIME_ZONE).dt.date)
            other_days = set(other.start_ts.dt.tz_convert(TIME_ZONE).dt.date)
            same_days = len(days & other_days)
        result['related_types'].append({'identifier': related, 'available_records': len(other),
                                       'shared_recorded_days': same_days,
                                       'status': 'measured' if len(rows) and len(other) else 'absent',
                                       'reason': 'Same reporting day is descriptive alignment, not a HealthKit link or confirmation of ovulation or conception.'})
    if suffix == 'MenstrualFlow':
        starts = [m.get('HKMenstrualCycleStart') for m in metadata]
        marked = rows[[v is True for v in starts]] if len(rows) else rows
        result['cycle_start_metadata'] = {'true': sum(v is True for v in starts), 'false': sum(v is False for v in starts),
                                          'missing_or_invalid': sum(v is not True and v is not False for v in starts)}
        result['marked_start_gap_days'] = describe(marked.start_ts.diff().dt.total_seconds().dropna() / 86400) if len(marked) > 1 else None
        result['special_considerations'] = 'Single intervals may cover a period; multiple intervals can describe changing flow. First interval must mark cycle start. Marked-start gaps require checking duplicate/source overlap and missed cycles before interpretation.'
        result['enumeration_evolution'] = 'HKCategoryValueMenstrualFlow deprecated in iOS 18/watchOS 11 in favor of HKCategoryValueVaginalBleeding; raw codes remain unspecified1/light2/medium3/heavy4/none5.'
    elif suffix == 'SexualActivity':
        values = [m.get('HKSexualActivityProtectionUsed') for m in metadata]
        result['protection_metadata'] = {'true': sum(v is True for v in values), 'false': sum(v is False for v in values),
                                          'unknown': sum(v is not True and v is not False for v in values)}
        result['special_considerations'] = 'Optional Boolean protection metadata: missing is unknown. No method, effectiveness, partner or conception probability is encoded.'
    elif suffix == 'Pregnancy':
        result['special_considerations'] = 'An interval labels recorded pregnancy context. Its start is not independently validated conception or last menstrual period; its end is not proof of delivery or outcome. Overlapping revisions must not be counted as separate pregnancies.'
        result['gestational_age'] = {'status': 'unsupported', 'reason': 'Category code and interval alone do not establish clinically dated gestational age, due date or pregnancy outcome.'}
    elif suffix == 'CervicalMucusQuality':
        result['special_considerations'] = 'Subjective observations; category ordering is descriptive, not equal numeric spacing or a calibrated probability of fertility. Missing days prevent complete phase reconstruction.'
    elif suffix == 'OvulationTestResult':
        result['special_considerations'] = 'LH surge and estrogen surge are distinct categories. Deprecated positive is an alias of LH surge, not an additional result. Qualitative categories do not contain hormone concentrations or confirm egg release.'
    else:
        result['special_considerations'] = 'Home urine hCG result category, not hCG concentration. Timing, device instructions and detection sensitivity affect results; serial category transitions cannot assess pregnancy viability or gestational dating.'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = load_snapshot(str(args.input.resolve()))
    notebooks = []
    for suffix, (key, _) in TYPES.items():
        identifier = 'HKCategoryTypeIdentifier' + suffix
        references = ['https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/' + suffix.lower(),
                      'https://support.apple.com/en-us/120356']
        if suffix == 'PregnancyTestResult':
            references.append('https://www.fda.gov/medical-devices/home-use-tests/pregnancy')
        report = research_report(data, identifier, kind='category', special_analysis=special(data, identifier),
                                 related_identifiers=RELATED, references=references)
        notebooks.append(persist_research(report, args.output / key, suffix, input_dir=args.input,
                                         setup_code='from batch2_reproductive import special',
                                         special_code=f'special(data, {identifier!r})',
                                         related_identifiers=RELATED, references=references))
    execute_notebooks(notebooks)


if __name__ == '__main__':
    main()
