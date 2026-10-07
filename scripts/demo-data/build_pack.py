#!/usr/bin/env python3
"""Build a de-identified demo pack from one person's synced history.

Reads a window of one user's data (default: the 26 weeks before today) from a
PulsHealth database, read-only, and writes a small "pack" that load.py replays
into a demo account through the ingest API. Nothing in the pack is a real
reading, a real time, a real place or a real name:

  * Types: an allowlist of everyday activity, heart, sleep, body and workout
    types. Anything else (ECG, State of Mind, medications, blood pressure,
    nutrition, audio exposure, falls, cycle tracking, ...) never leaves the
    database.
  * Dates: the pack stores days as offsets from its first day plus that day's
    weekday, never a calendar date; load.py lays them onto a timeline of its
    own, looping every 26 weeks.
  * Values: each family of related types (heart rate, energy, distance, ...)
    is scaled by one random factor drawn at build time and discarded, plus a
    little per-reading noise, so relationships between types survive and no
    reading equals a real one. High-rate types are thinned or summed into
    15-minute buckets.
  * Sleep: each night moves by a random 0-20 minutes, earlier or later.
  * Identity: a fixed "Demo" profile; two generic sources ("Apple Watch",
    "iPhone"); every sample gets a fresh UUID at load time; metadata is
    dropped except a few non-identifying keys.
  * Places: no real GPS point is read. Workouts that had a route get a
    generated one on loops in a public park, paced by the workout's own
    (scaled) distance samples.

The pack is still derived from a real person's history: keep it out of
version control and anywhere public. See scripts/demo-data/README.md.

Usage:
  build_pack.py --psql 'psql -X -q postgres://...' --out pack.json.gz
  build_pack.py --psql 'docker compose exec -T db psql -U postgres -X -q' ...

Python 3.9+, standard library only.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import io
import json
import math
import random
import re
import shlex
import subprocess
import sys
import uuid
from collections import defaultdict
from pathlib import Path

DEFAULT_USER = "5ea4d000-0000-4000-8000-000000000001"
CATALOG = Path(__file__).resolve().parents[2] / "docs" / "protocol" / "catalog.json"
CATALOG_UNITS = {t["identifier"]: t["unit"] for t in json.loads(CATALOG.read_text())["types"]}
PACK_DAYS = 182  # 26 weeks: a loop keeps weekdays aligned

Q = "HKQuantityTypeIdentifier"
C = "HKCategoryTypeIdentifier"

# Quantity types the demo carries, each with:
#   group   the scale family (one random factor per family, see FACTORS)
#   kind    "sum" (cumulative: summed into buckets) or "sample" (discrete)
#   bucket  seconds: the sum bucket, or the thinning interval (0 = keep all)
#   src     which source to keep: "watch", "iphone", "best" (the larger of
#           the two per bucket, like HealthKit's de-duplication) or "any"
#   digits  decimal places kept
QUANTITY = {
    Q + "ActiveEnergyBurned": ("energy", "sum", 900, "watch", 3),
    Q + "BasalEnergyBurned": ("energy", "sum", 3600, "watch", 3),
    Q + "AppleExerciseTime": (None, "sum", 900, "watch", 0),
    Q + "AppleStandTime": (None, "sum", 900, "watch", 0),
    Q + "StepCount": (None, "sum", 900, "best", 0),
    Q + "DistanceWalkingRunning": ("distance", "sum", 900, "best", 2),
    Q + "DistanceCycling": ("distance", "sum", 900, "watch", 2),
    Q + "DistanceSwimming": ("distance", "sum", 900, "watch", 2),
    Q + "SwimmingStrokeCount": (None, "sum", 900, "watch", 0),
    Q + "FlightsClimbed": (None, "sum", 900, "best", 0),
    Q + "HeartRate": ("heart", "sample", 300, "watch", 0),
    Q + "RestingHeartRate": ("heart", "sample", 0, "watch", 0),
    Q + "WalkingHeartRateAverage": ("heart", "sample", 0, "watch", 0),
    Q + "HeartRateRecoveryOneMinute": ("heart", "sample", 0, "watch", 0),
    Q + "HeartRateVariabilitySDNN": ("hrv", "sample", 0, "watch", 1),
    Q + "OxygenSaturation": (None, "sample", 0, "watch", 2),
    Q + "RespiratoryRate": ("resp", "sample", 600, "watch", 1),
    Q + "VO2Max": ("vo2", "sample", 0, "watch", 2),
    Q + "PhysicalEffort": ("effort", "sample", 300, "watch", 1),
    Q + "TimeInDaylight": (None, "sum", 900, "watch", 0),
    Q + "BodyMass": ("mass", "sample", 0, "any", 2),
    Q + "WalkingSpeed": ("distance", "sample", 0, "iphone", 2),
    Q + "WalkingStepLength": ("distance", "sample", 0, "iphone", 2),
    Q + "WalkingAsymmetryPercentage": (None, "sample", 0, "iphone", 3),
    Q + "WalkingDoubleSupportPercentage": (None, "sample", 0, "iphone", 3),
    Q + "RunningSpeed": ("distance", "sample", 30, "watch", 2),
    Q + "RunningPower": ("power", "sample", 30, "watch", 0),
    Q + "RunningStrideLength": ("distance", "sample", 30, "watch", 2),
    Q + "RunningGroundContactTime": ("gait", "sample", 30, "watch", 0),
    Q + "RunningVerticalOscillation": ("gait", "sample", 30, "watch", 1),
}

CATEGORY = {C + "SleepAnalysis": "watch", C + "AppleStandHour": "watch"}

# Scale families and the range their one factor is drawn from.
FACTORS = {
    "heart": (0.94, 1.06),
    "hrv": (0.85, 1.15),
    "energy": (0.88, 1.12),
    "distance": (0.90, 1.10),
    "power": (0.90, 1.10),
    "gait": (0.93, 1.07),
    "mass": (0.90, 1.10),
    "vo2": (0.93, 1.07),
    "resp": (0.92, 1.08),
    "effort": (0.92, 1.08),
}
# Per-reading multiplicative noise (standard deviation) by family; types with
# no family get NOISE_DEFAULT on discrete readings and none on sums.
NOISE = {"heart": 0.015, "hrv": 0.04, "mass": 0.003, "vo2": 0.01, "energy": 0.03, "distance": 0.02}
NOISE_DEFAULT = {"sample": 0.01, "sum": 0.03}
# Minute counts (rings, daylight) stay exact: noise could push a 15-minute
# bucket past 15 minutes, and they say nothing about the person.
EXACT = {Q + "AppleExerciseTime", Q + "AppleStandTime", Q + "TimeInDaylight"}

# Workout series: types kept and the thinning interval (seconds).
SERIES_BUCKET = 10

# The only metadata that survives, per sample type.
SAMPLE_METADATA = {Q + "HeartRate": "HKMetadataKeyHeartRateMotionContext"}

PROFILE = {"name": "Demo", "email": None, "dateOfBirth": 631152000000, "biologicalSex": "male"}

# Daily aggregate series load.py emits (what the app's statistics would send).
AGGREGATES = [
    [Q + "StepCount", "sum"],
    [Q + "DistanceWalkingRunning", "sum"],
    [Q + "ActiveEnergyBurned", "sum"],
    [Q + "AppleExerciseTime", "sum"],
    [Q + "AppleStandTime", "sum"],
    [Q + "BodyMass", "average"],
]

# Loops in a public park (Golden Gate Park, San Francisco) the generated
# routes run on: centre, semi-axes in metres (east-west, north-south), and
# terrain: altitude at the west end, the rise to the east end, and the
# height and count of the bumps along the way (metres).
LOOPS = {
    "park": ((37.7703, -122.4835), 2300.0, 330.0, (12.0, 50.0, 4.0, 11)),
    "lake": ((37.7697, -122.4757), 260.0, 170.0, (45.0, 4.0, 1.5, 5)),
}
ROUTE_STEP_S = 5
# Altitudes come out in steps of this size, like a GPS's: a reader that
# ignores per-point changes under a metre (web/lib/geo.ts) still sees climbs.
ALT_STEP_M = 1.5


def die(msg: str) -> None:
    print(f"build_pack: {msg}", file=sys.stderr)
    sys.exit(2)


# ── extraction ──────────────────────────────────────────────────────────────


class Source:
    """Reads CSV from COPY … TO STDOUT through a psql command, read-only."""

    def __init__(self, psql: str):
        self.cmd = shlex.split(psql)

    def rows(self, select: str) -> list[list[str]]:
        sql = (
            "\\set ON_ERROR_STOP 1\n"
            "BEGIN READ ONLY;\n"
            f"COPY ({select}) TO STDOUT WITH (FORMAT csv);\n"
            "ROLLBACK;\n"
        )
        proc = subprocess.run(self.cmd, input=sql.encode(), capture_output=True)
        if proc.returncode != 0:
            die(f"psql failed ({proc.returncode}): {proc.stderr.decode(errors='replace').strip()}")
        return list(csv.reader(io.StringIO(proc.stdout.decode())))


def sql_list(values) -> str:
    return "ARRAY[" + ",".join("'" + v + "'" for v in values) + "]::text[]"


def local_seconds(col: str, zone: str, start: str) -> str:
    """Wall-clock seconds since the window's first local midnight."""
    return f"extract(epoch from ({col} AT TIME ZONE '{zone}') - '{start}'::timestamp)"


