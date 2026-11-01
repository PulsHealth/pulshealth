export type SleepStage =
  "core" | "deep" | "rem" | "awake" | "unspecified" | "unknown";
export type SleepSegment = { start: number; end: number; stage: SleepStage };
export const SLEEP_COLORS: Record<SleepStage, string> = {
  awake: "#f5c985",
  rem: "#d7b8ff",
  core: "#74c9ff",
  deep: "#6174ef",
  unspecified: "#8ca4b8",
  unknown: "#2b3b4e",
};
export type SleepDay = {
  core?: number | null;
  unspecified?: number | null;
  segments?: SleepSegment[];
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
  if (!data || !Array.isArray(data.milestones) || data.milestones.length !== 1)
    throw new Error("Use one relative before-and-after sleep timeline.");
  return {
    milestones: data.milestones.map((milestone: SleepMilestone) => {
      if (
        !Number.isInteger(milestone.availableThrough) ||
        milestone.availableThrough < -1 ||
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
          let segments: SleepSegment[] | undefined;
          if (day.segments !== undefined) {
            if (!Array.isArray(day.segments) || day.segments.length > 500)
              throw new Error("Use at most 500 stage intervals per night.");
            let end = 0;
            segments = day.segments.map((segment) => {
              if (
                !segment ||
                !Object.hasOwn(SLEEP_COLORS, segment.stage) ||
                !Number.isFinite(segment.start) ||
                !Number.isFinite(segment.end) ||
                segment.start < end ||
                segment.start < 0 ||
                segment.end <= segment.start ||
                segment.end > 1440
              )
                throw new Error(
                  "Stage intervals need valid stages and nonoverlapping elapsed minutes.",
                );
              end = segment.end;
              return {
                start: segment.start,
                end: segment.end,
                stage: segment.stage,
              };
            });
            const asleep = segments
              .filter((segment) =>
                ["core", "deep", "rem", "unspecified"].includes(segment.stage),
              )
              .reduce((sum, segment) => sum + segment.end - segment.start, 0);
            if (
              segments.length &&
              (day.minutes === null || Math.abs(asleep - day.minutes) > 0.15)
            )
              throw new Error(
                "Stage sleep duration must reconcile with the nightly duration.",
              );
          }
          return {
            ...(segments ? { segments } : {}),
            offset: day.offset,
            minutes: day.minutes,
            awake: day.awake,
            rem: day.rem,
            deep: day.deep,
          };
        })
        .sort((a, b) => a.offset - b.offset);
      return {
        label: "Before & after",
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
  minimumAwake = 1,
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
  const nights = days.map((day) => sleepNight(day, minimumAwake));
  const known = nights.filter((night) => night.episodes !== null);
  const episodes = known.flatMap((night) => night.episodeLengths);
  return {
    episodes: quantile(
      known.map((night) => night.episodes!),
      0.5,
    ),
    episodeCoverage: known.length,
    awakeDuringSleep: quantile(
      known.map((night) => night.awakeMinutes!),
      0.5,
    ),
    episodeLength: quantile(episodes, 0.5),
    longestWake: quantile(
      known.map((night) => night.longestWake!),
      0.5,
    ),
    longestSleep: quantile(
      nights.flatMap((night) =>
        night.longestSleep === null ? [] : [night.longestSleep],
      ),
      0.5,
    ),
    core: quantile(
      nights.flatMap((night) => (night.core === null ? [] : [night.core])),
      0.5,
    ),
    rem: quantile(
      nights.flatMap((night) => (night.rem === null ? [] : [night.rem])),
      0.5,
    ),
    deep: quantile(
      nights.flatMap((night) => (night.deep === null ? [] : [night.deep])),
      0.5,
    ),
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

/** Recorded awake periods between first and last sleep; unobserved gaps never become awakenings. */
export function sleepNight(day: SleepDay, minimumAwake = 1) {
  const segments = day.segments ?? [];
  const sleeping = segments.filter((s) =>
    ["core", "deep", "rem", "unspecified"].includes(s.stage),
  );
  const coverage =
    segments.some((s) => ["core", "deep", "rem", "awake"].includes(s.stage)) &&
    sleeping.length > 0;
  const onset = sleeping[0]?.start ?? 0,
    finish = sleeping.at(-1)?.end ?? 0;
  const awake: { start: number; end: number }[] = [];
  for (const segment of segments.filter(
    (s) => s.stage === "awake" && s.start >= onset && s.end <= finish,
  )) {
    const previous = awake.at(-1);
    if (previous && segment.start - previous.end <= 0.001)
      previous.end = segment.end;
    else awake.push({ start: segment.start, end: segment.end });
  }
  const episodeLengths = awake
    .map((s) => s.end - s.start)
    .filter((minutes) => minutes + 1e-6 >= minimumAwake);
  let longest = 0,
    length = 0,
    end = -Infinity;
  for (const segment of sleeping) {
    length =
      segment.start - end <= 0.001
        ? length + segment.end - segment.start
        : segment.end - segment.start;
    end = segment.end;
    longest = Math.max(longest, length);
  }
  const stageMinutes = (stage: SleepStage) =>
    segments.some((s) => ["core", "deep", "rem"].includes(s.stage))
      ? segments
          .filter((s) => s.stage === stage)
          .reduce((sum, s) => sum + s.end - s.start, 0)
      : null;
  return {
    episodes: coverage ? episodeLengths.length : null,
    episodeLengths: coverage ? episodeLengths : [],
    awakeMinutes: coverage
      ? awake.reduce((sum, s) => sum + s.end - s.start, 0)
      : null,
    longestWake: coverage ? Math.max(0, ...episodeLengths) : null,
    longestSleep: sleeping.length ? longest : null,
    core: stageMinutes("core"),
    rem: stageMinutes("rem"),
    deep: stageMinutes("deep"),
  };
}
export const relativeNight = (offset: number) =>
  `Night ${offset < 0 ? -offset : offset + 1} ${offset < 0 ? "before" : "after"}`;
