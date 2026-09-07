// Server-side viewer configuration. The web app is intentionally a read-only,
// single-user viewer; every health-data query is scoped to this user.

export const DEFAULT_USER_ID = "5ea4d000-0000-4000-8000-000000000001";
// Must match the server stack's PULS_TIME_ZONE (and the phone's zone): the
// database's daily views bucket days in that zone. The stack defaults to UTC.
export const DEFAULT_TIME_ZONE = "UTC";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function viewerUserId(): string {
  const value = process.env.PULS_USER_ID || DEFAULT_USER_ID;
  if (!UUID_RE.test(value)) {
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
