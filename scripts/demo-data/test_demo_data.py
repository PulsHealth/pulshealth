#!/usr/bin/env python3
"""Tests for build_pack.py and load.py, on synthetic rows (no database).

  python3 -m unittest discover -s scripts/demo-data -p 'test_*.py'
  python3 scripts/demo-data/test_demo_data.py --emit DIR   # batches for tools/protocol-check
"""

from __future__ import annotations

import datetime as dt
import json
import math
import random
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pack as bp  # noqa: E402
import load  # noqa: E402

Q, C = bp.Q, bp.C
WATCH = ("Someone's Apple Watch", "com.apple.health.11111111-2222-3333-4444-555555555555")
PHONE = ("Someone's iPhone", "com.apple.health.66666666-7777-8888-9999-000000000000")
APP = ("A Scale App", "com.example.scale")


def synthetic_rows(days=14, seed=1):
    """Rows shaped like build_pack.extract's, for `days` days."""
    r = random.Random(seed)
    quantity, category, workouts, series, rings = [], [], [], [], []
    for d in range(days):
        base = d * 86400
        for minute in range(0, 24 * 60, 2):
            t = base + minute * 60
            quantity.append([Q + "HeartRate", *WATCH, str(t), "0", str(r.randint(55, 140)), "1"])
            quantity.append([Q + "ActiveEnergyBurned", *WATCH, str(t), "60", str(r.uniform(0.1, 3)), ""])
            if minute % 10 == 0:
                quantity.append([Q + "StepCount", *WATCH, str(t), "600", str(r.randint(0, 300)), ""])
                quantity.append([Q + "StepCount", *PHONE, str(t), "600", str(r.randint(0, 250)), ""])
        for minute in range(0, 24 * 60, 15):
            quantity.append([Q + "AppleExerciseTime", *WATCH, str(base + minute * 60), "60", "1", ""])
        quantity.append([Q + "BodyMass", *APP, str(base + 7 * 3600), "0", "80.0", ""])
        quantity.append([Q + "BloodPressureSystolic", *APP, str(base + 8 * 3600), "0", "120", ""])  # not allowlisted
        for h in range(24):
            category.append([C + "AppleStandHour", *WATCH, str(base + h * 3600), "3600", str(0 if 8 <= h <= 20 else 1)])
        for k in range(16):  # a night from 23:00
            category.append([C + "SleepAnalysis", *WATCH, str(base + 23 * 3600 + k * 1800), "1800", str(3 + k % 3)])
        start_ms = 1_700_000_000_000 + base * 1000
        wid = str(uuid.UUID(int=d + 1))
        events = json.dumps([{"type": "segment", "start": start_ms + 60_000, "end": start_ms + 600_000, "metadata": {"x": "y"}}])
        workouts.append([wid, "cycling", str(base + 8 * 3600), "1500", str(start_ms), "1490", "220", "8000",
                         json.dumps({Q + "HeartRate": {"min": 90, "avg": 130, "max": 160}}), events, "[]", "0",
                         "7.1 kcal/hr·kg", "t"])
        for s in range(0, 1500, 2):
            series.append([wid, Q + "DistanceCycling", str(base + 8 * 3600 + s), "10.6"])
            series.append([wid, Q + "HeartRate", str(base + 8 * 3600 + s), str(120 + s % 30)])
        rings.append([str(d), "600", "30", "12"])
    return {"quantity": quantity, "category": category, "workouts": workouts, "series": series, "rings": rings}


def make_pack(days=14, seed=1):
    raw = synthetic_rows(days, seed)
    raw["quantity"] = [q for q in raw["quantity"] if q[0] in bp.QUANTITY]
    rng = random.Random(seed)
    scrub = bp.Scrubber(rng)
    loops = {n: bp.Loop(c, a, b, t, rng) for n, (c, a, b, t) in bp.LOOPS.items()}
    quantity = bp.transform_quantity(raw["quantity"], scrub)
    category = bp.transform_category(raw["category"], scrub)
    workouts = bp.transform_workouts(raw["workouts"], raw["series"], scrub, loops)
    rings = bp.transform_rings(raw["rings"], scrub)
    quantity = [q for q in quantity if 0 <= q[2] < days * 86400]
    category = [c for c in category if 0 <= c[2] < days * 86400]
    bp.split_days(quantity, 2)
    bp.split_days(category, 2)
    for w in workouts:
        day = math.floor(w["t"] / 86400)
        w["day"], w["sec"] = day, round(w.pop("t") - day * 86400, 3)
    types = sorted({q[0] for q in quantity} | {c[0] for c in category})
    for r in quantity + category:
        r[0] = types.index(r[0])
        r[1] = ["Apple Watch", "iPhone"].index(r[1])
    return {
        "format": "puls-demo-pack", "version": 1, "packID": str(uuid.UUID(int=seed)), "days": days, "weekday0": 1,
        "profile": bp.PROFILE, "types": types, "units": {t: bp.CATALOG_UNITS[t] for t in types if bp.CATALOG_UNITS.get(t)},
        "sources": ["Apple Watch", "iPhone"], "aggregates": bp.AGGREGATES,
        "quantity": quantity, "category": category, "workouts": workouts, "rings": rings,
    }, scrub


