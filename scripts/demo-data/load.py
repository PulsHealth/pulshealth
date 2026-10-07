#!/usr/bin/env python3
"""Replay a demo pack (build_pack.py) into a demo user through the ingest API.

The pack's days are laid onto a timeline that loops every pack length
(26 weeks): local day D shows pack day (D - epoch) mod 182, so weekdays line
up and the data never runs out. Each pass of the loop gets its own sample
UUIDs, derived from the pack ID, so re-sending any window is a no-op on the
server (samples are ON CONFLICT DO NOTHING; rings and aggregates upsert).

Only what has already "happened" is sent: a sample whose end is still in the
future waits for a later run, so an hourly run fills today in like a phone
syncing through the day. Today's rings and daily aggregates are recomputed
from what has been sent.

  load.py --pack pack.json.gz --user <uuid> --token-file token --days 182   # first fill
  load.py --pack pack.json.gz --user <uuid> --token-file token --hours 26   # hourly

The token is a per-device ingest token bound to the demo user
(make issue-device NAME='Demo data' ARGS='--user <uuid>').

Python 3.9+, standard library only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
from zoneinfo import ZoneInfo

MAX_SAMPLES = 20_000  # per batch (the server allows 100,000)
MAX_POINTS = 50_000  # route + series points per batch (100,000 each allowed)
LINE_POINTS = 4_000  # per route or series line (the protocol's limit)
EPOCH_FROM = dt.date(2026, 1, 5)  # loop epoch: first date from here on the pack's weekday
CLIENT = "puls-demo-loader 1"

STAND = "HKCategoryTypeIdentifierAppleStandHour"
ACTIVE = "HKQuantityTypeIdentifierActiveEnergyBurned"
EXERCISE = "HKQuantityTypeIdentifierAppleExerciseTime"


def die(msg: str) -> None:
    print(f"load: {msg}", file=sys.stderr)
    sys.exit(2)


class Timeline:
    """Maps (local date, pack seconds) to instants, and dates to pack days."""

    def __init__(self, pack: dict, zone: str, epoch: dt.date | None):
        self.days = pack["days"]
        self.tz = ZoneInfo(zone)
        if epoch is None:
            epoch = EPOCH_FROM + dt.timedelta(days=(pack["weekday0"] - EPOCH_FROM.weekday()) % 7)
        if epoch.weekday() != pack["weekday0"]:
            die(f"--epoch {epoch} is a {epoch:%A}; the pack starts on weekday {pack['weekday0']} (Monday = 0)")
        self.epoch = epoch
        self.ns = uuid.UUID(pack["packID"])

    def locate(self, date: dt.date) -> tuple[int, int]:
        """(loop, pack day) shown on a local date."""
        return divmod((date - self.epoch).days, self.days)

    def instant_ms(self, date: dt.date, seconds: float) -> float:
        """Epoch ms of `seconds` of local wall-clock time after `date`'s midnight."""
        whole = math.floor(seconds)
        wall = dt.datetime.combine(date, dt.time()) + dt.timedelta(seconds=whole)
        return wall.replace(tzinfo=self.tz).timestamp() * 1000 + (seconds - whole) * 1000

    def midnight_ms(self, date: dt.date) -> int:
        return int(self.instant_ms(date, 0))

    def uuid(self, loop: int, key: str) -> str:
        return str(uuid.uuid5(self.ns, f"{loop}/{key}")).upper()


def by_day(records, day_index: int):
    out = defaultdict(list)
    for i, r in enumerate(records):
        out[r[day_index]].append((i, r))
    return out


