// Whether this viewer is an OAuth 2.1 authorization server for the MCP
// server (server/mcp), and with what settings. See web/README.md, "AI
// assistants (OAuth)".
//
// On only in accounts mode, and only with all three of PULS_MCP_OAUTH_SECRET
// (the HMAC key the MCP server verifies access tokens with), PULS_MCP_URL
// (the MCP server's public URL: the tokens' audience) and WEB_PUBLIC_URL (the
// issuer). Off, every OAuth path is a 404. A setting that is present but
// unusable — a secret shorter than 32 characters or the `change-me`
// placeholder, a URL that is not https — also leaves it off, with one error
// in the log: fail closed, but keep serving the viewer.
//
// Read from the environment per call, like lib/mode.ts.

import { type Env, viewerMode } from "../mode";

export interface OAuthConfig {
  /** WEB_PUBLIC_URL without a trailing slash: the `iss` of every token. */
  issuer: string;
  /** PULS_MCP_URL exactly: the `aud` of every token. */
  resource: string;
  /** PULS_MCP_OAUTH_SECRET, used as UTF-8 bytes. */
  secret: string;
}

export type OAuthSetting =
  | { state: "on"; config: OAuthConfig }
  | { state: "off" }
  | { state: "invalid"; problem: string };

export const MIN_SECRET_LENGTH = 32;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An https URL, or http on a loopback host (development); null if neither. */
function webUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.hash || url.username || url.password) return null;
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return url;
    return null;
  } catch {
    return null;
  }
}

export function readOAuthConfig(env: Env = process.env): OAuthSetting {
  if (viewerMode(env) !== "accounts") return { state: "off" };
  const secret = env.PULS_MCP_OAUTH_SECRET ?? "";
  const resource = (env.PULS_MCP_URL ?? "").trim();
  const publicUrl = (env.WEB_PUBLIC_URL ?? "").trim();
  if (!secret && !resource) return { state: "off" };
  if (!secret || !resource || !publicUrl) {
    return {
      state: "invalid",
      problem: "OAuth for AI assistants needs PULS_MCP_OAUTH_SECRET, PULS_MCP_URL and WEB_PUBLIC_URL all set",
    };
  }
  if (secret === "change-me" || secret.length < MIN_SECRET_LENGTH) {
    return {
      state: "invalid",
      problem: `PULS_MCP_OAUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters and not the change-me placeholder (openssl rand -hex 32)`,
    };
  }
  const resourceUrl = webUrl(resource);
  if (!resourceUrl || resourceUrl.search) {
    return { state: "invalid", problem: "PULS_MCP_URL must be the MCP server's https URL, path included (https://mcp.example.com/mcp)" };
  }
  const issuerUrl = webUrl(publicUrl);
  if (!issuerUrl || issuerUrl.search) {
    return { state: "invalid", problem: "WEB_PUBLIC_URL must be the viewer's https URL to issue OAuth tokens" };
  }
  return { state: "on", config: { issuer: publicUrl.replace(/\/+$/, ""), resource, secret } };
}

// The problem logged last, so a broken setting is said once, not per request.
const globalForOAuth = globalThis as typeof globalThis & { __pulsOAuthProblem?: string };

/** The settings when OAuth is on; null (and one logged error) otherwise. */
export function oauthConfig(env: Env = process.env): OAuthConfig | null {
  const setting = readOAuthConfig(env);
  if (setting.state === "on") return setting.config;
  if (setting.state === "invalid" && globalForOAuth.__pulsOAuthProblem !== setting.problem) {
    globalForOAuth.__pulsOAuthProblem = setting.problem;
    console.error(`[puls-web] ${setting.problem}; OAuth for AI assistants is OFF (every /oauth path answers 404).`);
  }
  return null;
}

/** The OAuth endpoints machines call: no session, no Origin check, CORS *. */
export const OAUTH_MACHINE_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/oauth/register",
  "/oauth/token",
  "/oauth/revoke",
] as const;

/** The consent page and the route its form reaches (proxy.ts rewrites POSTs to it). */
export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_DECISION_PATH = "/oauth/authorize/decision";

/** Every path that exists only while OAuth is on (a 404 otherwise). */
export function isOAuthPath(pathname: string): boolean {
  return (
    (OAUTH_MACHINE_PATHS as readonly string[]).includes(pathname) ||
    pathname.startsWith("/api/health/") ||
    pathname === OAUTH_AUTHORIZE_PATH ||
    pathname === OAUTH_DECISION_PATH
  );
}

/** The one scope there is: read everything on the signed-in account. */
export const OAUTH_SCOPE = "health:read";
/** Access-token lifetime: what a revocation can lag by. */
export const ACCESS_TOKEN_SECONDS = 1800;
/** A refresh token dies this long after its grant was last used. */
export const REFRESH_TOKEN_DAYS = 60;
/** An authorization code works once, within this. */
export const CODE_SECONDS = 300;

/** Separate audience for the public, account-scoped health API. */
export function healthResource(config: OAuthConfig): string {
  return `${config.issuer}/api/health`;
}

export function oauthResources(config: OAuthConfig): string[] {
  return [config.resource, healthResource(config)];
}
