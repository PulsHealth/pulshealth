import { describe, expect, it, vi } from "vitest";

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
    // A row past the cap is dead weight too: the sign-in sweep removes it.
    await createSession("00000000-0000-4000-8000-000000000000", { userAgent: null, ip: null });
    const sweep = queryMock.mock.calls.find(([sql]) => String(sql).startsWith("DELETE FROM auth.sessions"));
    expect(sweep?.[0]).toMatch(/created_at < now\(\) - make_interval\(days => \$1\)/);
    expect(sweep?.[1]).toEqual([SESSION_ABSOLUTE_DAYS]);
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
});
