// The public demo end to end against a real, migrated database, connected as
// web_app: `make web-demo`'s script creates the account with web_app's own
// grants (and refuses what it must), /demo signs a visitor in with a
// two-hour, non-sliding session that records no browser or address, never
// replaces a live session, refuses an administrator's account, and a demo
// session can change nothing but still signs out. Skipped without the same
// two connection strings as webapp.integration.test.ts.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabases } from "./integrationEnv";

const { webUrl: WEB_URL, adminUrl: ADMIN_URL } = requireIntegrationDatabases();

const DEMO = randomUUID();
const OTHER = randomUUID();
const SIGNUP = randomUUID();
const MISSING = randomUUID();
const DEMO_EMAIL = `demo-${DEMO.slice(0, 8)}@demo.invalid`;
const OTHER_EMAIL = `${OTHER.slice(0, 8)}@example.com`;
const COOKIE = "__Host-puls-session";
const SCRIPT = fileURLToPath(new URL("../scripts/demo.mjs", import.meta.url));

function request(method: "GET" | "POST", path: string, opts: { cookie?: string; ip?: string; fields?: Record<string, string> } = {}) {
  const headers = new Headers({
    host: "viewer.example",
    origin: "https://viewer.example",
    "x-forwarded-proto": "https",
    "x-forwarded-for": opts.ip ?? "198.51.100.200",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
  });
  if (opts.cookie) headers.set("cookie", `${COOKIE}=${opts.cookie}`);
  let body: FormData | undefined;
  if (method === "POST") {
    body = new FormData();
    for (const [k, v] of Object.entries(opts.fields ?? {})) body.set(k, v);
  }
  return new NextRequest(new URL(path, "http://web:3000"), { method, headers, body });
}

function sessionCookie(res: Response): string | undefined {
  const match = /__Host-puls-session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "");
  return match?.[1] || undefined;
}

