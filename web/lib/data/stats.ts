// Catalog-wide stats: rows and date range per type, for one user.

import { scoped } from "../db";
import { demoStats } from "../demo";
import type { TypeStat } from "../types";
import { liveRead } from "./source";

// Cached per user for a short TTL (the scan is the heaviest query here).
const STATS_TTL = 30_000;
const statsCache = new Map<string, { value: Map<string, TypeStat>; at: number }>();
const statsInFlight = new Map<string, Promise<Map<string, TypeStat>>>();

export async function getStats(userId: string): Promise<Map<string, TypeStat>> {
  const cached = statsCache.get(userId);
  if (cached && Date.now() - cached.at < STATS_TTL) return cached.value;
  const inFlight = statsInFlight.get(userId);
  if (inFlight) return inFlight;
  const promise = loadStats(userId);
  statsInFlight.set(userId, promise);
  try {
    const value = await promise;
    statsCache.set(userId, { value, at: Date.now() });
    return value;
  } finally {
    if (statsInFlight.get(userId) === promise) statsInFlight.delete(userId);
  }
}

async function loadStats(userId: string): Promise<Map<string, TypeStat>> {
  const out = new Map<string, TypeStat>();
  return liveRead("getStats", () => new Map(demoStats().map((s) => [s.identifier, s])), async () => {
    return await scoped(userId, async (q) => {
      const rows = await q<{ identifier: string; rows: string; earliest: string | null; latest: string | null }>(
        `SELECT st.identifier,
                count(*)::bigint AS rows,
                (extract(epoch from min(x.start_ts)) * 1000)::bigint AS earliest,
                (extract(epoch from max(x.start_ts)) * 1000)::bigint AS latest
           FROM (
             SELECT type_id, start_ts FROM quantity_samples WHERE user_id = $1::uuid
             UNION ALL
             SELECT type_id, start_ts FROM category_samples WHERE user_id = $1::uuid
           ) x
           JOIN sample_types st ON st.type_id = x.type_id
          GROUP BY st.identifier`,
        [userId],
      );
      for (const r of rows) {
        out.set(r.identifier, {
          identifier: r.identifier,
          rows: Number(r.rows),
          earliest: r.earliest == null ? null : Number(r.earliest),
          latest: r.latest == null ? null : Number(r.latest),
        });
      }
      // Workouts live in their own table.
      const wk = await q<{ rows: string; earliest: string | null; latest: string | null }>(
        `SELECT count(*)::bigint AS rows,
                (extract(epoch from min(start_ts)) * 1000)::bigint AS earliest,
                (extract(epoch from max(start_ts)) * 1000)::bigint AS latest
           FROM workouts
          WHERE user_id = $1::uuid`,
        [userId],
      );
      if (wk[0] && Number(wk[0].rows) > 0) {
        out.set("HKWorkoutTypeIdentifier", {
          identifier: "HKWorkoutTypeIdentifier",
          rows: Number(wk[0].rows),
          earliest: wk[0].earliest == null ? null : Number(wk[0].earliest),
          latest: wk[0].latest == null ? null : Number(wk[0].latest),
        });
      }
      return out;
    });
  });
}
