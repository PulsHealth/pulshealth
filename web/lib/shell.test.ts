import { describe, expect, it } from "vitest";

import { isBarePage } from "./shell";

describe("isBarePage", () => {
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
