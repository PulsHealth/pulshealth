// The accounts route handlers' own decisions, with the database mocked out:
// /api/admin's refusals and bulk decline, the sign-up form's silence when
// the queue is full, and sign-in's known-address exemption from the email
// bucket. The database's side of each is in signups.integration.test.ts and
// accounts.integration.test.ts.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const signups = vi.hoisted(() => ({
  declineSignups: vi.fn(),
  disableRefusal: vi.fn(),
  setAccountDisabled: vi.fn(),
  purgeUser: vi.fn(),
  createSignupRequest: vi.fn(),
  accountExists: vi.fn(),
}));
const sessions = vi.hoisted(() => ({ findSession: vi.fn(), signedInFrom: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn() }));
const store = vi.hoisted(() => ({ findAccountForLogin: vi.fn(), replacePasswordHash: vi.fn() }));
const mail = vi.hoisted(() => ({ notifyNewRequest: vi.fn() }));

vi.mock("./signups", async (importOriginal) => ({ ...(await importOriginal<typeof import("./signups")>()), ...signups }));
vi.mock("./session", async (importOriginal) => ({ ...(await importOriginal<typeof import("./session")>()), ...sessions }));
vi.mock("./store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./store")>()), ...store }));
vi.mock("./mail", () => mail);
vi.mock("./password", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./password")>()),
  verifyPassword: vi.fn(async (password: string) => password === "the right passphrase"),
  needsRehash: vi.fn(() => false),
  burnPasswordCheck: vi.fn(async () => {}),
}));

const ADMIN = { id: Buffer.alloc(32, 1), accountId: "10000000-0000-4000-8000-000000000001", isAdmin: true };
const OTHER = "10000000-0000-4000-8000-000000000002";
const REQ1 = "20000000-0000-4000-8000-000000000001";
const REQ2 = "20000000-0000-4000-8000-000000000002";

function post(path: string, fields: [string, string][], ip = "198.51.100.1") {
  const body = new FormData();
  for (const [k, v] of fields) body.append(k, v);
  const headers = new Headers({ host: "viewer.example", origin: "https://viewer.example", "x-forwarded-for": ip });
  return new NextRequest(new URL(path, "http://web:3000"), { method: "POST", headers, body });
}
const location = (res: Response) => res.headers.get("location");

const saved = { ...process.env };
beforeAll(() => {
  process.env.WEB_ACCOUNTS = "true";
  process.env.WEB_SIGNUPS = "true";
  process.env.TRUST_PROXY_HEADERS = "true";
  delete process.env.WEB_CLIENT_IP_HEADER;
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  for (const group of [signups, sessions, store, mail]) for (const fn of Object.values(group)) fn.mockReset();
  sessions.findSession.mockResolvedValue(ADMIN);
  signups.declineSignups.mockResolvedValue(1);
  signups.disableRefusal.mockResolvedValue(null);
});

describe("/api/admin", async () => {
  const { POST } = await import("@/app/api/admin/route");

  it("refuses anyone but an administrator", async () => {
    sessions.findSession.mockResolvedValue({ ...ADMIN, isAdmin: false });
    expect(location(await POST(post("/api/admin", [["action", "deny"], ["id", REQ1]])))).toBe("/admin?error=forbidden");
    expect(signups.declineSignups).not.toHaveBeenCalled();
  });

  it("never disables or enables the administrator's own account, or another administrator's", async () => {
    signups.disableRefusal.mockResolvedValueOnce("own");
    expect(location(await POST(post("/api/admin", [["action", "disable"], ["id", ADMIN.accountId]])))).toBe("/admin?error=own_account");
    signups.disableRefusal.mockResolvedValueOnce("admin");
    expect(location(await POST(post("/api/admin", [["action", "enable"], ["id", OTHER]])))).toBe("/admin?error=admin_account");
    expect(signups.setAccountDisabled).not.toHaveBeenCalled();
    expect(signups.disableRefusal).toHaveBeenCalledWith(ADMIN.accountId, OTHER);

    // The database's own refusal (a promotion since the check) reads the same.
    signups.setAccountDisabled.mockRejectedValueOnce(Object.assign(new Error("managed from the server"), { code: "42501" }));
    expect(location(await POST(post("/api/admin", [["action", "disable"], ["id", OTHER]])))).toBe("/admin?error=admin_account");

    signups.setAccountDisabled.mockResolvedValueOnce(undefined);
    expect(location(await POST(post("/api/admin", [["action", "disable"], ["id", OTHER]])))).toBe("/admin?notice=disabled");
    expect(signups.setAccountDisabled).toHaveBeenLastCalledWith(ADMIN.id, OTHER, true);
  });

  it("declines one request through the database function", async () => {
    expect(location(await POST(post("/api/admin", [["action", "deny"], ["id", REQ1]])))).toBe("/admin?notice=denied");
    expect(signups.declineSignups).toHaveBeenCalledWith(ADMIN.id, [REQ1]);
    expect(location(await POST(post("/api/admin", [["action", "deny"], ["id", "not-a-uuid"]])))).toBe("/admin?error=failed");
  });

  it("declines the ticked requests, ignoring junk and repeats", async () => {
    const res = await POST(
      post("/api/admin", [["action", "deny_many"], ["scope", "selected"], ["ids", REQ1], ["ids", "junk"], ["ids", REQ2.toUpperCase()], ["ids", REQ1]]),
    );
    expect(location(res)).toBe("/admin?notice=denied_many");
    expect(signups.declineSignups).toHaveBeenCalledWith(ADMIN.id, [REQ1, REQ2]);
    // Nothing ticked: nothing declined.
    expect(location(await POST(post("/api/admin", [["action", "deny_many"], ["scope", "selected"]])))).toBe("/admin?error=none_selected");
    expect(signups.declineSignups).toHaveBeenCalledTimes(1);
  });

  it("declines every request shown only behind its confirm box", async () => {
    const shown: [string, string][] = [["action", "deny_many"], ["scope", "shown"], ["shown", REQ1], ["shown", REQ2], ["ids", OTHER]];
    expect(location(await POST(post("/api/admin", shown)))).toBe("/admin?error=failed");
    expect(signups.declineSignups).not.toHaveBeenCalled();
    expect(location(await POST(post("/api/admin", [...shown, ["confirm", "yes"]])))).toBe("/admin?notice=denied_many");
    // The shown list, not the ticks.
    expect(signups.declineSignups).toHaveBeenCalledWith(ADMIN.id, [REQ1, REQ2]);
  });
});