def window(col: str, zone: str, start: str, end: str) -> str:
    return (
        f"{col} >= ('{start}'::timestamp AT TIME ZONE '{zone}') "
        f"AND {col} < ('{end}'::timestamp AT TIME ZONE '{zone}')"
    )


def device_of(name: str, bundle: str) -> str:
    """watch / iphone / app, from an HKSource name and bundle id."""
    if "watch" in name.lower():
        return "watch"
    if bundle.startswith("com.apple.health"):
        return "iphone"
    return "app"


def extract(src: Source, user: str, zone: str, start: str, end: str) -> dict:
    meta_cols = ", ".join(f"q.metadata->>'{k}'" for k in sorted(set(SAMPLE_METADATA.values())))
    quantity = src.rows(
        f"""SELECT t.identifier, coalesce(s.name, ''), coalesce(s.bundle_id, ''),
                   {local_seconds('q.start_ts', zone, start)},
                   extract(epoch from q.end_ts - q.start_ts), q.value, {meta_cols}
              FROM quantity_samples q
              JOIN sample_types t USING (type_id)
              LEFT JOIN sources s USING (source_id)
             WHERE q.user_id = '{user}' AND q.value IS NOT NULL
               AND t.identifier = ANY({sql_list(QUANTITY)})
               AND {window('q.start_ts', zone, start, end)}"""
    )
    category = src.rows(
        f"""SELECT t.identifier, coalesce(s.name, ''), coalesce(s.bundle_id, ''),
                   {local_seconds('c.start_ts', zone, start)},
                   extract(epoch from c.end_ts - c.start_ts), c.value
              FROM category_samples c
              JOIN sample_types t USING (type_id)
              LEFT JOIN sources s USING (source_id)
             WHERE c.user_id = '{user}'
               AND t.identifier = ANY({sql_list(CATEGORY)})
               AND {window('c.start_ts', zone, start, end)}"""
    )
    workouts = src.rows(
        f"""SELECT w.uuid, w.activity_type,
                   {local_seconds('w.start_ts', zone, start)},
                   extract(epoch from w.end_ts - w.start_ts),
                   extract(epoch from w.start_ts) * 1000,
                   w.duration_s, w.energy_kcal, w.distance_m,
                   w.stats_detail::text, w.events::text, w.activities::text,
                   w.metadata->>'HKIndoorWorkout', w.metadata->>'HKAverageMETs',
                   EXISTS (SELECT 1 FROM workout_route_points r
                            WHERE r.workout_uuid = w.uuid
                              AND r.ts >= w.start_ts - interval '1 hour'
                              AND r.ts <= w.end_ts + interval '1 hour')
              FROM workouts w
             WHERE w.user_id = '{user}' AND {window('w.start_ts', zone, start, end)}"""
    )
    series = src.rows(
        f"""SELECT p.workout_uuid, t.identifier,
                   {local_seconds('p.ts', zone, start)}, p.value
              FROM workout_series_points p
              JOIN sample_types t USING (type_id)
              JOIN workouts w ON w.uuid = p.workout_uuid
             WHERE w.user_id = '{user}' AND {window('w.start_ts', zone, start, end)}
               AND p.ts >= ('{start}'::timestamp AT TIME ZONE '{zone}') - interval '1 day'
               AND p.ts < ('{end}'::timestamp AT TIME ZONE '{zone}') + interval '1 day'
               AND t.identifier = ANY({sql_list(QUANTITY)})"""
    )
    rings = src.rows(
        f"""SELECT (date - '{start}'::date), move_goal_kcal, exercise_goal_min, stand_goal_hours
              FROM activity_summaries
             WHERE user_id = '{user}' AND date >= '{start}'::date AND date < '{end}'::date"""
    )
    return {"quantity": quantity, "category": category, "workouts": workouts, "series": series, "rings": rings}