async function runScript(args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, DATABASE_URL: WEB_URL, PULS_USER_ID: "" },
    });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe.skipIf(!WEB_URL || !ADMIN_URL)("the public demo (integration)", () => {
  let admin: Client;
  let otherToken: string;
  let demoRoute: typeof import("@/app/demo/route");
  let session: typeof import("./accounts/session");

  beforeAll(async () => {
    process.env.WEB_ACCOUNTS = "true";
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.DATABASE_URL = WEB_URL;
    process.env.WEB_DEMO_USER = DEMO;
    delete process.env.PULS_USER_ID;

    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    for (const user of [DEMO, OTHER, SIGNUP]) await admin.query("INSERT INTO users (id) VALUES ($1)", [user]);
    await admin.query("INSERT INTO auth.self_service_users (user_id) VALUES ($1)", [SIGNUP]);
    const { hashPassword } = await import("./accounts/password");
    await admin.query("INSERT INTO auth.accounts (user_id, email, password_hash) VALUES ($1, $2, $3)", [
      OTHER, OTHER_EMAIL, await hashPassword("the other person's passphrase"),
    ]);

    demoRoute = await import("@/app/demo/route");
    session = await import("./accounts/session");
    otherToken = await session.createSession(
      (await admin.query<{ id: string }>("SELECT id::text FROM auth.accounts WHERE user_id = $1", [OTHER])).rows[0].id,
      { userAgent: null, ip: null },
    );
  });

  afterAll(async () => {
    await (await import("./db")).getPool()?.end();
    if (!admin) return;
    const users = [DEMO, OTHER, SIGNUP];
    await admin.query("DELETE FROM auth.sessions WHERE account_id IN (SELECT id FROM auth.accounts WHERE user_id = ANY($1))", [users]);
    await admin.query("DELETE FROM auth.accounts WHERE user_id = ANY($1)", [users]);
    await admin.query("DELETE FROM auth.self_service_users WHERE user_id = ANY($1)", [users]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [users]);
    await admin.end();
  });

  it("make web-demo creates the account as web_app, once, and refuses the wrong users", async () => {
    const missing = await runScript(["--user", MISSING]);
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/no user .*make issue-device/s);

    const signup = await runScript(["--user", SIGNUP]);
    expect(signup.code).toBe(1);
    expect(signup.out).toMatch(/approved sign-up/);

    const created = await runScript(["--user", DEMO, "--email", DEMO_EMAIL]);
    expect(created.code, created.out).toBe(0);
    expect(created.out).toContain(`WEB_DEMO_USER=${DEMO}`);
    const rows = await admin.query("SELECT email, is_admin, disabled_at, password_hash FROM auth.accounts WHERE user_id = $1", [DEMO]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ email: DEMO_EMAIL, is_admin: false, disabled_at: null });
    expect(rows.rows[0].password_hash).toMatch(/^scrypt\$65536\$8\$2\$/);

    const again = await runScript(["--user", DEMO]);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toMatch(/already has a viewer account/);
    expect((await admin.query("SELECT 1 FROM auth.accounts WHERE user_id = $1", [DEMO])).rowCount).toBe(1);

    // Someone else's account is reported, never turned into the demo.
    const other = await runScript(["--user", OTHER]);
    expect(other.out).toContain(OTHER_EMAIL);
  });

  let demoToken: string;

  it("signs a visitor in: two hours, never sliding, no browser or address", async () => {
    const res = await demoRoute.GET(request("GET", "/demo", { ip: "198.51.100.201" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    demoToken = sessionCookie(res)!;
    expect(demoToken).toBeDefined();
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=7200/);

    const id = session.tokenHash(demoToken);
    const row = (
      await admin.query<{ user_agent: string | null; ip: string | null; lifetime: number }>(
        "SELECT user_agent, ip::text, extract(epoch FROM expires_at - created_at)::int AS lifetime FROM auth.sessions WHERE id = $1",
        [id],
      )
    ).rows[0];
    expect(row).toEqual({ user_agent: null, ip: null, lifetime: 7_200 });

    // Stale, and touched: it still does not slide.
    await admin.query("UPDATE auth.sessions SET last_seen_at = now() - interval '90 minutes' WHERE id = $1", [id]);
    const before = (await admin.query("SELECT expires_at FROM auth.sessions WHERE id = $1", [id])).rows[0].expires_at;
    const found = await session.findSession(demoToken, true);
    expect(found).toMatchObject({ userId: DEMO, demo: true, isAdmin: false, selfService: false, refreshed: false });
    expect((await admin.query("SELECT expires_at FROM auth.sessions WHERE id = $1", [id])).rows[0].expires_at).toEqual(before);
  });

  it("never replaces a live session, the demo's or another account's", async () => {
    const count = async () =>
      Number((await admin.query("SELECT count(*) FROM auth.sessions s JOIN auth.accounts a ON a.id = s.account_id WHERE a.user_id = $1", [DEMO])).rows[0].count);
    const before = await count();
    for (const cookie of [otherToken, demoToken]) {
      const res = await demoRoute.GET(request("GET", "/demo", { cookie, ip: "198.51.100.202" }));
      expect(res.headers.get("location")).toBe("/");
      expect(sessionCookie(res)).toBeUndefined();
    }
    expect(await count()).toBe(before);
    expect(await session.findSession(otherToken)).toMatchObject({ userId: OTHER, demo: false });
  });

  it("changes nothing for a demo session, and still signs it out", async () => {
    const { POST: password } = await import("@/app/api/auth/password/route");
    const { POST: sessions } = await import("@/app/api/auth/sessions/route");
    const { POST: logout } = await import("@/app/api/auth/logout/route");
    const hash = (await admin.query("SELECT password_hash FROM auth.accounts WHERE user_id = $1", [DEMO])).rows[0].password_hash;

    const changed = await password(
      request("POST", "/api/auth/password", { cookie: demoToken, fields: { current: "x", password: "a new long passphrase", confirm: "a new long passphrase" } }),
    );
    expect(changed.headers.get("location")).toBe("/account?error=demo");
    const everywhere = await sessions(request("POST", "/api/auth/sessions", { cookie: demoToken, fields: { session: "others" } }));
    expect(everywhere.headers.get("location")).toBe("/account?error=demo");
    expect((await admin.query("SELECT password_hash FROM auth.accounts WHERE user_id = $1", [DEMO])).rows[0].password_hash).toBe(hash);

    // A second visitor's session survived the first one's "sign out everywhere else".
    const second = sessionCookie(await demoRoute.GET(request("GET", "/demo", { ip: "198.51.100.203" })))!;
    await sessions(request("POST", "/api/auth/sessions", { cookie: demoToken, fields: { session: "others" } }));
    expect(await session.findSession(second)).toMatchObject({ demo: true });

    const out = await logout(request("POST", "/api/auth/logout", { cookie: demoToken }));
    expect(out.headers.get("location")).toBe("/login?notice=signed-out");
    expect(await session.findSession(demoToken)).toBeNull();
    expect(await session.findSession(second)).toMatchObject({ demo: true });
  });

  it("refuses to take visitors into an administrator's or a disabled account", async () => {
    const error = console.error;
    console.error = () => {};
    try {
      for (const change of ["is_admin = true", "disabled_at = now()"]) {
        await admin.query(`UPDATE auth.accounts SET ${change} WHERE user_id = $1`, [DEMO]);
        const res = await demoRoute.GET(request("GET", "/demo", { ip: "198.51.100.204" }));
        expect(res.status, change).toBe(503);
        expect(sessionCookie(res)).toBeUndefined();
        await admin.query("UPDATE auth.accounts SET is_admin = false, disabled_at = NULL WHERE user_id = $1", [DEMO]);
      }
    } finally {
      console.error = error;
    }
  });
});
