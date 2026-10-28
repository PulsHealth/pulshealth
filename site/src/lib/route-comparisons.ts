import {
  routePaths,
  type ExampleWorkout,
  type RaceMetrics,
  type WorkoutStreams,
} from "./example-data";

export type RouteComparison = {
  name: string;
  attempts: {
    month: number;
    km: number;
    minutes: number;
    path: string;
    metrics?: RaceMetrics;
    streams?: WorkoutStreams;
    track?: { seconds: number; x: number; y: number }[];
  }[];
};
type Point = { lat: number; lon: number };
const radians = Math.PI / 180;
function meters(a: Point, b: Point) {
  return (
    Math.hypot(
      (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * radians),
      a.lat - b.lat,
    ) * 111195
  );
}
function pointToSegment(p: Point, a: Point, b: Point) {
  const c = Math.cos(p.lat * radians);
  const ax = (a.lon - p.lon) * c * 111195,
    ay = (a.lat - p.lat) * 111195;
  const bx = (b.lon - p.lon) * c * 111195,
    by = (b.lat - p.lat) * 111195;
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(ax + t * dx, ay + t * dy);
}
function coverage(a: Point[], b: Point[]) {
  const distances = a
    .map((p) => {
      let nearest = Infinity;
      for (let i = 1; i < b.length; i++)
        nearest = Math.min(nearest, pointToSegment(p, b[i - 1], b[i]));
      return nearest;
    })
    .sort((a, b) => a - b);
  return distances[Math.ceil(distances.length * 0.95) - 1] <= 75;
}
function sample(route: Point[]) {
  if (route.length <= 96) return route;
  return Array.from(
    { length: 96 },
    (_, i) => route[Math.round((i * (route.length - 1)) / 95)],
  );
}
/** Conservative geographic matches, same direction and similar recorded distance.
 * Every member matches the original reference, avoiding chained route drift.
 * Geometry is used privately; only normalized paths and display metrics leave here.
 */
export function compareRoutes(workouts: ExampleWorkout[]): RouteComparison[] {
  const candidates = workouts
    .filter(
      (w) =>
        w.activity === "Running" &&
        w.route &&
        w.route.length >= 8 &&
        w.distanceM !== null &&
        w.distanceM >= 1000 &&
        w.durationS > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 500);
  const routes = new Map(candidates.map((w) => [w, sample(w.route!)]));
  function matches(a: ExampleWorkout, b: ExampleWorkout) {
    if (
      Math.min(a.distanceM!, b.distanceM!) /
        Math.max(a.distanceM!, b.distanceM!) <
      0.92
    )
      return false;
    const x = routes.get(a)!,
      y = routes.get(b)!;
    if (
      meters(x[0], y[0]) > 150 ||
      meters(x[x.length - 1], y[y.length - 1]) > 150
    )
      return false;
    // Ordered anchors also reject reversed loops and substantially different ordering.
    for (const fraction of [0.25, 0.5, 0.75])
      if (
        meters(
          x[Math.round((x.length - 1) * fraction)],
          y[Math.round((y.length - 1) * fraction)],
        ) > 400
      )
        return false;
    // Compare traversal order in both directions, including small closed loops
    // whose endpoints coincide and whose diameter is below the anchor limit.
    let forward = 0,
      reverse = 0;
    for (const fraction of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const p = x[Math.round((x.length - 1) * fraction)];
      forward += meters(p, y[Math.round((y.length - 1) * fraction)]);
      reverse += meters(p, y[Math.round((y.length - 1) * (1 - fraction))]);
    }
    if (reverse + 7 * 30 < forward) return false;
    return coverage(x, y) && coverage(y, x);
  }
  const groups: ExampleWorkout[][] = [];
  for (const w of candidates) {
    const group = groups.find((g) => matches(w, g[0]));
    if (group) group.push(w);
    else groups.push([w]);
  }
  return groups
    .filter((g) => g.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 20)
    .map((group, i) => {
      const paths = routePaths(group, false);
      return {
        name: `Route ${String(i + 1).padStart(2, "0")}`,
        attempts: group.map((w, index) => ({
          month: Number(w.date.slice(5, 7)),
          km: w.distanceM! / 1000,
          minutes: w.durationS / 60,
          path: paths[index].d,
          ...(w.route!.every((p) => p.seconds !== undefined)
            ? {
                track: [
                  ...paths[index].d.matchAll(/[ML]([\d.-]+),([\d.-]+)/g),
                ].map((p, j) => ({
                  seconds: w.route![j].seconds!,
                  x: Number(p[1]),
                  y: Number(p[2]),
                })),
              }
            : {}),
          ...(w.streams
            ? {
                streams: Object.fromEntries(
                  ["heartRate", "powerW", "speedMps"]
                    .filter(
                      (key) => w.streams![key as keyof WorkoutStreams]?.length,
                    )
                    .map((key) => [
                      key,
                      w.streams![key as keyof WorkoutStreams]!.map((p) => ({
                        seconds: p.seconds,
                        value: p.value,
                      })),
                    ]),
                ),
              }
            : {}),
          ...(w.metrics
            ? {
                metrics: Object.fromEntries(
                  Object.entries(w.metrics).filter(
                    ([key, value]) =>
                      [
                        "heartRate",
                        "powerW",
                        "steps",
                        "activeKcal",
                        "strideM",
                        "groundContactMs",
                        "verticalCm",
                      ].includes(key) &&
                      Number.isFinite(value) &&
                      value >= 0,
                  ),
                ),
              }
            : {}),
        })),
      };
    });
}
