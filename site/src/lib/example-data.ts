/** Generated fallback fixtures and validation for local health exports. */
export type Activity = "Running" | "Walking" | "Cycling" | "Other";
export type RaceMetrics = {
  heartRate?: number;
  powerW?: number;
  steps?: number;
  activeKcal?: number;
  strideM?: number;
  groundContactMs?: number;
  verticalCm?: number;
};
export type ExampleWorkout = {
  id: string;
  date: string;
  activity: Activity;
  sport?: string;
  metrics?: RaceMetrics;
  distanceM: number | null;
  durationS: number;
  route?: { lat: number; lon: number }[];
};
export type ExampleData = {
  label: string;
  year: number;
  raceDate: string;
  timeZone?: string;
  raceId?: string;
  workouts: ExampleWorkout[];
  daily?: {
    date: string;
    steps: number | null;
    sleepMinutes: number | null;
    restingHR: number | null;
    hrv: number | null;
    activeKcal: number | null;
    exerciseMinutes: number | null;
  }[];
};
export const ACTIVITY_COLORS: Record<Activity, string> = {
  Running: "#68c7ff",
  Walking: "#d7b8ff",
  Cycling: "#ffd182",
  Other: "#a4b5c7",
};
export const ACTIVITIES: Activity[] = [
  "Running",
  "Walking",
  "Cycling",
  "Other",
];
export function sampleData(): ExampleData {
  const workouts: ExampleWorkout[] = [];
  for (let day = 0; day < 365; day++) {
    if (day % 7 !== 1 && day % 7 !== 3 && day % 7 !== 5 && day % 11 !== 0)
      continue;
    const activity = ACTIVITIES[day % 7 === 5 ? 2 : day % 11 === 0 ? 1 : 0];
    const date = new Date(Date.UTC(2025, 0, day + 1))
      .toISOString()
      .slice(0, 10);
    const raceDay = 291;
    const trainingWeek = Math.floor((day - 180) / 7);
    if (
      activity === "Running" &&
      (trainingWeek === 3 || trainingWeek === 9) &&
      day < raceDay
    )
      continue;
    const inTraining = trainingWeek >= 0 && trainingWeek < 16 && day < raceDay;
    const distanceM =
      inTraining && activity === "Running"
        ? day % 7 === 3
          ? 9000 + Math.min(trainingWeek, 11) * 1500
          : 5000 + (trainingWeek % 4) * 800
        : activity === "Cycling"
          ? 14000 + (day % 8) * 1600
          : activity === "Walking"
            ? 2000 + (day % 5) * 600
            : 4500 + (day % 9) * 900;
    const route = Array.from({ length: 65 }, (_, point) => {
      const t = (point / 64) * Math.PI * 2;
      const radius = 0.009 + (day % 9) * 0.002;
      return {
        lat:
          0.04 +
          Math.sin(t) * radius +
          Math.sin(t * 3 + day) * 0.002 +
          (day % 5) * 0.003,
        lon:
          0.04 +
          Math.cos(t) * radius * (activity === "Cycling" ? 1.8 : 1) +
          Math.sin(t * 2 + day) * 0.004 +
          (day % 7) * 0.003,
      };
    });
    workouts.push({
      id: `synthetic-${day}`,
      date,
      activity,
      distanceM,
      durationS: Math.round(
        distanceM /
          (activity === "Cycling" ? 5.8 : activity === "Walking" ? 1.3 : 2.8),
      ),
      route: day % 3 === 0 ? undefined : route,
    });
  }
  // A missing-distance record demonstrates that absence is never treated as zero.
  workouts.push({
    id: "synthetic-missing-distance",
    date: "2025-04-01",
    activity: "Running",
    distanceM: null,
    durationS: 1800,
  });
  workouts.push({
    id: "synthetic-race",
    date: "2025-10-19",
    activity: "Running",
    distanceM: 42195,
    durationS: 14520,
  });
  return {
    label: "Synthetic example",
    year: 2025,
    raceDate: "2025-10-19",
    raceId: "synthetic-race",
    workouts,
  };
}
export function parseExampleData(text: string): ExampleData {
  const data = JSON.parse(text);
  if (
    !data ||
    !Number.isInteger(data.year) ||
    data.year < 1900 ||
    data.year > 2200 ||
    !validDate(data.raceDate) ||
    !Array.isArray(data.workouts) ||
    !data.workouts.length ||
    data.workouts.length > 5000
  )
    throw new Error(
      "Use a showcase JSON file with a year, raceDate, and 1–5,000 workouts.",
    );
  if (data.timeZone !== undefined) {
    if (typeof data.timeZone !== "string")
      throw new Error("timeZone must be an IANA zone name.");
    new Intl.DateTimeFormat("en", { timeZone: data.timeZone });
  }
  if (data.daily !== undefined) {
    if (!Array.isArray(data.daily) || data.daily.length > 366)
      throw new Error("Use at most 366 daily summaries.");
    const dates = new Set<string>();
    for (const day of data.daily) {
      if (!day || !validDate(day.date) || dates.has(day.date))
        throw new Error("Daily summaries need unique calendar dates.");
      dates.add(day.date);
      for (const key of [
        "steps",
        "sleepMinutes",
        "restingHR",
        "hrv",
        "activeKcal",
        "exerciseMinutes",
      ]) {
        if (day[key] !== null && (!Number.isFinite(day[key]) || day[key] < 0))
          throw new Error("Daily values must be nonnegative numbers or null.");
      }
    }
  }
  let points = 0;
  const ids = new Set<string>();
  for (const w of data.workouts) {
    if (
      !w ||
      typeof w.id !== "string" ||
      !w.id ||
      ids.has(w.id) ||
      !validDate(w.date) ||
      !ACTIVITIES.includes(w.activity) ||
      (w.sport !== undefined &&
        (typeof w.sport !== "string" || w.sport.length > 50)) ||
      (w.distanceM !== null &&
        (!Number.isFinite(w.distanceM) || w.distanceM < 0)) ||
      !Number.isFinite(w.durationS) ||
      w.durationS < 0
    )
      throw new Error(
        "Check workout IDs, dates, activity names, distances, and durations. IDs must be unique; missing distance must be null.",
      );
    if (w.metrics !== undefined) {
      if (
        !w.metrics ||
        typeof w.metrics !== "object" ||
        Array.isArray(w.metrics)
      )
        throw new Error("Workout metrics must be an object.");
      for (const key of [
        "heartRate",
        "powerW",
        "steps",
        "activeKcal",
        "strideM",
        "groundContactMs",
        "verticalCm",
      ])
        if (
          w.metrics[key] !== undefined &&
          (!Number.isFinite(w.metrics[key]) || w.metrics[key] < 0)
        )
          throw new Error(
            "Workout metrics must be nonnegative finite numbers.",
          );
    }
    ids.add(w.id);
    if (w.route !== undefined) {
      if (
        !Array.isArray(w.route) ||
        w.route.some(
          (p: { lat: number; lon: number }) =>
            !p ||
            !Number.isFinite(p.lat) ||
            !Number.isFinite(p.lon) ||
            Math.abs(p.lat) > 90 ||
            Math.abs(p.lon) > 180,
        )
      )
        throw new Error("Route points need valid lat and lon coordinates.");
      points += w.route.length;
    }
  }
  if (points > 200000)
    throw new Error("Use at most 200,000 route points per file.");
  if (
    data.raceId !== undefined &&
    (typeof data.raceId !== "string" || !ids.has(data.raceId))
  )
    throw new Error("raceId must identify a workout in this file.");
  return { ...data, label: "Your local file" };
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function trainingWeeks(data: ExampleData) {
  // Calendar dates are already assigned by the export adapter's reporting zone.
  const race = Date.parse(`${data.raceDate}T00:00:00Z`);
  const weekday = (new Date(race).getUTCDay() + 6) % 7;
  const first = race - (weekday + 15 * 7) * 86400000;
  return Array.from({ length: 16 }, (_, index) => {
    const start = first + index * 7 * 86400000;
    const runs = data.workouts.filter(
      (w) =>
        w.activity === "Running" &&
        w.id !== data.raceId &&
        Date.parse(w.date) >= start &&
        Date.parse(w.date) < start + 7 * 86400000 &&
        w.date <= data.raceDate,
    );
    const known = runs.flatMap((w) =>
      w.distanceM === null ? [] : [w.distanceM / 1000],
    );
    return {
      date: new Date(start).toISOString().slice(0, 10),
      count: runs.length,
      km: runs.reduce((n, w) => n + (w.distanceM ?? 0) / 1000, 0),
      longest: known.length ? Math.max(...known) : null,
      missing: runs.filter((w) => w.distanceM === null).length,
    };
  });
}
/** Adapted from route-art's shared-bounds route compositor; adds longitude correction. */
export function routePaths(workouts: ExampleWorkout[], tiled: boolean) {
  const valid = workouts
    .filter((w) => w.route && w.route.length > 1)
    .slice(0, 500);
  function fit(
    routes: ExampleWorkout[],
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    const points = routes.flatMap((w) => w.route!);
    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
    const correction = Math.max(
      0.01,
      Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180),
    );
    const dx = (maxLon - minLon) * correction,
      dy = maxLat - minLat;
    const scale = Math.min(width / (dx || 1e-8), height / (dy || 1e-8));
    return routes.map((w) => ({
      id: w.id,
      activity: w.activity,
      d: w
        .route!.map(
          (p, i) =>
            `${i ? "L" : "M"}${(x + (width - dx * scale) / 2 + (p.lon - minLon) * correction * scale).toFixed(2)},${(y + (height - dy * scale) / 2 + (maxLat - p.lat) * scale).toFixed(2)}`,
        )
        .join(" "),
    }));
  }
  if (!valid.length) return [];
  if (!tiled) return fit(valid, 40, 30, 640, 360);
  const selected = valid.slice(0, 24);
  return selected.flatMap((w, i) =>
    fit([w], 24 + (i % 6) * 116, 18 + Math.floor(i / 6) * 100, 88, 72),
  );
}
