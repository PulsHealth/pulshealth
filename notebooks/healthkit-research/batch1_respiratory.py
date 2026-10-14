"""Supplemental overnight-vital analyses; source snapshots remain private."""
from __future__ import annotations

import numpy as np
import pandas as pd
from common import (annotate_context, cadence, describe, FOCUS_START, FOCUS_END,
                    YEAR_START, YEAR_END)
from heart_rate import episode_cadence

IDENTIFIERS = ["HKQuantityTypeIdentifierRespiratoryRate", "HKQuantityTypeIdentifierOxygenSaturation",
               "HKQuantityTypeIdentifierBodyTemperature", "HKQuantityTypeIdentifierAppleSleepingWristTemperature"]


def analyze(data, identifier):
    frame = annotate_context(data["quantity"][data["quantity"].identifier == identifier], data)
    if frame.empty:
        return {"status": "no_raw_records", "unsupported": "No quantity observations available; no values, cadence, context response or relationship can be estimated."}
    frame = frame[(frame.start_ts >= YEAR_START) & (frame.start_ts < YEAR_END)]
    focus = frame[(frame.start_ts >= FOCUS_START) & (frame.start_ts < FOCUS_END)]
    sleep = data["sleep"]
    sleep = sleep[sleep.value.isin([1, 3, 4, 5])]
    result = {"focus_contexts": [{"context": context, "records": len(rows), "values": describe(rows.value), "cadence": cadence(rows)} for context, rows in focus.groupby("context")],
              "within_sleep_episode_cadence": episode_cadence(focus, sleep),
              "within_workout_episode_cadence": episode_cadence(focus, data["workouts"]),
              "metadata_presence": {key: int(frame.metadata.map(lambda item: key in item).sum()) for key in sorted({key for item in frame.metadata for key in item})},
              "special_considerations": {"stored_scale": "Audit unit plus values; percent can be represented as 0-1 by HealthKit, Puls stored percent retains the HealthKit 0-1 ratio; multiply by 100 for percentage presentation.",
                  "temperature": "Sleeping wrist temperature HealthKit samples are absolute wrist skin temperature, not Health UI baseline deviations or clinical core temperature.",
                  "sampling": "Stored samples do not reveal internal sensor cadence; interval overlap does not prove moment of measurement or exercise response.",
                  "eligibility": "Absent records cannot distinguish wear, permissions, regional feature availability, settings, unsupported devices or failed measurements."}}
    extremes = pd.concat([frame.nsmallest(3, "value"), frame.nlargest(3, "value")]).drop_duplicates("uuid")
    result["retained_extremes"] = [{"value": float(row.value), "timestamp": row.start_ts.isoformat(), "duration_s": (row.end_ts-row.start_ts).total_seconds(), "source_group": row.source_group, "context": row.context, "metadata": row.metadata} for row in extremes.itertuples()]
    result["relationships"] = "See shared source-paired related_types facet; no source-pooled correlations."
    return result


def figures(data, identifier, output):
    """Source-anonymous distributions and cadence; no timestamps or source names."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    frame = annotate_context(data["quantity"][data["quantity"].identifier == identifier], data)
    if frame.empty:
        return []
    focus = frame[(frame.start_ts >= FOCUS_START) & (frame.start_ts < FOCUS_END)]
    period = "July–September 2026"
    if identifier == IDENTIFIERS[3]:
        focus = frame[(frame.start_ts >= YEAR_START) & (frame.start_ts < YEAR_END)]
        period = "October 2025–September 2026"
    if focus.empty:
        return []
    output.mkdir(parents=True, exist_ok=True)
    labels = {IDENTIFIERS[0]: ("Respiratory rate", "breaths/min"), IDENTIFIERS[1]: ("Blood oxygen saturation", "%"), IDENTIFIERS[2]: ("Body temperature", "°C"), IDENTIFIERS[3]: ("Sleeping wrist temperature", "°C, absolute wrist temperature")}
    name, unit = labels[identifier]
    fig, axs = plt.subplots(1, 2, figsize=(12, 5), constrained_layout=True)
    values = focus.value.dropna() * (100 if identifier == IDENTIFIERS[1] else 1)
    for index, (_, rows) in enumerate(focus.groupby("source_group")):
        values = rows.value.dropna() * (100 if identifier == IDENTIFIERS[1] else 1)
        axs[0].hist(values, bins=25, alpha=.6, label=f"Source {index+1}")
    axs[0].legend()
    axs[0].set(xlabel=unit, ylabel="Stored records", title="Recorded value distribution")
    groups = list(focus.groupby("source_group"))
    for index, (_, rows) in enumerate(groups):
        gap = rows.sort_values("start_ts").start_ts.diff().dt.total_seconds()
        gap = gap[gap > 0] / 60
        axs[1].hist(gap, bins=np.geomspace(max(.01, gap.min()), max(.02,gap.max())*1.001, 25) if len(gap) else 25, alpha=.6, label=f"Source {index+1}")
    axs[1].set(xlabel="Positive start-to-start gap (minutes, log scale)", ylabel="Adjacent pairs", title="Cadence within each source", xscale="log")
    if groups: axs[1].legend()
    fig.suptitle(f"{name} · {period} example data · {len(focus):,} records", fontsize=14)
    path = output / "values-and-cadence.png"
    fig.savefig(path, dpi=120); plt.close(fig)
    return [path]
