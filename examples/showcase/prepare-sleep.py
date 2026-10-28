#!/usr/bin/env python3
"""Turn private sleep/daily API responses into relative-day display summaries."""
import argparse
import datetime as dt
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('input', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--milestone', action='append', required=True, help='Private YYYY-MM-DD date; repeat for each milestone')
args = parser.parse_args()
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
labels = ['First child', 'Second child', 'Third child', 'Fourth child']
if not 1 <= len(args.milestone) <= 4:
    raise ValueError('Use one to four milestones')
for i, value in enumerate(args.milestone):
    event = dt.date.fromisoformat(value)
    end = min(364, (last - event).days)
    rows = []
    for offset in range(-180, end + 1):
        night = by_day.get(event + dt.timedelta(days=offset))
        stages = (night or {}).get('stages', {})
        known_stages = sum(stages.get(k, 0) or 0 for k in ['core', 'deep', 'rem']) > 0
        rows.append({'offset': offset, 'minutes': round(night['asleepMinutes'], 1) if night else None,
                     'awake': round(stages.get('awake', 0) or 0, 1) if known_stages else None,
                     'rem': round(stages.get('rem', 0) or 0, 1) if known_stages else None,
                     'deep': round(stages.get('deep', 0) or 0, 1) if known_stages else None})
    report['milestones'].append({'label': labels[i], 'availableThrough': end, 'days': rows})
with args.output.open('x') as output:
    json.dump(report, output, indent=2)
    output.write('\n')
print('Prepared relative sleep timelines; no milestone dates or source IDs emitted.')