describe("/api/auth/signup", async () => {
  const { POST } = await import("@/app/api/auth/signup/route");

  it("answers a request dropped at the cap exactly like an accepted one, and mails no one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    signups.accountExists.mockResolvedValue(false);
    const outcomes: string[] = [];
    for (const [i, outcome] of (["created", "exists", "full", "full"] as const).entries()) {
      signups.createSignupRequest.mockResolvedValueOnce(outcome);
      mail.notifyNewRequest.mockResolvedValue(undefined);
      const res = await POST(post("/api/auth/signup", [["email", `p${i}@example.com`], ["consent", "yes"]], `198.51.100.${30 + i}`));
      outcomes.push(location(res)!);
    }
    expect(outcomes).toEqual(Array(4).fill("/signup?notice=received"));
    expect(mail.notifyNewRequest).toHaveBeenCalledTimes(1);
    // The operator hears about the full queue once, without an address.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/500 sign-up requests are waiting/);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/@/);
    warn.mockRestore();
  });
});

describe("/api/auth/login", async () => {
  const { POST } = await import("@/app/api/auth/login/route");
  const { authFailures } = await import("./ratelimit");
  const login = (email: string, password: string, ip: string) =>
    POST(post("/api/auth/login", [["email", email], ["password", password]], ip));

  it("lets the owner in from an address they signed in from while strangers hold the email bucket empty", async () => {
    const email = "owner@example.com";
    store.findAccountForLogin.mockResolvedValue({ id: OTHER, userId: OTHER, passwordHash: "x" });
    sessions.createSession.mockResolvedValue("t".repeat(43));
    sessions.signedInFrom.mockImplementation(async (_email: string, ip: string) => ip === "198.51.100.77");

    // While the email's bucket has room nobody asks the database about the address.
    expect(location(await login(email, "wrong guess", "203.0.113.1"))).toBe("/login?error=invalid");
    expect(sessions.signedInFrom).not.toHaveBeenCalled();
    for (let i = 2; i <= 12; i++) await login(email, "wrong guess", `203.0.113.${i}`);

    // Exhausted: a stranger with the right password is refused unchecked...
    expect(location(await login(email, "the right passphrase", "203.0.113.50"))).toBe("/login?error=throttled");
    // ...the owner, from a known address, is not.
    expect(location(await login(email, "the right passphrase", "198.51.100.77"))).toBe("/");
    expect(sessions.signedInFrom).toHaveBeenCalledWith(email, "198.51.100.77");
    // And a known address still has its own bucket.
    for (let i = 0; i < 10; i++) await login(email, "wrong guess", "198.51.100.77");
    expect(location(await login(email, "the right passphrase", "198.51.100.77"))).toBe("/login?error=throttled");
  });

  it("treats a failed lookup as an unknown address", async () => {
    const email = "lookup@example.com";
    store.findAccountForLogin.mockResolvedValue(null);
    for (let i = 0; i < 10; i++) authFailures.fail(`email:${email}`);
    sessions.signedInFrom.mockRejectedValue(new Error("database down"));
    expect(location(await login(email, "the right passphrase", "198.51.100.88"))).toBe("/login?error=throttled");
  });
});
