"""Reusable, read-only HealthKit snapshot analysis; never connects to a database."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

TIME_ZONE = "America/Los_Angeles"
YEAR_START = pd.Timestamp("2025-10-01", tz=TIME_ZONE)
YEAR_END = pd.Timestamp("2026-10-01", tz=TIME_ZONE)
FOCUS_START = pd.Timestamp("2026-07-01", tz=TIME_ZONE)
FOCUS_END = YEAR_END


def timestamp(values):
    """Accept exported PostgreSQL timestamps or protocol epoch milliseconds."""
    numeric = pd.to_numeric(values, errors="coerce")
    if numeric.notna().all() and len(values):
        return pd.to_datetime(numeric, unit="ms", utc=True, errors="coerce")
    return pd.to_datetime(values, utc=True, errors="coerce", format="mixed")


def load_data(input_dir):
    result = {}
    for name in ("quantity", "sleep", "mindful", "workouts", "aggregates", "workout_series"):
        path = Path(input_dir) / f"{name}.csv"
        if not path.exists():
            path = Path(input_dir) / f"{name}.csv.gz"
        if not path.exists():
            result[name] = pd.DataFrame()
            continue
        try:
            frame = pd.read_csv(path, low_memory=False)
        except pd.errors.EmptyDataError:
            frame = pd.DataFrame()
        for column in ("start_ts", "end_ts", "bucket_start", "bucket_end", "ts"):
            if column in frame:
                frame[column] = timestamp(frame[column])
        for column in ("value", "duration_s", "distance_m", "energy_kcal"):
            if column in frame:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")
        for column in ("metadata", "stats_detail", "events"):
            if column in frame:
                def parse(value):
                    if pd.isna(value):
                        return {}
                    try:
                        return json.loads(value)
                    except (ValueError, TypeError):
                        return {"_parse_error": True}
                frame[column] = frame[column].map(parse)
        result[name] = frame
    return result


def overlap_mask(samples, intervals):
    """Any half-open interval overlap, including instantaneous observations.

    Merge context intervals first, so duplicate sleep stages cannot multiply rows.
    A point at an interval end is outside; an interval beginning at that end is
    outside too. No causal or explicit HealthKit workout linkage is implied.
    """
    mask = np.zeros(len(samples), dtype=bool)
    if samples.empty or intervals.empty:
        return mask
    spans = intervals[["start_ts", "end_ts"]].dropna().sort_values("start_ts")
    merged = []
    for start, end in spans.itertuples(index=False, name=None):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    if not merged:
        return mask
    starts = np.array([a.value for a, _ in merged], dtype=np.int64)
    ends = np.array([b.value for _, b in merged], dtype=np.int64)
    valid = samples["start_ts"].notna() & samples["end_ts"].notna()
    s = samples.loc[valid, "start_ts"].astype("int64").to_numpy()
    e = samples.loc[valid, "end_ts"].astype("int64").to_numpy()
    positions = np.searchsorted(ends, s, side="right")
    safe = np.minimum(positions, len(starts) - 1)
    matches = (positions < len(starts)) & np.where(e == s, starts[safe] <= s, starts[safe] < e) & (e >= s)
    mask[np.flatnonzero(valid.to_numpy())] = matches
    return mask


def annotate_context(frame, data, timezone=TIME_ZONE):
    result = frame.copy()
    if result.empty:
        return result
    result["workout_overlap"] = overlap_mask(result, data.get("workouts", pd.DataFrame()))
    sleep = data.get("sleep", pd.DataFrame())
    # HealthKit: asleep unspecified=1, core=3, deep=4, REM=5.
    if "value" in sleep:
        sleep = sleep[sleep["value"].isin([1, 3, 4, 5])]
    result["sleep_overlap"] = overlap_mask(result, sleep)
    result["context"] = np.select(
        [result.workout_overlap & result.sleep_overlap, result.workout_overlap, result.sleep_overlap],
        ["workout_and_sleep", "workout", "sleep"], default="other_or_unknown")
    result["local_day"] = result.start_ts.dt.tz_convert(timezone).dt.strftime("%Y-%m-%d")
    result["local_month"] = result.start_ts.dt.tz_convert(timezone).dt.strftime("%Y-%m")
    # source_id is a source revision, not a persistent device identity. Prefer
    # bundle + display name for grouping revisions, and retain IDs separately.
    bundle = result.get("bundle_id", pd.Series("unknown", index=result.index)).fillna("unknown")
    name = result.get("source_name", pd.Series("unknown", index=result.index)).fillna("unknown")
    result["source_group"] = bundle.astype(str) + " | " + name.astype(str)
    return result


def describe(values):
    values = pd.to_numeric(pd.Series(values), errors="coerce")
    finite = values[np.isfinite(values)]
    report = {"count": len(values), "finite_count": len(finite), "nonfinite_or_missing": len(values)-len(finite)}
    if finite.empty:
        return report
    report.update({"min": float(finite.min()), "max": float(finite.max()),
                   "mean": float(finite.mean()), "std": float(finite.std(ddof=1)) if len(finite)>1 else None,
                   "zero_count": int((finite == 0).sum()), "negative_count": int((finite < 0).sum())})
    report.update({f"p{p}": float(finite.quantile(p/100)) for p in (1, 5, 25, 50, 75, 95, 99)})
    return report


def cadence(frame):
    ordered = frame.dropna(subset=["start_ts", "end_ts"]).sort_values(["start_ts", "end_ts"])
    gaps = ordered.start_ts.diff().dt.total_seconds().dropna()
    end_gaps = (ordered.start_ts - ordered.end_ts.shift()).dt.total_seconds().dropna()
    return {"start_to_start_seconds_positive": describe(gaps[gaps > 0]),
            "start_to_start_zero_count": int((gaps == 0).sum()),
            "start_to_start_negative_count": int((gaps < 0).sum()),
            "end_to_next_start_seconds": describe(end_gaps),
            "overlap_next_count": int((end_gaps < 0).sum()),
            "duration_seconds": describe((ordered.end_ts-ordered.start_ts).dt.total_seconds())}


def summarize(frame, start, end, timezone=TIME_ZONE):
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("Analysis bounds must be timezone-aware")
    local_start, local_end = start.tz_convert(timezone), end.tz_convert(timezone)
    if local_start != local_start.normalize() or local_end != local_end.normalize():
        raise ValueError("Coverage windows must start and end at reporting-calendar midnight")
    if end <= start:
        raise ValueError("Coverage window must have positive duration")
    rows = frame[(frame.start_ts >= start) & (frame.start_ts < end)]
    days = len(pd.date_range(local_start, local_end, inclusive="left", freq="D"))
    # Derive keys in the requested reporting calendar rather than trust a
    # caller's previously annotated (possibly differently zoned) local_day.
    day_counts = rows.groupby(rows.start_ts.dt.tz_convert(timezone).dt.strftime("%Y-%m-%d")).size()
    return {"records": len(rows), "calendar_days": days, "days_with_records": len(day_counts),
            "coverage_fraction": len(day_counts)/days,
            "records_per_observed_day": describe(day_counts), "values": describe(rows.value),
            "cadence": cadence(rows)}


def standard_analysis(data, identifier, *, timezone=TIME_ZONE, year_start=YEAR_START,
                      year_end=YEAR_END, focus_start=FOCUS_START, focus_end=FOCUS_END):
    year_start, year_end = pd.Timestamp(year_start), pd.Timestamp(year_end)
    focus_start, focus_end = pd.Timestamp(focus_start), pd.Timestamp(focus_end)
    for bound in (year_start, year_end, focus_start, focus_end):
        if bound.tzinfo is None:
            raise ValueError("Analysis bounds must be timezone-aware")
    if not year_start <= focus_start < focus_end <= year_end:
        raise ValueError("Focus must lie within the analysis year window")
    quantity = data.get("quantity", pd.DataFrame())
    frame = annotate_context(quantity[quantity.identifier == identifier], data, timezone) if "identifier" in quantity else pd.DataFrame()
    limitations = ["One person's observational data; not population reference ranges or medical advice.",
                   "Missing records are not zero measurements or evidence of non-wear.",
                   "Contexts use interval overlap, not causal or explicit workout association.",
                   "A fixed reporting calendar may differ from recorded travel-local days.",
                   "Sampling can be informative: sample means overweight densely recorded activity.",
                   "Grouped cadence includes gaps across separate sleep/workout episodes; episode-specific cadence requires the type plugin.",
                   "Start-selected snapshots omit context intervals beginning before the boundary; first-day other/unknown is not proof of awake or non-workout.",
                   "IQR flags are descriptive; no records are deleted or diagnosed."]
    report = {"identifier": identifier, "timezone": timezone, "limitations": limitations,
              "windows": {"year": [year_start.isoformat(), year_end.isoformat()],
                          "focus": [focus_start.isoformat(), focus_end.isoformat()]}}
    if frame.empty:
        report.update({"status": "unsupported_no_raw_quantity_records", "facets": {"raw_values": "unsupported"}})
        return report
    report["invalid_timestamps"] = {"missing_start": int(frame.start_ts.isna().sum()),
                                    "missing_end": int(frame.end_ts.isna().sum()),
                                    "negative_duration": int((frame.end_ts < frame.start_ts).sum())}
    frame = frame[(frame.start_ts >= year_start) & (frame.start_ts < year_end)]
    if frame.empty:
        report.update({"status": "unsupported_no_raw_quantity_records_in_window", "facets": {"raw_values": "unsupported"}})
        return report
    report["status"] = "completed"
    report["facets"] = {name: "completed" for name in (
        "coverage", "value_ranges", "validity", "source_revisions", "cadence", "durations",
        "workout_overlap", "sleep_overlap", "monthly_change", "iqr_outliers")}
    report["facets"]["cross_type_relationships"] = "requires_type_specific_analysis"
    report["units"] = sorted(frame.unit.dropna().unique().tolist()) if "unit" in frame else []
    report["year"] = summarize(frame, year_start, year_end, timezone)
    report["focus"] = summarize(frame, focus_start, focus_end, timezone)
    if len(report["units"]) > 1:
        report["limitations"].append("Multiple units found: pooled numeric summaries require review before interpretation.")
    report["source_revisions"] = []
    for group, rows in frame.groupby("source_group"):
        report["source_revisions"].append({"source_group": group, "records": len(rows),
            "source_ids": sorted(rows.source_id.dropna().astype(str).unique().tolist()) if "source_id" in rows else [],
            "versions": sorted(rows.source_version.dropna().astype(str).unique().tolist()) if "source_version" in rows else [],
            "first": rows.start_ts.min().isoformat(), "last": rows.start_ts.max().isoformat(),
            "values": describe(rows.value), "cadence": cadence(rows)})
    report["by_source_context"] = []
    for (source, context), rows in frame.groupby(["source_group", "context"]):
        finite = rows.value[np.isfinite(rows.value)]
        q1, q3 = finite.quantile(.25), finite.quantile(.75)
        lower, upper = q1-1.5*(q3-q1), q3+1.5*(q3-q1)
        report["by_source_context"].append({"source_group": source, "context": context,
            "records": len(rows), "values": describe(rows.value), "cadence": cadence(rows),
            "iqr_lower": float(lower) if np.isfinite(lower) else None,
            "iqr_upper": float(upper) if np.isfinite(upper) else None,
            "iqr_outlier_count": int(((finite < lower) | (finite > upper)).sum()),
            "iqr_supported": len(finite) >= 4})
    report["monthly"] = [{"month": month, "records": len(rows), "days_with_records": rows.local_day.nunique(),
                           "values": describe(rows.value)} for month, rows in frame.groupby("local_month")]
    report["local_hour_record_counts"] = {str(k): int(v) for k, v in frame.groupby(frame.start_ts.dt.tz_convert(timezone).dt.hour).size().items()}
    return report


def input_manifest(input_dir):
    result = []
    paths = list(Path(input_dir).glob("*.csv")) + list(Path(input_dir).glob("*.csv.gz"))
    for path in sorted(paths):
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
        result.append({"file": path.name, "bytes": path.stat().st_size, "sha256": digest.hexdigest()})
    return result


def write_notebook(output_path, title, sections):
    """Write an evidence notebook from sections; figures are embedded PNG files.

    Code cells with output use text/plain (dict/list values become strict JSON).
    Include an executable setup cell in sections for reproducibility.
    """
    import nbformat
    cells = [nbformat.v4.new_markdown_cell(f"# {title}\n\nPrivate observational research. Review limitations before publishing excerpts.")]
    for section in sections:
        if section.get("heading"):
            cells.append(nbformat.v4.new_markdown_cell("## " + section["heading"]))
        if section.get("markdown"):
            cells.append(nbformat.v4.new_markdown_cell(section["markdown"]))
        if section.get("code"):
            outputs = []
            if "output" in section:
                output = section["output"]
                if not isinstance(output, str):
                    output = json.dumps(output, indent=2, allow_nan=False, default=str)
                outputs.append(nbformat.v4.new_output("stream", name="stdout", text=output))
            cells.append(nbformat.v4.new_code_cell(section["code"], outputs=outputs))
        for figure in section.get("figures", []):
            encoded = base64.b64encode(Path(figure).read_bytes()).decode()
            cells.append(nbformat.v4.new_code_cell(
                "from IPython.display import Image, display\n"
                f"display(Image(filename={str(Path(figure).resolve())!r}))", outputs=[
                nbformat.v4.new_output("display_data", data={"image/png": encoded}, metadata={})]))
    notebook = nbformat.v4.new_notebook(cells=cells, metadata={"kernelspec": {
        "display_name": "Python 3", "language": "python", "name": "python3"}})
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    nbformat.write(notebook, path)