def build(pack: dict, tl: Timeline, start_ms: float, now_ms: float):
    """The lines to send: samples, routes, series, aggregates, rings."""
    types, sources, units = pack["types"], pack["sources"], pack.get("units", {})
    quantity = by_day(pack["quantity"], 2)
    category = by_day(pack["category"], 2)
    workouts = defaultdict(list)
    for i, w in enumerate(pack["workouts"]):
        workouts[w["day"]].append((i, w))
    rings = {r[0]: r for r in pack["rings"]}

    first = dt.datetime.fromtimestamp(start_ms / 1000, tl.tz).date()
    last = dt.datetime.fromtimestamp(now_ms / 1000, tl.tz).date()

    samples, routes, series, aggregates, summaries = [], [], [], [], []
    date = first
    while date <= last:
        loop, day = tl.locate(date)
        midnight, next_midnight = tl.midnight_ms(date), tl.midnight_ms(date + dt.timedelta(days=1))
        totals = defaultdict(float)  # identifier -> sum of what has happened today
        counts = defaultdict(int)
        stood = 0

        for i, (t, s, _d, sec, dur, value, md) in quantity[day]:
            begin = tl.instant_ms(date, sec)
            end = begin + dur * 1000
            if end > now_ms:
                continue
            ident = types[t]
            totals[ident] += value
            counts[ident] += 1
            if end < start_ms:
                continue
            line = {
                "uuid": tl.uuid(loop, f"q{i}"), "type": ident, "kind": "quantity",
                "start": round(begin, 3), "end": round(end, 3), "value": value,
                "unit": units.get(ident), "sourceName": sources[s], "sourceBundleID": "com.apple.health",
                "device": sources[s],
            }
            if md:
                line["metadata"] = md
            samples.append(line)

        for i, (t, s, _d, sec, dur, value, *hold) in category[day]:
            begin = tl.instant_ms(date, sec)
            end = begin + dur * 1000
            if begin + (hold[0] if hold else dur) * 1000 > now_ms:  # a night goes out once it is over
                continue
            if types[t] == STAND and value == 0:  # HKCategoryValueAppleStandHour.stood
                stood += 1
            if end < start_ms:
                continue
            samples.append({
                "uuid": tl.uuid(loop, f"c{i}"), "type": types[t], "kind": "category",
                "start": round(begin, 3), "end": round(end, 3), "category": value,
                "sourceName": sources[s], "sourceBundleID": "com.apple.health", "device": sources[s],
            })

        for i, w in workouts[day]:
            begin = tl.instant_ms(date, w["sec"])
            end = begin + w["span"] * 1000
            if end > now_ms or end < start_ms:
                continue
            wid = tl.uuid(loop, f"w{i}")
            detail = {"activityType": w["activityType"], "duration": w["duration"]}
            if "energy" in w:
                detail["totalEnergyKcal"] = w["energy"]
            if "distance" in w:
                detail["totalDistanceMeters"] = w["distance"]
            if "statsDetail" in w:
                detail["statisticsDetail"] = w["statsDetail"]
                detail["statistics"] = {
                    k: (v.get("sum") if v.get("sum") is not None else v.get("avg"))
                    for k, v in w["statsDetail"].items()
                }
            if "events" in w:
                detail["events"] = [
                    {"type": typ, "start": round(begin + a * 1000, 3), **({"end": round(begin + b * 1000, 3)} if b is not None else {})}
                    for typ, a, b in w["events"]
                ]
            if "activities" in w:
                detail["activities"] = [
                    {"activityType": typ, "start": round(begin + a * 1000, 3),
                     **({"end": round(begin + b * 1000, 3)} if b is not None else {}), "duration": d}
                    for typ, a, b, d in w["activities"]
                ]
            line = {
                "uuid": wid, "type": "HKWorkoutTypeIdentifier", "kind": "workout",
                "start": round(begin, 3), "end": round(end, 3), "workout": detail,
                "sourceName": "Apple Watch", "sourceBundleID": "com.apple.health", "device": "Apple Watch",
            }
            if "metadata" in w:
                line["metadata"] = w["metadata"]
            samples.append(line)
            for ident, points in w.get("series", {}).items():
                pts = [{"t": round(begin + off * 1000, 3), "value": v} for off, v in points]
                for k in range(0, len(pts), LINE_POINTS):
                    series.append({"series": {"workoutUUID": wid, "type": ident, "unit": units.get(ident), "points": pts[k:k + LINE_POINTS]}})
            if "route" in w:
                pts = []
                for off, lat, lon, alt, speed, course in w["route"]:
                    p = {"t": round(begin + off * 1000, 3), "lat": lat, "lon": lon, "alt": alt, "hAcc": 4.0, "vAcc": 3.0}
                    if speed is not None:
                        p["speed"] = speed
                    if course is not None:
                        p["course"] = course
                    pts.append(p)
                for k in range(0, len(pts), LINE_POINTS):
                    routes.append({"route": {"workoutUUID": wid, "points": pts[k:k + LINE_POINTS]}})

        # Rings and daily aggregates for a day that has begun, from what has
        # happened so far (the whole day once it is over).
        if midnight <= now_ms:
            for ident, func in pack["aggregates"]:
                if func == "sum":
                    value = round(totals[ident], 3) if counts[ident] else None
                else:
                    value = round(totals[ident] / counts[ident], 3) if counts[ident] else None
                aggregates.append({"aggregate": {
                    "type": ident, "func": func, "intervalValue": 1, "intervalUnit": "day", "deviceFilter": "all",
                    "bucketStart": midnight, "bucketEnd": next_midnight, "value": value, "unit": units.get(ident),
                }})
            ring = rings.get(day)
            summary = {"date": midnight, "localDate": date.isoformat(), "moveMode": 0,
                       "moveKcal": round(totals[ACTIVE], 1), "exerciseMin": round(totals[EXERCISE]),
                       "standHours": stood}
            if ring:
                _day, move_goal, exercise_goal, stand_goal = ring
                summary.update({k: v for k, v in (("moveGoalKcal", move_goal), ("exerciseGoalMin", exercise_goal),
                                                  ("standGoalHours", stand_goal)) if v is not None})
            summaries.append({"activitySummary": summary})
        date += dt.timedelta(days=1)
    return samples, routes, series, aggregates, summaries


