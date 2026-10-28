import importlib.util
from pathlib import Path
import unittest
import tempfile
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location("prepare", Path(__file__).with_name("prepare.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreparationTests(unittest.TestCase):
    def workout(self, **changes):
        return {"uuid": "run", "start": 1735691400000, "activityType": "running", "distanceM": None, "durationS": 1800, **changes}

    def prepare(self, rows, **kwargs):
        return module.prepare(rows, ZoneInfo("America/Los_Angeles"), 2024, "2024-12-31", **kwargs)

    def test_reporting_calendar_and_missing_distance(self):
        result = self.prepare([self.workout()])
        self.assertEqual(result["workouts"][0]["date"], "2024-12-31")
        self.assertIsNone(result["workouts"][0]["distanceM"])

    def test_duplicate_workouts_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.prepare([self.workout(), self.workout()])

    def test_bad_or_unknown_race_rejected(self):
        with self.assertRaisesRegex(ValueError, "race UUID"):
            self.prepare([self.workout()], race_id="absent")

    def test_route_sorting_deduplication_and_ownership(self):
        routes = [{"workoutUUID": "run", "t": t, "lat": lat, "lon": 0} for t, lat in [(2, 2), (1, 1), (2, 3)]]
        routes.append({"workoutUUID": "someone-else", "t": 0, "lat": 40, "lon": 40})
        result = self.prepare([self.workout()], route_rows=routes)
        self.assertEqual(result["workouts"][0]["route"], [{"lat": 1, "lon": 0}, {"lat": 3, "lon": 0}])

    def test_app_csv_and_server_jsonl_have_the_same_input_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "workouts.csv"
            path.write_text("uuid,start,activityType,distanceM,durationS\nrun,1735691400000,running,,1800\n")
            csv_data = self.prepare(module.rows(path))
            path = Path(folder) / "workouts.jsonl"
            import json
            path.write_text(json.dumps(self.workout()) + "\n")
            self.assertEqual(csv_data, self.prepare(module.rows(path)))

    def test_daily_summaries_keep_longest_sleep_and_preserve_missing(self):
        metrics = [{"identifier": "HKQuantityTypeIdentifierStepCount", "date": "2025-01-01", "value": 0}]
        sleep = [{"date": "2025-01-01", "asleepMinutes": 420}, {"date": "2025-01-01", "asleepMinutes": 60}]
        daily = module.daily_summaries(metrics, sleep)
        self.assertEqual(daily[0]["steps"], 0)
        self.assertEqual(daily[0]["sleepMinutes"], 420)
        self.assertIsNone(daily[0]["restingHR"])
        with self.assertRaisesRegex(ValueError, "Duplicate daily"):
            module.daily_summaries(metrics + metrics)

    def test_invalid_numbers_are_not_serialized(self):
        for field, value in [("start", float("nan")), ("durationS", -1), ("distanceM", float("inf"))]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.prepare([self.workout(**{field: value})])


if __name__ == "__main__":
    unittest.main()
