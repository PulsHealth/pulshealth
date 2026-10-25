"""Reproduce the published weekly audit: python3 check.py (Python 3.9+)."""
import json
from pathlib import Path
from statistics import mean

records = json.loads(Path(__file__).with_name('selected-records.json').read_text())
metrics = {row['identifier'].removeprefix('HKQuantityTypeIdentifier'): row['days'] for row in records['metrics']}
steps = [row['value'] for row in metrics['StepCount'] if row['value'] is not None]
heart = [row['value'] for row in metrics['RestingHeartRate'] if row['value'] is not None]
workouts = records['workouts']
sleep_by_date = {}
for session in records['sleepSessions']:
    if session['asleepMinutes'] is not None:
        sleep_by_date[session['date']] = sleep_by_date.get(session['date'], 0) + session['asleepMinutes']
rings = [row for row in records['rings'] if row['moveKcal'] is not None and row['moveGoalKcal'] is not None]
print(f"Period: {records['periodStart']} through 2026-10-18; {records['calendar']}")
print(f"Steps: {sum(steps):.2f} total; {mean(steps):.2f}/day; {len(steps)}/7 dates")
print(f"Workouts: {len(workouts)} records on {len({row['date'] for row in workouts})} dates")
for activity in sorted({row['activityType'] for row in workouts}):
    rows = [row for row in workouts if row['activityType'] == activity]
    print(f"  {activity}: {len(rows)} workouts, {sum(row['durationMinutes'] for row in rows):.2f} minutes")
print(f"Sleep: {mean(sleep_by_date.values()):.2f} minutes per recorded wake date; {len(sleep_by_date)}/7 dates")
print(f"Resting heart rate: {mean(heart):.2f} bpm; {len(heart)}/7 dates")
print(f"Move: {sum(row['moveKcal'] >= row['moveGoalKcal'] for row in rings)} summaries at/above goal, {len(rings)}/7 dates; whole-week result unknown")
