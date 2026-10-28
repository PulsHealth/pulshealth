#!/usr/bin/env python3
"""Turn private sleep/daily API responses into relative-day display summaries."""
import argparse
import datetime as dt
import json
from pathlib import Path
from sleep_stages import stage_timeline

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('input', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--milestone', action='append', required=True, help='Private YYYY-MM-DD date; repeat for each milestone')
parser.add_argument('--before-days', type=int, default=90)
parser.add_argument('--after-days', type=int, default=90)
parser.add_argument('--intervals', type=Path, help='Optional private category interval JSONL with decoded stage names')
args = parser.parse_args()
intervals = [json.loads(line) for line in args.intervals.read_text().splitlines() if line.strip()] if args.intervals else []
data = json.loads(args.input.read_text())
responses = data.get('years', [data])
by_day = {}
for response in responses:
    for night in response['nights']:
        date = dt.date.fromisoformat(night['date'])
        minutes = night.get('asleepMinutes')
        if not isinstance(minutes, (int, float)) or not 0 < minutes <= 1440:
            continue
        if date not in by_day or minutes > by_day[date]['asleepMinutes']:
            by_day[date] = night
if not by_day:
    raise ValueError('No positive sleep sessions found')
last = max(by_day)
report = {'milestones': []}
if len(args.milestone) != 1 or not 1 <= args.before_days <= 180 or not 1 <= args.after_days <= 365:
    raise ValueError('Use one milestone and valid before/after day counts')
for value in args.milestone:
    event = dt.date.fromisoformat(value)
    end = max(-1, min(args.after_days - 1, (last - event).days - 1))
    rows = []
    for offset in range(-args.before_days, end + 1):
        # Omit the session waking on the milestone day: event time is unknown.
        wake_offset = offset if offset < 0 else offset + 1
        night = by_day.get(event + dt.timedelta(days=wake_offset))
        stages = (night or {}).get('stages', {})
        known_stages = sum(stages.get(k, 0) or 0 for k in ['core', 'deep', 'rem']) > 0
        segments = stage_timeline(night, intervals) if night and intervals else None
        rows.append({'offset': offset, 'minutes': round(night['asleepMinutes'], 1) if night else None,
                     'awake': round(stages.get('awake', 0) or 0, 1) if known_stages else None,
                     'rem': round(stages.get('rem', 0) or 0, 1) if known_stages else None,
                     'deep': round(stages.get('deep', 0) or 0, 1) if known_stages else None,
                     'core': round(stages.get('core', 0) or 0, 1) if known_stages else None,
                     'unspecified': round(stages.get('unspecified', 0) or 0, 1) if night else None,
                     **({'segments': segments} if segments is not None else {})})
    report['milestones'].append({'label': 'Before & after', 'availableThrough': end, 'days': rows})
with args.output.open('x') as output:
    json.dump(report, output, indent=2)
    output.write('\n')
print('Prepared relative sleep timelines; no milestone dates or source IDs emitted.')
