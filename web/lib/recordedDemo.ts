// Optional private, local-only preview. The snapshot is never imported into
// the bundle or checked into source control. Production uses the database.
import { readFileSync } from "node:fs";
import { typeByIdentifier } from "./catalog";
import { isCumulative, RANGES, resolvePresetWindow } from "./metrics";
import type { ActivityRingsData, Latest, RangeKey, Series, SeriesPoint, TypeStat, WorkoutDetail, WorkoutSeries } from "./types";

export interface RecordedDemo {
  version: 1;
  generatedAt: number;
  today: number;
  timeZone: string;
  workouts: WorkoutDetail[];
  workoutSeries: Record<string, WorkoutSeries[]>;
  daily: Record<string, SeriesPoint[]>;
  hourly: Record<string, SeriesPoint[]>;
  latest: Record<string, Latest>;
  stats: TypeStat[];
  rings: ActivityRingsData;
}

let cached: { path: string; data: RecordedDemo } | undefined;
export function recordedDemo(): RecordedDemo | null {
  const path = process.env.PULS_DEMO_PREVIEW_FILE;
  if (!path || process.env.NODE_ENV === "production") return null;
  if (cached?.path === path) return cached.data;
  const data = JSON.parse(readFileSync(path, "utf8")) as RecordedDemo;
  if (data.version !== 1 || !Array.isArray(data.workouts) || !data.daily || !data.hourly || !data.latest || !data.rings) {
    throw new Error("Invalid private demo snapshot");
  }
  cached = { path, data };
  return data;
}

export function recordedSeries(data: RecordedDemo, identifier: string, range: RangeKey): Series {
  const spec = RANGES[range];
  const summed = isCumulative(identifier) || identifier.startsWith("HKCategory");
  const raw = (range === "D" ? data.hourly : data.daily)[identifier] ?? [];
  const window = resolvePresetWindow(range, new Date(), raw[0]?.t);
  const bucketMs = window?.bucketMs ?? spec.bucketMs;
  const cutoff = window?.start.getTime() ?? Infinity;
  const calendar = new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, year: "numeric", month: "numeric", day: "numeric" });
  const groups = new Map<string, SeriesPoint[]>();
  for (const p of raw) {
    if (p.t < cutoff - bucketMs) continue;
    const parts = Object.fromEntries(calendar.formatToParts(p.t).map(p => [p.type, Number(p.value)]));
    const day = Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
    // Daily instants already represent local midnights. Group longer ranges
    // by local calendar dates, never by elapsed 24-hour periods across DST.
    const bucket = bucketMs <= 86_400_000 ? String(p.t)
      : bucketMs >= 30 * 86_400_000 ? `month-${Math.floor((parts.year * 12 + parts.month - 1) / Math.round(bucketMs / (30 * 86_400_000)))}`
      : `week-${Math.floor((day + 3) / Math.round(bucketMs / 86_400_000))}`;
    const list = groups.get(bucket) ?? [];
    list.push(p);
    groups.set(bucket, list);
  }
  const points = [...groups.values()].map((list) => {
    const t = list[0].t;
    const count = list.reduce((n, p) => n + p.count, 0);
    return { t, count, value: summed ? list.reduce((n, p) => n + p.value, 0) : list.reduce((n, p) => n + p.value * p.count, 0) / count,
      min: summed ? null : Math.min(...list.map(p => p.min ?? p.value)),
      max: summed ? null : Math.max(...list.map(p => p.max ?? p.value)) };
  }).sort((a, b) => a.t - b.t);
  return { identifier, agg: summed ? "sum" : "avg", unit: identifier.endsWith("SleepAnalysis") ? "h" : typeByIdentifier(identifier)?.unit ?? null, bucketMs, points };
}
