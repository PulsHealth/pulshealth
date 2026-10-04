// Server-side viewer configuration. The web app is a read-only viewer; every
// health-data query is scoped to one user. PULS_USER_ID is the user shown
// until one is chosen — lib/viewer.ts resolves the chosen one per request.

import { isUuid } from "./uuid";

export const DEFAULT_USER_ID = "5ea4d000-0000-4000-8000-000000000001";
// Must match the server stack's PULS_TIME_ZONE (and the phone's zone): the
// database's daily views bucket days in that zone. The stack defaults to UTC.
export const DEFAULT_TIME_ZONE = "UTC";

/** The user shown until one is chosen: PULS_USER_ID, or the seeded default. */
export function defaultUserId(): string {
  const value = process.env.PULS_USER_ID || DEFAULT_USER_ID;
  if (!isUuid(value)) {
    throw new Error("PULS_USER_ID must be a valid UUID");
  }
  return value;
}

export function configuredTimeZone(): string {
  const value = process.env.PULS_TIME_ZONE || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    throw new Error(`PULS_TIME_ZONE is not a valid IANA time zone: ${value}`);
  }
}
