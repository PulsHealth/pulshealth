import {
  ACTIVITIES,
  routePaths,
  trainingWeeks,
  type Activity,
  type ExampleData,
} from "./example-data";
export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export type ReportDay = {
  day: number;
  steps: number | null;
  sleepMinutes: number | null;
  restingHR: number | null;
  hrv: number | null;
  activeKcal: number | null;
  exerciseMinutes: number | null;
  workouts: number;
};
export type ReportRoute = {
  id: string;
  activity: Activity;
  month: number;
  km: number | null;
  minutes: number;
  path: string;
  shape: string;
};
export type ReportRun = {
  week: number;
  weekday: number;
  km: number | null;
  minutes: number;
};
export type ReportWeek = {
  week: number;
  count: number;
  km: number;
  longest: number | null;
  missing: number;
};
export type Report = {
  year: number;
  totals: {
    workouts: number;
    hours: number;
    km: number;
    missing: number;
    activeDays: number;
  };
  months: {
    label: string;
    distances: number[];
    workouts: number;
    hours: number;
  }[];
  sports: { name: string; count: number; hours: number; km: number }[];
  days: ReportDay[];
  weeks: ReportWeek[];
  runs: ReportRun[];
  race: { km: number | null; minutes: number } | null;
  raceExcluded: boolean;
  routes: ReportRoute[];
  routeCoverage: { workouts: number; withRoutes: number; localRoutes: number };
};
export function mean(values: (number | null)[]): number | null {
  const known = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  return known.length ? known.reduce((n, v) => n + v, 0) / known.length : null;
}
export function yearMetrics(report: Report) {
  const steps = report.days.filter((d) => d.steps !== null);
  const sleep = report.days.filter((d) => d.sleepMinutes !== null);
  const heart = report.days.filter((d) => d.restingHR !== null);
  return {
    steps: steps.length ? steps.reduce((n, d) => n + d.steps!, 0) : null,
    stepDays: steps.length,
    avgSteps: mean(steps.map((d) => d.steps)),
    maxSteps: steps.length ? Math.max(...steps.map((d) => d.steps!)) : null,
    sleepMinutes: mean(sleep.map((d) => d.sleepMinutes)),
    sleepDays: sleep.length,
    eightHours: sleep.filter((d) => d.sleepMinutes! >= 480).length,
    restingHR: mean(heart.map((d) => d.restingHR)),
    heartDays: heart.length,
    hrv: mean(report.days.map((d) => d.hrv)),
    exerciseMinutes: report.days.some((d) => d.exerciseMinutes !== null)
      ? report.days.reduce((n, d) => n + (d.exerciseMinutes ?? 0), 0)
      : null,
    activeKcal: report.days.some((d) => d.activeKcal !== null)
      ? report.days.reduce((n, d) => n + (d.activeKcal ?? 0), 0)
      : null,
    tenKDays: steps.filter((d) => d.steps! >= 10000).length,
  };
}
export function monthlyHealth(
  report: Report,
  field: keyof Omit<ReportDay, "day" | "workouts">,
) {
  return MONTH_NAMES.map((_, month) =>
    mean(
      report.days
        .filter(
          (d) =>
            new Date(Date.UTC(report.year, 0, d.day + 1)).getUTCMonth() ===
            month,
        )
        .map((d) => d[field]),
    ),
  );
}
export function buildReport(data: ExampleData, localOnly = false): Report {
  const selected = data.workouts.filter((w) =>
    w.date.startsWith(`${data.year}-`),
  );
  const yearStart = Date.UTC(data.year, 0, 1),
    dayCount = (Date.UTC(data.year + 1, 0, 1) - yearStart) / 86400000;
  const daily = new Map((data.daily ?? []).map((d) => [d.date, d]));
  const days: ReportDay[] = Array.from({ length: dayCount }, (_, day) => {
    const date = new Date(yearStart + day * 86400000)
      .toISOString()
      .slice(0, 10);
    const d = daily.get(date);
    return {
      day,
      steps: d?.steps ?? null,
      sleepMinutes: d?.sleepMinutes ?? null,
      restingHR: d?.restingHR ?? null,
      hrv: d?.hrv ?? null,
      activeKcal: d?.activeKcal ?? null,
      exerciseMinutes: d?.exerciseMinutes ?? null,
      workouts: selected.filter((w) => w.date === date).length,
    };
  });
  const weeksRaw = trainingWeeks(data),
    first = Date.parse(weeksRaw[0].date);
  const runs = data.workouts
    .filter(
      (w) =>
        w.activity === "Running" &&
        w.id !== data.raceId &&
        Date.parse(w.date) >= first &&
        w.date <= data.raceDate,
    )
    .map((w) => ({
      week: Math.floor((Date.parse(w.date) - first) / 86400000 / 7),
      weekday: (new Date(w.date).getUTCDay() + 6) % 7,
      km: w.distanceM === null ? null : w.distanceM / 1000,
      minutes: w.durationS / 60,
    }));
  const race = data.workouts.find((w) => w.id === data.raceId);
  const routed = selected.filter((w) => w.route && w.route.length > 1);
  let local = routed;
  if (localOnly && routed.length) {
    const buckets = new Map<string, typeof routed>();
    for (const w of routed) {
      const p = w.route![0],
        key = `${Math.floor(p.lat * 4)},${Math.floor(p.lon * 4)}`;
      buckets.set(key, [...(buckets.get(key) ?? []), w]);
    }
    const main = [...buckets.values()].sort((a, b) => b.length - a.length)[0],
      anchor = main[0].route![0];
    local = routed.filter((w) =>
      w.route!.every(
        (p) =>
          Math.abs(p.lat - anchor.lat) < 0.25 &&
          Math.abs(p.lon - anchor.lon) < 0.25,
      ),
    );
  }
  const byActivity = ACTIVITIES.map((a) =>
    local.filter((w) => w.activity === a),
  );
  const mixed = Array.from(
    { length: Math.max(0, ...byActivity.map((w) => w.length)) },
    (_, i) => byActivity.flatMap((w) => w.slice(i, i + 1)),
  )
    .flat()
    .slice(0, 500);
  const paths = routePaths(mixed, false);
  const sportNames = [...new Set(selected.map((w) => w.sport ?? w.activity))];
  return {
    year: data.year,
    totals: {
      workouts: selected.length,
      hours: selected.reduce((n, w) => n + w.durationS, 0) / 3600,
      km: selected.reduce((n, w) => n + (w.distanceM ?? 0) / 1000, 0),
      missing: selected.filter((w) => w.distanceM === null).length,
      activeDays: new Set(selected.map((w) => w.date)).size,
    },
    months: MONTH_NAMES.map((label, i) => {
      const workouts = selected.filter(
        (w) => Number(w.date.slice(5, 7)) === i + 1,
      );
      return {
        label,
        distances: ACTIVITIES.map((a) =>
          workouts
            .filter((w) => w.activity === a)
            .reduce((n, w) => n + (w.distanceM ?? 0) / 1000, 0),
        ),
        workouts: workouts.length,
        hours: workouts.reduce((n, w) => n + w.durationS, 0) / 3600,
      };
    }),
    sports: sportNames
      .map((name) => {
        const ws = selected.filter((w) => (w.sport ?? w.activity) === name);
        return {
          name,
          count: ws.length,
          hours: ws.reduce((n, w) => n + w.durationS, 0) / 3600,
          km: ws.reduce((n, w) => n + (w.distanceM ?? 0) / 1000, 0),
        };
      })
      .sort((a, b) => b.hours - a.hours),
    days,
    weeks: weeksRaw.map((w, week) => ({
      week,
      count: w.count,
      km: w.km,
      longest: w.longest,
      missing: w.missing,
    })),
    runs,
    raceExcluded: !!race,
    race: race
      ? {
          km: race.distanceM === null ? null : race.distanceM / 1000,
          minutes: race.durationS / 60,
        }
      : null,
    routes: paths.map((p, i) => ({
      id: `route-${i + 1}`,
      activity: p.activity,
      month: Number(mixed[i].date.slice(5, 7)),
      km: mixed[i].distanceM === null ? null : mixed[i].distanceM! / 1000,
      minutes: mixed[i].durationS / 60,
      path: p.d,
      shape: routePaths([mixed[i]], true)[0].d,
    })),
    routeCoverage: {
      workouts: selected.length,
      withRoutes: routed.length,
      localRoutes: mixed.length,
    },
  };
}
