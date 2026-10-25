"""Rebuild the article figures from the published selected records.

From the repository root:
    uv run --with matplotlib --with pillow blog/images/apple-health-ai-weekly-review/render.py

The ring-update time comes from the separately checked source metadata described
in the article. No private identifiers, raw samples, or credentials are needed.
"""
from collections import defaultdict
from datetime import date, timedelta
from io import BytesIO
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from PIL import Image

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
DATA = json.loads((ROOT / "site/public/downloads/apple-health-weekly-review/selected-records.json").read_text())
BG, INK, MUTED, GRID = "#111b28", "#edf3fb", "#b6c7dc", "#33455b"
BLUE, TEAL, AMBER = "#60a5fa", "#2dd4bf", "#fbbf24"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 18,
    "text.color": INK, "axes.labelcolor": MUTED, "xtick.color": MUTED,
    "ytick.color": MUTED, "axes.facecolor": BG, "figure.facecolor": BG,
    "axes.edgecolor": GRID, "savefig.facecolor": BG})

def save(fig, name):
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=100)
    buf.seek(0)
    Image.open(buf).convert("RGB").save(OUT / name, "WEBP", quality=95, method=6)
    plt.close(fig)

start = date.fromisoformat(DATA["periodStart"])
days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
workouts = defaultdict(list)
for workout in DATA["workouts"]:
    workouts[workout["date"]].append(workout)
active = {v["date"]: v["value"] for m in DATA["metrics"] if m["identifier"].endswith("ActiveEnergyBurned") for v in m["days"]}
rings = {r["date"]: r["moveKcal"] for r in DATA["rings"]}

# Figure 1: a calendar, not a duration-scaled chart. The exact durations are text.
fig = plt.figure(figsize=(16, 10))
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 1600); ax.set_ylim(0, 1000); ax.axis("off")
ax.text(75, 915, "Twelve workouts. Six days.", fontsize=32, weight="bold")
ax.text(75, 858, "October 12–18, 2026 • America/Los_Angeles calendar", fontsize=20, color=MUTED)
total_minutes = sum(w["durationMinutes"] for w in DATA["workouts"])
ax.text(75, 790, f"10 cycling workouts  +  2 runs  =  {total_minutes:.0f} recorded minutes", fontsize=23)
left, width, gap = 75, 195, 14
for i, day in enumerate(days):
    x = left + i * (width + gap)
    stamp = date.fromisoformat(day)
    ax.add_patch(FancyBboxPatch((x, 235), width, 485, boxstyle="round,pad=0,rounding_size=15", facecolor="#182637", edgecolor=GRID, linewidth=1.5))
    ax.text(x+18, 672, stamp.strftime("%a"), fontsize=24, weight="bold")
    ax.text(x+18, 632, f"Oct {stamp.day}", fontsize=19, color=MUTED)
    groups = [(kind, [w for w in workouts[day] if w["activityType"] == kind]) for kind in ["cycling", "running"]]
    y = 535
    for kind, values in groups:
        if not values:
            continue
        color = BLUE if kind == "cycling" else TEAL
        ax.plot([x+18, x+18], [y-65, y+22], color=color, linewidth=5, solid_capstyle="round")
        count = len(values)
        label = f"{count} " + ("rides" if count > 1 else "ride") if kind == "cycling" else f"{count} run"
        ax.text(x+35, y, label, fontsize=22, color=color, weight="bold")
        ax.text(x+35, y-42, f'{sum(w["durationMinutes"] for w in values):.1f} min', fontsize=19)
        y -= 145
    if not workouts[day]:
        ax.text(x+18, 535, "No workout", fontsize=19, color=MUTED)
        ax.text(x+18, 497, "recorded", fontsize=19, color=MUTED)
    count = len(workouts[day])
    ax.text(x+18, 276, f"{count} workout" + ("s" if count != 1 else ""), fontsize=18, color=MUTED)
ax.text(75, 153, "A count of workouts is not a count of active days.", fontsize=23, weight="bold")
ax.text(75, 108, "Sunday has no recorded workout; that does not establish a rest day.", fontsize=19, color=MUTED)
ax.text(75, 58, "Source: selected author records retrieved October 25, 2026. Durations rounded to 0.1 minute.", fontsize=17, color=MUTED)
save(fig, "activity-week.webp")

