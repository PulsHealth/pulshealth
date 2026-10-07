import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({ query: queryMock, transaction: vi.fn() }));

describe("session tokens and cookie", async () => {
  const { newToken, SESSION_COOKIE, sessionCookieAttributes, tokenHash } = await import("./session");

  it("makes 256-bit tokens and stores only their SHA-256", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    const hash = tokenHash(token);
    expect(hash).toHaveLength(32);
    expect(hash!.equals(Buffer.from(token, "base64url"))).toBe(false);
    expect(tokenHash(token)!.equals(hash!)).toBe(true);
    expect(newToken()).not.toBe(token);
  });

  it("never sends junk to the database", () => {
    for (const bad of [undefined, null, "", "short", `${newToken()}x`, "a".repeat(42) + "!"]) {
      expect(tokenHash(bad)).toBeNull();
    }
  });

  it("caps a session at 90 days from sign-in, however often it is used", async () => {
    const { findSession, createSession, SESSION_ABSOLUTE_DAYS } = await import("./session");
    expect(SESSION_ABSOLUTE_DAYS).toBe(90);
    queryMock.mockReset();
    queryMock.mockResolvedValue([]);
    expect(await findSession(newToken(), true)).toBeNull();
    const [lookup, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(lookup).toMatch(/s\.expires_at > now\(\)/);
    expect(lookup).toMatch(/s\.created_at > now\(\) - make_interval\(days => \$2\)/);
    expect(params[1]).toBe(SESSION_ABSOLUTE_DAYS);
    // Signing in no longer sweeps expired rows: the database's hourly job
    // does (auth.prune_signups, 018_web_accounts_hardening.sql).
    queryMock.mockReset();
    queryMock.mockResolvedValue([]);
    await createSession("00000000-0000-4000-8000-000000000000", { userAgent: null, ip: null });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toMatch(/^\s*INSERT INTO auth\.sessions/);
    expect(queryMock.mock.calls.some(([sql]) => /DELETE/.test(String(sql)))).toBe(false);
  });

  it("knows an address only from the account's own live sessions, and only a real address", async () => {
    const { signedInFrom, SESSION_ABSOLUTE_DAYS } = await import("./session");
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([{ "?column?": 1 }]).mockResolvedValueOnce([]);
    expect(await signedInFrom("a@example.com", "198.51.100.7")).toBe(true);
    expect(await signedInFrom("a@example.com", "2001:db8::1")).toBe(false);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/a\.email = \$1 AND s\.ip = \$2::inet/);
    expect(sql).toMatch(/s\.expires_at > now\(\)/);
    expect(sql).toMatch(/s\.created_at > now\(\) - make_interval\(days => \$3\)/);
    expect(params).toEqual(["a@example.com", "198.51.100.7", SESSION_ABSOLUTE_DAYS]);
    // Without trusted proxy headers every client is "direct": never known,
    // and never a query.
    queryMock.mockReset();
    for (const ip of ["direct", "unknown", "", "evil, 198.51.100.7"]) expect(await signedInFrom("a@example.com", ip)).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("is a __Host- cookie: Secure, HttpOnly, SameSite=Lax, Path=/, 30 days", () => {
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(sessionCookieAttributes()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86_400,
    });
    expect(sessionCookieAttributes(0).maxAge).toBe(0);
  });

  describe("the demo account's sessions", () => {
    const DEMO = "0d3a0000-0000-4000-8000-0000000000ab";
    const row = (over: Record<string, unknown> = {}) => ({
      account_id: "00000000-0000-4000-8000-000000000001",
      user_id: DEMO,
      email: "demo@demo.invalid",
      is_admin: false,
      self_service: false,
      stale: true,
      ...over,
    });
    const saved = { ...process.env };
    beforeEach(() => {
      process.env.WEB_ACCOUNTS = "true";
      process.env.WEB_DEMO_USER = DEMO;
      queryMock.mockReset();
    });
    afterEach(() => {
      process.env = { ...saved };
    });

    it("never slide, however stale, and are marked demo", async () => {
      const { findSession } = await import("./session");
      queryMock.mockResolvedValueOnce([row()]);
      const session = await findSession(newTokenForTest(), true);
      expect(session).toMatchObject({ userId: DEMO, demo: true, refreshed: false });
      // The lookup, and no UPDATE after it.
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("are never an administrator's or self-service, whatever the rows say", async () => {
      const { findSession } = await import("./session");
      queryMock.mockResolvedValueOnce([row({ is_admin: true, self_service: true })]);
      expect(await findSession(newTokenForTest())).toMatchObject({ demo: true, isAdmin: false, selfService: false });
    });

    it("leave every other account's sessions as they were, sliding included", async () => {
      const { findSession } = await import("./session");
      const other = row({ user_id: "11111111-1111-4111-8111-111111111111", is_admin: true });
      queryMock.mockResolvedValueOnce([other]).mockResolvedValueOnce([{ "?column?": 1 }]);
      expect(await findSession(newTokenForTest(), true)).toMatchObject({ demo: false, isAdmin: true, refreshed: true });
      expect(String(queryMock.mock.calls[1][0])).toMatch(/^\s*UPDATE auth\.sessions/);
      // No demo configured: nobody is the demo.
      delete process.env.WEB_DEMO_USER;
      queryMock.mockResolvedValueOnce([row({ stale: false })]);
      expect(await findSession(newTokenForTest())).toMatchObject({ demo: false });
    });

    it("start with two hours to live and record no browser or address", async () => {
      const { createDemoSession, DEMO_SESSION_HOURS, DEMO_SESSION_MAX_AGE_SECONDS, tokenHash } = await import("./session");
      expect(DEMO_SESSION_HOURS).toBe(2);
      expect(DEMO_SESSION_MAX_AGE_SECONDS).toBe(7_200);
      queryMock.mockResolvedValueOnce([]);
      const token = await createDemoSession("00000000-0000-4000-8000-000000000001");
      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/INSERT INTO auth\.sessions \(id, account_id, expires_at, user_agent, ip\)/);
      expect(sql).toMatch(/now\(\) \+ make_interval\(hours => \$3\), NULL, NULL\)/);
      expect(params).toEqual([tokenHash(token), "00000000-0000-4000-8000-000000000001", 2]);
    });
  });
});

function newTokenForTest(): string {
  return "B".repeat(43);
}
