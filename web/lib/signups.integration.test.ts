// Sign-up with approval against a real, migrated database (016_web_signups.sql),
// through the viewer's own route handlers and store, connected as web_app:
// a request creates nothing; only an administrator's session can approve it;
// approval makes a user and an invite; the person connects their own iPhone
// and nobody else's; disabling cuts the phone off; deleting an account and
// purging a user leave nothing behind; and web_app still cannot write the
// tables those functions write. Skipped without the two connection strings.

import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Client, DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WEB_URL = process.env.WEB_APP_DATABASE_URL;
const ADMIN_URL = process.env.ADMIN_DATABASE_URL;
if (process.env.CI && process.env.PULS_WEB_INTEGRATION && (!WEB_URL || !ADMIN_URL)) {
  throw new Error("PULS_WEB_INTEGRATION is set but WEB_APP_DATABASE_URL or ADMIN_DATABASE_URL is missing");
}

const ADMIN_USER = randomUUID();
const tag = ADMIN_USER.slice(0, 8);
const ADMIN_EMAIL = `admin-${tag}@example.com`;
const PERSON_EMAIL = `person-${tag}@example.com`;
const PASSWORD = "a long enough passphrase";
const COOKIE = "__Host-puls-session";

function post(path: string, fields: Record<string, string>, opts: { cookie?: string; ip?: string } = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const headers = new Headers({
    host: "viewer.example",
    origin: "https://viewer.example",
    "x-forwarded-proto": "https",
    "x-forwarded-for": opts.ip ?? "198.51.100.1",
  });
  if (opts.cookie) headers.set("cookie", `${COOKIE}=${opts.cookie}`);
  return new NextRequest(new URL(path, "http://web:3000"), { method: "POST", headers, body });
}

const cookieOf = (res: Response) => /__Host-puls-session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1] || undefined;

async function sqlState(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof DatabaseError ? (e.code ?? "unknown") : `not a database error: ${String(e)}`;
  }
}

