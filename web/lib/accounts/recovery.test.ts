import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ after: vi.fn(), request: vi.fn(), send: vi.fn(), available: vi.fn(() => true) }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("./recovery", () => ({ recoveryAvailable: mocks.available, requestPasswordReset: mocks.request, sendPasswordReset: mocks.send }));
import { POST } from "@/app/api/auth/forgot-password/route";
beforeEach(() => { vi.clearAllMocks(); process.env.WEB_ACCOUNTS = "true"; });
it("answers identically before any account lookup or mail delivery", async () => {
  for (const email of ["known@example.com", "missing@example.com", "disabled@example.com", "bad"]) {
    const body = new FormData(); body.set("email", email);
    const res = await POST(new NextRequest("https://viewer.example/api/auth/forgot-password", { method: "POST", body }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/forgot-password?sent=1");
    expect(res.headers.get("cache-control")).toBe("no-store");
  }
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.after).toHaveBeenCalledTimes(3);
});
it("does not schedule mail when unconfigured", async () => {
  mocks.available.mockReturnValueOnce(false);
  const body = new FormData(); body.set("email", "known@example.com");
  await POST(new NextRequest("https://viewer.example/api/auth/forgot-password", { method: "POST", body }));
  expect(mocks.after).not.toHaveBeenCalled();
});
it("protects recovery forms with HTTPS and same-origin checks without requiring a session", async () => {
  const { classifyPath, decideAccounts } = await import("./policy");
  for (const pathname of ["/forgot-password", "/reset-password/example", "/api/auth/forgot-password", "/api/auth/reset-password"]) {
    expect(classifyPath(pathname)).toBe("public");
    expect(decideAccounts({ pathname, secure: true, sameOrigin: false, development: false })).toBe("cross-origin");
    expect(decideAccounts({ pathname, secure: false, sameOrigin: true, development: false })).toBe("insecure");
    expect(decideAccounts({ pathname, secure: true, sameOrigin: true, development: false })).toBe("pass");
  }
  expect(classifyPath("/reset-password/example/extra")).toBe("protected");
});
