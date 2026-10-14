#!/usr/bin/env python3
"""Extract a user-scoped, bounded, read-only HealthKit research snapshot.

Connection details and identity are CLI parameters, never defaults in the
public repository. Outputs contain private health data and must stay outside
the source tree. Uses the existing SSH/docker/psql access without credentials
in files or command-line database URLs.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

QUANTITIES = [
    'HeartRate', 'HeartRateVariabilitySDNN', 'HeartRateVariabilityRMSSD',
    'RestingHeartRate', 'WalkingHeartRateAverage', 'StepCount',
    'RunningVerticalOscillation', 'RunningSpeed', 'RunningStrideLength',
    'RunningGroundContactTime', 'ActiveEnergyBurned', 'DistanceWalkingRunning',
    'RespiratoryRate', 'OxygenSaturation', 'VO2Max', 'BodyMass',
    'TimeInDaylight', 'HeartRateRecoveryOneMinute',
]


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('host', 'container', 'owner-name', 'start', 'end', 'output'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--timezone', default='America/Los_Angeles')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', args.host + args.container):
        parser.error('host and container must be simple identifiers')
    zone = ZoneInfo(args.timezone)
    start = datetime.fromisoformat(args.start).replace(tzinfo=zone)
    end = datetime.fromisoformat(args.end).replace(tzinfo=zone)
    if end <= start:
        parser.error('end must follow start')
    out = Path(args.output).resolve()
    root = Path(__file__).resolve().parents[2]
    # .git is private even when the task checkout itself is under .git.
    common_result = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd=root, capture_output=True, text=True, check=True)
    private_git = Path(common_result.stdout.strip()).resolve()
    if (out == root or root in out.parents) and private_git not in out.parents:
        parser.error('private snapshot must be outside the source checkout or inside private Git metadata')
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        parser.error('snapshot output must be empty; preserve existing evidence and choose a new directory')
    remote = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', args.host,
              f'docker exec -i {args.container} psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1']

    def psql(sql, output):
        with output.open('wb') as stream:
            result = subprocess.run(remote, input=("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
                "SET LOCAL statement_timeout='90s'; SET LOCAL jit=off;\n" + sql + "\nROLLBACK;\n").encode(),
                stdout=stream, stderr=subprocess.PIPE)
        if result.returncode:
            output.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.decode())

    owner_file = out / 'owner.csv'
    psql("COPY (SELECT id FROM users WHERE lower(name) LIKE " + literal('%' + args.owner_name.lower() + '%')
         + ") TO STDOUT WITH CSV HEADER;", owner_file)
    with owner_file.open() as stream:
        owners = list(csv.DictReader(stream))
    if len(owners) != 1:
        raise RuntimeError('owner selection must identify exactly one profile')
    user = literal(owners[0]['id']) + '::uuid'
    bounds = f" >= {literal(start.isoformat())}::timestamptz AND {{alias}}.{{column}} < {literal(end.isoformat())}::timestamptz"

    def where(alias, column='start_ts'):
        return f'{alias}.user_id={user} AND {alias}.{column}' + bounds.format(alias=alias, column=column)

    ids = ','.join(literal('HKQuantityTypeIdentifier' + name) for name in QUANTITIES)
    qselect = "q.uuid,t.identifier,t.unit,q.start_ts,q.end_ts,q.value,q.source_id,q.metadata,s.name AS source_name,s.bundle_id,s.version AS source_version,tc.time_zone_id AS start_timezone"
    queries = {
        'quantity': f'SELECT {qselect} FROM quantity_samples q JOIN sample_types t USING(type_id) LEFT JOIN sources s USING(source_id) LEFT JOIN temporal_contexts tc ON tc.temporal_context_id=q.start_temporal_context_id WHERE {where("q")} AND t.identifier IN ({ids}) ORDER BY q.start_ts,q.uuid',
        'sleep': f"SELECT c.uuid,t.identifier,c.start_ts,c.end_ts,c.value,c.source_id,c.metadata,s.name AS source_name,s.bundle_id,s.version AS source_version,tc.time_zone_id AS start_timezone FROM category_samples c JOIN sample_types t USING(type_id) LEFT JOIN sources s USING(source_id) LEFT JOIN temporal_contexts tc ON tc.temporal_context_id=c.start_temporal_context_id WHERE {where('c')} AND t.identifier='HKCategoryTypeIdentifierSleepAnalysis' ORDER BY c.start_ts,c.uuid",
        'mindful': f"SELECT c.uuid,t.identifier,c.start_ts,c.end_ts,c.value,c.source_id,c.metadata,s.name AS source_name,s.bundle_id,s.version AS source_version FROM category_samples c JOIN sample_types t USING(type_id) LEFT JOIN sources s USING(source_id) WHERE {where('c')} AND t.identifier='HKCategoryTypeIdentifierMindfulSession' ORDER BY c.start_ts,c.uuid",
        'workouts': f'SELECT w.uuid,w.start_ts,w.end_ts,w.activity_type,w.duration_s,w.distance_m,w.energy_kcal,w.source_id,w.metadata,w.stats_detail,w.events,w.activities,s.name AS source_name,s.bundle_id,s.version AS source_version FROM workouts w LEFT JOIN sources s USING(source_id) WHERE {where("w")} ORDER BY w.start_ts,w.uuid',
        'aggregates': f'SELECT t.identifier,a.series_id,s.agg_func,s.interval_value,s.interval_unit,s.device_filter,s.unit,a.bucket_start,a.bucket_end,a.value FROM aggregate_samples a JOIN aggregate_series s USING(series_id) JOIN sample_types t ON t.type_id=s.type_id WHERE {where("a", "bucket_start")} AND t.identifier IN ({ids}) ORDER BY a.bucket_start,a.series_id',
        'workout_series': f'SELECT p.workout_uuid,t.identifier,t.unit,p.ts,p.value FROM workout_series_points p JOIN sample_types t USING(type_id) WHERE {where("p", "ts")} AND t.identifier IN ({ids}) ORDER BY p.ts,p.workout_uuid',
    }
    manifest = {'workflow_version': '1', 'extracted_at': datetime.now(timezone.utc).isoformat(),
                'start': start.isoformat(), 'end_exclusive': end.isoformat(), 'timezone': args.timezone,
                'owner_profiles_matched': len(owners), 'files': {},
                'consistency': 'Each immutable-past export uses its own repeatable-read, read-only transaction; not a single cross-table transaction.',
                'boundary_note': 'Selection is by start timestamp inside the window; boundary-spanning intervals starting earlier are not included.'}
    for name, query in queries.items():
        (out / (name + '.sql')).write_text(query + ';\n')
        output = out / (name + '.csv')
        psql('COPY (' + query + ') TO STDOUT WITH CSV HEADER;', output)
        with output.open() as stream:
            rows = sum(1 for _ in csv.DictReader(stream))
        manifest['files'][output.name] = {'rows': rows, 'bytes': output.stat().st_size,
                                         'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
        print(f'{name}: {rows} records saved privately', flush=True)
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
