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

/** The largest body a machine endpoint reads (registration JSON, token and revocation forms). */
export const MAX_BODY_BYTES = 16 * 1024;

/**
 * The request body as text, or null when it is larger than `max` bytes. A
 * declared Content-Length over the limit is refused before anything is read;
 * otherwise the stream is read only until it passes the limit, so a chunked
 * body (no Content-Length) cannot make the server buffer more than that.
 */
export async function readBodyCapped(request: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared.trim()) || Number(declared) > max)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A form-urlencoded body as FormData (repeated fields kept, for formParam). */
export function parseForm(text: string): FormData {
  const form = new FormData();
  for (const [k, v] of new URLSearchParams(text)) form.append(k, v);
  return form;
}

/**
 * The bucket an address's registrations are charged to: an IPv4 address as
 * it is, an IPv6 address by its /64 — one subscriber or host usually holds a
 * whole /64, and keying on the full address would hand it 2^64 buckets.
 * Anything that is not an IP address (the "direct" and "unknown" fallbacks)
 * as it is.
 */
export function addressBucket(ip: string): string {
  const prefix = ipv6Prefix64(ip);
  return prefix ?? ip;
}

const HEXTET = /^[0-9a-f]{1,4}$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** `raw`'s /64 as "a:b:c:d::/64"; an IPv4-mapped address as its IPv4; null if not IPv6. */
function ipv6Prefix64(raw: string): string | null {
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (!ip.includes(":")) return null;
  ip = ip.replace(/%.*$/, ""); // zone id
  // An embedded IPv4 tail (::ffff:192.0.2.1) becomes two hextets.
  const lastColon = ip.lastIndexOf(":");
  const v4 = IPV4.exec(ip.slice(lastColon + 1));
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    ip = `${ip.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (![...head, ...tail].every((h) => HEXTET.test(h))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((h) => parseInt(h, 16));
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
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
  __pulsOAuthRevocations?: FailureLimiter;
  __pulsOAuthRegistrations?: FailureLimiter;
};
export const tokenFailures: FailureLimiter = (globalForOAuth.__pulsOAuthFailures ??= new FailureLimiter(60, 60));

// Revocation requests that revoked nothing, per client address, on the same
// failure-only policy in a bucket of their own: a revocation answers 200
// whatever the token was, so this only bounds how fast one address can make
// the database look tokens up.
export const revocationFailures: FailureLimiter = (globalForOAuth.__pulsOAuthRevocations ??= new FailureLimiter(60, 60));

// Registrations: every one is charged (registering is not a failure), thirty
// an hour per address (an IPv6 address by its /64, addressBucket). Generous
// because claude.ai registers from a few shared cloud addresses on behalf of
// everyone connecting; there is deliberately no global cap, since a handful
// of addresses could drain one and block every new connection. The table
// cannot grow without bound: auth.prune_oauth deletes, hourly, clients
// unused for 30 days that hold no live grant, so what a flood leaves behind
// is bounded by this rate times the addresses sending it, and is gone a
// month later.
export const registrations: FailureLimiter = (globalForOAuth.__pulsOAuthRegistrations ??= new FailureLimiter(30, 30 / 60));
