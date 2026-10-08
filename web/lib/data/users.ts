// The people in the database: Basic mode's switcher list, one user's own
// row, and the profile behind the heart-rate zones.

import { query, scoped } from "../db";
import { reportingTimeZone } from "../reportingTimeZone";
import { configuredTimeZone } from "../config";
import { demoProfile, demoUsers } from "../demo";
import type { Profile, User } from "../types";
import { getDataSource, liveRead, readFailed } from "./source";

// ── the users the database holds (for the switcher) ──────────────────────
// Oldest first, so the seeded default user — created by migration 000 before
// any phone syncs — leads the list. Name and email are null until the
// phone's first {"profile":…} line lands.
//
// Not health data and never thrown: the root layout renders the switcher,
// and a layout sits outside the error boundary of the page it wraps, so a
// throw here would take the whole shell down instead of one page. A failure
// reads as an empty list (and re-checks the source, so the sidebar shows
// "Database unavailable" from the next load).
export async function getUsers(): Promise<User[]> {
  const { source } = await getDataSource();
  if (source === "demo") return demoUsers();
  if (source !== "live") return [];
  try {
    const rows = await query<{ id: string; name: string | null; email: string | null }>(
      `SELECT id::text AS id, name, email
         FROM users
        ORDER BY created_at, id`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
  } catch (e) {
    readFailed("getUsers", e);
    return [];
  }
}

// ── one user's own row (name/email from the phone's profile) ─────────────
export async function getUser(userId: string): Promise<User> {
  const fallback: User = { id: userId, name: null, email: null };
  return liveRead("getUser", () => demoUsers().find((u) => u.id === userId) ?? fallback, async () => {
    const rows = await scoped(userId, (q) => q<{ id: string; name: string | null; email: string | null }>(
      "SELECT id::text AS id, name, email FROM users WHERE id = $1::uuid",
      [userId],
    ));
    return rows[0] ? { id: rows[0].id, name: rows[0].name, email: rows[0].email } : fallback;
  });
}

// ── user profile (DOB/max HR + resting HR for HRR zones) ──────────────────
export const DEFAULT_MAX_HR = 190;

export async function getProfile(userId: string): Promise<Profile> {
  const fallback: Profile = { dob: null, biologicalSex: null, age: null, maxHr: DEFAULT_MAX_HR, restingHr: null };
  return liveRead("getProfile", demoProfile, async () => {
    const timeZone = await reportingTimeZone(userId);
    const rows = await scoped(userId, (q) => q<{ dob: string | null; biological_sex: string | null; resting_hr: number | null }>(
      `SELECT (extract(epoch from (u.dob::timestamp AT TIME ZONE $2::text)) * 1000)::bigint AS dob,
              u.biological_sex,
              r.value::float8 AS resting_hr
         FROM users u
         LEFT JOIN LATERAL (
           SELECT q.value
             FROM quantity_samples q
             JOIN sample_types st ON st.type_id = q.type_id
            WHERE q.user_id = u.id
              AND st.identifier = 'HKQuantityTypeIdentifierRestingHeartRate'
            ORDER BY q.start_ts DESC
            LIMIT 1
         ) r ON true
        WHERE u.id = $1::uuid`,
      [userId, timeZone],
    ));
    const r = rows[0];
    if (!r) return fallback;
    const restingHr = r.resting_hr == null ? null : Number(r.resting_hr);
    return profileFromStoredValues(
      r.dob == null ? null : Number(r.dob),
      r.biological_sex,
      restingHr,
      timeZone,
    );
  });
}

export function profileFromStoredValues(
  dobMs: number | null,
  sex: string | null,
  restingHr: number | null,
  timeZone = configuredTimeZone(),
): Profile {
  if (dobMs == null) {
    return { dob: null, biologicalSex: sex, age: null, maxHr: DEFAULT_MAX_HR, restingHr };
  }
  return profileFromDob(dobMs, sex, restingHr, new Date(), timeZone);
}

// Build a Profile from an epoch-ms DOB: age today, max HR = 220 − age.
export function profileFromDob(
  dobMs: number,
  sex: string | null,
  restingHr: number | null = null,
  now = new Date(),
  timeZone = configuredTimeZone(),
): Profile {
  const parts = (date: Date) => Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "numeric", day: "numeric", timeZone,
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day", number>;
  const today = parts(now);
  const dob = parts(new Date(dobMs));
  let age = today.year - dob.year;
  if (today.month < dob.month || (today.month === dob.month && today.day < dob.day)) age--;
  const valid = age >= 0 && age < 120;
  return {
    dob: dobMs,
    biologicalSex: sex,
    age: valid ? age : null,
    maxHr: valid ? 220 - age : DEFAULT_MAX_HR,
    restingHr,
  };
}
