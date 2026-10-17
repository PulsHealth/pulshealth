import { describe, expect, it } from "vitest";

import { isBarePage } from "./shell";

describe("isBarePage", () => {
  it.each([
    "/login", "/signup", "/invite/example-token", "/forgot-password",
    "/reset-password/example-token", "/deletion/example-token",
  ])("keeps %s outside dashboard navigation for every session", (pathname) => {
    expect(isBarePage(pathname)).toBe(true);
  });

  it.each(["/login-extra", "/signup-extra", "/invites/token", "/forgot-password-extra", "/reset-passwords/token"])(
    "keeps unrelated route %s in the dashboard",
    (pathname) => { expect(isBarePage(pathname)).toBe(false); },
  );

  it("centres OAuth and phone connection pages", () => {
    expect(isBarePage("/connect/iphone")).toBe(true);
    expect(isBarePage("/connect/iphonex")).toBe(false);
    expect(isBarePage("/oauth/authorize")).toBe(true);
    expect(isBarePage("/oauth")).toBe(true);
    expect(isBarePage("/oauthx")).toBe(false);
    expect(isBarePage("/")).toBe(false);
    expect(isBarePage("/account")).toBe(false);
    expect(isBarePage(null)).toBe(false);
  });
});
