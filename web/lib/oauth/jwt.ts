import { isUuid } from "../uuid";
// The MCP server's access tokens: compact JWTs, HS256, header exactly
// {"alg":"HS256","typ":"at+jwt"}, claims in a fixed order. The MCP server
// (server/mcp) verifies them with the same PULS_MCP_OAUTH_SECRET and never
// asks the database, so they are short-lived (ACCESS_TOKEN_SECONDS). Both
// sides test against the same vector (jwt.test.ts). node:crypto only.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { ACCESS_TOKEN_SECONDS, OAUTH_SCOPE, type OAuthConfig } from "./config";

export interface AccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  client_id: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
  grant_id?: string;
}

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "at+jwt" })).toString("base64url");

/** Signs `claims`, serialised in the contract's key order whatever order they came in. */
export function signAccessToken(claims: AccessTokenClaims, secret: string): string {
  const ordered = {
    iss: claims.iss,
    aud: claims.aud,
    sub: claims.sub,
    client_id: claims.client_id,
    scope: claims.scope,
    iat: claims.iat,
    exp: claims.exp,
    jti: claims.jti,
    ...(claims.grant_id ? { grant_id: claims.grant_id } : {}),
  };
  const payload = Buffer.from(JSON.stringify(ordered)).toString("base64url");
  const input = `${HEADER}.${payload}`;
  const signature = createHmac("sha256", Buffer.from(secret, "utf8")).update(input).digest("base64url");
  return `${input}.${signature}`;
}

/** A fresh access token for `userId`, through `clientId`. */
export function issueAccessToken(
  config: OAuthConfig,
  userId: string,
  clientId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  grantId?: string,
): { token: string; expiresIn: number } {
  const token = signAccessToken(
    {
      iss: config.issuer,
      aud: config.resource,
      sub: userId.toLowerCase(),
      client_id: clientId,
      scope: OAUTH_SCOPE,
      iat: nowSeconds,
      exp: nowSeconds + ACCESS_TOKEN_SECONDS,
      jti: randomBytes(16).toString("base64url"),
      ...(grantId ? { grant_id: grantId } : {}),
    },
    config.secret,
  );
  return { token, expiresIn: ACCESS_TOKEN_SECONDS };
}

/** Verify a bounded access token for exactly this resource, without trusting a cookie. */
export function verifyAccessToken(token: string, config: OAuthConfig, now = Math.floor(Date.now() / 1000)): AccessTokenClaims | null {
  if (token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  const signature = Buffer.from(parts[2], "base64url");
  const expected = createHmac("sha256", config.secret).update(`${parts[0]}.${parts[1]}`).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (c.iss !== config.issuer || c.aud !== config.resource || !isUuid(c.sub) ||
        c.scope !== OAUTH_SCOPE || typeof c.client_id !== "string" || !c.client_id ||
        typeof c.jti !== "string" || !c.jti || !Number.isInteger(c.iat) || !Number.isInteger(c.exp) ||
        c.iat > now + 60 || c.exp <= now || c.exp <= c.iat || c.exp - c.iat > ACCESS_TOKEN_SECONDS) return null;
    return c;
  } catch { return null; }
}
