import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accounts/session", () => ({
  findSession: vi.fn(),
  SESSION_COOKIE: "puls-session",
  sessionCookieAttributes: () => ({ httpOnly: true, secure: true, path: "/", maxAge: 0 }),
}));

import proxy from "@/proxy";
import { findSession } from "@/lib/accounts/session";

const lookup = vi.mocked(findSession);
const request = (path = "/", method = "GET", cookie?: string) => new NextRequest(`https://viewer.example${path}`, {
  method,
  headers: { origin: "https://viewer.example", ...(cookie ? { cookie: `puls-session=${cookie}` } : {}) },
});

beforeEach(() => {
  vi.stubEnv("WEB_ACCOUNTS", "true");
  vi.stubEnv("WEB_DEMO_USER", "0d3a0000-0000-4000-8000-000000000001");
  vi.stubEnv("WEB_PUBLIC_URL", "https://viewer.example");
  vi.stubEnv("TRUST_PROXY_HEADERS", "false");
  lookup.mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("signed-out dashboard entry", () => {
  it("opens the configured demo through its existing session route", async () => {
    const response = await proxy(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://viewer.example/demo");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("clears an expired cookie before entering the demo", async () => {
    const response = await proxy(request("/", "GET", "expired"));
    expect(response.headers.get("location")).toBe("https://viewer.example/demo");
    expect(response.cookies.get("puls-session")?.value).toBe("");
  });

  it("keeps authentication for other pages, APIs and writes", async () => {
    expect((await proxy(request("/account"))).headers.get("location")).toBe("https://viewer.example/login?next=%2Faccount");
    expect((await proxy(request("/api/user"))).status).toBe(401);
    expect((await proxy(request("/", "POST"))).status).toBe(401);
    expect((await proxy(request("/login"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("uses sign-in when no demo is configured", async () => {
    vi.stubEnv("WEB_DEMO_USER", "");
    expect((await proxy(request())).headers.get("location")).toBe("https://viewer.example/login");
  });

  it("preserves signed-in visitors and existing demo sessions", async () => {
    for (const demo of [false, true]) {
      lookup.mockResolvedValue({ userId: "user", email: "test@example.invalid", demo, refreshed: false } as NonNullable<Awaited<ReturnType<typeof findSession>>>);
      const response = await proxy(request("/", "GET", "active"));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
      expect(response.cookies.get("puls-session")).toBeUndefined();
    }
  });
});