# ── transform ───────────────────────────────────────────────────────────────


class Scrubber:
    def __init__(self, rng: random.Random):
        self.rng = rng
        self.factor = {g: rng.uniform(lo, hi) for g, (lo, hi) in FACTORS.items()}

    def scale(self, ident: str, value: float, noisy: bool = True) -> float:
        group, kind = QUANTITY[ident][0], QUANTITY[ident][1]
        v = value * self.factor.get(group, 1.0)
        if noisy and ident not in EXACT:
            v *= max(0.5, self.rng.gauss(1.0, NOISE.get(group, NOISE_DEFAULT[kind])))
        if ident == Q + "OxygenSaturation":
            v = min(v, 1.0)
        return v


def fnum(s: str):
    return None if s in ("", None) else float(s)


def rnd(v: float, digits: int):
    r = round(v, digits)
    return int(r) if digits == 0 else r


def transform_quantity(rows, scrub: Scrubber):
    """Scaled, de-duplicated, thinned/bucketed quantity samples:
    [identifier, source, t, dur, value, metadata-or-null]."""
    by_type = defaultdict(list)
    for ident, name, bundle, t, dur, value, *meta in rows:
        by_type[ident].append((device_of(name, bundle), float(t), float(dur), float(value), meta))
    out = []
    for ident, samples in by_type.items():
        _group, kind, bucket, policy, digits = QUANTITY[ident]
        if policy in ("watch", "iphone"):
            samples = [s for s in samples if s[0] == policy]
        elif policy == "best":
            samples = [s for s in samples if s[0] != "app"]
        if kind == "sum":
            # bucket -> device -> [sum, last end]
            sums = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
            for device, t, dur, value, _ in samples:
                b = math.floor(t / bucket) * bucket
                acc = sums[b][device]
                acc[0] += value
                acc[1] = max(acc[1], t + dur)
            for b in sorted(sums):
                device, (total, _end) = max(sums[b].items(), key=lambda kv: kv[1][0])
                if total <= 0:
                    continue
                value = rnd(scrub.scale(ident, total), digits)
                if value <= 0:
                    continue
                out.append([ident, label(device), b, bucket, value, None])
        else:
            samples.sort(key=lambda s: s[1])
            last_bin = None
            meta_key = SAMPLE_METADATA.get(ident)
            for device, t, dur, value, meta in samples:
                if bucket:
                    b = math.floor(t / bucket)
                    if b == last_bin:
                        continue
                    last_bin = b
                md = None
                if meta_key and meta and re.fullmatch(r"[0-9]", meta[0] or ""):
                    md = {meta_key: int(meta[0])}
                out.append([ident, label(device), round(t, 3), round(dur, 3), rnd(scrub.scale(ident, value), digits), md])
    return out