def points(line: dict) -> int:
    body = line.get("route") or line.get("series")
    return len(body["points"])


def batches(samples, routes, series, aggregates, summaries, profile, reason):
    """Splits the lines into protocol-conformant batches, in send order."""
    out = []
    for k in range(0, len(samples), MAX_SAMPLES):
        out.append({"samples": samples[k:k + MAX_SAMPLES]})
    cur = {"routes": [], "series": []}
    load = 0
    for kind, lines in (("routes", routes), ("series", series)):
        for line in lines:
            n = points(line)
            if load + n > MAX_POINTS and load:
                out.append(cur)
                cur, load = {"routes": [], "series": []}, 0
            cur[kind].append(line)
            load += n
    if load:
        out.append(cur)
    out.append({"aggregates": aggregates, "summaries": summaries, "profile": profile})
    bodies = []
    for b in out:
        s, r, se = b.get("samples", []), b.get("routes", []), b.get("series", [])
        a, su, pr = b.get("aggregates", []), b.get("summaries", []), b.get("profile")
        label = s[0]["type"] if s else ("HKWorkoutTypeIdentifier" if r or se else "HKActivitySummaryTypeIdentifier")
        batch_id = str(uuid.uuid4()).upper()
        header = {
            "schemaVersion": 1, "clientVersion": CLIENT, "batchID": batch_id, "deviceID": "demo-loader",
            "type": label, "reason": reason, "exportedAt": int(time.time() * 1000),
            "sampleCount": len(s), "deletionCount": 0, "routeCount": len(r), "seriesCount": len(se),
            "aggregateCount": len(a), "activitySummaryCount": len(su), "profileCount": 1 if pr else 0,
        }
        lines = [header, *s, *r, *se, *a, *su] + ([{"profile": pr}] if pr else [])
        bodies.append((batch_id, "".join(json.dumps(x, separators=(",", ":")) + "\n" for x in lines)))
    return bodies


