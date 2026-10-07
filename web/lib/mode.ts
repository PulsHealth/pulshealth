// Which kind of access control this viewer runs, decided from the environment
// on every call (one published image serves all three: edit .env,
// `docker compose up -d web`).
//
//   accounts  WEB_ACCOUNTS=true. People sign in with their own email and
//             password and see only their own records; the viewer connects
//             as the web_app role, which the database scopes per user
//             (server/db/migrations/015_web_accounts.sql). Needs HTTPS.
//   basic     WEB_AUTH_PASSWORD set. One shared password over HTTP Basic, any
//             user selectable (lib/auth.ts). Unchanged from before accounts.
//   open      Neither. No login at all; the bind address is the only guard.
//
// Accounts mode wins when both are set: the shared password would otherwise
// sit in front of a login that already identifies the person.

import { DEFAULT_USER_ID } from "./config";
import { isUuid } from "./uuid";

export type ViewerMode = "accounts" | "basic" | "open";

/** The environment, or a stand-in for it in tests. */
export type Env = Record<string, string | undefined>;

/** An environment flag that is on: true/1/yes/on, any case. */
export function isTrue(value: string | undefined): boolean {
  return /^(true|1|yes|on)$/i.test((value ?? "").trim());
}

export function viewerMode(env: Env = process.env): ViewerMode {
  if (isTrue(env.WEB_ACCOUNTS)) return "accounts";
  if (env.WEB_AUTH_PASSWORD) return "basic";
  return "open";
}

/**
 * Whether strangers may ask for an account (/signup). Only in accounts mode,
 * and off unless WEB_SIGNUPS is on: a request creates nothing until an
 * administrator approves it on /admin.
 */
export function signupsOpen(env: Env = process.env): boolean {
  return viewerMode(env) === "accounts" && isTrue(env.WEB_SIGNUPS);
}

/**
 * A boolean setting the way ingest, the product API and the MCP server read
 * one (parseBoolEnv in each): true/1/yes/on or false/0/no/off, any case,
 * surrounding space ignored; empty or unset is `fallback`. Anything else
 * throws, naming the variable — a typo must not quietly mean "off" here and
 * "on" in a Go service.
 */
export function parseFlag(name: string, value: string | undefined, fallback = false): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "") return fallback;
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  throw new Error(
    `${name} must be true or false (also accepted: 1/0, yes/no, on/off), got ${JSON.stringify((value ?? "").trim())}`,
  );
}

/**
 * Whether X-Forwarded-* and CF-Connecting-IP may be believed. Same switch,
 * same spelling rule (parseFlag), same default and same caveat as ingest and
 * the product API: only when a trusted proxy is the ONLY way to reach the
 * port (the client IP is then the last entry of the header, the one that
 * proxy appended). An unparseable value stops the server at startup
 * (instrumentation.ts); should one reach a request anyway, it means "do not
 * trust", the safe reading.
 */
export function trustProxyHeaders(env: Env = process.env): boolean {
  try {
    return parseFlag("TRUST_PROXY_HEADERS", env.TRUST_PROXY_HEADERS);
  } catch {
    return false;
  }
}

/**
 * WEB_DEMO_USER read strictly: the user id lower-cased, null when empty or
 * unset, and an error naming the variable for anything that is not a UUID —
 * or that is the household's default user (PULS_USER_ID, or the seeded one):
 * anyone can open the demo, so it must be a user holding only sample data.
 * instrumentation.ts stops the viewer on an error at startup.
 */
export function parseDemoUser(env: Env = process.env): string | null {
  const v = (env.WEB_DEMO_USER ?? "").trim();
  if (v === "") return null;
  if (!isUuid(v)) throw new Error(`WEB_DEMO_USER must be the demo user's UUID, got ${JSON.stringify(v)}`);
  const id = v.toLowerCase();
  if (id === DEFAULT_USER_ID || id === (env.PULS_USER_ID ?? "").trim().toLowerCase()) {
    throw new Error("WEB_DEMO_USER names the household's default user (PULS_USER_ID); the demo must be a user that holds only sample data");
  }
  return id;
}

/**
 * The user whose account is the public demo (`/demo` signs visitors into
 * it, view-only), or null when there is none. Accounts mode only; ignored in
 * the others. The demo account is the auth.accounts row with this user_id,
 * created by `make web-demo`. A malformed value stops the server at startup;
 * should one reach a request anyway, it means "no demo", so /demo is a 404.
 */
export function demoUserId(env: Env = process.env): string | null {
  if (viewerMode(env) !== "accounts") return null;
  try {
    return parseDemoUser(env);
  } catch {
    return null;
  }
}
