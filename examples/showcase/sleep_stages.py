"""Build source-consistent relative sleep stages; never infer wakefulness in gaps."""
from collections import defaultdict

STAGES = {
    'HKCategoryValueSleepAnalysisAsleepCore': 'core',
    'HKCategoryValueSleepAnalysisAsleepDeep': 'deep',
    'HKCategoryValueSleepAnalysisAsleepREM': 'rem',
    'HKCategoryValueSleepAnalysisAsleepUnspecified': 'unspecified',
    'HKCategoryValueSleepAnalysisAwake': 'awake',
}
ASLEEP = {'core', 'deep', 'rem', 'unspecified'}


def stage_timeline(night, intervals):
    by_source = defaultdict(list)
    for row in intervals:
        stage = STAGES.get(row['stage'])
        if stage is None or row['end'] <= row['start']:
            continue
        if row['start'] >= night['start'] - 1 and row['end'] <= night['end'] + 1:
            by_source[row['source']].append((row['start'], row['end'], stage))
    if not by_source:
        return None

    def rank(item):
        source, rows = item
        asleep = sum(end - start for start, end, stage in rows if stage in ASLEEP)
        staged = sum(end - start for start, end, stage in rows if stage in {'core', 'deep', 'rem'})
        return asleep, staged, -source

    _, rows = max(by_source.items(), key=rank)
    asleep_rows = [row for row in rows if row[2] in ASLEEP]
    if not asleep_rows:
        return None
    asleep = sum(end - start for start, end, _ in asleep_rows) / 60000
    if abs(asleep - night['asleepMinutes']) > .1:
        raise ValueError('Interval source does not reconcile with the canonical main sleep session')
    origin = min(row[0] for row in asleep_rows)
    finish = max(row[1] for row in asleep_rows)
    clipped = [(max(start, origin), min(end, finish), stage) for start, end, stage in rows if end > origin and start < finish]
    edges = sorted({point for start, end, _ in clipped for point in [start, end]})
    segments = []
    for start, end in zip(edges, edges[1:]):
        active = {stage for a, b, stage in clipped if a < end and b > start}
        stage = next(iter(active)) if len(active) == 1 else 'unknown'
        a, b = round((start - origin) / 60000, 3), round((end - origin) / 60000, 3)
        if b <= a:
            continue
        if segments and segments[-1]['stage'] == stage and abs(segments[-1]['end'] - a) < .001:
            segments[-1]['end'] = b
        else:
            segments.append({'start': a, 'end': b, 'stage': stage})
    merged_asleep = sum(segment["end"] - segment["start"] for segment in segments if segment["stage"] in ASLEEP)
    if abs(merged_asleep - night["asleepMinutes"]) > .15:
        raise ValueError("Overlapping stage records do not reconcile with the nightly sleep total")
    return segments
