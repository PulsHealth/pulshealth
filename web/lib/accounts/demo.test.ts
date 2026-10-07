// GET /demo (app/demo/route.ts), with the database mocked out: off unless
// accounts mode names a demo user; never replaces a live session; refuses an
// account unfit for strangers; otherwise a two-hour, non-sliding session with
// no browser or address recorded, twenty an hour per client address from a
// bucket of its own. The view-only refusals are in refusals.test.ts.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessions = vi.hoisted(() => ({ findSession: vi.fn(), createDemoSession: vi.fn(), createSession: vi.fn() }));
const store = vi.hoisted(() => ({ findDemoAccount: vi.fn() }));
vi.mock("./session", async (importOriginal) => ({ ...(await importOriginal<typeof import("./session")>()), ...sessions }));
vi.mock("./store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./store")>()), ...store }));

const DEMO_USER = "0d3a0000-0000-4000-8000-0000000000ab";
const ACCOUNT = { id: "00000000-0000-4000-8000-000000000001", disabled: false, hasPassword: true, isAdmin: false, selfService: false };
const NEW_TOKEN = "N".repeat(43);
const OLD_TOKEN = "O".repeat(43);

function visit(ip: string, cookie?: string, extra: Record<string, string> = {}): NextRequest {
  const headers = new Headers({ host: "viewer.example", "x-forwarded-proto": "https", "x-forwarded-for": ip, "user-agent": "Mozilla/5.0 (Macintosh)", ...extra });
  if (cookie) headers.set("cookie", `__Host-puls-session=${cookie}`);
  return new NextRequest(new URL("/demo", "http://web:3000"), { method: "GET", headers });
}

const saved = { ...process.env };
let ipCounter = 0;
/** A fresh client address per test, so the in-process bucket starts full. */
const freshIp = () => `198.51.100.${++ipCounter}`;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  process.env.WEB_ACCOUNTS = "true";
  process.env.WEB_DEMO_USER = DEMO_USER;
  process.env.TRUST_PROXY_HEADERS = "true";
  delete process.env.WEB_CLIENT_IP_HEADER;
  delete process.env.WEB_AUTH_PASSWORD;
  for (const fn of [...Object.values(sessions), ...Object.values(store)]) fn.mockReset();
  sessions.findSession.mockResolvedValue(null);
  sessions.createDemoSession.mockResolvedValue(NEW_TOKEN);
  store.findDemoAccount.mockResolvedValue(ACCOUNT);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.env = { ...saved };
});

async function GET(req: NextRequest) {
  const { GET } = await import("@/app/demo/route");
  return GET(req);
}

describe("GET /demo", () => {
  it("does not exist unless accounts mode names a demo user", async () => {
    for (const env of [{ WEB_DEMO_USER: "" }, { WEB_ACCOUNTS: "false" }, { WEB_DEMO_USER: "not-a-uuid" }]) {
      Object.assign(process.env, { WEB_ACCOUNTS: "true", WEB_DEMO_USER: DEMO_USER }, env);
      const res = await GET(visit(freshIp()));
      expect(res.status, JSON.stringify(env)).toBe(404);
    }
    expect(sessions.findSession).not.toHaveBeenCalled();
    expect(store.findDemoAccount).not.toHaveBeenCalled();
    expect(sessions.createDemoSession).not.toHaveBeenCalled();
  });

  it("signs a visitor into the demo account: two hours, never sliding, no browser or address kept", async () => {
    const res = await GET(visit(freshIp(), OLD_TOKEN));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(store.findDemoAccount).toHaveBeenCalledWith(DEMO_USER);
    // Only the account id: nothing about the request reaches the session row.
    expect(sessions.createDemoSession).toHaveBeenCalledWith(ACCOUNT.id);
    expect(sessions.createSession).not.toHaveBeenCalled();
    const cookie = res.cookies.get("__Host-puls-session");
    expect(cookie).toMatchObject({ value: NEW_TOKEN, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 7_200 });
  });

  it("never replaces a live session, the demo's or anyone else's", async () => {
    for (const live of [{ demo: false, userId: "11111111-1111-4111-8111-111111111111" }, { demo: true, userId: DEMO_USER }]) {
      sessions.findSession.mockResolvedValueOnce({ id: Buffer.alloc(32), accountId: "x", ...live });
      const res = await GET(visit(freshIp(), OLD_TOKEN));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
      expect(res.cookies.get("__Host-puls-session")).toBeUndefined();
    }
    expect(sessions.findSession).toHaveBeenCalledWith(OLD_TOKEN);
    expect(sessions.createDemoSession).not.toHaveBeenCalled();
  });

  it("refuses an account unfit for strangers, naming no one in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ip = freshIp();
    for (const account of [
      null,
      { ...ACCOUNT, disabled: true },
      { ...ACCOUNT, hasPassword: false },
      { ...ACCOUNT, isAdmin: true },
      { ...ACCOUNT, selfService: true },
    ]) {
      store.findDemoAccount.mockResolvedValueOnce(account);
      const res = await GET(visit(ip));
      expect(res.status, JSON.stringify(account)).toBe(503);
      expect(res.cookies.get("__Host-puls-session")).toBeUndefined();
    }
    expect(sessions.createDemoSession).not.toHaveBeenCalled();
    const logged = error.mock.calls.map(String).join("\n");
    expect(logged).toMatch(/has no viewer account/);
    expect(logged).toMatch(/administrator/);
    expect(logged).toMatch(/approved sign-up/);
    expect(logged).not.toContain(DEMO_USER);
    expect(logged).not.toContain(ACCOUNT.id);
    expect(logged).not.toContain(ip);
    // Refusals are refunded: the address can still start a demo once fixed.
    for (let i = 0; i < 20; i++) expect((await GET(visit(ip))).status).toBe(303);
  });

  it("answers a database failure with a 503, never a sign-in", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sessions.findSession.mockRejectedValueOnce(new Error("connection refused"));
    expect((await GET(visit(freshIp(), OLD_TOKEN))).status).toBe(503);
    sessions.createDemoSession.mockRejectedValueOnce(new Error("connection refused"));
    expect((await GET(visit(freshIp()))).status).toBe(503);
  });

  it("starts twenty sessions an hour per client address, from its own bucket", async () => {
    const ip = freshIp();
    for (let i = 0; i < 20; i++) expect((await GET(visit(ip))).headers.get("location")).toBe("/");
    const res = await GET(visit(ip));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?error=demo_busy");
    expect(sessions.createDemoSession).toHaveBeenCalledTimes(20);
    // Another address is unaffected, and the sign-in failure buckets were never charged.
    expect((await GET(visit(freshIp()))).headers.get("location")).toBe("/");
    const { authFailures, checkAll, failureKeys } = await import("./ratelimit");
    expect(checkAll(authFailures, failureKeys(ip)).allowed).toBe(true);
    expect(authFailures.size).toBe(0);
  });
});

describe("proxy.ts and /demo", () => {
  it("lets /demo through without a session, over HTTPS only", async () => {
    const { default: proxy } = await import("@/proxy");
    const res = await proxy(visit(freshIp()));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(sessions.findSession).not.toHaveBeenCalled();
    delete process.env.TRUST_PROXY_HEADERS;
    const plain = await proxy(new NextRequest(new URL("/demo", "http://viewer.example"), { method: "GET" }));
    expect(plain.status).toBe(403);
  });
});
