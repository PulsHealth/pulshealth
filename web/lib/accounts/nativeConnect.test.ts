import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findSession: vi.fn(), connectPhone: vi.fn() }));
vi.mock("./session", async original => ({ ...(await original<typeof import("./session")>()), findSession: mocks.findSession }));
vi.mock("./connect", () => ({ connectPhone: mocks.connectPhone }));
import { POST } from "@/app/api/native/connect/route";
import { classifyPath, decideAccounts } from "./policy";
const token = "A".repeat(43);
const session = { id: Buffer.alloc(32, 1), accountId: "account", userId: "own-user", email: "person@example.com", demo: false };
function request(authorization: string | null = `Bearer ${token}`) {
  const headers: Record<string, string> = { cookie: `__Host-puls-session=${token}`, "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  return new NextRequest("https://viewer.example/api/native/connect", {
    method: "POST", headers, body: JSON.stringify({ userID: "someone-else", name: "someone-else" }),
  });
}
beforeEach(() => {
  vi.stubEnv("WEB_ACCOUNTS", "true");
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.findSession.mockResolvedValue(session);
  mocks.connectPhone.mockResolvedValue({ ok: true, link: "puls://pair?fixture" });
});
afterEach(() => vi.unstubAllEnvs());
describe("native managed server connection", () => {
  it("exempts exactly this bearer route and still requires TLS", () => {
    expect(classifyPath("/api/native/connect")).toBe("oauth");
    expect(classifyPath("/api/native/connect/extra")).toBe("protected");
    expect(decideAccounts({ pathname: "/api/native/connect", secure: false, sameOrigin: false, development: false })).toBe("insecure");
  });
  it("never mints a credential for cookies, malformed bearer tokens, expired or demo sessions", async () => {
    for (const header of [null, "Bearer bad", `Basic ${token}`]) {
      expect((await POST(request(header))).status).toBe(401);
    }
    expect(mocks.findSession).not.toHaveBeenCalled();
    for (const value of [null, { ...session, demo: true }]) {
      mocks.findSession.mockResolvedValue(value);
      expect((await POST(request())).status).toBe(401);
    }
    expect(mocks.connectPhone).not.toHaveBeenCalled();
  });
  it("pairs only the bearer account and ignores caller-supplied identity", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ link: "puls://pair?fixture" });
    expect(mocks.findSession).toHaveBeenCalledWith(token, true);
    expect(mocks.connectPhone).toHaveBeenCalledWith(session, "iPhone");
  });
  it("returns connection failures without manufacturing a pairing", async () => {
    mocks.connectPhone.mockResolvedValue({ ok: false, code: "devices", error: "Device limit reached." });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Device limit reached." });
    mocks.findSession.mockRejectedValue(new Error("private database error"));
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain("private");
  });
  it("is absent when accounts mode is off", async () => {
    vi.stubEnv("WEB_ACCOUNTS", "false");
    expect((await POST(request())).status).toBe(404);
    expect(mocks.findSession).not.toHaveBeenCalled();
  });
});