describe.skipIf(!WEB_URL || !ADMIN_URL)("sign-up with approval (integration)", () => {
  let admin: Client;
  let adminCookie: string;
  let personCookie: string;
  let personUser: string;
  let signups: typeof import("./accounts/signups");
  let loginRoute: typeof import("@/app/api/auth/login/route");
  let inviteRoute: typeof import("@/app/api/auth/invite/route");
  let signupRoute: typeof import("@/app/api/auth/signup/route");

  beforeAll(async () => {
    process.env.WEB_ACCOUNTS = "true";
    process.env.WEB_SIGNUPS = "true";
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.DATABASE_URL = WEB_URL;
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const { hashPassword } = await import("./accounts/password");
    await admin.query("INSERT INTO users (id) VALUES ($1)", [ADMIN_USER]);
    await admin.query("INSERT INTO auth.accounts (user_id, email, password_hash, is_admin) VALUES ($1, $2, $3, true)", [
      ADMIN_USER, ADMIN_EMAIL, await hashPassword(PASSWORD),
    ]);
    signups = await import("./accounts/signups");
    loginRoute = await import("@/app/api/auth/login/route");
    inviteRoute = await import("@/app/api/auth/invite/route");
    signupRoute = await import("@/app/api/auth/signup/route");
    adminCookie = cookieOf(await loginRoute.POST(post("/api/auth/login", { email: ADMIN_EMAIL, password: PASSWORD }, { ip: "198.51.100.200" })))!;
    expect(adminCookie).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    await (await import("./db")).getPool()?.end();
    if (!admin) return;
    const users = (await admin.query<{ id: string }>(
      "SELECT DISTINCT user_id::text AS id FROM auth.signup_requests WHERE email LIKE $1 AND user_id IS NOT NULL", [`%-${tag}@example.com`],
    )).rows.map((r) => r.id);
    for (const user of [...users, ADMIN_USER]) {
      await admin.query("DELETE FROM device_tokens WHERE user_id = $1", [user]);
      await admin.query("DELETE FROM auth.invites WHERE user_id = $1", [user]);
      await admin.query("DELETE FROM auth.signup_requests WHERE user_id = $1", [user]);
      await admin.query("DELETE FROM auth.accounts WHERE user_id = $1", [user]);
      await admin.query("DELETE FROM quantity_samples WHERE user_id = $1 AND start_ts > now() - interval '400 days'", [user]);
      await admin.query("DELETE FROM users WHERE id = $1", [user]);
    }
    await admin.query("DELETE FROM auth.signup_requests WHERE email LIKE $1", [`%-${tag}@example.com`]);
    await admin.end();
  }, 60_000);

  const requestRow = (email: string) =>
    admin.query<{ id: string; status: string; user_id: string | null }>(
      "SELECT id::text, status, user_id::text FROM auth.signup_requests WHERE email = $1 ORDER BY created_at", [email],
    ).then((r) => r.rows);

  it("records a request and creates nothing else", async () => {
    const before = Number((await admin.query("SELECT count(*) FROM users")).rows[0].count);
    const res = await signupRoute.POST(post("/api/auth/signup", { name: "Pat", email: ` ${PERSON_EMAIL.toUpperCase()} `, note: "hi", consent: "yes" }, { ip: "198.51.100.10" }));
    expect(res.headers.get("location")).toBe("/signup?notice=received");
    expect(await requestRow(PERSON_EMAIL)).toMatchObject([{ status: "pending", user_id: null }]);
    expect(Number((await admin.query("SELECT count(*) FROM users")).rows[0].count)).toBe(before);
    expect((await admin.query("SELECT 1 FROM auth.accounts WHERE email = $1", [PERSON_EMAIL])).rows).toHaveLength(0);

    // Asking again while pending changes nothing, and answers the same.
    const again = await signupRoute.POST(post("/api/auth/signup", { name: "Pat", email: PERSON_EMAIL, consent: "yes" }, { ip: "198.51.100.11" }));
    expect(again.headers.get("location")).toBe("/signup?notice=received");
    expect(await requestRow(PERSON_EMAIL)).toHaveLength(1);
  });

  it("drops a honeypot, insists on consent, and limits one address to three an hour", async () => {
    const bot = `bot-${tag}@example.com`;
    const res = await signupRoute.POST(post("/api/auth/signup", { email: bot, consent: "yes", website: "http://spam" }, { ip: "198.51.100.20" }));
    expect(res.headers.get("location")).toBe("/signup?notice=received");
    expect(await requestRow(bot)).toHaveLength(0);
    expect((await signupRoute.POST(post("/api/auth/signup", { email: bot }, { ip: "198.51.100.21" }))).headers.get("location")).toBe("/signup?error=consent");

    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      const r = await signupRoute.POST(post("/api/auth/signup", { email: `flood${i}-${tag}@example.com`, consent: "yes" }, { ip: "198.51.100.30" }));
      outcomes.push(r.headers.get("location"));
    }
    expect(outcomes.slice(0, 3)).toEqual(Array(3).fill("/signup?notice=received"));
    expect(outcomes[3]).toBe("/signup?error=throttled");
  });

  it("lets only an administrator's session approve, and approval makes a user and an invite", async () => {
    const [{ id }] = await requestRow(PERSON_EMAIL);
    // web_app cannot fake it: no session, a made-up one, or a non-admin's.
    expect(await sqlState(signups.approveSignup("x".repeat(43), "00000000-0000-4000-8000-000000000000", id))).toBe("42501");

    const approval = await signups.approveSignup(adminCookie, (await admin.query("SELECT id::text FROM auth.accounts WHERE email = $1", [ADMIN_EMAIL])).rows[0].id, id);
    personUser = approval.userId;
    expect(approval.email).toBe(PERSON_EMAIL);
    expect(await requestRow(PERSON_EMAIL)).toMatchObject([{ status: "approved", user_id: personUser }]);
    expect((await admin.query("SELECT 1 FROM users WHERE id = $1", [personUser])).rows).toHaveLength(1);
    expect(await sqlState(signups.approveSignup(adminCookie, ADMIN_USER, id))).toBe("P0002"); // decided already

    // The invite works like any other: the person chooses a password and is in.
    const accepted = await inviteRoute.POST(post("/api/auth/invite", { token: approval.inviteToken, password: PASSWORD, confirm: PASSWORD }, { ip: "198.51.100.40" }));
    expect(accepted.headers.get("location")).toBe("/?notice=welcome");
    personCookie = cookieOf(accepted)!;
    expect(personCookie).toBeTruthy();
  });

  it("connects the person's own iPhone, and nobody else's", async () => {
    const minted = await signups.issueDeviceToken(personCookie, "Pat's iPhone");
    expect(minted.token).toMatch(/^[0-9a-f]{64}$/);
    const { rows } = await admin.query<{ user_id: string; token_hash: Buffer; token_prefix: string; status: string }>(
      "SELECT user_id::text, token_hash, token_prefix, status FROM device_tokens WHERE id = $1", [minted.id],
    );
    // Exactly what ingest looks up: SHA-256 over the ASCII hex, bound to the user.
    expect(rows[0]).toMatchObject({ user_id: personUser, token_prefix: minted.token.slice(0, 8), status: "active" });
    expect(rows[0].token_hash.equals(createHash("sha256").update(minted.token, "ascii").digest())).toBe(true);

    expect((await signups.myDevices(personCookie)).map((d) => d.id)).toEqual([minted.id]);
    expect(await signups.myDevices(adminCookie)).toEqual([]);
    // The admin cannot revoke the person's device as "their own".
    expect(await signups.revokeMyDevice(adminCookie, minted.id)).toBe(false);
    expect(await sqlState(signups.issueDeviceToken("y".repeat(43), "x"))).toBe("42501");

    const link = signups.pairingLink("https://ingest.example/", minted.token, personUser);
    expect(link).toBe(`puls://pair?url=https%3A%2F%2Fingest.example%2F&token=${minted.token}&user=${personUser}`);

    expect(await signups.revokeMyDevice(personCookie, minted.id)).toBe(true);
    expect((await admin.query("SELECT status FROM device_tokens WHERE id = $1", [minted.id])).rows[0].status).toBe("revoked");
  });

  it("still cannot write users or device tokens directly", async () => {
    const web = new Client({ connectionString: WEB_URL });
    await web.connect();
    try {
      expect(await sqlState(web.query("INSERT INTO public.users (id) VALUES (gen_random_uuid())"))).toBe("42501");
      expect(await sqlState(web.query("SELECT 1 FROM public.device_tokens"))).toBe("42501");
      expect(await sqlState(web.query("SELECT * FROM auth.session_owner('z')"))).toBe("42501");
    } finally {
      await web.end();
    }
  });

  it("disabling cuts the account off and its phones with it; enabling lets it sign in again", async () => {
    const minted = await signups.issueDeviceToken(personCookie, "second");
    const accountId = (await admin.query("SELECT id::text FROM auth.accounts WHERE email = $1", [PERSON_EMAIL])).rows[0].id;
    expect(await sqlState(signups.setAccountDisabled(personCookie, accountId, true))).toBe("42501");

    await signups.setAccountDisabled(adminCookie, accountId, true);
    expect((await admin.query("SELECT status FROM device_tokens WHERE id = $1", [minted.id])).rows[0].status).toBe("revoked");
    const { findSession } = await import("./accounts/session");
    expect(await findSession(personCookie)).toBeNull();
    const refused = await loginRoute.POST(post("/api/auth/login", { email: PERSON_EMAIL, password: PASSWORD }, { ip: "198.51.100.50" }));
    expect(refused.headers.get("location")).toBe("/login?error=invalid");

    await signups.setAccountDisabled(adminCookie, accountId, false);
    personCookie = cookieOf(await loginRoute.POST(post("/api/auth/login", { email: PERSON_EMAIL, password: PASSWORD }, { ip: "198.51.100.51" })))!;
    expect(personCookie).toBeTruthy();
  });

  it("deleting your own account disables it at once; purging leaves nothing of the user", async () => {
    await admin.query(
      `INSERT INTO sample_types (identifier, kind, unit) VALUES ('HKQuantityTypeIdentifierStepCount', 'quantity', 'count') ON CONFLICT DO NOTHING`,
    );
    await admin.query(
      `INSERT INTO quantity_samples (uuid, type_id, start_ts, end_ts, value, user_id)
       SELECT gen_random_uuid(), (SELECT type_id FROM sample_types WHERE identifier = 'HKQuantityTypeIdentifierStepCount'),
              now() - make_interval(days => g), now() - make_interval(days => g), g, $1
         FROM generate_series(1, 5) g`,
      [personUser],
    );
    const minted = await signups.issueDeviceToken(personCookie, "third");

    expect(await sqlState(signups.deleteMyAccount(adminCookie))).toBe("42501"); // not for admins
    expect(await signups.deleteMyAccount(personCookie)).toBe(personUser);
    const { rows } = await admin.query("SELECT disabled_at IS NOT NULL AS disabled, deletion_requested_at IS NOT NULL AS asked FROM auth.accounts WHERE user_id = $1", [personUser]);
    expect(rows[0]).toEqual({ disabled: true, asked: true });
    expect((await admin.query("SELECT status FROM device_tokens WHERE id = $1", [minted.id])).rows[0].status).toBe("revoked");

    expect(await sqlState(signups.purgeUser(personCookie, personUser))).toBe("42501");
    expect(await sqlState(signups.purgeUser(adminCookie, ADMIN_USER))).toBe("42501"); // not your own
    const counts = await signups.purgeUser(adminCookie, personUser);
    expect(counts.quantity_samples).toBe(5);
    for (const [table, where] of [
      ["users", "id"], ["quantity_samples", "user_id"], ["device_tokens", "user_id"], ["auth.accounts", "user_id"], ["auth.invites", "user_id"],
    ] as const) {
      expect((await admin.query(`SELECT 1 FROM ${table} WHERE ${where} = $1`, [personUser])).rows, table).toHaveLength(0);
    }
  });

  it("refuses to purge a user whose account is still enabled", async () => {
    const email = `flood0-${tag}@example.com`;
    const [{ id }] = await requestRow(email);
    const adminAccount = (await admin.query("SELECT id::text FROM auth.accounts WHERE email = $1", [ADMIN_EMAIL])).rows[0].id;
    const approval = await signups.approveSignup(adminCookie, adminAccount, id);
    await inviteRoute.POST(post("/api/auth/invite", { token: approval.inviteToken, password: PASSWORD, confirm: PASSWORD }, { ip: "198.51.100.60" }));
    expect(await sqlState(signups.purgeUser(adminCookie, approval.userId))).toBe("55000");
  });
});
