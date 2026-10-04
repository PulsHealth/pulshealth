import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ACCESS_TOKEN_SECONDS, OAUTH_SCOPE } from "./config";
import { issueAccessToken, signAccessToken } from "./jwt";

// The shared test vector (the MCP server's verifier tests against the same one).
const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VECTOR =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9.eyJpc3MiOiJodHRwczovL3ZpZXdlci5leGFtcGxlLmNvbSIsImF1ZCI6Imh0dHBzOi8vbWNwLmV4YW1wbGUuY29tL21jcCIsInN1YiI6IjVlYTRkMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsImNsaWVudF9pZCI6InBjX3Rlc3QiLCJzY29wZSI6ImhlYWx0aDpyZWFkIiwiaWF0IjoxNzkwMDAwMDAwLCJleHAiOjE3OTAwMDE4MDAsImp0aSI6IkFBQUFBQUFBQUFBQUFBQUFBQUFBQUEifQ.Ovccwvjd4qDZ67ShjQwCTQYmlnLoYAoKhXzkUULFSTI";
const CLAIMS = {
  iss: "https://viewer.example.com",
  aud: "https://mcp.example.com/mcp",
  sub: "5ea4d000-0000-4000-8000-000000000001",
  client_id: "pc_test",
  scope: "health:read",
  iat: 1790000000,
  exp: 1790001800,
  jti: "AAAAAAAAAAAAAAAAAAAAAA",
};

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("signAccessToken", () => {
  it("reproduces the contract's test vector byte for byte", () => {
    expect(signAccessToken(CLAIMS, SECRET)).toBe(VECTOR);
  });

  it("serialises the claims in the contract's order whatever order they come in", () => {
    const shuffled = {
      jti: CLAIMS.jti,
      exp: CLAIMS.exp,
      scope: CLAIMS.scope,
      sub: CLAIMS.sub,
      iat: CLAIMS.iat,
      client_id: CLAIMS.client_id,
      aud: CLAIMS.aud,
      iss: CLAIMS.iss,
    };
    expect(signAccessToken(shuffled, SECRET)).toBe(VECTOR);
  });

  it("uses exactly the at+jwt HS256 header, unpadded base64url, HMAC-SHA256 over header.payload", () => {
    const [h, p, s] = VECTOR.split(".");
    expect(Buffer.from(h, "base64url").toString()).toBe('{"alg":"HS256","typ":"at+jwt"}');
    expect(VECTOR).not.toContain("=");
    expect(createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")).toBe(s);
  });

  it("changes the signature with the secret", () => {
    expect(signAccessToken(CLAIMS, `${SECRET}x`).split(".")[2]).not.toBe(VECTOR.split(".")[2]);
  });
});

describe("issueAccessToken", () => {
  it("issues 30-minute tokens for the configured issuer and audience, with a fresh jti", () => {
    const config = { issuer: "https://viewer.example.com", resource: "https://mcp.example.com/mcp", secret: SECRET };
    const a = issueAccessToken(config, "5EA4D000-0000-4000-8000-000000000001", "pc_abc", 1_800_000_000);
    const b = issueAccessToken(config, "5ea4d000-0000-4000-8000-000000000001", "pc_abc", 1_800_000_000);
    expect(a.expiresIn).toBe(ACCESS_TOKEN_SECONDS);
    expect(ACCESS_TOKEN_SECONDS).toBe(1800);
    const claims = decode(a.token.split(".")[1]);
    expect(Object.keys(claims)).toEqual(["iss", "aud", "sub", "client_id", "scope", "iat", "exp", "jti"]);
    expect(claims).toMatchObject({
      iss: config.issuer,
      aud: config.resource,
      sub: "5ea4d000-0000-4000-8000-000000000001",
      client_id: "pc_abc",
      scope: OAUTH_SCOPE,
      iat: 1_800_000_000,
      exp: 1_800_001_800,
    });
    expect(Buffer.from(claims.jti, "base64url")).toHaveLength(16);
    expect(decode(b.token.split(".")[1]).jti).not.toBe(claims.jti);
    // Signed with the configured secret: re-signing the decoded claims gives the same token.
    expect(signAccessToken(claims, SECRET)).toBe(a.token);
  });
});
