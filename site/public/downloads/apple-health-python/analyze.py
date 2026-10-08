"""Three descriptive charts from PulsHealth product API CSV exports.
Demo files are synthetic. Requires Python 3.10+; see requirements.txt.
"""
import argparse
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

RHR = "HKQuantityTypeIdentifierRestingHeartRate"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path(__file__).parent)
    parser.add_argument("--output", type=Path, default=Path("figures"))
    parser.add_argument("--time-zone", default="UTC")
    parser.add_argument("--start", default="2026-08-03")
    parser.add_argument("--end", default="2026-08-31", help="Exclusive local date")
    parser.add_argument("--label", default="Synthetic example data")
    args = parser.parse_args()
    start, end = pd.Timestamp(args.start), pd.Timestamp(args.end)
    if start.tzinfo or end.tzinfo or start >= end:
        raise ValueError("Use increasing local YYYY-MM-DD dates")
    days = pd.date_range(start, end, inclusive="left", freq="D")
    workouts = pd.read_csv(args.input / "workouts.csv")
    if workouts.uuid.duplicated().any():
        raise ValueError("Duplicate workout UUID: inspect input before counting")
    local = pd.to_datetime(workouts.start, unit="ms", utc=True).dt.tz_convert(args.time_zone)
    workout_days = local.dt.tz_localize(None).dt.normalize()
    counts = workout_days.value_counts().reindex(days, fill_value=0).sort_index()
    # Counts represent exported records, not proof of recording coverage.
    weeks = counts.resample("W-MON", closed="left", label="left").sum()
    sleep = pd.read_csv(args.input / "sleep.csv")
    metrics = pd.read_csv(args.input / "daily_metrics.csv")
    metrics = metrics.loc[metrics.identifier == RHR].copy()
    if not metrics.unit.eq("count/min").all():
        raise ValueError("Resting heart rate must use count/min")
    def daily(frame, column):
        date = pd.to_datetime(frame.date, format="%Y-%m-%d")
        if date.duplicated().any():
            raise ValueError("Multiple rows per local day: inspect input")
        values = pd.to_numeric(frame[column], errors="raise")
        return pd.Series(values.to_numpy(), index=date).reindex(days)
    hours = daily(sleep, "asleepMinutes") / 60
    heart = daily(metrics, "value")
    if (hours.dropna() < 0).any() or (heart.dropna() <= 0).any():
        raise ValueError("Invalid duration or resting heart rate")
    args.output.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11,
                         "axes.spines.top": False, "axes.spines.right": False})
    fig, axes = plt.subplots(3, 1, figsize=(12, 10), layout="constrained")
    fig.suptitle("Your first three Apple Health charts\n" + args.label, fontsize=19)
    axes[0].bar(weeks.index, weeks.values, width=4, color="#287e83")
    axes[0].set(title="Recorded workouts per week", ylabel="Workouts", ylim=(0, max(1, weeks.max()+1)))
    axes[0].set_xticks(weeks.index, [d.strftime("%b %d") for d in weeks.index])
    axes[0].set_xlabel("Week starting Monday; edge weeks may be partial")
    axes[1].plot(days, hours, marker="o", markersize=4, color="#7764a7")
    axes[1].set(title=f"Sleep duration · {hours.notna().sum()}/{len(days)} days with values", ylabel="Hours asleep", ylim=(0, max(9, hours.max()+1) if hours.notna().any() else 9))
    axes[2].plot(days, heart, marker="o", markersize=4, color="#bf6750")
    axes[2].set(title=f"Daily resting heart rate · {heart.notna().sum()}/{len(days)} days with values", ylabel="Beats per minute")
    for ax in axes:
        ax.grid(axis="y", alpha=.2)
    for ax in axes[1:]:
        ax.set_xticks(days[::7], [d.strftime("%b %d") for d in days[::7]])
    fig.savefig(args.output / "three-charts.webp", dpi=150)
    pd.DataFrame({"sleep_hours": hours, "resting_heart_rate_bpm": heart,
                  "recorded_workouts": counts}).rename_axis("date").to_csv(args.output / "daily-summary.csv")
    print(f"workouts={int(counts.sum())}; sleep_days={hours.notna().sum()}; resting_hr_days={heart.notna().sum()}; calendar_days={len(days)}")
    print(f"Saved {args.output / 'three-charts.webp'} and daily-summary.csv")

if __name__ == "__main__":
    main()
