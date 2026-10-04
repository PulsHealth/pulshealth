import { afterEach, describe, expect, it, vi } from "vitest";

import { isOAuthPath, oauthConfig, readOAuthConfig } from "./config";

const SECRET = "0123456789abcdef0123456789abcdef";
const ON = {
  WEB_ACCOUNTS: "true",
  WEB_PUBLIC_URL: "https://viewer.example.com/",
  PULS_MCP_URL: "https://mcp.example.com/mcp",
  PULS_MCP_OAUTH_SECRET: SECRET,
};

afterEach(() => vi.restoreAllMocks());

describe("readOAuthConfig", () => {
  it("is on with all three settings in accounts mode, the issuer without its trailing slash", () => {
    expect(readOAuthConfig(ON)).toEqual({
      state: "on",
      config: { issuer: "https://viewer.example.com", resource: "https://mcp.example.com/mcp", secret: SECRET },
    });
  });

  it("is off outside accounts mode, and with neither the secret nor the URL", () => {
    expect(readOAuthConfig({ ...ON, WEB_ACCOUNTS: "false" }).state).toBe("off");
    expect(readOAuthConfig({ ...ON, WEB_ACCOUNTS: undefined, WEB_AUTH_PASSWORD: "x" }).state).toBe("off");
    expect(readOAuthConfig({ WEB_ACCOUNTS: "true", WEB_PUBLIC_URL: ON.WEB_PUBLIC_URL }).state).toBe("off");
  });

  it("refuses a short or placeholder secret, a missing setting, and non-https URLs", () => {
    for (const env of [
      { ...ON, PULS_MCP_OAUTH_SECRET: "change-me" },
      { ...ON, PULS_MCP_OAUTH_SECRET: SECRET.slice(1) },
      { ...ON, PULS_MCP_OAUTH_SECRET: undefined },
      { ...ON, PULS_MCP_URL: undefined },
      { ...ON, WEB_PUBLIC_URL: undefined },
      { ...ON, PULS_MCP_URL: "http://mcp.example.com/mcp" },
      { ...ON, PULS_MCP_URL: "https://mcp.example.com/mcp?x=1" },
      { ...ON, PULS_MCP_URL: "not a url" },
      { ...ON, WEB_PUBLIC_URL: "http://viewer.example.com" },
    ]) {
      expect(readOAuthConfig(env).state, JSON.stringify(env)).toBe("invalid");
    }
    // Loopback http is fine for development.
    expect(readOAuthConfig({ ...ON, WEB_PUBLIC_URL: "http://localhost:3000", PULS_MCP_URL: "http://127.0.0.1:8090/mcp" }).state).toBe("on");
  });

  it("fails closed with one logged error, not one per request", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { ...ON, PULS_MCP_OAUTH_SECRET: "change-me" };
    expect(oauthConfig(bad)).toBeNull();
    expect(oauthConfig(bad)).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    // The message names the variable, never its value.
    expect(String(error.mock.calls[0][0])).toContain("PULS_MCP_OAUTH_SECRET");
    const short = readOAuthConfig({ ...ON, PULS_MCP_OAUTH_SECRET: "short-secret-value" });
    expect(short.state === "invalid" && short.problem).not.toContain("short-secret-value");
    expect(oauthConfig(ON)).not.toBeNull();
  });
});

describe("isOAuthPath", () => {
  it("names exactly the OAuth endpoints", () => {
    for (const p of [
      "/.well-known/oauth-authorization-server",
      "/oauth/register",
      "/oauth/authorize",
      "/oauth/authorize/decision",
      "/oauth/token",
      "/oauth/revoke",
    ]) {
      expect(isOAuthPath(p), p).toBe(true);
    }
    for (const p of ["/oauth", "/oauth/", "/oauth/token/x", "/.well-known/openid-configuration", "/api/auth/assistants"]) {
      expect(isOAuthPath(p), p).toBe(false);
    }
  });
});
