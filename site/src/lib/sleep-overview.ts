import {
  sleepNight,
  sleepPeriod,
  type SleepMilestone,
  type SleepStage,
} from "./sleep-report";

export function sleepOverview(milestone: SleepMilestone, window: number) {
  const groups = [
    milestone.days.filter(
      (day) => day.offset >= -window && day.offset < 0 && day.minutes !== null,
    ),
    milestone.days.filter(
      (day) => day.offset >= 0 && day.offset < window && day.minutes !== null,
    ),
  ];
  const domain = Math.max(
    720,
    ...groups.flat().map((day) => Math.ceil(day.minutes! / 60) * 60),
  );
  const series = groups.map((days, index) => {
    const nights = days.map((day) => sleepNight(day, 1));
    const summary = sleepPeriod(
      milestone,
      index ? 0 : -window,
      index ? window : 0,
      1,
    );
    const density = Array.from({ length: 85 }, (_, i) => {
      const minutes = (i / 84) * domain;
      // A common 25-minute Gaussian bandwidth and per-group normalization
      // keep distributions comparable when recorded-night counts differ.
      const value = days.length
        ? days.reduce(
            (sum, day) =>
              sum + Math.exp(-0.5 * ((minutes - day.minutes!) / 25) ** 2),
            0,
          ) /
          (days.length * 25 * Math.sqrt(2 * Math.PI))
        : 0;
      return { minutes, value };
    });
    function buckets(values: number[], edges: number[]) {
      return edges
        .slice(1)
        .map((edge, i) =>
          values.length
            ? (values.filter((value) => value >= edges[i] && value < edge)
                .length /
                values.length) *
              100
            : null,
        );
    }
    const stageMinutes: Record<SleepStage, number> = {
      awake: 0,
      rem: 0,
      core: 0,
      deep: 0,
      unspecified: 0,
      unknown: 0,
    };
    for (const day of days)
      for (const segment of day.segments ?? [])
        stageMinutes[segment.stage] += segment.end - segment.start;
    const total = Object.entries(stageMinutes)
      .filter(([stage]) => stage !== "unknown")
      .reduce((sum, [, value]) => sum + value, 0);
    return {
      label: index ? "After" : "Before",
      summary,
      density,
      awake: buckets(
        nights.flatMap((night) =>
          night.awakeMinutes === null ? [] : [night.awakeMinutes],
        ),
        [0, 10, 30, 60, 120, Infinity],
      ),
      episodes: buckets(
        nights.flatMap((night) =>
          night.episodes === null ? [] : [night.episodes],
        ),
        [0, 3, 6, 9, Infinity],
      ),
      stages: Object.fromEntries(
        Object.entries(stageMinutes)
          .filter(([stage]) => stage !== "unknown")
          .map(([stage, value]) => [
            stage,
            total ? (value / total) * 100 : null,
          ]),
      ) as Record<Exclude<SleepStage, "unknown">, number | null>,
    };
  });
  const periods = [
    {
      label: window <= 7 ? "First week" : "First 2 weeks",
      start: 0,
      end: Math.min(window, 14),
    },
    { label: "Rest of month 1", start: 14, end: Math.min(window, 30) },
    { label: "Month 2", start: 30, end: Math.min(window, 60) },
    { label: "Month 3", start: 60, end: Math.min(window, 90) },
  ].filter((period) => period.end > period.start);
  const progression = [
    { label: "Before", summary: series[0].summary },
    ...periods.map((period) => ({
      label: period.label,
      summary: sleepPeriod(milestone, period.start, period.end, 1),
    })),
  ];
  return { series, domain, progression };
}
