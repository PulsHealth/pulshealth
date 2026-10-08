// When charts may read metric_daily, the database's canonical daily view,
// instead of rolling raw samples up themselves.

import { viewerMode } from "../mode";
import { reportingTimeZone } from "../reportingTimeZone";
import { query } from "../db";
import { configuredTimeZone } from "../config";
import { warnOnce } from "./source";

export const DAY_MS = 86_400_000;

// The database's own calendar zone. `puls_time_zone()` returns the server
// stack's PULS_TIME_ZONE (stored on the database by db/migrations/013_time_zone.sh;
// UTC when unset). metric_daily buckets its days in that zone, so its rows are
// only honest for this viewer when it equals the viewer's PULS_TIME_ZONE.
// Resolved lazily and cached at module scope. A failed lookup (database
// unreachable, or an older schema without the function) yields `null`, is
// retried after a short delay rather than on every request, and warns once.
const DB_TZ_RETRY_MS = 60_000;
let dbZoneCache: { zone: string | null; at: number } | null = null;
let dbZoneInFlight: Promise<string | null> | null = null;
async function databaseTimeZone(): Promise<string | null> {
  if (dbZoneCache && (dbZoneCache.zone !== null || Date.now() - dbZoneCache.at < DB_TZ_RETRY_MS)) {
    return dbZoneCache.zone;
  }
  if (dbZoneInFlight) return dbZoneInFlight;
  const promise = query<{ zone: string | null }>("SELECT puls_time_zone() AS zone")
    .then((rows) => {
      const zone = rows[0]?.zone;
      if (!zone) {
        warnOnce("db-zone-empty", "[queries] puls_time_zone() returned no value; metric_daily disabled");
        return null;
      }
      return zone;
    })
    .catch((e: unknown) => {
      warnOnce("db-zone-error", "[queries] could not read puls_time_zone(); metric_daily disabled:", e);
      return null;
    });
  dbZoneInFlight = promise;
  try {
    const zone = await promise;
    dbZoneCache = { zone, at: Date.now() };
    return zone;
  } finally {
    if (dbZoneInFlight === promise) dbZoneInFlight = null;
  }
}

/**
 * Whether metric_daily's days are this viewer's days. Its canonical day is
 * defined in the database's zone; for a viewer in any other zone (or when
 * the database's zone is unknown), raw local buckets are more honest than
 * relabeling those canonical dates. Reads through query(), so callers decide
 * this BEFORE opening their scoped transaction.
 */
export async function metricDailyUsable(userId?: string): Promise<boolean> {
  // Migration 026 computes raw daily rows per account and retains phone dates.
  if (viewerMode() === "accounts" && userId) {
    await reportingTimeZone(userId);
    return true;
  }
  const viewerZone = configuredTimeZone();
  const dbZone = await databaseTimeZone();
  if (dbZone === viewerZone) return true;
  if (dbZone !== null) {
    warnOnce(
      "db-zone-mismatch",
      `[queries] PULS_TIME_ZONE (${viewerZone}) differs from the database's puls_time_zone() (${dbZone}); ` +
        "using raw local buckets instead of metric_daily",
    );
  }
  return false;
}
