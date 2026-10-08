"""Check the blog's synthetic example. Python standard library only."""
import csv
from pathlib import Path
from statistics import median

rows = list(csv.DictReader((Path(__file__).with_name("sleep-example.csv")).open()))
assert len(rows) == 14 and len({r["wake_date"] for r in rows}) == 14
medians = []
for start, end in [("2026-09-01", "2026-09-07"), ("2026-09-08", "2026-09-14")]:
    period = [r for r in rows if start <= r["wake_date"] <= end]
    values = sorted(int(r["asleep_minutes"]) for r in period if r["asleep_minutes"] != "")
    missing = [r["wake_date"] for r in period if r["asleep_minutes"] == ""]
    result = median(values)
    medians.append(result)
    print(f"{start} to {end}: {len(values)}/{len(period)} nights; median {result:g} min")
    print(f"  Sorted minutes: {values}; missing: {', '.join(missing)}")
assert medians == [425, 455]
print(f"Difference in recorded-night medians: {medians[1] - medians[0]:g} min")
