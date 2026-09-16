// Which user the viewer shows for this request (SRV-11).
//
// The database can hold more than one person's records (every table carries a
// user_id), but the viewer used to render exactly one: PULS_USER_ID. The
// chosen user now lives in a cookie, set by POST /api/user (the sidebar's
// switcher) or by `?user=<uuid>` on any page (proxy.ts). It is a preference,
// not access control — everyone behind the one WEB_AUTH_PASSWORD can pick any
// user — so the cookie carries nothing that needs signing: a forged value is
// at worst a UUID the database does not have, which renders empty.
//
// `cookies()` needs a request scope, so this module is imported by pages and
// route handlers only; lib/queries.ts takes the user id as a plain argument
// and stays testable without one.

import { cookies } from "next/headers";
import { defaultUserId, UUID_RE } from "./config";

/** Cookie holding the chosen user's id. */
export const USER_COOKIE = "puls-user";

/** Seconds the choice is remembered for: a year. */
export const USER_COOKIE_MAX_AGE = 31_536_000;

/**
 * The user a cookie value selects: the value when it is a UUID, otherwise the
 * fallback. Pure, so the tests can hit it without a request.
 */
export function parseViewerUser(cookieValue: string | undefined, fallback: string): string {
  if (cookieValue && UUID_RE.test(cookieValue)) return cookieValue.toLowerCase();
  return fallback;
}

/** The user this request shows: the cookie's choice, else PULS_USER_ID. */
export async function viewerUser(): Promise<string> {
  const jar = await cookies();
  return parseViewerUser(jar.get(USER_COOKIE)?.value, defaultUserId());
}