def label(device: str) -> str:
    return "Apple Watch" if device == "watch" else "iPhone"


def transform_category(rows, scrub: Scrubber):
    """[identifier, source, t, dur, value, hold]; each sleep night moved as a
    block. `hold` (sleep only) is seconds from a sample's start to its night's
    end: the Watch hands a night over in the morning, so load.py sends none of
    it before then."""
    keep = []
    for ident, name, bundle, t, dur, value in rows:
        device = device_of(name, bundle)
        if CATEGORY[ident] == device:
            keep.append([ident, label(device), float(t), float(dur), int(value)])
    sleep = sorted((r for r in keep if r[0] == C + "SleepAnalysis"), key=lambda r: r[2])
    nights, night_end = [], None
    for r in sleep:
        if night_end is None or r[2] - night_end > 3 * 3600:
            nights.append([])
            night_end = r[2]
        night_end = max(night_end, r[2] + r[3])
        nights[-1].append(r)
    for night in nights:
        shift = scrub.rng.choice((-1, 1)) * scrub.rng.uniform(0, 20 * 60)
        end = max(r[2] + r[3] for r in night)
        for r in night:
            r.append(round(end - r[2], 3))
            r[2] += shift
    for r in keep:
        r[2], r[3] = round(r[2], 3), round(r[3], 3)
    return [r for r in keep if r[2] >= 0]


