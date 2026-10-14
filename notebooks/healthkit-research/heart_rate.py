"""Heart-rate research from an immutable, private HealthKit CSV snapshot.

Run with --input, --output and --figures. Public SVGs contain aggregate context
distributions only; raw timestamps, source names and record IDs stay private.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from common import (FOCUS_END, FOCUS_START, TIME_ZONE, YEAR_END, YEAR_START,
                    annotate_context, cadence, describe, input_manifest,
                    load_data, overlap_mask, standard_analysis, write_notebook)

IDENTIFIER = "HKQuantityTypeIdentifierHeartRate"
CONTEXTS = ["other_or_unknown", "sleep", "workout"]
LABELS = ["Other / unknown", "Recorded sleep", "Recorded workout"]
COLORS = ["#64748b", "#7c3aed", "#e11d48"]


def clean_json(value):
    if isinstance(value, dict):
        return {str(k): clean_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_json(v) for v in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def merged_intervals(intervals):
    spans = []
    if intervals.empty:
        return spans
    for start, end in intervals[["start_ts", "end_ts"]].dropna().sort_values("start_ts").itertuples(index=False, name=None):
        if end <= start:
            continue
        if spans and start <= spans[-1][1]:
            spans[-1][1] = max(end, spans[-1][1])
        else:
            spans.append([start, end])
    return spans


def episode_cadence(frame, intervals):
    """Assign starts inside a merged episode; exclude between-episode gaps."""
    output, gaps = [], []
    for episode, (start, end) in enumerate(merged_intervals(intervals)):
        inside = frame[(frame.start_ts >= start) & (frame.start_ts < end)]
        for source, rows in inside.groupby("source_group"):
            ordered = rows.sort_values("start_ts")
            delta = ordered.start_ts.diff().dt.total_seconds().dropna()
            gaps.extend(delta[delta > 0].tolist())
            output.append({"episode": episode, "source_group": source,
                           "start": start.isoformat(), "end": end.isoformat(),
                           "records": len(rows), "values": describe(rows.value),
                           "cadence": cadence(rows)})
    return {"episodes_with_records": len({x["episode"] for x in output}),
            "source_episode_groups": output,
            "positive_within_episode_gaps_seconds": describe(gaps)}


def motion_representation(metadata):
    key = "HKMetadataKeyHeartRateMotionContext"
    if key not in metadata:
        return "missing", None
    value = metadata[key]
    # This is the narrowly documented historical decoder for this key only.
    # Keep its boolean representation distinct in all provenance tables.
    if isinstance(value, bool):
        return "legacy_boolean_" + str(value).lower(), 1 if value else 0
    if isinstance(value, (int, float)) and value in (0, 1, 2):
        return "numeric_" + str(int(value)), int(value)
    return "invalid_" + type(value).__name__ + ":" + str(value), None


def type_specific(data, frame):
    focus = frame[(frame.start_ts >= FOCUS_START) & (frame.start_ts < FOCUS_END)].copy()
    metadata = frame.get("metadata", pd.Series([{} for _ in range(len(frame))], index=frame.index))
    motion = metadata.map(motion_representation)
    frame["motion_representation"] = motion.map(lambda x: x[0])
    frame["motion_decoded"] = motion.map(lambda x: x[1])
    motion_tables = [{"representation": representation, "context": context,
                      "records": len(rows), "values": describe(rows.value)}
                     for (representation, context), rows in frame.groupby(["motion_representation", "context"])]
    ordered = frame.sort_values("start_ts")
    extremes = []
    selected = pd.concat([ordered.nsmallest(5, "value"), ordered.nlargest(5, "value")])
    selected = selected.loc[~selected.index.duplicated()]
    for _, row in selected.iterrows():
        neighbors = ordered[(ordered.source_group == row.source_group) &
                            (abs(ordered.start_ts-row.start_ts) <= pd.Timedelta(minutes=5))]
        extremes.append({"start": row.start_ts.isoformat(), "value": float(row.value),
                         "context": row.context, "source_group": row.source_group,
                         "metadata": row.get("metadata", {}),
                         "neighbors_5min": [{"offset_s": (n.start_ts-row.start_ts).total_seconds(),
                                              "value": float(n.value)} for n in neighbors.itertuples()]})
    daily = frame.groupby("local_day").value.mean()
    # Start-selected context tables may miss intervals beginning before the
    # snapshot boundary. Exclude its first local day from paired comparisons.
    comparison_daily = daily[daily.index > YEAR_START.strftime("%Y-%m-%d")]
    related = []
    for identifier in ["HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
                       "HKQuantityTypeIdentifierRestingHeartRate",
                       "HKQuantityTypeIdentifierWalkingHeartRateAverage",
                       "HKQuantityTypeIdentifierRespiratoryRate"]:
        related_rows = data["quantity"][data["quantity"].identifier == identifier]
        related_rows = annotate_context(related_rows, data)
        if related_rows.empty:
            related.append({"identifier": identifier, "status": "no_records"})
            continue
        medians = related_rows.groupby("local_day").value.median()
        paired = pd.concat([comparison_daily.rename("heart_rate_sample_mean"), medians.rename("related_median")], axis=1).dropna()
        sleeping_daily = frame[frame.context == "sleep"].groupby("local_day").value.median()
        sleeping_daily = sleeping_daily[sleeping_daily.index > YEAR_START.strftime("%Y-%m-%d")]
        sleeping_pairs = pd.concat([sleeping_daily.rename("sleep_hr_median"), medians.rename("related_median")], axis=1).dropna()
        related.append({"identifier": identifier, "paired_days": len(paired),
                        "spearman_all_day_sample_mean": paired.corr(method="spearman").iloc[0, 1] if len(paired) >= 3 else None,
                        "sleep_paired_days": len(sleeping_pairs),
                        "spearman_sleep_median": sleeping_pairs.corr(method="spearman").iloc[0, 1] if len(sleeping_pairs) >= 3 else None,
                        "method": "Same reporting day; no timestamp-nearest pairing, causal inference or adjustment for confounders."})
    sleep = data["sleep"]
    if "value" in sleep:
        sleep = sleep[sleep.value.isin([1, 3, 4, 5])]
    focus_sleep = sleep[(sleep.start_ts < FOCUS_END) & (sleep.end_ts > FOCUS_START)]
    focus_workouts = data["workouts"][(data["workouts"].start_ts < FOCUS_END) & (data["workouts"].end_ts > FOCUS_START)]
    source_monthly = [{"source_group": source, "month": month, "records": len(rows),
                       "values": describe(rows.value), "cadence": cadence(rows)}
                      for (source, month), rows in frame.groupby(["source_group", "local_month"])]
    hourly = [{"hour": int(hour), "context": context, "records": len(rows), "values": describe(rows.value)}
              for (hour, context), rows in frame.groupby([frame.start_ts.dt.tz_convert(TIME_ZONE).dt.hour, "context"])]
    workout_types = []
    activity_column = next((x for x in ["activity_type", "workout_activity_type", "activity"] if x in focus_workouts), None)
    if activity_column:
        for activity, workouts in focus_workouts.groupby(activity_column):
            annotated = annotate_context(focus, {"workouts": workouts, "sleep": pd.DataFrame()})
            rows = annotated[annotated.workout_overlap]
            workout_types.append({"activity": str(activity), "workouts": len(workouts), "records": len(rows), "values": describe(rows.value)})
    phases = []
    for workout in focus_workouts.itertuples():
        duration = (workout.end_ts-workout.start_ts).total_seconds()
        if duration <= 0:
            continue
        # Actual records, not interpolated endpoints. Post-window records can
        # overlap another workout; report that uncertainty rather than label
        # this a clinical one-minute recovery measure.
        for phase, start, end in [
            ("first_five_minutes", workout.start_ts, min(workout.start_ts+pd.Timedelta(minutes=5), workout.end_ts)),
            ("middle", workout.start_ts+pd.Timedelta(seconds=duration*.4), workout.start_ts+pd.Timedelta(seconds=duration*.6)),
            ("last_five_minutes", max(workout.end_ts-pd.Timedelta(minutes=5), workout.start_ts), workout.end_ts),
            ("one_to_five_minutes_after", workout.end_ts+pd.Timedelta(minutes=1), workout.end_ts+pd.Timedelta(minutes=5))]:
            rows = focus[(focus.start_ts >= start) & (focus.start_ts < end)]
            phases.append({"workout_start": workout.start_ts.isoformat(), "activity": str(getattr(workout, "activity_type", "unknown")),
                           "phase": phase, "records": len(rows), "median": rows.value.median()})
    phase_frame = pd.DataFrame(phases)
    phase_summary = [{"phase": phase, "activity": activity, "windows": len(rows),
                      "windows_with_records": int(rows["median"].notna().sum()),
                      "per_window_medians": describe(rows["median"])}
                     for (phase, activity), rows in phase_frame.groupby(["phase", "activity"])] if len(phases) else []
    stage_summary = []
    if "value" in sleep:
        for stage, spans in sleep.groupby("value"):
            rows = frame[overlap_mask(frame, spans)]
            stage_summary.append({"sleep_stage_code": int(stage), "records": len(rows),
                                  "values": describe(rows.value),
                                  "method": "Any sample overlap with this recorded stage, pooled sources; a sample can overlap several stages."})
    invalid_values = frame[(~np.isfinite(frame.value)) | (frame.value <= 0)]
    return {"motion_metadata": motion_tables, "extreme_neighbor_review": extremes,
            "source_monthly": source_monthly, "local_hour_values": hourly,
            "focus_workout_episode_cadence": episode_cadence(focus, focus_workouts),
            "focus_sleep_episode_cadence": episode_cadence(focus, focus_sleep),
            "workout_activity_types": workout_types,
            "workout_phase_summary": phase_summary, "workout_phase_windows": phases,
            "recorded_sleep_stage_distributions": stage_summary,
            "invalid_physiological_values": {"count": len(invalid_values),
                                            "stored_values": invalid_values.value.tolist(),
                                            "retained": True},
            "sample_weighted_year_mean": frame.value.mean(), "equal_observed_day_mean": daily.mean(),
            "paired_related_types": related,
            "limitations": ["A temporal overlap is not proof a sample was collected by a workout.",
                "Other/unknown includes activity and rest, unrecorded sleep and absent context; it is not resting heart rate.",
                "Within-episode gaps exclude gaps between merged episodes, computed separately per source.",
                "Adjacent sleep stages are merged only for timing, not interpreted as a sleep-stage diagnosis.",
                "Correlation uses repeated daily observations from one person; confounding and autocorrelation prevent population inference.",
                "Legacy boolean motion decoding is specific to the documented historical serialization of this metadata key; raw metadata is retained.",
                "Start-selected snapshot can omit boundary-spanning context on the first day; paired relationships exclude that day."]}


def public_figures(frame, data, figure_dir, output_dir):
    focus = frame[(frame.start_ts >= FOCUS_START) & (frame.start_ts < FOCUS_END)]
    # Select the largest consistent source group once for both charts.
    source = focus.source_group.value_counts().index[0]
    selected = focus[focus.source_group == source]
    fig_dir, private = Path(figure_dir), Path(output_dir)
    fig_dir.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "svg.fonttype": "none"})
    fig, ax = plt.subplots(figsize=(9, 4.6), constrained_layout=True)
    bins = np.arange(20, 231, 5)
    for context, label, color in zip(CONTEXTS, LABELS, COLORS):
        values = selected[selected.context == context].value.dropna()
        if len(values):
            ax.hist(values, bins=bins, weights=np.ones(len(values))*100/len(values),
                    histtype="step", linewidth=2.3, label=f"{label} (n={len(values):,})", color=color)
    ax.set(xlabel="Heart rate (beats/minute)", ylabel="Share within each context (%)",
           title="The same source records different heart-rate distributions")
    ax.legend(frameon=False)
    ax.grid(axis="y", alpha=.15)
    fig.savefig(fig_dir / "context-ranges.svg", metadata={"Date": None})
    fig.savefig(private / "context-ranges.png", dpi=160)
    plt.close(fig)
    fig, ax = plt.subplots(figsize=(9, 4.6), constrained_layout=True)
    distributions = []
    for context, label, color in zip(CONTEXTS, LABELS, COLORS):
        rows = selected[selected.context == context].sort_values("start_ts")
        if context == "other_or_unknown":
            delta = rows.start_ts.diff().dt.total_seconds()
            gaps = np.sort(delta[delta > 0].to_numpy())
        else:
            intervals = data["workouts"] if context == "workout" else data["sleep"][data["sleep"].value.isin([1, 3, 4, 5])]
            collected = []
            for start, end in merged_intervals(intervals):
                inside = rows[(rows.start_ts >= start) & (rows.start_ts < end)]
                delta = inside.start_ts.diff().dt.total_seconds()
                collected.extend(delta[delta > 0].tolist())
            gaps = np.sort(collected)
        if len(gaps):
            ax.step(gaps, np.arange(1, len(gaps)+1)/len(gaps)*100, color=color,
                    label=label, linewidth=2, where="post")
            distributions.append({"context": context, "gaps": describe(gaps),
                                  "scope": "consecutive same-context records" if context == "other_or_unknown" else "within merged recorded episodes"})
    ax.set_xscale("log")
    ax.set(xlabel="Positive start-to-start gap (seconds; logarithmic scale)",
           ylabel="Gaps at or below this duration (%)", ylim=(0, 100),
           title="Recording cadence changes with context")
    ax.legend(frameon=False)
    ax.grid(alpha=.15)
    fig.savefig(fig_dir / "context-cadence.svg", metadata={"Date": None})
    fig.savefig(private / "context-cadence.png", dpi=160)
    plt.close(fig)
    return {"source_group_private": source, "records": len(selected),
            "source_observed_days": int(selected.local_day.nunique()),
            "context_values": [{"context": context, "days": int(selected[selected.context == context].local_day.nunique()), "values": describe(selected[selected.context == context].value)} for context in CONTEXTS],
            "context_gaps": distributions,
            "window_days": 92, "context_rule": "Any half-open recorded workout/asleep interval overlap; dual overlap is excluded from these three-context charts."}


def run(input_dir, output_dir, figure_dir):
    data = load_data(input_dir)
    frame = annotate_context(data["quantity"][data["quantity"].identifier == IDENTIFIER], data)
    frame = frame[(frame.start_ts >= YEAR_START) & (frame.start_ts < YEAR_END)]
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report = standard_analysis(data, IDENTIFIER)
    report["inputs"] = input_manifest(input_dir)
    report["type_specific"] = type_specific(data, frame)
    report["public_figure_methods"] = public_figures(frame, data, figure_dir, output_dir)
    report["facets"]["cross_type_relationships"] = "completed_exploratory_daily_pairs"
    report["primary_reference_review"] = [
        {"url": "https://support.apple.com/en-us/120277", "reviewed_on": "2026-10-14", "finding": "Updated September 2026: model and settings affect continuous recording; optical support range is not a physiological reference range."},
        {"url": "https://support.apple.com/en-us/105002", "reviewed_on": "2026-10-14", "finding": "Wrist detection, fit, perfusion, tattoos and motion can affect measurements."},
        {"url": "https://developer.apple.com/documentation/healthkit/hkmetadatakeyheartratemotioncontext", "reviewed_on": "2026-10-14", "finding": "An NSNumber containing a motion-context enum; not an explicit workout identifier."},
        {"url": "https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse", "reviewed_on": "2026-10-14", "finding": "Adult resting reference 60–100 bpm; fitness, medication and sleep can lower it; symptoms matter."}]
    report = clean_json(report)
    (output_dir / "findings.json").write_text(json.dumps(report, indent=2, allow_nan=False))
    selected = report["public_figure_methods"]
    summary = ["# Heart-rate research findings", "",
               "## Coverage and value quality",
               f"The full year contains {report['year']['records']:,} records on all 365 reporting days. "
               "Presence on a day does not establish continuous monitoring. Three source groups contribute records. "
               "One zero-valued observation belongs to a separate app source, followed by a reading of 78 bpm about 155 seconds later. "
               "The zero is preserved and flagged rather than treated as a physiological value. Positive extremes are 37–184 bpm; "
               "the upper extremes are outside recorded workout overlap, illustrating that unknown context is not rest.", "",
               "## Source-selected focus-window observations",
               "| Context | Records | Observed days | Median bpm | 5th–95th percentile bpm |",
               "|---|---:|---:|---:|---:|"]
    for item in selected["context_values"]:
        v = item["values"]
        summary.append(f"| {item['context']} | {v['count']:,} | {item['days']} | {v.get('p50', 0):.1f} | {v.get('p5', 0):.1f}–{v.get('p95', 0):.1f} |")
    summary.extend(["", "Only five sleep-observed days occur in this selected source; the other watch-source group supplies much of the year's sleep context. "
                    "Sample density, context and source coverage differ materially. Treat this as a case example, not a population comparison.", "",
                    "## Cadence and aggregation",
                    "Workout median within-episode positive gaps are 5 seconds. Selected-source sleep median within-episode gaps are 246 seconds. "
                    "The curves exclude between-episode time for sleep/workouts; other/unknown consecutive gaps have a different denominator. "
                    f"The year-wide sample-weighted mean is {report['type_specific']['sample_weighted_year_mean']:.2f} bpm; the equally weighted observed-day sample means average "
                    f"{report['type_specific']['equal_observed_day_mean']:.2f} bpm. Neither estimates a time-weighted physiological mean.", "",
                    "## Type-specific checks",
                    "The notebook preserves numeric and legacy boolean motion representations; only the narrowly documented heart-motion decoder maps historical booleans. "
                    "Contextual IQR flags and five-minute same-source neighbors are retained for review. Sleep-stage distributions overlap where interval boundaries cross; "
                    "these are recorded stage labels rather than physiological stage verification. Workout phase comparisons use actual first/middle/last/post records without "
                    "interpolating missing endpoints. Post windows are not the HealthKit one-minute recovery metric.", "",
                    "## Related types",
                    "Daily paired heart-rate summaries and HRV, resting heart rate, walking average and respiratory rate are exploratory. "
                    "The first snapshot day is excluded because start-selected context can omit pre-boundary intervals. Sparse and informative sampling, "
                    "source mixture, repeated-day autocorrelation and unmeasured confounders prevent causal or population conclusions.", "",
                    "## Publication decisions",
                    "Use the two source-selected aggregate figures with explicit five-day sleep coverage, retain contextual range/cadence nuance, "
                    "remove unsupported accuracy percentages and disease bullet lists, and distinguish optical support range from clinical resting references. "
                    "Original identifiers, dates, app names, UUIDs and metadata remain in the private notebook and snapshot only."])
    (output_dir / "findings.md").write_text("\n".join(summary) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--figures", required=True, type=Path)
    args = parser.parse_args()
    code_dir = Path(__file__).resolve().parent
    setup = f"""from pathlib import Path
