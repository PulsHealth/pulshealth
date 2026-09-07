// Per-unit splits (every km or mile) derived from the GPS route, the way Apple
// Fitness shows them. Walks the route accumulating distance + time and emits a
// split each time cumulative distance crosses a unit boundary, interpolating
// the crossing time so splits are exact.

import { haversine } from "./geo";
import type { RoutePoint } from "./types";

export interface Split {
  index: number; // 1-based
  distanceM: number; // length of this split (full unit, or remainder for the last)
  seconds: number; // elapsed time within this split
  paceMps: number; // distanceM / seconds
  partial: boolean; // true for a trailing sub-unit split
}

export function splitsFromRoute(route: RoutePoint[], unitMeters: number): Split[] {
  if (route.length < 2 || unitMeters <= 0) return [];

  const splits: Split[] = [];
  let cum = 0; // cumulative distance
  let nextBoundary = unitMeters;
  let lastBoundaryDist = 0;
  let lastBoundaryT = route[0].t;

  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1];
    const p = route[i];
    const seg = haversine(prev.lat, prev.lon, p.lat, p.lon);
    if (seg <= 0) continue;
    const segStart = cum;
    cum += seg;

    // One segment may cross several unit boundaries (sparse fixes).
    while (cum >= nextBoundary) {
      const frac = (nextBoundary - segStart) / seg; // 0..1 within this segment
      const crossT = prev.t + frac * (p.t - prev.t);
      const seconds = (crossT - lastBoundaryT) / 1000;
      splits.push({
        index: splits.length + 1,
        distanceM: unitMeters,
        seconds,
        paceMps: seconds > 0 ? unitMeters / seconds : 0,
        partial: false,
      });
      lastBoundaryDist = nextBoundary;
      lastBoundaryT = crossT;
      nextBoundary += unitMeters;
    }
  }

  // Trailing partial split.
  const remainder = cum - lastBoundaryDist;
  if (remainder > unitMeters * 0.05) {
    const seconds = (route[route.length - 1].t - lastBoundaryT) / 1000;
    splits.push({
      index: splits.length + 1,
      distanceM: remainder,
      seconds,
      paceMps: seconds > 0 ? remainder / seconds : 0,
      partial: true,
    });
  }
  return splits;
}
