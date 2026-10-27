#!/usr/bin/env python3
"""Render a private demo pack into a local viewer snapshot. Never sends data."""
import argparse
import datetime as dt
import gzip
import json
import os
from collections import defaultdict
from pathlib import Path

import load
from build_pack import QUANTITY


def snapshot(pack, zone, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    tl = load.Timeline(pack, zone, None)
    samples, routes, streams, _, rings = load.build(
        pack, tl, (now - dt.timedelta(days=pack['days'])).timestamp() * 1000,
        now.timestamp() * 1000,
    )
    workouts, by_uuid, series = [], {}, defaultdict(dict)
    daily, hourly = defaultdict(lambda: defaultdict(list)), defaultdict(lambda: defaultdict(list))
    latest, stats = {}, {}
    today = now.astimezone(tl.tz).date()

    for item in samples:
        ident, start = item['type'], item['start']
        stat = stats.setdefault(ident, dict(identifier=ident, rows=0, earliest=start, latest=start))
        stat.update(rows=stat['rows'] + 1, earliest=min(stat['earliest'], start), latest=max(stat['latest'], start))
        if item['kind'] == 'workout':
            w = item['workout']
            detail = dict(uuid=item['uuid'], activityType=w['activityType'], start=start, end=item['end'],
                          durationS=w['duration'], energyKcal=w.get('totalEnergyKcal'), distanceM=w.get('totalDistanceMeters'),
                          stats=w.get('statistics', {}), statsDetail=w.get('statisticsDetail', {}),
                          events=[dict(type=e['type'], start=e['start'], end=e.get('end')) for e in w.get('events', [])],
                          activities=[dict(activityType=a['activityType'], start=a['start'], end=a.get('end'),
                                           durationS=a['duration'], statistics={}) for a in w.get('activities', [])],
                          metadata=item.get('metadata', {}), source='Apple Watch', route=[])
            workouts.append(detail)
            by_uuid[item['uuid']] = detail
            continue
        date = dt.datetime.fromtimestamp(start / 1000, tl.tz)
        hour = int(date.replace(minute=0, second=0, microsecond=0).timestamp() * 1000)
        value = item.get('value')
        if item['kind'] == 'category':
            if ident.endswith('SleepAnalysis'):
                if item['category'] not in (1, 3, 4, 5):
                    continue
                value = (item['end'] - start) / 3_600_000
                date += dt.timedelta(hours=6)
            elif ident.endswith('AppleStandHour'):
                if item['category'] != 0:
                    continue
                value = 1
            else:
                continue
        day = int(dt.datetime.combine(date.date(), dt.time(), tl.tz).timestamp() * 1000)
        daily[ident][day].append(value)
        hourly[ident][hour].append(value)
        if ident not in latest or start > latest[ident]['t']:
            latest[ident] = dict(identifier=ident, value=value, unit=item.get('unit'), t=start)

    for line in routes:
        body = line['route']
        if body['workoutUUID'] in by_uuid:
            by_uuid[body['workoutUUID']]['route'].extend(dict(t=p['t'], lat=p['lat'], lon=p['lon'], altitude=p.get('alt'), speed=p.get('speed')) for p in body['points'])
    for line in streams:
        body = line['series']
        s = series[body['workoutUUID']].setdefault(body['type'], dict(type=body['type'], unit=body.get('unit'), points=[]))
        s['points'].extend(body['points'])
    workouts.sort(key=lambda w: w['start'], reverse=True)
    for index, w in enumerate(workouts):
        # Stable preview URLs with no original UUIDs, including demo-4.
        original = w['uuid']
        w['uuid'] = f'demo-{index + 1}'
        series[w['uuid']] = list(series.pop(original, {}).values())

    def points(buckets):
        result = {}
        for ident, days in buckets.items():
            summed = QUANTITY.get(ident, (None, 'sum'))[1] == 'sum'
            result[ident] = [dict(t=t, value=sum(v) if summed else sum(v)/len(v),
                                  min=None if summed else min(v), max=None if summed else max(v), count=len(v))
                             for t, v in sorted(days.items())]
        return result

    today_ms = int(dt.datetime.combine(today, dt.time(), tl.tz).timestamp() * 1000)
    today_rings = next((r['activitySummary'] for r in rings if r['activitySummary']['localDate'] == today.isoformat()), {})
    return dict(version=1, generatedAt=int(now.timestamp()*1000), timeZone=zone, today=today_ms,
                workouts=workouts, workoutSeries=dict(series), daily=points(daily), hourly=points(hourly),
                latest=latest, stats=list(stats.values()), rings=dict(
                    date=today_ms, moveMode=0, moveKcal=today_rings.get('moveKcal', 0), moveGoalKcal=today_rings.get('moveGoalKcal', 600),
                    exerciseMin=today_rings.get('exerciseMin', 0), exerciseGoalMin=today_rings.get('exerciseGoalMin', 30),
                    standHours=today_rings.get('standHours', 0), standGoalHours=today_rings.get('standGoalHours', 12),
                    moveTimeMin=None, moveTimeGoalMin=None, hasData=bool(today_rings)))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pack', required=True)
    ap.add_argument('--zone', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.umask(0o077)
    with gzip.open(args.pack, 'rt') as f:
        result = snapshot(json.load(f), args.zone)
    Path(args.out).write_text(json.dumps(result, separators=(',', ':'), allow_nan=False))
    print(f"Preview ready: {len(result['workouts'])} workouts, {sum(len(w['route']) for w in result['workouts'])} route points")
