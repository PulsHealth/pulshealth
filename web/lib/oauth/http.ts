// What the OAuth route handlers share. The machine endpoints (metadata,
// registration, token, revocation) are called by other origins' servers and
// browser clients with no cookies: they answer CORS `*` without
// credentials, and nothing they return may be cached. Server-only.

import { NextResponse } from "next/server";

import { FailureLimiter } from "../accounts/ratelimit";
import { oauthConfig, type OAuthConfig } from "./config";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "600",
};

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function notFound(): NextResponse {
  return new NextResponse("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** The settings, or the 404 every OAuth path answers while OAuth is off. */
export function oauthOrNotFound(): { config: OAuthConfig; off?: undefined } | { config?: undefined; off: NextResponse } {
  const config = oauthConfig();
  return config ? { config } : { off: notFound() };
}

export function json(status: number, body: unknown, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...NO_STORE, ...extra } });
}

/** An RFC 6749 §5.2 error. */
export function oauthError(status: number, error: string, description?: string, extra: Record<string, string> = {}): NextResponse {
  return json(status, description ? { error, error_description: description } : { error }, extra);
}

/** The CORS preflight answer. */
export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS, ...NO_STORE } });
}

/** A form field as a string, or null when absent; undefined when repeated (RFC 6749 §3.1). */
export function formParam(form: FormData, name: string): string | null | undefined {
  const all = form.getAll(name);
  if (all.length > 1) return undefined;
  const v = all[0];
  return typeof v === "string" ? v : null;
}

export type ClientCredentials =
  | { ok: true; clientId: string; secret: string | null; basic: boolean }
  | { ok: false; error: "invalid_request" | "invalid_client"; basic: boolean };

/**
 * The client a token or revocation request says it is: HTTP Basic
 * (client_secret_basic, both halves form-urlencoded — RFC 6749 §2.3.1) or
 * the client_id / client_secret form fields. Both at once must agree.
 */
export function clientCredentials(authorization: string | null, form: FormData): ClientCredentials {
  const formId = formParam(form, "client_id");
  const formSecret = formParam(form, "client_secret");
  if (formId === undefined || formSecret === undefined) return { ok: false, error: "invalid_request", basic: false };
  if (authorization && /^basic /i.test(authorization)) {
    let id: string;
    let secret: string;
    try {
      const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) return { ok: false, error: "invalid_client", basic: true };
      id = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, " "));
      secret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, " "));
    } catch {
      return { ok: false, error: "invalid_client", basic: true };
    }
    if ((formId && formId !== id) || formSecret) return { ok: false, error: "invalid_request", basic: true };
    return { ok: true, clientId: id, secret, basic: true };
  }
  if (!formId) return { ok: false, error: "invalid_client", basic: false };
  return { ok: true, clientId: formId, secret: formSecret || null, basic: false };
}

// Failed token requests, per client address: the sign-in policy
// (lib/accounts/ratelimit.ts: only failures cost, the token is taken before
// the check and refunded on success) in a bucket of its own. Not the
// sign-in limiter: claude.ai's token requests come from a few shared cloud
// addresses, so a handful of expired refresh tokens there must not lock
// every person out of signing in, and the budget is larger for the same
// reason. Codes, refresh tokens and client secrets are 256 random bits, so
// this limits load, not guessing.
const globalForOAuth = globalThis as typeof globalThis & {
  __pulsOAuthFailures?: FailureLimiter;
  __pulsOAuthRegistrations?: FailureLimiter;
  __pulsOAuthRegistrationsAll?: FailureLimiter;
};
export const tokenFailures: FailureLimiter = (globalForOAuth.__pulsOAuthFailures ??= new FailureLimiter(60, 60));

// Registrations: every one is charged (registering is not a failure, but
// nothing legitimate registers often) — ten an hour per address, and two
// hundred an hour in all, so a flood cannot fill auth.oauth_clients faster
// than auth.prune_oauth empties it of the ones nobody used.
export const registrations: FailureLimiter = (globalForOAuth.__pulsOAuthRegistrations ??= new FailureLimiter(10, 10 / 60));
export const registrationsAll: FailureLimiter = (globalForOAuth.__pulsOAuthRegistrationsAll ??= new FailureLimiter(200, 200 / 60));