def thin_series(ident: str, points, scrub: Scrubber):
    """Workout series points [offset, value], thinned to SERIES_BUCKET s."""
    _group, kind, _b, _p, digits = QUANTITY[ident]
    points.sort()
    out = []
    if kind == "sum":
        sums = defaultdict(float)
        for off, value in points:
            sums[math.floor(off / SERIES_BUCKET) * SERIES_BUCKET] += value
        for b in sorted(sums):
            out.append([b, round(scrub.scale(ident, sums[b], noisy=False), max(digits, 3))])
    else:
        last = None
        for off, value in points:
            b = math.floor(off / SERIES_BUCKET)
            if b == last:
                continue
            last = b
            out.append([round(off, 1), rnd(scrub.scale(ident, value), digits)])
    return out


def scale_detail(detail: dict | None, scrub: Scrubber) -> dict | None:
    if not detail:
        return None
    out = {}
    for ident, stats in detail.items():
        if ident not in QUANTITY or not isinstance(stats, dict):
            continue
        digits = max(QUANTITY[ident][4], 1)
        kept = {k: round(scrub.scale(ident, v, noisy=False), digits) for k, v in stats.items() if isinstance(v, (int, float))}
        if kept:
            out[ident] = kept
    return out or None


def relative_events(raw: str | None, start_ms: float):
    """[type, startOffset, endOffset-or-null] for each event; metadata dropped."""
    out = []
    for e in json.loads(raw) if raw else []:
        if not isinstance(e, dict) or not e.get("type") or not e.get("start"):
            continue
        end = e.get("end")
        out.append([e["type"], round((e["start"] - start_ms) / 1000, 1), round((end - start_ms) / 1000, 1) if end else None])
    return out


def relative_activities(raw: str | None, start_ms: float):
    """[activityType, startOffset, endOffset-or-null, duration]; statistics dropped."""
    out = []
    for a in json.loads(raw) if raw else []:
        if not isinstance(a, dict) or not a.get("activityType") or not a.get("start"):
            continue
        end = a.get("end")
        out.append([
            a["activityType"],
            round((a["start"] - start_ms) / 1000, 1),
            round((end - start_ms) / 1000, 1) if end else None,
            round(a.get("duration") or 0, 1),
        ])
    return out


class Loop:
    """A closed path (a wobbly ellipse) walked by arc length."""

    def __init__(self, centre, a, b, terrain, rng: random.Random, n=2000):
        lat0, lon0 = centre
        self.terrain = terrain
        self.m_lat = 111_320.0
        self.m_lon = 111_320.0 * math.cos(math.radians(lat0))
        ph1, ph2 = rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi)
        pts = []
        for i in range(n):
            u = 2 * math.pi * i / n
            wobble = 1 + 0.03 * math.sin(3 * u + ph1) + 0.02 * math.sin(7 * u + ph2)
            x, y = a * math.cos(u) * wobble, b * math.sin(u) * wobble
            pts.append((lat0 + y / self.m_lat, lon0 + x / self.m_lon, x, y))
        self.pts = pts
        self.cum = [0.0]
        for i in range(1, n + 1):
            p, q = pts[i - 1], pts[i % n]
            self.cum.append(self.cum[-1] + math.hypot(q[2] - p[2], q[3] - p[3]))
        self.length = self.cum[-1]

    def at(self, d: float):
        d %= self.length
        lo, hi = 0, len(self.cum) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if self.cum[mid] <= d:
                lo = mid
            else:
                hi = mid
        p, q = self.pts[lo % len(self.pts)], self.pts[hi % len(self.pts)]
        f = (d - self.cum[lo]) / max(1e-9, self.cum[hi] - self.cum[lo])
        u = 2 * math.pi * (lo + f) / len(self.pts)
        base, rise, bump, bumps = self.terrain
        alt = base + rise * (1 + math.cos(u)) / 2 + bump * math.sin(bumps * u)
        return p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, round(alt / ALT_STEP_M) * ALT_STEP_M


