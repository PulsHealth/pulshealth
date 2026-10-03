// When charts may read metric_daily, the database's canonical daily view,
// instead of rolling raw samples up themselves.

import { query, type QueryFn } from "../db";
import { configuredTimeZone } from "../config";
import { warnOnce } from "./source";

export const DAY_MS = 86_400_000;
export const NO_TYPES: ReadonlySet<string> = new Set();

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
export async function metricDailyUsable(): Promise<boolean> {
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

// Types for which a user actually has canonical metric_daily rows. The view
// is daily-grain, so callers use it only for day-or-coarser buckets. Querying
// the view itself avoids treating min/max/mostRecent-only aggregate configs as
// daily truth. Cached briefly, per user, to avoid a round-trip per query —
// keyed by user so two people alternating in the switcher do not evict each
// other's entry. Runs on the caller's scoped connection; the caller decides
// first, outside its transaction, whether metric_daily is usable at all.
const mdTypesCache = new Map<string, { set: Set<string>; at: number }>();
const mdTypesInFlight = new Map<string, Promise<Set<string>>>();
export async function metricDailyTypes(q: QueryFn, userId: string): Promise<Set<string>> {
  const cached = mdTypesCache.get(userId);
  if (cached && Date.now() - cached.at < 60_000) return cached.set;
  const inFlight = mdTypesInFlight.get(userId);
  if (inFlight) return inFlight;
  const promise = q<{ identifier: string }>(
    `SELECT DISTINCT identifier FROM metric_daily WHERE user_id = $1::uuid`, [userId],
  ).then((rows) => new Set(rows.map((row) => row.identifier)));
  mdTypesInFlight.set(userId, promise);
  try {
    const set = await promise;
    mdTypesCache.set(userId, { set, at: Date.now() });
    return set;
  } finally {
    if (mdTypesInFlight.get(userId) === promise) mdTypesInFlight.delete(userId);
  }
}