def strings_in(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for k, v in x.items():
            yield k
            yield from strings_in(v)
    elif isinstance(x, list):
        for v in x:
            yield from strings_in(v)


class BuildPackTests(unittest.TestCase):
    def setUp(self):
        self.pack, self.scrub = make_pack()

    def test_no_identifying_strings_survive(self):
        text = json.dumps(self.pack)
        for leaked in ("Someone", "com.apple.health.", "com.example", "Scale", "kcal/hr·kg", '"x"'):
            self.assertNotIn(leaked, text)
        self.assertNotIn(Q + "BloodPressureSystolic", text)

    def test_only_allowlisted_types(self):
        for t in self.pack["types"]:
            self.assertTrue(t in bp.QUANTITY or t in bp.CATEGORY, t)

    def test_sums_are_bucketed_and_deduplicated(self):
        steps = self.pack["types"].index(Q + "StepCount")
        rows = [q for q in self.pack["quantity"] if q[0] == steps]
        self.assertTrue(rows)
        self.assertTrue(all(q[3] % 900 == 0 and q[4] == 900 for q in rows))  # 15-minute buckets
        keys = [(q[2], q[3]) for q in rows]
        self.assertEqual(len(keys), len(set(keys)))  # one source per bucket

    def test_heart_rate_is_thinned_and_scaled(self):
        hr = self.pack["types"].index(Q + "HeartRate")
        rows = [q for q in self.pack["quantity"] if q[0] == hr]
        per_day = len(rows) / self.pack["days"]
        self.assertLessEqual(per_day, 24 * 12)
        self.assertTrue(all(q[6] == {"HKMetadataKeyHeartRateMotionContext": 1} for q in rows))

    def test_body_mass_from_any_source_is_relabelled(self):
        mass = self.pack["types"].index(Q + "BodyMass")
        rows = [q for q in self.pack["quantity"] if q[0] == mass]
        self.assertEqual(len(rows), self.pack["days"])
        self.assertTrue(all(q[1] == 1 for q in rows))
        self.assertTrue(all(q[5] != 80.0 for q in rows))

    def test_workouts_carry_generated_routes_and_no_event_metadata(self):
        for w in self.pack["workouts"]:
            self.assertIn("route", w)
            self.assertEqual(w["metadata"], {"HKIndoorWorkout": 0, "HKAverageMETs": 7.1})
            for ev in w["events"]:
                self.assertEqual(len(ev), 3)
            lat, lon = w["route"][0][1], w["route"][0][2]
            (clat, clon), _a, _b, _t = bp.LOOPS["park"]
            self.assertLess(abs(lat - clat), 0.02)
            self.assertLess(abs(lon - clon), 0.04)
            # distance along the route ≈ the workout's own scaled distance
            ser = sum(v for _, v in w["series"][Q + "DistanceCycling"])
            self.assertAlmostEqual(ser, 750 * 10.6 * self.scrub.factor["distance"], delta=5)

    def test_routes_climb_the_way_the_viewer_counts_it(self):
        route = self.pack["workouts"][0]["route"]
        alts = [p[3] for p in route]
        # web/lib/geo.ts: only per-point rises over a metre count
        gain = sum(b - a for a, b in zip(alts, alts[1:]) if b - a > 1)
        self.assertGreater(gain, 20)
        self.assertLess(gain, 300)

    def test_sleep_nights_move_as_one_block(self):
        sleep = self.pack["types"].index(C + "SleepAnalysis")
        rows = sorted((c for c in self.pack["category"] if c[0] == sleep), key=lambda c: (c[2], c[3]))
        night = [c for c in rows if c[2] == rows[0][2]]
        starts = [c[2] * 86400 + c[3] for c in rows[:16]]
        gaps = {round(b - a, 3) for a, b in zip(starts, starts[1:])}
        self.assertEqual(gaps, {1800.0})
        self.assertTrue(night)


class LoadTests(unittest.TestCase):
    def setUp(self):
        self.pack, _ = make_pack()
        self.tl = load.Timeline(self.pack, "America/Los_Angeles", None)

    def test_epoch_keeps_weekdays(self):
        self.assertEqual(self.tl.epoch.weekday(), self.pack["weekday0"])
        for k in range(30):
            date = self.tl.epoch + dt.timedelta(days=k)
            _loop, day = self.tl.locate(date)
            self.assertEqual(day, k % self.pack["days"])

    def test_wrong_weekday_epoch_is_refused(self):
        with self.assertRaises(SystemExit):
            load.Timeline(self.pack, "UTC", self.tl.epoch + dt.timedelta(days=1))

    def _build(self, now, hours=None, days=None):
        now_ms = now.timestamp() * 1000
        if days:
            first = now.astimezone(self.tl.tz).date() - dt.timedelta(days=days - 1)
            start_ms = self.tl.midnight_ms(first)
        else:
            start_ms = now_ms - hours * 3_600_000
        return load.build(self.pack, self.tl, start_ms, now_ms), now_ms

    def test_nothing_from_the_future_and_uuids_are_stable(self):
        now = dt.datetime(2026, 3, 18, 14, 30, tzinfo=self.tl.tz)
        (samples, routes, series, aggregates, summaries), now_ms = self._build(now, days=20)
        self.assertTrue(samples)
        self.assertTrue(all(s["end"] <= now_ms for s in samples))
        self.assertEqual(len({s["uuid"] for s in samples}), len(samples))
        (again, *_), _ = self._build(now, days=20)
        self.assertEqual([s["uuid"] for s in samples], [s["uuid"] for s in again])
        # a later run sends the same samples under the same UUIDs, plus new ones
        (later, *_), _ = self._build(now + dt.timedelta(hours=3), days=20)
        self.assertLessEqual({s["uuid"] for s in samples} - {s["uuid"] for s in later}, set())

    def test_a_night_of_sleep_waits_for_the_morning(self):
        sleep = C + "SleepAnalysis"
        def sleep_sent(hour, day=18):
            now = dt.datetime(2026, 3, day, hour, 0, tzinfo=self.tl.tz)
            (samples, *_), _ = self._build(now, hours=11)  # from 16:00 or 22:00: one night at most
            return [x for x in samples if x["type"] == sleep]
        self.assertEqual(sleep_sent(3), [])  # mid-night: nothing yet
        self.assertEqual(len(sleep_sent(9)), 16)  # the whole night once it is over

    def test_loops_get_fresh_uuids(self):
        a = self.tl.uuid(0, "q1")
        self.assertNotEqual(a, self.tl.uuid(1, "q1"))
        self.assertEqual(a, self.tl.uuid(0, "q1"))

    def test_today_rings_and_aggregates_count_only_what_happened(self):
        now = dt.datetime(2026, 3, 18, 12, 0, tzinfo=self.tl.tz)
        (samples, _r, _s, aggregates, summaries), now_ms = self._build(now, hours=6)
        today = summaries[-1]["activitySummary"]
        self.assertEqual(today["localDate"], "2026-03-18")
        self.assertEqual(today["standHours"], 4)  # stood 08:00-12:00: four hours over by noon
        self.assertEqual(today["exerciseMin"], 48)  # every 15 minutes, 00:00-11:45
        steps = [a["aggregate"] for a in aggregates if a["aggregate"]["type"] == Q + "StepCount"]
        self.assertEqual(steps[-1]["bucketStart"], self.tl.midnight_ms(dt.date(2026, 3, 18)))
        self.assertIsNotNone(steps[-1]["value"])

    def test_batches_respect_protocol_limits(self):
        now = dt.datetime(2026, 3, 20, 9, 0, tzinfo=self.tl.tz)
        lines, _ = self._build(now, days=14)
        bodies = load.batches(*lines, self.pack["profile"], "backfill")
        for _bid, body in bodies:
            header, *rest = [json.loads(x) for x in body.splitlines()]
            counted = sum(header[k] for k in ("sampleCount", "routeCount", "seriesCount", "aggregateCount",
                                              "activitySummaryCount", "profileCount"))
            self.assertEqual(counted, len(rest))
            self.assertLessEqual(header["sampleCount"], 100_000)
            for line in rest:
                body = line.get("route") or line.get("series")
                if body:
                    self.assertLessEqual(len(body["points"]), 4000)


def emit(directory: str) -> None:
    """Writes a synthetic pack's batches for tools/protocol-check."""
    pack, _ = make_pack()
    tl = load.Timeline(pack, "America/Los_Angeles", None)
    now = dt.datetime(2026, 3, 20, 9, 0, tzinfo=tl.tz)
    start = tl.midnight_ms(now.date() - dt.timedelta(days=13))
    lines = load.build(pack, tl, start, now.timestamp() * 1000)
    Path(directory).mkdir(parents=True, exist_ok=True)
    for n, (_bid, body) in enumerate(load.batches(*lines, pack["profile"], "backfill"), 1):
        (Path(directory) / f"demo-{n:03d}.ndjson").write_text(body)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--emit":
        emit(sys.argv[2])
    else:
        unittest.main()
