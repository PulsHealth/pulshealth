import { describe, expect, it } from "vitest";

import { isTrue, parseFlag, signupsOpen, trustProxyHeaders, viewerMode } from "./mode";

describe("viewerMode", () => {
  it("is accounts when WEB_ACCOUNTS is on, whatever else is set", () => {
    expect(viewerMode({ WEB_ACCOUNTS: "true" })).toBe("accounts");
    expect(viewerMode({ WEB_ACCOUNTS: "1", WEB_AUTH_PASSWORD: "x" })).toBe("accounts");
  });

  it("falls back to basic with a password, open without", () => {
    expect(viewerMode({ WEB_ACCOUNTS: "false", WEB_AUTH_PASSWORD: "pw" })).toBe("basic");
    expect(viewerMode({ WEB_ACCOUNTS: "" })).toBe("open");
    expect(viewerMode({})).toBe("open");
  });

  it("reads flags the way the Go services do", () => {
    for (const on of ["true", "TRUE", "1", "yes", "on", " true "]) expect(isTrue(on), on).toBe(true);
    for (const off of [undefined, "", "false", "0", "no", "off", "truthy"]) expect(isTrue(off), String(off)).toBe(false);
    expect(trustProxyHeaders({ TRUST_PROXY_HEADERS: "true" })).toBe(true);
    expect(trustProxyHeaders({})).toBe(false);
  });

  it("parses TRUST_PROXY_HEADERS exactly as ingest, the API and the MCP server do", () => {
    for (const on of ["true", "TRUE", "True", "1", "yes", "YES", "on", "On", " true "]) {
      expect(parseFlag("X", on), on).toBe(true);
      expect(trustProxyHeaders({ TRUST_PROXY_HEADERS: on }), on).toBe(true);
    }
    for (const off of ["false", "FALSE", "0", "no", "off", " Off "]) expect(parseFlag("X", off), off).toBe(false);
    // Empty or unset is the default (false for this one).
    for (const empty of [undefined, "", "  "]) {
      expect(parseFlag("X", empty), String(empty)).toBe(false);
      expect(parseFlag("X", empty, true), String(empty)).toBe(true);
    }
    // Anything else is an error naming the variable, never a quiet "off".
    for (const bad of ["truthy", "t", "f", "y", "2", "enabled", "tru e"]) {
      expect(() => parseFlag("TRUST_PROXY_HEADERS", bad), bad).toThrow(/^TRUST_PROXY_HEADERS must be true or false/);
    }
    expect(() => parseFlag("TRUST_PROXY_HEADERS", " ture ")).toThrow('got "ture"');
    // At request time (startup already refused it) an unparseable value is
    // the safe reading: do not trust.
    expect(trustProxyHeaders({ TRUST_PROXY_HEADERS: "ture" })).toBe(false);
  });

  it("opens sign-up requests only in accounts mode, and only when asked", () => {
    expect(signupsOpen({ WEB_ACCOUNTS: "true", WEB_SIGNUPS: "true" })).toBe(true);
    expect(signupsOpen({ WEB_ACCOUNTS: "true" })).toBe(false);
    expect(signupsOpen({ WEB_SIGNUPS: "true" })).toBe(false);
    expect(signupsOpen({ WEB_AUTH_PASSWORD: "pw", WEB_SIGNUPS: "true" })).toBe(false);
  });
});
