// Where the viewer's data comes from, and what a read does when it cannot
// come from the database.
//
// Demo fallback is a DEV-ONLY convenience: outside production
// (`NODE_ENV !== "production"`) an unconfigured or unreachable database is
// the "demo" source, and synthetic data keeps the UI populated. In production
// (the `web` container image sets NODE_ENV=production) demo data is NEVER
// served. Every read goes through `liveRead`, which turns anything but a live
// answer into either demo data (the "demo" source only) or a thrown
// DataUnavailableError, which the page's error boundary (app/error.tsx)
// shows as "Database unavailable" — never an empty chart that would read as
// "no data". Live mode never fabricates either: an empty result stays empty.

import { healthQuery } from "../db";
import { viewerMode } from "../mode";
import type { DataSourceInfo } from "../types";
import { DataUnavailableError } from "./unavailable";

// Demo data is a dev-only convenience; production never fabricates.
export const ALLOW_DEMO = process.env.NODE_ENV !== "production";

// ── data source detection (short TTL cache) ──────────────────────────────
let srcCache: { info: DataSourceInfo; at: number } | null = null;
let srcInFlight: Promise<DataSourceInfo> | null = null;
const SRC_TTL = 30_000;
// Recover promptly after a transient outage instead of caching it for 30 s.
const ERROR_TTL = 1000;

export async function getDataSource(): Promise<DataSourceInfo> {
  if (!process.env.DATABASE_URL) {
    return ALLOW_DEMO
      ? { source: "demo", detail: "No DATABASE_URL set — showing demo data" }
      : { source: "error", detail: "No DATABASE_URL configured" };
  }
  if (srcCache && Date.now() - srcCache.at < (srcCache.info.source === "live" ? SRC_TTL : ERROR_TTL)) return srcCache.info;
  if (srcInFlight) return srcInFlight;
  srcInFlight = checkDataSource();
  try {
    const info = await srcInFlight;
    srcCache = { info, at: Date.now() };
    return info;
  } finally {
    srcInFlight = null;
  }
}

async function checkDataSource(): Promise<DataSourceInfo> {
  let info: DataSourceInfo;
  try {
    if (viewerMode() === "accounts") {
      // Accounts mode promises that the database, not this code, keeps people
      // to their own records — which holds only as web_app. Connected as any
      // role that can read the tables directly (grafana, the superuser), serve
      // nothing: every read throws DataUnavailableError while the source is
      // not live, and /api/healthz reports it.
      const rows = await healthQuery<{ direct: boolean }>(
        `SELECT has_table_privilege('public.quantity_samples', 'SELECT')
             OR has_table_privilege('public.users', 'SELECT') AS direct`,
      );
      if (rows[0]?.direct) {
        warnOnce(
          "accounts-role",
          "[queries] WEB_ACCOUNTS is on, but this database role can read every user's records directly. " +
            "Connect as web_app (WEB_DATABASE_URL in server/.env); serving no data until then.",
        );
        return { source: "error", detail: "Accounts mode needs the web_app database role" };
      }
    } else {
      await healthQuery("SELECT 1");
    }
    info = { source: "live", detail: "Connected to TimescaleDB" };
  } catch (e) {
    info = ALLOW_DEMO
      ? { source: "demo", detail: "Database unreachable — showing demo data" }
      : { source: "error", detail: "Database unreachable" };
    if (!ALLOW_DEMO) console.error("[queries] database unreachable:", e);
  }
  return info;
}

// A live read failed. Besides logging it, drop the cached check so the next
// getDataSource() probes again instead of reporting "live" for up to SRC_TTL:
// a lost database fails that probe too and becomes the
// "error" source (the sidebar's "Database unavailable", /api/healthz's 503).
// The probe has a reserved connection, so chart-pool saturation stays local.
// A failure confined to one query (a statement timeout on one person's All
// Time chart) passes the probe, so it does not blank the viewer for
// everyone — only the page that hit it, through liveRead's throw.
export function readFailed(what: string, e: unknown): void {
  console.error(`[queries] ${what} failed:`, e);
  srcCache = null;
}

/**
 * One read of the viewer's data. On the "demo" source (dev only) the answer
 * is `demo()`; on the "error" source, a DataUnavailableError without touching
 * the database; live, `read()` — and if that fails, the failure is logged,
 * the source is re-checked on the next call (`readFailed`), and the page gets
 * a DataUnavailableError rather than an empty value it would chart as "no
 * data". A DataUnavailableError from a nested read (All Time asking for the
 * stats) passes through as it is.
 */
export async function liveRead<T>(what: string, demo: () => T, read: () => Promise<T>): Promise<T> {
  const info = await getDataSource();
  if (info.source === "demo") return demo();
  if (info.source !== "live") throw new DataUnavailableError(info.detail);
  try {
    return await read();
  } catch (e) {
    if (e instanceof DataUnavailableError) throw e;
    readFailed(what, e);
    throw new DataUnavailableError("A read failed; the database may be unreachable or the query timed out");
  }
}

// Log a given warning once per process; the zone checks run on every request
// and would otherwise flood the log with the same line.
const warnedOnce = new Set<string>();
export function warnOnce(key: string, ...args: unknown[]): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(...args);
}