def generate_route(activity: str, span_s: float, distance_m: float | None, dist_series, rng: random.Random, loops):
    """[offset, lat, lon, alt, speed, course] every ROUTE_STEP_S seconds."""
    total = distance_m or 0.0
    if dist_series:
        total = sum(v for _, v in dist_series)
    if total <= 0 or span_s <= 0:
        return []
    loop = loops["lake"] if activity == "walking" or (activity == "running" and total < 3000) else loops["park"]
    origin = rng.uniform(0, loop.length)
    sign = rng.choice((-1, 1))

    # cumulative distance at time offset, from the (already scaled) series
    if dist_series:
        times = [0.0]
        dists = [0.0]
        for off, v in sorted(dist_series):
            times.append(max(off, times[-1]))
            dists.append(dists[-1] + v)
    else:
        times, dists = [0.0, span_s], [0.0, total]

    def dist_at(t: float) -> float:
        if t <= times[0]:
            return dists[0]
        if t >= times[-1]:
            return dists[-1]
        lo, hi = 0, len(times) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if times[mid] <= t:
                lo = mid
            else:
                hi = mid
        span = times[hi] - times[lo]
        f = 0 if span <= 0 else (t - times[lo]) / span
        return dists[lo] + (dists[hi] - dists[lo]) * f

    out, prev = [], None
    steps = int(span_s // ROUTE_STEP_S) + 1
    for i in range(steps):
        t = min(i * ROUTE_STEP_S, span_s)
        d = dist_at(t)
        lat, lon, alt = loop.at(origin + sign * d)
        lat += rng.gauss(0, 1.5) / loop.m_lat
        lon += rng.gauss(0, 1.5) / loop.m_lon
        speed = course = None
        if prev is not None:
            dt_s = t - prev[0]
            if dt_s > 0:
                speed = max(0.0, (d - prev[1]) / dt_s)
            dy = (lat - prev[2]) * loop.m_lat
            dx = (lon - prev[3]) * loop.m_lon
            if dx or dy:
                course = (math.degrees(math.atan2(dx, dy)) + 360) % 360
        out.append([
            round(t, 1), round(lat, 6), round(lon, 6), round(alt, 1),
            None if speed is None else round(speed, 2),
            None if course is None else round(course, 1),
        ])
        prev = (t, d, lat, lon)
    return out


def transform_workouts(rows, series_rows, scrub: Scrubber, loops):
    series = defaultdict(lambda: defaultdict(list))
    starts = {r[0]: float(r[2]) for r in rows}
    for wid, ident, t, value in series_rows:
        if wid in starts:
            series[wid][ident].append((float(t) - starts[wid], float(value)))
    out = []
    for (wid, activity, t, span, start_ms, duration, energy, distance,
         detail, events, activities, indoor, mets, has_route) in sorted(rows, key=lambda r: float(r[2])):
        t, span, start_ms = float(t), float(span), float(start_ms)
        w = {
            "t": round(t, 3),
            "span": round(span, 3),
            "activityType": activity,
            "duration": round(float(duration or span), 1),
        }
        if fnum(energy):
            w["energy"] = round(fnum(energy) * scrub.factor["energy"], 1)
        if fnum(distance):
            w["distance"] = round(fnum(distance) * scrub.factor["distance"], 1)
        sd = scale_detail(json.loads(detail) if detail else None, scrub)
        if sd:
            w["statsDetail"] = sd
        meta = {}
        if indoor not in ("", None):
            meta["HKIndoorWorkout"] = 1 if indoor in ("1", "true", "True") else 0
        m = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", mets or "")  # older builds sent "6.9 kcal/hr·kg"
        if m:
            meta["HKAverageMETs"] = round(float(m.group(1)), 1)
        if meta:
            w["metadata"] = meta
        ev = relative_events(events, start_ms)
        if ev:
            w["events"] = ev
        acts = relative_activities(activities, start_ms)
        if acts:
            w["activities"] = acts
        ser = {ident: thin_series(ident, pts, scrub) for ident, pts in series[wid].items()}
        ser = {k: v for k, v in ser.items() if v}
        if ser:
            w["series"] = ser
        if has_route == "t":
            dist_key = Q + ("DistanceCycling" if activity == "cycling" else "DistanceWalkingRunning")
            route = generate_route(activity, span, w.get("distance"), ser.get(dist_key), scrub.rng, loops)
            if route:
                w["route"] = route
        out.append(w)
    return out


def transform_rings(rows, scrub: Scrubber):
    out = []
    for day, move_goal, ex_goal, stand_goal in rows:
        mg = fnum(move_goal)
        out.append([
            int(day),
            None if mg is None else int(round(mg * scrub.factor["energy"] / 10.0) * 10),
            fnum(ex_goal),
            fnum(stand_goal),
        ])
    return out


def split_days(records, t_index: int):
    """Turns window seconds into (day, seconds-of-day) in place."""
    for r in records:
        t = r[t_index]
        day = math.floor(t / 86400)
        r[t_index:t_index + 1] = [day, round(t - day * 86400, 3)]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--psql", default="psql -X -q", help="command that runs psql against the source database (SQL on stdin)")
    ap.add_argument("--user", default=DEFAULT_USER, help="the user whose history is read")
    ap.add_argument("--zone", help="IANA zone the days are cut in (default: the database's puls_time_zone())")
    ap.add_argument("--end", help="first local date NOT included (default: today in --zone)")
    ap.add_argument("--out", required=True, help="where to write the pack (.json.gz)")
    ap.add_argument("--seed", type=int, help="random seed (default: fresh randomness; never commit one)")
    args = ap.parse_args()

    if not re.fullmatch(r"[0-9a-fA-F-]{36}", args.user):
        die("--user must be a UUID")
    src = Source(args.psql)
    zone = args.zone or src.rows("SELECT puls_time_zone()")[0][0]
    if not re.fullmatch(r"[A-Za-z0-9_+\-/]+", zone):
        die(f"unexpected zone {zone!r}")
    if args.end:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.end):
            die("--end must be YYYY-MM-DD")
        end = dt.date.fromisoformat(args.end)
    else:
        end = dt.date.fromisoformat(src.rows(f"SELECT (now() AT TIME ZONE '{zone}')::date")[0][0])
    start = end - dt.timedelta(days=PACK_DAYS)

    print(f"build_pack: reading {PACK_DAYS} days in {zone}", file=sys.stderr)
    raw = extract(src, args.user, zone, start.isoformat(), end.isoformat())
    for k, v in raw.items():
        print(f"build_pack:   {k}: {len(v)} rows", file=sys.stderr)

    rng = random.Random(args.seed) if args.seed is not None else random.SystemRandom()
    scrub = Scrubber(rng)
    loops = {name: Loop(c, a, b, t, rng) for name, (c, a, b, t) in LOOPS.items()}

    quantity = transform_quantity(raw["quantity"], scrub)
    category = transform_category(raw["category"], scrub)
    workouts = transform_workouts(raw["workouts"], raw["series"], scrub, loops)
    rings = transform_rings(raw["rings"], scrub)
    del raw

    # Drop anything a shift pushed outside the window, then cut into days.
    quantity = [r for r in quantity if 0 <= r[2] < PACK_DAYS * 86400]
    category = [r for r in category if 0 <= r[2] < PACK_DAYS * 86400]
    split_days(quantity, 2)
    split_days(category, 2)
    for w in workouts:
        day = math.floor(w["t"] / 86400)
        w["day"], w["sec"] = day, round(w.pop("t") - day * 86400, 3)

    types = sorted({r[0] for r in quantity} | {r[0] for r in category})
    index = {t: i for i, t in enumerate(types)}
    for r in quantity:
        r[0] = index[r[0]]
    for r in category:
        r[0] = index[r[0]]
    sources = ["Apple Watch", "iPhone"]
    for r in quantity + category:
        r[1] = sources.index(r[1])
    units = {t: CATALOG_UNITS[t] for t in types if CATALOG_UNITS.get(t)}

    pack = {
        "format": "puls-demo-pack",
        "version": 1,
        "packID": str(uuid.uuid4()),
        "days": PACK_DAYS,
        "weekday0": start.weekday(),
        "profile": PROFILE,
        "types": types,
        "units": units,
        "sources": sources,
        "aggregates": AGGREGATES,
        "quantity": quantity,
        "category": category,
        "workouts": workouts,
        "rings": rings,
    }
    with gzip.open(args.out, "wt", encoding="utf-8") as f:
        json.dump(pack, f, separators=(",", ":"))
    routed = sum(1 for w in workouts if "route" in w)
    print(
        f"build_pack: wrote {args.out}: {len(quantity)} quantity, {len(category)} category, "
        f"{len(workouts)} workouts ({routed} with generated routes), {len(rings)} ring days",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
