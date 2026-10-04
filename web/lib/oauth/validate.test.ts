import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  checkAuthorizeRequest,
  cleanClientName,
  grantedScope,
  isCodeVerifier,
  type KnownClient,
  pkceChallenge,
  redirectOrigin,
  redirectUriMatches,
  redirectUriProblem,
  redirectWith,
  resourceMatches,
  validateRegistration,
  verifyPkce,
} from "./validate";

describe("redirect URIs", () => {
  it("takes https and loopback http, nothing else", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "http://localhost:33418/callback",
      "http://127.0.0.1:5000/cb?x=1",
      "http://[::1]:8080/callback",
      "http://localhost/callback",
    ]) {
      expect(redirectUriProblem(ok), ok).toBeNull();
    }
    for (const bad of [
      "",
      "http://claude.ai/api/mcp/auth_callback",
      "http://localhost.evil.example/callback",
      "http://127.0.0.2/callback",
      "https://claude.ai/cb#frag",
      "https://claude.ai/cb#",
      "https://user:pass@claude.ai/cb",
      "javascript:alert(1)",
      "claude://callback",
      "/relative",
      "https://claude.ai/a b",
      "https://claude.ai/a\\b",
      `https://claude.ai/${"a".repeat(2000)}`,
      42,
      null,
    ]) {
      expect(redirectUriProblem(bad), String(bad)).not.toBeNull();
    }
  });

  it("matches https exactly", () => {
    const reg = ["https://claude.ai/api/mcp/auth_callback"];
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback/")).toBe(false);
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(redirectUriMatches(reg, "https://claude.ai:443/api/mcp/auth_callback")).toBe(false);
    expect(redirectUriMatches(reg, "https://CLAUDE.ai/api/mcp/auth_callback")).toBe(false);
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback#x")).toBe(false);
  });

  it("matches loopback on any port, but the same host, path and query", () => {
    const reg = ["http://localhost:1234/callback", "http://127.0.0.1/cb?a=1"];
    expect(redirectUriMatches(reg, "http://localhost:1234/callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://localhost:55555/callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://localhost/callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://127.0.0.1:9/cb?a=1")).toBe(true);
    expect(redirectUriMatches(reg, "http://127.0.0.1:9/cb?a=2")).toBe(false);
    expect(redirectUriMatches(reg, "http://127.0.0.1:1234/callback")).toBe(false); // other host
    expect(redirectUriMatches(reg, "http://localhost:1234/other")).toBe(false);
    expect(redirectUriMatches(reg, "https://localhost:1234/callback")).toBe(false);
    expect(redirectUriMatches(reg, "http://localhost:1234/callback#x")).toBe(false);
    // An https registration is never port-agnostic.
    expect(redirectUriMatches(["https://example.com:8443/cb"], "https://example.com:9443/cb")).toBe(false);
  });

  it("gives the consent page's form-action origin only for a valid URI", () => {
    expect(redirectOrigin("https://claude.ai/api/mcp/auth_callback")).toBe("https://claude.ai");
    expect(redirectOrigin("http://localhost:4000/callback")).toBe("http://localhost:4000");
    expect(redirectOrigin("https://claude.ai/x; script-src *")).toBeNull();
    expect(redirectOrigin("javascript:alert(1)")).toBeNull();
    expect(redirectOrigin(null)).toBeNull();
  });

  it("adds answer parameters and keeps the URI's own query", () => {
    expect(redirectWith("http://localhost:1/cb?a=1", { code: "c", state: "s&t", iss: "https://v.example", error: null })).toBe(
      "http://localhost:1/cb?a=1&code=c&state=s%26t&iss=https%3A%2F%2Fv.example",
    );
  });
});

