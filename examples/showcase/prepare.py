#!/usr/bin/env python3
"""Convert PulsHealth workout and optional route CSV/JSONL exports for local demos.

Standard library only. No network, database writes, or third-party services.
"""
import argparse
import csv
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
from zoneinfo import ZoneInfo


def rows(path):
    if Path(path).suffix.lower() == ".csv":
        with Path(path).open(encoding="utf-8-sig", newline="") as source:
            for row in csv.DictReader(source):
                for field in ("start", "distanceM", "durationS", "t", "lat", "lon", "value", "asleepMinutes", "exerciseMin"):
                    if field in row:
                        row[field] = float(row[field]) if row[field] else None
                yield row
        return
    with Path(path).open(encoding="utf-8") as source:
        for number, line in enumerate(source, 1):
            if line.strip():
                try:
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise ValueError("expected an object")
                    yield value
                except (ValueError, TypeError) as error:
                    raise ValueError(f"Invalid JSON object on line {number}") from error


def finite(value, field, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"{field} must be a finite nonnegative number")
    return value


def prepare(workouts, zone, year, race_date, race_id=None, route_rows=()):
    result = []
    seen = set()
    for row in workouts:
        identifier = row.get("uuid")
        if not isinstance(identifier, str) or not identifier:
            raise ValueError("Every workout needs a uuid")
        if identifier in seen:
            raise ValueError("Duplicate workout UUID; resolve duplicates before importing")
        seen.add(identifier)
        instant = row.get("start")
        if isinstance(instant, bool) or not isinstance(instant, (int, float)) or not math.isfinite(instant):
            raise ValueError("Workout start must be epoch milliseconds")
        local_date = datetime.fromtimestamp(instant / 1000, timezone.utc).astimezone(zone).date().isoformat()
        raw_activity = str(row.get("activityType", "")).lower()
        activity = {"running": "Running", "walking": "Walking", "cycling": "Cycling", "37": "Running", "52": "Walking", "13": "Cycling"}.get(raw_activity, "Other")
        result.append({"id": identifier, "date": local_date, "activity": activity, "sport": {"running":"Running", "walking":"Walking", "cycling":"Cycling", "swimming":"Swimming", "pickleball":"Pickleball", "hiking":"Hiking", "rowing":"Rowing", "yoga":"Yoga", "strength_training":"Strength", "functional_strength_training":"Strength"}.get(raw_activity, "Other"),
                       "distanceM": finite(row.get("distanceM"), "distanceM", nullable=True),
                       "durationS": finite(row.get("durationS"), "durationS")})
    if not result or len(result) > 5000:
        raise ValueError("Provide 1–5,000 workouts")
    indexed = {w["id"]: w for w in result}
    routes = {}
    count = 0
    for row in route_rows:
        if row.get("workoutUUID") not in indexed:
            continue
        lat, lon, instant = row.get("lat"), row.get("lon"), row.get("t")
        if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in (lat, lon, instant)) or abs(lat) > 90 or abs(lon) > 180:
            raise ValueError("Each route point needs finite t, lat and lon values in their valid ranges")
        routes.setdefault(row["workoutUUID"], {})[instant] = {"lat": lat, "lon": lon}
        count += 1
        if count > 200000:
            raise ValueError("Use at most 200,000 route points; select a smaller range first")
    for identifier, points in routes.items():
        indexed[identifier]["route"] = [point for _, point in sorted(points.items())]
    if race_id and race_id not in indexed:
        raise ValueError("The race UUID is not in the workout file")
    return {"label": "Your local file", "year": year, "raceDate": race_date, "timeZone": zone.key,
            **({"raceId": race_id} if race_id else {}), "workouts": result}


def daily_summaries(metric_rows=(), sleep_rows=(), activity_rows=()):
    fields = ("steps", "sleepMinutes", "restingHR", "hrv", "activeKcal", "exerciseMinutes")
    output = {}
    def day(stamp):
        if not isinstance(stamp, str) or date.fromisoformat(stamp).isoformat() != stamp:
            raise ValueError("Daily summaries require YYYY-MM-DD dates")
        return output.setdefault(stamp, {"date": stamp, **{key: None for key in fields}})
    metric_names = {"HKQuantityTypeIdentifierStepCount": "steps", "HKQuantityTypeIdentifierRestingHeartRate": "restingHR", "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "hrv", "HKQuantityTypeIdentifierActiveEnergyBurned": "activeKcal"}
    seen = set()
    for row in metric_rows:
        field = metric_names.get(row.get("identifier"))
        if not field:
            continue
        key = (row["date"], field)
        if key in seen:
            raise ValueError("Duplicate daily metric; use one daily series per type")
        seen.add(key)
        day(row["date"])[field] = finite(row.get("value"), field, nullable=True)
    for row in sleep_rows:
        value = finite(row.get("asleepMinutes"), "asleepMinutes", nullable=True)
        if value is not None and value > 0:
            target = day(row["date"])
            target["sleepMinutes"] = max(target["sleepMinutes"] or 0, value)
    activity_dates = set()
    for row in activity_rows:
        if row["date"] in activity_dates:
            raise ValueError("Duplicate activity date")
        activity_dates.add(row["date"])
        day(row["date"])["exerciseMinutes"] = finite(row.get("exerciseMin"), "exerciseMin", nullable=True)
    return list(output.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workouts", help="App workout CSV or server workout JSONL export")
    parser.add_argument("--routes", help="Optional app workout_routes CSV or database route JSONL")
    parser.add_argument("--daily-metrics", help="Optional server daily_metrics CSV or JSONL")
    parser.add_argument("--sleep", help="Optional server sleep CSV or JSONL")
    parser.add_argument("--activity", help="Optional daily activity CSV or JSONL")
    parser.add_argument("--time-zone", required=True, help="IANA reporting zone, e.g. Europe/London")
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--race-date", required=True, help="YYYY-MM-DD; used only by marathon view")
    parser.add_argument("--race-id", help="Workout UUID to exclude from training")
    parser.add_argument("--output", required=True, help="New local JSON file; existing files are preserved")
    args = parser.parse_args()
    try:
        if not 1900 <= args.year <= 2200:
            raise ValueError("Year must be between 1900 and 2200")
        if date.fromisoformat(args.race_date).isoformat() != args.race_date:
            raise ValueError("Use YYYY-MM-DD for race date")
        data = prepare(rows(args.workouts), ZoneInfo(args.time_zone), args.year, args.race_date,
                       args.race_id, rows(args.routes) if args.routes else ())
        if args.daily_metrics or args.sleep or args.activity:
            data["daily"] = daily_summaries(rows(args.daily_metrics) if args.daily_metrics else (), rows(args.sleep) if args.sleep else (), rows(args.activity) if args.activity else ())
        encoded = json.dumps(data, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode()) > 10000000:
            raise ValueError("Result exceeds the demo's 10 MB file limit; select a smaller range")
        with open(args.output, "x", encoding="utf-8") as destination:
            destination.write(encoded)
        print(f"Prepared {len(data['workouts'])} workouts. Open the new JSON file in a PulsHealth example.")
    except (ValueError, OSError, KeyError, OverflowError) as error:
        parser.exit(1, f"Could not prepare the example: {error}\n")


if __name__ == "__main__":
    main()
