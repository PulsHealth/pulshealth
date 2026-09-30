import type { RangeKey } from "./types";

// HealthKit aggregationStyle isn't ported to the web catalog, so we classify
// cumulative ("how much over the period" → sum) vs discrete ("what was the
// reading" → avg) by identifier. Substring match keeps this robust as the
// catalog grows.
const CUMULATIVE_HINTS = [
  "StepCount",
  "DistanceWalkingRunning",
  "DistanceCycling",
  "DistanceSwimming",
  "DistanceWheelchair",
  "DistanceDownhillSnowSports",
  "DistanceCrossCountrySkiing",
  "DistancePaddleSports",
  "DistanceRowing",
  "DistanceSkatingSports",
  "FlightsClimbed",
  "ActiveEnergyBurned",
  "BasalEnergyBurned",
  "AppleExerciseTime",
  "AppleStandTime",
  "AppleMoveTime",
  "SwimmingStrokeCount",
  "PushCount",
  "NikeFuel",
  "NumberOfTimesFallen",
  "NumberOfAlcoholicBeverages",
  "Dietary",
  "InhalerUsage",
  // Not UVExposure: HealthKit's aggregation style for it is discrete (a UV
  // index reading), so summing readings per day is meaningless.
  "TimeInDaylight",
  "AppleSleepingBreathingDisturbances",
];

export function isCumulative(identifier: string): boolean {
  return CUMULATIVE_HINTS.some((h) => identifier.includes(h));
}

export function defaultAgg(identifier: string): "sum" | "avg" {
  return isCumulative(identifier) ? "sum" : "avg";
}

export interface RangeSpec {
  key: RangeKey;
  label: string;
  /** how far back from now, in ms; null for ALL, which starts at the earliest sample */
  spanMs: number | null;
  /** Postgres time_bucket interval literal (ALL's is resolved per series; see resolvePresetWindow) */
  bucket: string;
  bucketMs: number;
}

const HOUR = 3600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

/** A bucket that keeps a chart of `durationMs` to roughly 30–90 points. */
export function bucketForDuration(durationMs: number): {
  bucket: string;
  bucketMs: number;
} {
  if (durationMs <= 90 * DAY) return { bucket: "1 day", bucketMs: DAY };
  if (durationMs <= 365 * DAY) return { bucket: "1 week", bucketMs: WEEK };
  if (durationMs <= 730 * DAY) return { bucket: "2 weeks", bucketMs: 14 * DAY };
  if (durationMs <= 1825 * DAY) return { bucket: "1 month", bucketMs: MONTH };
  return { bucket: "3 months", bucketMs: 90 * DAY };
}

export const RANGES: Record<RangeKey, RangeSpec> = {
  D: { key: "D", label: "Day", spanMs: DAY, bucket: "1 hour", bucketMs: HOUR },
  "7D": { key: "7D", label: "7 Days", spanMs: 7 * DAY, bucket: "1 day", bucketMs: DAY },
  "30D": { key: "30D", label: "30 Days", spanMs: 30 * DAY, bucket: "1 day", bucketMs: DAY },
  "90D": { key: "90D", label: "90 Days", spanMs: 90 * DAY, bucket: "1 day", bucketMs: DAY },
  "6M": { key: "6M", label: "6 Months", spanMs: 182 * DAY, bucket: "1 week", bucketMs: WEEK },
  Y: { key: "Y", label: "1 Year", spanMs: 365 * DAY, bucket: "1 week", bucketMs: WEEK },
  "2Y": { key: "2Y", label: "2 Years", spanMs: 730 * DAY, bucket: "2 weeks", bucketMs: 14 * DAY },
  "5Y": { key: "5Y", label: "5 Years", spanMs: 1825 * DAY, bucket: "1 month", bucketMs: MONTH },
  ALL: { key: "ALL", label: "All Time", spanMs: null, bucket: "3 months", bucketMs: 90 * DAY },
};

export const RANGE_ORDER: RangeKey[] = ["D", "7D", "30D", "90D", "6M", "Y", "2Y", "5Y", "ALL"];

// Links from before PR #70 used W (week) and M (month); they are the same
// windows as 7D and 30D.
const RANGE_ALIASES: Record<string, RangeKey> = { W: "7D", M: "30D" };

export function parseRange(v: string | null | undefined): RangeKey {
  if (v && (RANGE_ORDER as string[]).includes(v)) return v as RangeKey;
  return (v && RANGE_ALIASES[v]) || "7D";
}

/** Where a preset's chart starts, and its bucket. */
export interface SeriesWindow {
  start: Date;
  bucket: string;
  bucketMs: number;
}

/**
 * The window a preset covers at `now`. ALL starts at the series' earliest
 * sample and picks its bucket from that span, so a year of data is not four
 * quarterly bars; with no sample at all there is no window (null).
 */
export function resolvePresetWindow(
  range: RangeKey,
  now: Date,
  earliestMs?: number | null,
): SeriesWindow | null {
  const spec = RANGES[range];
  if (spec.spanMs != null) {
    return { start: new Date(now.getTime() - spec.spanMs), bucket: spec.bucket, bucketMs: spec.bucketMs };
  }
  if (earliestMs == null) return null;
  return { start: new Date(earliestMs), ...bucketForDuration(now.getTime() - earliestMs) };
}

/**
 * A chart window between two calendar dates in the viewer's zone: `fromDate`
 * inclusive, `toDate` inclusive (so the query ends before `endExclusive`).
 * getSeries accepts one in place of a preset. No page offers it yet: the
 * range selector and `?range=` only name presets.
 */
export interface CustomSeriesWindow {
  fromDate: string;
  toDate: string;
  endExclusive: string;
  bucket: string;
  bucketMs: number;
}

export function resolveCustomWindow(
  fromDate: string,
  toDate: string,
): CustomSeriesWindow {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  const isValidDate = (value: string): boolean => {
    if (!datePattern.test(value)) return false;

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  };

  if (!isValidDate(fromDate) || !isValidDate(toDate)) {
    throw new Error("Invalid custom date range");
  }

  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  const durationMs = to.getTime() - from.getTime() + DAY;

  if (!Number.isFinite(durationMs) || durationMs < DAY) {
    throw new Error("Invalid custom date range");
  }

  const { bucket, bucketMs } = bucketForDuration(durationMs);

  return {
    fromDate,
    toDate,
    endExclusive: new Date(to.getTime() + DAY).toISOString().slice(0, 10),
    bucket,
    bucketMs,
  };
}
