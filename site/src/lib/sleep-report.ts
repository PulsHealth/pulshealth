export type SleepDay = {
  offset: number;
  minutes: number | null;
  awake: number | null;
  rem: number | null;
  deep: number | null;
};
export type SleepMilestone = {
  label: string;
  availableThrough: number;
  days: SleepDay[];
};
export type SleepReport = { milestones: SleepMilestone[] };
export function parseSleepReport(text: string): SleepReport {
  const data = JSON.parse(text);
  if (
    !data ||
    !Array.isArray(data.milestones) ||
    !data.milestones.length ||
    data.milestones.length > 4
  )
    throw new Error("Use one to four relative sleep timelines.");
  return {
    milestones: data.milestones.map((milestone: SleepMilestone, i: number) => {
      if (
        !Number.isInteger(milestone.availableThrough) ||
        milestone.availableThrough < 0 ||
        milestone.availableThrough > 364 ||
        !Array.isArray(milestone.days) ||
        milestone.days.length > 545
      )
        throw new Error("Use daily offsets from -180 to at most 364.");
      const offsets = new Set<number>();
      const days = milestone.days
        .map((day) => {
          if (
            !day ||
            !Number.isInteger(day.offset) ||
            day.offset < -180 ||
            day.offset > milestone.availableThrough ||
            offsets.has(day.offset)
          )
            throw new Error("Sleep days need unique relative offsets.");
          offsets.add(day.offset);
          for (const key of ["minutes", "awake", "rem", "deep"] as const)
            if (
              day[key] !== null &&
              (!Number.isFinite(day[key]) || day[key]! < 0 || day[key]! > 1440)
            )
              throw new Error("Sleep measurements must be minutes or null.");
          return {
            offset: day.offset,
            minutes: day.minutes,
            awake: day.awake,
            rem: day.rem,
            deep: day.deep,
          };
        })
        .sort((a, b) => a.offset - b.offset);
      return {
        label: ["First child", "Second child", "Third child", "Fourth child"][
          i
        ],
        availableThrough: milestone.availableThrough,
        days,
      };
    }),
  };
}
export function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    position = (sorted.length - 1) * fraction,
    lower = Math.floor(position),
    t = position - lower;
  return sorted[lower] * (1 - t) + sorted[Math.ceil(position)] * t;
}
export function sleepPeriod(
  milestone: SleepMilestone,
  start: number,
  end: number,
) {
  const available = Math.max(
    0,
    Math.min(end, milestone.availableThrough + 1) - start,
  );
  const days = milestone.days.filter(
      (day) => day.offset >= start && day.offset < end && day.minutes !== null,
    ),
    values = days.map((day) => day.minutes!);
  const knownAwake = days.flatMap((day) =>
    day.awake === null ? [] : [day.awake],
  );
  return {
    count: values.length,
    available,
    median: quantile(values, 0.5),
    lower: quantile(values, 0.25),
    upper: quantile(values, 0.75),
    short: values.length
      ? (values.filter((v) => v < 360).length / values.length) * 100
      : null,
    awake: quantile(knownAwake, 0.5),
    awakeCount: knownAwake.length,
  };
}
export const sleepTime = (minutes: number | null) =>
  minutes === null
    ? "—"
    : `${Math.floor(Math.round(minutes) / 60)}h ${String(Math.round(minutes) % 60).padStart(2, "0")}m`;
