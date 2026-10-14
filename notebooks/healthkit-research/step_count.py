"""Step interval, source-overlap and calendar-bucket research on private snapshots."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from common import (TIME_ZONE, YEAR_START, YEAR_END, FOCUS_START, FOCUS_END,
                    annotate_context, cadence, describe, input_manifest,
                    load_data, overlap_mask, standard_analysis, write_notebook)

IDENTIFIER = "HKQuantityTypeIdentifierStepCount"


def contained_mask(rows, spans):
    """Fully contained in one context interval (no prorating cumulative counts)."""
    result = np.zeros(len(rows), dtype=bool)
    for start, end in spans[["start_ts", "end_ts"]].dropna().itertuples(index=False, name=None):
        result |= ((rows.start_ts >= start) & (rows.end_ts <= end) & (rows.end_ts >= rows.start_ts)).to_numpy()
    return result


def overlap_report(rows):
    output = []
    for name, group in rows.groupby("source_group"):
        ordered = group.sort_values(["start_ts", "end_ts"])
        prior_max_end = ordered.end_ts.cummax().shift()
        cross = overlap_mask(group, rows[rows.source_group != name])
        output.append({"source_group": name, "records": len(group),
                       "overlapping_prior_same_group": int((ordered.start_ts < prior_max_end).sum()),
                       "overlapping_other_group": int(cross.sum()),
                       "same_group_identical_interval_value_extra_rows": int(group.duplicated(["start_ts", "end_ts", "value"]).sum()),
                       "source_revisions": int(group.source_id.nunique())})
    return output


def valid_daily_buckets(aggregates):
    if aggregates.empty:
        return aggregates.copy(), {"reason": "no aggregate records"}
    selected = aggregates[(aggregates.identifier == IDENTIFIER) & (aggregates.agg_func == "sum") &
                          (aggregates.interval_value == 1) & (aggregates.interval_unit == "day")].copy()
    selected = selected[(selected.bucket_start >= YEAR_START) & (selected.bucket_start < YEAR_END)]
    starts = selected.bucket_start.dt.tz_convert(TIME_ZONE)
    ends = selected.bucket_end.dt.tz_convert(TIME_ZONE)
    # Validate both actual boundaries; 23/25-hour DST days are legal.
    expected_ends = starts.map(lambda t: t.normalize() + pd.DateOffset(days=1))
    selected["calendar_valid"] = (starts == starts.dt.normalize()) & (ends == expected_ends)
    selected["local_day"] = starts.dt.strftime("%Y-%m-%d")
    report = {"candidate_records": len(selected), "valid_records": int(selected.calendar_valid.sum()),
              "invalid_boundary_records": int((~selected.calendar_valid).sum()),
              "candidate_duration_hours": describe((selected.bucket_end-selected.bucket_start).dt.total_seconds()/3600),
              "by_device_filter": [], "sample_boundary_patterns": []}
    for device, group in selected.groupby("device_filter"):
        valid = group[group.calendar_valid]
        report["by_device_filter"].append({"device_filter": device, "candidates": len(group),
            "valid": len(valid), "explicit_empty_valid": int(valid.value.isna().sum()),
            "values": describe(valid.value), "days": int(valid.local_day.nunique())})
    for (start_hour, end_hour, duration), n in selected.assign(
            sh=starts.dt.strftime("%H:%M"), eh=ends.dt.strftime("%H:%M"),
            dh=(selected.bucket_end-selected.bucket_start).dt.total_seconds()/3600).groupby(["sh", "eh", "dh"]).size().items():
        report["sample_boundary_patterns"].append({"start_local_time": start_hour, "end_local_time": end_hour,
                                                  "duration_hours": duration, "records": int(n)})
    return selected[selected.calendar_valid].copy(), report


def clean_json(value):
    if isinstance(value, dict):
        return {str(k): clean_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_json(v) for v in value]
    if isinstance(value, (np.integer, np.floating)):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def run(input_dir, output_dir, figure_dir=None):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    figure_dir = Path(figure_dir) if figure_dir else output_dir / "figures"
    figure_dir.mkdir(parents=True, exist_ok=True)
    data = load_data(input_dir)
    report = standard_analysis(data, IDENTIFIER)
    report["inputs"] = input_manifest(input_dir)
    rows = annotate_context(data["quantity"][data["quantity"].identifier == IDENTIFIER], data)
    rows = rows[(rows.start_ts >= YEAR_START) & (rows.start_ts < YEAR_END)].copy()
    if rows.empty:
        raise ValueError("No real step-count observations; no figures or completion claim produced")
    rows["duration_min"] = (rows.end_ts-rows.start_ts).dt.total_seconds()/60
    rows["interval_rate"] = np.where(rows.duration_min > 0, rows.value/rows.duration_min, np.nan)
    focus = rows[(rows.start_ts >= FOCUS_START) & (rows.start_ts < FOCUS_END)].copy()
    report["step_specific"] = {"year_overlap": overlap_report(rows), "focus_overlap": overlap_report(focus),
        "noninteger_values": int((rows.value.dropna() % 1 != 0).sum()),
        "zero_duration": int((rows.duration_min == 0).sum()),
        "interval_rate_steps_per_minute": describe(rows.interval_rate),
        "note": "Interval count divided by full duration is an interval average, not directly observed gait cadence. No source deduplication or count prorating is performed."}
    report["step_specific"]["source_context"] = []
    asleep = data["sleep"][data["sleep"].value.isin([1,3,4,5])]
    focus["fully_workout"] = contained_mask(focus, data["workouts"])
    focus["fully_sleep_stage"] = contained_mask(focus, asleep)
    for (source, context), group in focus.groupby(["source_group", "context"]):
        report["step_specific"]["source_context"].append({"source_group": source, "context": context,
            "records": len(group), "counts_per_interval": describe(group.value),
            "duration_minutes": describe(group.duration_min), "interval_rate_steps_per_minute": describe(group.interval_rate),
            "fully_contained_workout_records": int(group.fully_workout.sum()),
            "fully_contained_single_asleep_stage_records": int(group.fully_sleep_stage.sum()),
            "cadence": cadence(group)})
    report["step_specific"]["focus_month_source"] = [{"month": month, "source_group": source,
        "records": len(group), "record_days": group.local_day.nunique(), "duration_minutes": describe(group.duration_min),
        "interval_rate": describe(group.interval_rate)} for (month, source), group in focus.groupby(["local_month", "source_group"])]
    report["step_specific"]["focus_dayofweek"] = [{"weekday": int(day), "source_group": source,
        "raw_start_assigned_steps": describe(group.groupby("local_day").value.sum()), "records": len(group)}
        for (day, source), group in focus.groupby([focus.start_ts.dt.tz_convert(TIME_ZONE).dt.dayofweek, "source_group"])]
    valid, bucket_report = valid_daily_buckets(data["aggregates"])
    report["aggregate_boundary_audit"] = bucket_report
    report["focus_valid_daily_aggregates"] = [{"device_filter": device, "values": describe(group.value),
        "calendar_days": 92, "observed_bucket_days": group.local_day.nunique()}
        for device, group in valid[(valid.bucket_start >= FOCUS_START) & (valid.bucket_start < FOCUS_END)].groupby("device_filter")]
    report["window_edges"] = {"selection": "Raw snapshot selected by start timestamp, so pre-year-start crossing intervals may be absent; no completeness inference at first boundary.",
        "raw_cross_focus_start_from_within_snapshot": int(((rows.start_ts < FOCUS_START) & (rows.end_ts > FOCUS_START)).sum()),
        "raw_cross_year_end": int((rows.end_ts > YEAR_END).sum())}
    report["source_month_cadence"] = [{"month": month,"source_group": source,"records":len(group),
        "source_versions": sorted(group.source_version.dropna().astype(str).unique().tolist()),
        "cadence": cadence(group)} for (month,source),group in rows.groupby(["local_month","source_group"])]
    report["extreme_interval_rates"] = rows.nlargest(10,"interval_rate")[["start_ts","end_ts","value","duration_min","interval_rate","source_group","context"]].astype(str).to_dict("records")
    diagnostics = []
    for bucket in valid.itertuples():
        overlapping = rows[(rows.start_ts < bucket.bucket_end) & (rows.end_ts > bucket.bucket_start)]
        contained = overlapping[(overlapping.start_ts >= bucket.bucket_start) & (overlapping.end_ts <= bucket.bucket_end)]
        diagnostics.append({"local_day": bucket.local_day, "device_filter": bucket.device_filter,
            "aggregate_value": bucket.value, "fully_contained_all_raw_sum": contained.value.sum(),
            "overlapping_all_raw_sum": overlapping.value.sum(), "cross_boundary_records": len(overlapping)-len(contained)})
    report["raw_aggregate_diagnostics"] = diagnostics
    # Related quantities aligned by raw-source group and local start day: diagnostic only.
    related = annotate_context(data["quantity"], data)
    related = related[(related.start_ts >= FOCUS_START) & (related.start_ts < FOCUS_END)]
    correlations = []
    for source, step_group in focus.groupby("source_group"):
        s = step_group.groupby("local_day").value.sum().rename("steps")
        for identifier in ("HKQuantityTypeIdentifierDistanceWalkingRunning", "HKQuantityTypeIdentifierActiveEnergyBurned"):
            r = related[(related.identifier == identifier) & (related.source_group == source)].groupby("local_day").value.sum().rename("related")
            joined = pd.concat([s, r], axis=1).dropna()
            correlations.append({"source_group": source, "identifier": identifier, "matched_days": len(joined),
                "spearman": joined.steps.rank().corr(joined.related.rank()) if len(joined)>2 else None,
                "method": "raw start-date sums, same source-name/bundle group; overlapping observations retained, no daily Health total inferred"})
    report["related_daily_diagnostics"] = correlations
    workouts = data["workouts"][(data["workouts"].start_ts >= FOCUS_START) & (data["workouts"].start_ts < FOCUS_END)]
    workout_pairs = []
    for source, group in focus.groupby("source_group"):
        pairs = []
        for w in workouts.itertuples():
            contained = group[(group.start_ts >= w.start_ts) & (group.end_ts <= w.end_ts)]
            if len(contained):
                pairs.append({"activity_type": w.activity_type, "raw_steps": float(contained.value.sum()),
                              "records": len(contained), "distance_m": getattr(w,"distance_m",np.nan),
                              "energy_kcal": getattr(w,"energy_kcal",np.nan), "cadence": cadence(contained)})
        p = pd.DataFrame(pairs)
        for activity, group_pairs in p.groupby("activity_type") if not p.empty else []:
            workout_pairs.append({"source_group": source, "activity_type": str(activity), "matched_workouts": len(group_pairs),
                "fully_contained_raw_steps": describe(group_pairs.raw_steps),
                "distance_spearman": group_pairs.raw_steps.rank().corr(group_pairs.distance_m.rank()) if group_pairs.distance_m.notna().sum()>2 else None,
                "energy_spearman": group_pairs.raw_steps.rank().corr(group_pairs.energy_kcal.rank()) if group_pairs.energy_kcal.notna().sum()>2 else None})
    report["workout_related_diagnostics"] = workout_pairs
    report["workout_interval_detail"] = []
    for source, group in focus.groupby("source_group"):
        for activity, workout_group in workouts.groupby("activity_type"):
            matched = []
            gaps = []
            for w in workout_group.itertuples():
                samples = group[(group.start_ts >= w.start_ts) & (group.end_ts <= w.end_ts)].sort_values("start_ts")
                if len(samples):
                    matched.append(samples)
                    gap = samples.start_ts.diff().dt.total_seconds()
                    gaps.extend(gap[gap > 0].tolist())
            if matched:
                samples = pd.concat(matched)
                report["workout_interval_detail"].append({"source_group": source,"activity_type": str(activity),
                    "matched_workouts":len(matched),"records":len(samples),"values":describe(samples.value),
                    "duration_seconds":describe(samples.duration_min*60),"interval_rate":describe(samples.interval_rate),
                    "within_workout_positive_start_gaps_seconds":describe(gaps)})
    report["limitations"] += ["Raw step intervals may overlap within and across sources; row sums are not deduplicated daily totals.",
        "Midnight validity is checked in the fixed reporting timezone, not proof of historical phone-local alignment.",
        "Intervals overlapping sleep or workouts do not locate every counted step within that context.",
        "Daily raw-source relationship checks retain overlapping counts and omit days lacking either type."]
    if not len(valid):
        report["limitations"].append("No aggregate buckets meet both reporting-calendar midnight boundaries; daily totals and reconciliation remain unsupported.")
    # Two editorial figures: one actual day of source interval overlap; one duration/rate view or valid totals.
    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False, "axes.spines.right": False,
                         "svg.fonttype": "none", "figure.facecolor": "#fbfaf7", "axes.facecolor": "#fbfaf7"})
    groups = sorted(focus.source_group.unique())
    labels = {g: f"Source {i+1}" for i,g in enumerate(groups)}
    colors = ["#d65a31", "#277c8e", "#6764a2", "#518a43"]
    day_counts = focus.groupby("local_day").source_group.nunique()
    candidates = day_counts[day_counts >= 2].index
    if len(candidates):
        day = focus[focus.local_day.isin(candidates)].groupby("local_day").size().sort_values().index[len(candidates)//2]
    else:
        day = focus.groupby("local_day").size().sort_values().index[len(focus.local_day.unique())//2]
    selected = focus[focus.local_day == day]
    local_midnight = pd.Timestamp(day,tz=TIME_ZONE)
    fig, ax = plt.subplots(figsize=(10,3.8), layout="constrained")
    for i,g in enumerate(groups):
        group = selected[selected.source_group == g]
        xs = (group.start_ts-local_midnight).dt.total_seconds()/3600
        durations = group.duration_min/60
        ax.broken_barh(list(zip(xs,durations)), (i-.24,.48), facecolors=colors[i%len(colors)], alpha=.68)
    ax.set(yticks=range(len(groups)), yticklabels=[labels[g] for g in groups], xlabel="Hours after local midnight", xlim=(0,24),
           title="Step records can cover the same time twice")
    ax.text(.01,-.24,"Example step data • One selected day • Each bar is a stored count interval",transform=ax.transAxes,fontsize=10)
    paths = []
    for suffix in ("svg", "png"):
        path=figure_dir/f"source-overlap.{suffix}"; fig.savefig(path,dpi=180); paths.append(str(path))
    plt.close(fig)
    report["figure_selection"] = {"selected_day_private": day, "records": len(selected), "labels_private": labels}
    fig, axes = plt.subplots(1,2,figsize=(10,4.2),layout="constrained")
    if len(valid):
        daily = valid[(valid.bucket_start >= FOCUS_START) & (valid.bucket_start < FOCUS_END)]
        for i,(device,group) in enumerate(daily.groupby("device_filter")):
            daily_values=group.set_index("local_day").value.reindex(pd.date_range(FOCUS_START,FOCUS_END,inclusive="left",freq="D").strftime("%Y-%m-%d"))
            x=np.arange(len(daily_values))
            axes[0].plot(x,daily_values.to_numpy(),label=f"HealthKit {device}",color=colors[i%len(colors)],alpha=.85)
        axes[0].set(xlabel="Days since case window began",ylabel="Steps per validated calendar bucket",title="HealthKit daily sums"); axes[0].legend()
        ds=pd.DataFrame(diagnostics); ds=ds[(ds.device_filter=="all") & (ds.local_day>=FOCUS_START.strftime("%Y-%m-%d")) & (ds.local_day<FOCUS_END.strftime("%Y-%m-%d"))]
        axes[1].scatter(ds.aggregate_value,ds.fully_contained_all_raw_sum,color=colors[0],s=12,alpha=.6)
        maximum=max(ds.aggregate_value.max(),ds.fully_contained_all_raw_sum.max())
        axes[1].plot([0,maximum],[0,maximum],color="#78807b",linestyle="--",linewidth=1,label="Equal totals")
        axes[1].legend()
        axes[1].set(xlabel="HealthKit all-source steps",ylabel="Fully-contained all-source raw sum",title="Raw sum is a diagnostic, not a total")
    else:
        for i,g in enumerate(groups):
            group=focus[(focus.source_group==g) & (focus.duration_min>0)]
            axes[0].hist(group.duration_min,bins=np.logspace(-2,4,55),histtype="step",linewidth=2,label=labels[g],color=colors[i%len(colors)])
            axes[1].scatter(group.duration_min,group.interval_rate,s=7,alpha=.12,color=colors[i%len(colors)],rasterized=True,label=labels[g])
        axes[0].set(xscale="log",xlabel="Stored interval duration (minutes, log scale)",ylabel="Records",title="A step record has no fixed duration"); axes[0].legend()
        axes[1].set(xscale="log",yscale="log",xlabel="Stored interval duration (minutes, log scale)",ylabel="Steps / full interval minute (log scale)",title="Interval average is not walking cadence")
    fig.suptitle("Example step records • Three-month data window",fontsize=12)
    for suffix in ("svg", "png"):
        path=figure_dir/f"intervals-and-rate.{suffix}"; fig.savefig(path,dpi=180); paths.append(str(path))
    plt.close(fig)
    report=clean_json(report)
    (output_dir/"findings.json").write_text(json.dumps(report,indent=2,allow_nan=False))
    return report, paths


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",required=True,type=Path)
    parser.add_argument("--output",required=True,type=Path)
    parser.add_argument("--figures",type=Path)
    args=parser.parse_args()
    report, paths=run(args.input,args.output,args.figures)
    code=("from pathlib import Path\nimport sys,json\n"
          f"FRAMEWORK_DIR = Path({str(Path(__file__).resolve().parent)!r})\n"
          "sys.path.insert(0,str(FRAMEWORK_DIR))\nfrom step_count import run\n"
          f"report, figures = run(Path({str(args.input)!r}),Path({str(args.output)!r}))\n"
          "print(json.dumps(report,indent=2,allow_nan=False))")
    write_notebook(args.output/"research.ipynb","Step count: counts, contexts, sources and calendar boundaries",[
        {"heading":"Provenance and questions","markdown":"The standard eleven facets are investigated before publication. Inputs are one participant's actual database snapshot, a full reporting year and a July–September focus window. File hashes bind evidence. Interval rates are averages, not sensor step timing. We retain IQR outliers and overlaps; no invented deduplication or proportional step allocation. Related-type daily sums and fully-contained workout records are diagnostic, not Health totals. Sleep context uses asleep categories only, not in-bed or awake. Boundary tests honor DST and validate both local midnights."},
        {"heading":"Executed, rerunnable analysis","code":code,"output":report},
        {"heading":"Editorial figures","figures":[p for p in paths if p.endswith('.png')]},
        {"heading":"Primary sources checked","markdown":"Apple stepCount and HKCumulativeQuantitySample documentation; Apple HKStatisticsCollectionQuery for anchoring; Apple Support Manage Health data (108779) for source priority. Primary documentation establishes semantics, while the actual findings establish this single case. No population daily-step target is inferred."}])
    import nbformat
    from nbclient import NotebookClient
    notebook_path = args.output / "research.ipynb"
    notebook = nbformat.read(notebook_path, as_version=4)
    figure_index = 0
    for cell in notebook.cells:
        if cell.cell_type == "code" and "display(Image(filename=" in cell.source:
            cell.source = ("from IPython.display import display, Image\n"
                           f"display(Image(filename=[path for path in figures if path.endswith('.png')][{figure_index}]))")
            figure_index += 1
    notebook = NotebookClient(notebook, timeout=240, kernel_name="python3").execute()
    nbformat.write(notebook, notebook_path)
    print(json.dumps({"records":report["year"]["records"],"output":str(args.output),"aggregate_audit":report["aggregate_boundary_audit"]},indent=2))

if __name__=="__main__":
    main()
