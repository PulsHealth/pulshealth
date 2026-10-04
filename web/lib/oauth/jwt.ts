// The MCP server's access tokens: compact JWTs, HS256, header exactly
// {"alg":"HS256","typ":"at+jwt"}, claims in a fixed order. The MCP server
// (server/mcp) verifies them with the same PULS_MCP_OAUTH_SECRET and never
// asks the database, so they are short-lived (ACCESS_TOKEN_SECONDS). Both
// sides test against the same vector (jwt.test.ts). node:crypto only.

import { createHmac, randomBytes } from "node:crypto";

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
    },
    config.secret,
  );
  return { token, expiresIn: ACCESS_TOKEN_SECONDS };
}
