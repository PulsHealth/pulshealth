// Geometry helpers for workout GPS routes. Dependency-free: distance via
// haversine, plus derived summary metrics and a sampled profile series for
// the elevation / speed charts.

import type { RoutePoint } from "./types";

const EARTH_M = 6_371_000; // mean earth radius, meters

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

// Great-circle distance between two lat/lon points, in meters.
export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RouteSummary {
  distanceM: number; // total path length from GPS fixes
  elevGainM: number; // cumulative ascent
  elevLossM: number; // cumulative descent
  minAltM: number | null;
  maxAltM: number | null;
  avgSpeedMps: number | null; // distance / moving span
  maxSpeedMps: number | null;
  hasAltitude: boolean;
  hasSpeed: boolean;
}

// One sample of the route plotted against cumulative distance, used by the
// elevation and pace profile charts.
export interface ProfilePoint {
  distM: number; // cumulative distance from start
  t: number; // epoch ms
  altitude: number | null;
  speed: number | null; // m/s — measured, or derived from segment if absent
}

// Walk the route once, accumulating distance and the per-point profile.
function walk(route: RoutePoint[]): { cum: number[]; profile: ProfilePoint[] } {
  const cum: number[] = [];
  const profile: ProfilePoint[] = [];
  let dist = 0;
  for (let i = 0; i < route.length; i++) {
    const p = route[i];
    if (i > 0) {
      const prev = route[i - 1];
      const seg = haversine(prev.lat, prev.lon, p.lat, p.lon);
      dist += seg;
    }
    cum.push(dist);
    // Prefer the device-reported speed; otherwise derive it from the segment.
    let speed = p.speed;
    if (speed == null && i > 0) {
      const dt = (p.t - route[i - 1].t) / 1000;
      if (dt > 0) speed = (cum[i] - cum[i - 1]) / dt;
    }
    profile.push({ distM: dist, t: p.t, altitude: p.altitude, speed });
  }
  return { cum, profile };
}

export function routeSummary(route: RoutePoint[]): RouteSummary {
  const empty: RouteSummary = {
    distanceM: 0, elevGainM: 0, elevLossM: 0, minAltM: null, maxAltM: null,
    avgSpeedMps: null, maxSpeedMps: null, hasAltitude: false, hasSpeed: false,
  };
  if (route.length < 2) return empty;

  const { cum } = walk(route);
  const distanceM = cum[cum.length - 1];

  let elevGain = 0;
  let elevLoss = 0;
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  let hasAltitude = false;
  let prevAlt: number | null = null;
  for (const p of route) {
    if (p.altitude == null) continue;
    hasAltitude = true;
    minAlt = Math.min(minAlt, p.altitude);
    maxAlt = Math.max(maxAlt, p.altitude);
    if (prevAlt != null) {
      const d = p.altitude - prevAlt;
      // Ignore sub-meter jitter so noise doesn't inflate the totals.
      if (d > 1) elevGain += d;
      else if (d < -1) elevLoss += -d;
    }
    prevAlt = p.altitude;
  }

  let maxSpeed = 0;
  let hasSpeed = false;
  for (const p of route) {
    if (p.speed == null) continue;
    hasSpeed = true;
    maxSpeed = Math.max(maxSpeed, p.speed);
  }

  const spanS = (route[route.length - 1].t - route[0].t) / 1000;
  const avgSpeed = spanS > 0 ? distanceM / spanS : null;

  return {
    distanceM,
    elevGainM: elevGain,
    elevLossM: elevLoss,
    minAltM: hasAltitude ? minAlt : null,
    maxAltM: hasAltitude ? maxAlt : null,
    avgSpeedMps: avgSpeed,
    maxSpeedMps: hasSpeed ? maxSpeed : null,
    hasAltitude,
    hasSpeed,
  };
}

// Down-sample the route to at most `max` evenly-spaced profile points so the
// SVG charts stay light even for hour-long, thousands-of-fix routes.
export function routeProfile(route: RoutePoint[], max = 240): ProfilePoint[] {
  const { profile } = walk(route);
  if (profile.length <= max) return profile;
  const step = (profile.length - 1) / (max - 1);
  const out: ProfilePoint[] = [];
  for (let i = 0; i < max; i++) out.push(profile[Math.round(i * step)]);
  return out;
}

// m/s → min/km pace string ("5:30 /km"); returns "—" for non-moving speeds.
export function paceFromSpeed(mps: number | null | undefined): string {
  if (mps == null || mps <= 0.1) return "—";
  const secPerKm = 1000 / mps;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")} /km`;
}

// m/s → km/h string.
export function speedKmh(mps: number | null | undefined): string {
  if (mps == null) return "—";
  return `${(mps * 3.6).toFixed(1)} km/h`;
}