describe("PKCE", () => {
  // Computed independently (Python: urlsafe_b64encode(sha256(v)).rstrip("=")).
  const verifier = "dBjftJeZ4CVP-mJ92K9fRbP_hKbRA8ugVzMRZhH5tFw";
  const challenge = "p_j-Nj_Xa-C0MOoCl6lv9UzGgSvHUvKaouTlEnyXOiE";

  it("verifies S256 against an independently computed pair", () => {
    expect(pkceChallenge(verifier)).toBe(challenge);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("refuses a wrong, short, long or malformed verifier", () => {
    expect(verifyPkce(`${verifier.slice(0, -1)}x`, challenge)).toBe(false);
    expect(verifyPkce(challenge, challenge)).toBe(false); // "plain" is not accepted
    expect(isCodeVerifier("a".repeat(42))).toBe(false);
    expect(isCodeVerifier("a".repeat(129))).toBe(false);
    expect(isCodeVerifier("a".repeat(43))).toBe(true);
    expect(verifyPkce("a b".repeat(20), challenge)).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
    const long = "~".repeat(128);
    expect(verifyPkce(long, createHash("sha256").update(long).digest("base64url"))).toBe(true);
  });
});

describe("scope and resource", () => {
  it("grants health:read for nothing or health:read, and nothing more", () => {
    expect(grantedScope(null)).toBe("health:read");
    expect(grantedScope("")).toBe("health:read");
    expect(grantedScope("health:read")).toBe("health:read");
    expect(grantedScope("health:read health:read")).toBe("health:read");
    expect(grantedScope("health:write")).toBeNull();
    expect(grantedScope("health:read openid")).toBeNull();
  });

  it("takes the MCP URL with or without a trailing slash", () => {
    const r = "https://mcp.example.com/mcp";
    expect(resourceMatches(null, r)).toBe(true);
    expect(resourceMatches(r, r)).toBe(true);
    expect(resourceMatches(`${r}/`, r)).toBe(true);
    expect(resourceMatches("https://mcp.example.com", r)).toBe(false);
    expect(resourceMatches("https://evil.example/mcp", r)).toBe(false);
  });
});

describe("dynamic client registration", () => {
  it("accepts claude.ai's and Claude Code's registrations, defaulting to a public client", () => {
    const web = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "health:read",
    });
    expect(web).toEqual({
      ok: true,
      client: {
        name: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"],
        authMethod: "none",
        grantTypes: ["authorization_code", "refresh_token"],
      },
    });
    const cli = validateRegistration({ redirect_uris: ["http://localhost:33418/callback"], client_name: "Claude Code (puls)" });
    expect(cli.ok && cli.client.authMethod).toBe("none");
    expect(cli.ok && cli.client.grantTypes).toEqual(["authorization_code", "refresh_token"]);
    const confidential = validateRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" });
    expect(confidential.ok && confidential.client.authMethod).toBe("client_secret_basic");
  });

  it("refuses bad redirect URIs", () => {
    for (const uris of [undefined, [], "https://a.example/cb", Array(11).fill("https://a.example/cb"), ["http://a.example/cb"], ["https://a.example/cb#x"]]) {
      const r = validateRegistration({ redirect_uris: uris });
      expect(r.ok, JSON.stringify(uris)).toBe(false);
      if (!r.ok) expect(r.error).toBe("invalid_redirect_uri");
    }
  });

  it("refuses unknown auth methods, grant types, response types and scopes", () => {
    const base = { redirect_uris: ["https://a.example/cb"] };
    for (const extra of [
      { token_endpoint_auth_method: "private_key_jwt" },
      { grant_types: ["client_credentials"] },
      { grant_types: ["refresh_token"] },
      { grant_types: "authorization_code" },
      { response_types: ["token"] },
      { scope: "health:write" },
    ]) {
      const r = validateRegistration({ ...base, ...extra });
      expect(r.ok, JSON.stringify(extra)).toBe(false);
      if (!r.ok) expect(r.error).toBe("invalid_client_metadata");
    }
    expect(validateRegistration(null).ok).toBe(false);
    const own = validateRegistration({ redirect_uris: ["https://viewer.example/oauth/authorize"] }, "https://viewer.example");
    expect(own).toMatchObject({ ok: false, error: "invalid_redirect_uri", description: "a redirect URI must not point at this server" });
    expect(validateRegistration({ redirect_uris: ["https://viewer.example:8443/cb"] }, "https://viewer.example").ok).toBe(true);
    expect(validateRegistration({ redirect_uris: ["https://viewer.example/cb"] }).ok).toBe(true);
    expect(validateRegistration([]).ok).toBe(false);
  });

  it("cleans the self-reported name", () => {
    expect(cleanClientName("Evil\u0000‮ App\n\tName")).toBe("Evil App Name");
    expect(cleanClientName("x".repeat(300))).toHaveLength(100);
    expect(cleanClientName(7)).toBe("");
  });
});