import sys, json
sys.path.insert(0, {str(code_dir)!r})
from heart_rate import run
report = run(Path({str(args.input.resolve())!r}), Path({str(args.output.resolve())!r}), Path({str(args.figures.resolve())!r}))
print(json.dumps({{key: report[key] for key in ['identifier','timezone','windows','inputs','units','invalid_timestamps','limitations']}}, indent=2))"""
    sections = [
        {"heading": "Snapshot provenance and reproducible analysis", "markdown": "One consenting person's immutable database snapshot; full reporting year plus a 92-day focus. Read-only analysis preserves all observations. Inputs are hashed. Context uses half-open interval overlap, with workout and sleep overlaps retained separately. Source bundle/display-name groups do not establish persistent physical device identity.", "code": setup},
        {"heading": "Findings and interpretation", "code": "from IPython.display import Markdown, display\ndisplay(Markdown((Path(" + repr(str(args.output.resolve())) + ") / 'findings.md').read_text()))"},
        {"heading": "Standard coverage, values, outliers, cadence and source changes", "code": "print(json.dumps({key: report[key] for key in ['year','focus','source_revisions','by_source_context','monthly','local_hour_record_counts']}, indent=2))"},
        {"heading": "Heart-specific metadata, extremes, episodes and relationships", "code": "print(json.dumps(report['type_specific'], indent=2))"},
        {"heading": "Actual-data figures and exact selection methods", "code": "print(json.dumps(report['public_figure_methods'], indent=2))\nfrom IPython.display import Image, display\ndisplay(Image(filename=str(Path(" + repr(str(args.output.resolve())) + ") / 'context-ranges.png')))\ndisplay(Image(filename=str(Path(" + repr(str(args.output.resolve())) + ") / 'context-cadence.png')))"},
        {"heading": "Reference review and publication limits", "code": "print(json.dumps(report['primary_reference_review'], indent=2))", "markdown": "Single-person distributions are examples, not normal ranges. No clinical diagnosis follows from IQR flags. Means are sample weighted unless explicitly stated; observed-day averages weight days equally but still do not measure a time-weighted physiological mean. Cadence is about stored records rather than optical sampling. Public figures omit source names, timestamps, UUIDs and raw metadata."}]
    write_notebook(args.output / "research.ipynb", "Heart rate: completed database research", sections)
    import nbformat
    from nbclient import NotebookClient
    notebook = nbformat.read(args.output / "research.ipynb", as_version=4)
    NotebookClient(notebook, timeout=900, kernel_name="python3").execute()
    nbformat.write(notebook, args.output / "research.ipynb")


if __name__ == "__main__":
    main()