def post(url: str, token: str, user: str, batch_id: str, body: str) -> dict:
    data = gzip.compress(body.encode())
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/x-ndjson", "Content-Encoding": "gzip",
        "X-Puls-Protocol": "1", "X-Batch-ID": batch_id, "X-User-ID": user,
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace").strip()
            if e.code < 500 or attempt == 3:
                die(f"batch {batch_id}: HTTP {e.code}: {detail}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 3:
                die(f"batch {batch_id}: {e}")
        time.sleep(2 ** attempt * 5)
    return {}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pack", required=True)
    ap.add_argument("--user", required=True, help="the demo user's UUID (the token must be bound to it)")
    ap.add_argument("--url", default="http://127.0.0.1:8080", help="ingest base URL")
    ap.add_argument("--token-file", help="file holding the demo user's device token (or set PULS_DEMO_TOKEN)")
    ap.add_argument("--zone", default=os.environ.get("PULS_TIME_ZONE") or "UTC",
                    help="the server's PULS_TIME_ZONE (default: $PULS_TIME_ZONE, else UTC)")
    span = ap.add_mutually_exclusive_group(required=True)
    span.add_argument("--days", type=int, help="send the last N local days, today included")
    span.add_argument("--hours", type=float, help="send what ended in the last N hours (rings and aggregates for the days touched)")
    ap.add_argument("--epoch", help="loop epoch, YYYY-MM-DD on the pack's first weekday (default: fixed; changing it re-dates everything)")
    ap.add_argument("--now", help="pretend it is this ISO 8601 instant (testing)")
    ap.add_argument("--dry-run", metavar="DIR", help="write the batches to DIR as .ndjson instead of sending them")
    args = ap.parse_args()

    with gzip.open(args.pack, "rt", encoding="utf-8") as f:
        pack = json.load(f)
    if pack.get("format") != "puls-demo-pack" or pack.get("version") != 1:
        die("not a version 1 demo pack")
    try:
        uuid.UUID(args.user)
    except ValueError:
        die("--user must be a UUID")
    tl = Timeline(pack, args.zone, dt.date.fromisoformat(args.epoch) if args.epoch else None)

    now = dt.datetime.fromisoformat(args.now) if args.now else dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=tl.tz)
    now_ms = now.timestamp() * 1000
    if args.days:
        first = now.astimezone(tl.tz).date() - dt.timedelta(days=args.days - 1)
        start_ms = tl.midnight_ms(first)
    else:
        start_ms = now_ms - args.hours * 3_600_000
    reason = "backfill" if args.days else "incremental"

    lines = build(pack, tl, start_ms, now_ms)
    bodies = batches(*lines, pack["profile"], reason)
    samples, routes, series, aggregates, summaries = lines
    print(
        f"load: {len(samples)} samples, {sum(map(points, routes))} route and {sum(map(points, series))} series points, "
        f"{len(aggregates)} aggregates, {len(summaries)} ring days in {len(bodies)} batches",
        file=sys.stderr,
    )

    if args.dry_run:
        os.makedirs(args.dry_run, exist_ok=True)
        for n, (_bid, body) in enumerate(bodies, 1):
            with open(os.path.join(args.dry_run, f"batch-{n:03d}.ndjson"), "w") as f:
                f.write(body)
        return

    token = os.environ.get("PULS_DEMO_TOKEN", "")
    if args.token_file:
        with open(args.token_file) as f:
            token = f.read().strip()
    if not token:
        die("no token: --token-file or PULS_DEMO_TOKEN")
    url = args.url.rstrip("/") + "/v1/batches"
    for n, (bid, body) in enumerate(bodies, 1):
        result = post(url, token, args.user, bid, body)
        print(f"load: batch {n}/{len(bodies)}: {json.dumps(result, separators=(',', ':'))}", file=sys.stderr)


if __name__ == "__main__":
    main()