describe("checkAuthorizeRequest", () => {
  const MCP = "https://mcp.example.com/mcp";
  const client: KnownClient = {
    id: "pc_AAAAAAAAAAAAAAAAAAAAAAAA",
    name: "Claude",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback", "http://localhost/callback"],
    grantTypes: ["authorization_code", "refresh_token"],
  };
  const good = {
    client_id: client.id,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "xyz",
    scope: "health:read",
    resource: MCP,
  };
  const check = (over: Record<string, string | string[] | null>, c: KnownClient | null = client) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...good, ...over })) {
      if (v === null) continue;
      for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
    }
    return checkAuthorizeRequest(p, c, MCP);
  };

  it("accepts a complete request", () => {
    expect(check({})).toEqual({
      kind: "ok",
      request: {
        clientId: client.id,
        clientName: "Claude",
        redirectUri: good.redirect_uri,
        codeChallenge: good.code_challenge,
        scope: "health:read",
        resource: MCP,
        state: "xyz",
      },
    });
    const minimal = check({ scope: null, resource: null, state: null, redirect_uri: "http://localhost:6123/callback" });
    expect(minimal.kind === "ok" && minimal.request).toMatchObject({ scope: "health:read", resource: null, state: null });
  });

  it("never redirects for an unknown client or an unregistered redirect URI", () => {
    expect(check({}, null).kind).toBe("fatal");
    expect(check({ client_id: null }).kind).toBe("fatal");
    expect(check({ client_id: [client.id, client.id] }).kind).toBe("fatal");
    expect(check({ redirect_uri: null }).kind).toBe("fatal");
    expect(check({ redirect_uri: "https://evil.example/cb" }).kind).toBe("fatal");
    expect(check({ redirect_uri: "https://claude.ai/api/mcp/auth_callback#x" }).kind).toBe("fatal");
    expect(check({ client_id: "pc_other" }).kind).toBe("fatal");
  });

  it("sends every other problem back to the client", () => {
    const err = (over: Record<string, string | string[] | null>) => {
      const r = check(over);
      return r.kind === "error" ? r.error : r.kind;
    };
    expect(err({ response_type: "token" })).toBe("unsupported_response_type");
    expect(err({ response_type: null })).toBe("invalid_request");
    expect(err({ code_challenge: null })).toBe("invalid_request");
    expect(err({ code_challenge_method: null })).toBe("invalid_request");
    expect(err({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(err({ code_challenge: "short" })).toBe("invalid_request");
    expect(err({ scope: "health:write" })).toBe("invalid_scope");
    expect(err({ resource: "https://evil.example/mcp" })).toBe("invalid_target");
    expect(err({ resource: [MCP, MCP] })).toBe("invalid_target");
    expect(err({ resource: `${MCP}/` })).toBe("ok");
    expect(err({ state: ["a", "b"] })).toBe("invalid_request");
    expect(err({ state: "s".repeat(2001) })).toBe("invalid_request");
    const r = check({ response_type: "token" });
    expect(r.kind === "error" && r.state).toBe("xyz");
  });
});