# Figure 2: both series share the same zero baseline and kcal scale.
fig, ax = plt.subplots(figsize=(16, 11))
fig.subplots_adjust(left=.14, right=.94, top=.76, bottom=.21)
fig.text(.065, .935, "Daily active energy and the ring disagree", fontsize=30, weight="bold")
fig.text(.065, .884, "October 12–18, 2026 • America/Los_Angeles calendar", fontsize=20, color=MUTED)
fig.text(.065, .823, "━  Daily active-energy aggregate", fontsize=20, color=BLUE)
fig.text(.52, .823, "━  Stored Move ring summary", fontsize=20, color=TEAL)
for i, day in enumerate(days):
    if i == 3:
        ax.axhspan(i-.44, i+.44, color=AMBER, alpha=.07, zorder=0)
    ax.barh(i-.16, active[day], height=.23, color=BLUE, zorder=3)
    ax.text(active[day]+18, i-.16, f"{active[day]:,.0f}", va="center", fontsize=18)
    if day in rings:
        ax.barh(i+.16, rings[day], height=.23, color=TEAL, zorder=3)
        ax.text(rings[day]+18, i+.16, f"{rings[day]:,.0f}", va="center", fontsize=18, color=AMBER if i == 3 else INK)
    else:
        ax.text(20, i+.16, "Ring summary unavailable", va="center", fontsize=18, color=MUTED)
ax.set_yticks(range(7), [date.fromisoformat(d).strftime("%a  %b %-d") for d in days], fontsize=18)
ax.set_ylim(6.55, -.55); ax.set_xlim(0, 1750)
ax.set_xticks([0, 400, 800, 1200, 1600], ["0", "400", "800", "1,200", "1,600"], fontsize=18)
ax.set_xlabel("Kilocalories (kcal)", fontsize=19, labelpad=15)
ax.grid(axis="x", color=GRID, linewidth=.8, alpha=.7, zorder=0)
for edge in ["top", "right", "left"]: ax.spines[edge].set_visible(False)
ax.tick_params(axis="y", length=0, pad=15)
fig.text(.065, .116, "Oct 15: 777 kcal in the daily aggregate; 130 kcal in the stored ring.", fontsize=21, color=AMBER)
fig.text(.065, .077, "That ring was last updated at 11:52 a.m. PDT, before the day ended.", fontsize=19, color=INK)
fig.text(.065, .036, "Ring-update metadata was checked after the initial AI response. Missing summaries are not zeros.", fontsize=17, color=MUTED)
save(fig, "active-energy-vs-rings.webp")

# Original social card: excerpt of the same two-series comparison, not a new data set.
fig = plt.figure(figsize=(12, 6.3))
fig.text(.065, .875, "I asked AI about my health week.", fontsize=27, weight="bold")
fig.text(.065, .785, "Then I checked its work.", fontsize=27, weight="bold")
fig.text(.065, .697, "A real Apple Health summary, audited against the records", fontsize=16, color=MUTED)
ax = fig.add_axes([.19, .21, .68, .34])
for i, day in enumerate(days[:4]):
    ax.barh(i-.16, active[day], height=.24, color=BLUE)
    ax.barh(i+.16, rings[day], height=.24, color=TEAL)
ax.set_yticks(range(4), ["Mon 12", "Tue 13", "Wed 14", "Thu 15"], fontsize=15)
ax.set_ylim(3.6, -.6); ax.set_xlim(0, 1800)
ax.set_xticks([0, 800, 1600], ["0", "800", "1,600 kcal"], fontsize=13)
ax.grid(axis="x", color=GRID, alpha=.6); ax.set_axisbelow(True)
for edge in ["top", "right", "left"]: ax.spines[edge].set_visible(False)
ax.tick_params(axis="y", length=0, pad=12)
fig.text(.065, .105, "Active energy", color=BLUE, fontsize=15)
fig.text(.265, .105, "Stored Move ring", color=TEAL, fontsize=15)
fig.text(.92, .105, "PulsHealth", ha="right", color=MUTED, fontsize=15)
save(fig, "social.webp")
print(f"Rendered 3 figures from {len(DATA['workouts'])} workouts; total duration {total_minutes:.3f} minutes.")
