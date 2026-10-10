// The OAuth checks that need no database: redirect URIs, PKCE, scopes, the
// resource indicator, a dynamic client registration and an authorization
// request. Pure, so the tests can walk every case.

import { createHash, timingSafeEqual } from "node:crypto";

import { OAUTH_SCOPE } from "./config";

// ── redirect URIs ───────────────────────────────────────────────────────────

export const MAX_REDIRECT_URIS = 10;
export const MAX_REDIRECT_URI_LENGTH = 2000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Why `raw` cannot be a redirect URI, or null when it can: https (no
 * fragment, no user info), or plain http to a loopback address — a native
 * app's local listener (RFC 8252 §7.3), whose port may change between runs.
 * Custom schemes are not taken: every client this serves (claude.ai, the
 * Claude apps through claude.ai, Claude Code) uses one of the two.
 */
export function redirectUriProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return "a redirect URI must be a non-empty string";
  if (raw.length > MAX_REDIRECT_URI_LENGTH) return `a redirect URI must be at most ${MAX_REDIRECT_URI_LENGTH} characters`;
  if (raw.includes("#")) return "a redirect URI must not have a fragment";
  if (/[\u0000-\u0020\u007f\\]/.test(raw)) return "a redirect URI must not contain spaces, control characters or backslashes";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "a redirect URI must be an absolute URL";
  }
  if (url.username || url.password) return "a redirect URI must not carry user information";
  if (url.protocol === "https:") return url.hostname ? null : "a redirect URI needs a host";
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return null;
  return "a redirect URI must be https, or http to localhost, 127.0.0.1 or [::1]";
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Whether `presented` is one of `registered`: the exact string, or — for a
 * loopback URI — the same host, path and query on any port (RFC 8252 §7.3).
 */
export function redirectUriMatches(registered: readonly string[], presented: string): boolean {
  if (redirectUriProblem(presented) !== null) return false;
  if (registered.includes(presented)) return true;
  const p = new URL(presented);
  if (!isLoopback(p)) return false;
  return registered.some((r) => {
    if (redirectUriProblem(r) !== null) return false;
    const u = new URL(r);
    return isLoopback(u) && u.hostname === p.hostname && u.pathname === p.pathname && u.search === p.search;
  });
}

/** The origin a valid redirect URI sends the browser to (the consent page's CSP form-action), or null. */
export function redirectOrigin(raw: string | null | undefined): string | null {
  if (!raw || redirectUriProblem(raw) !== null) return null;
  return new URL(raw).origin;
}

// ── PKCE (S256 only) ────────────────────────────────────────────────────────

/** A code_challenge: base64url of a SHA-256, unpadded. */
export function isCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** A code_verifier as RFC 7636 §4.1 allows it. */
export function isCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Whether `verifier` is the one `challenge` was made from (S256), compared in constant time. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isCodeVerifier(verifier) || !isCodeChallenge(challenge)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── scope and resource ──────────────────────────────────────────────────────

/** The granted scope for a requested one (absent or empty: the default), or null when it asks for more. */
export function grantedScope(requested: string | null | undefined): string | null {
  const parts = (requested ?? "").split(" ").filter(Boolean);
  if (parts.every((s) => s === OAUTH_SCOPE)) return OAUTH_SCOPE;
  return null;
}

/** Whether a resource indicator (RFC 8707) names this MCP server; absent is fine. */
export function resourceMatches(requested: string | null | undefined, resource: string): boolean {
  if (requested === null || requested === undefined || requested === "") return true;
  return requested.replace(/\/+$/, "") === resource.replace(/\/+$/, "");
}

// ── dynamic client registration (RFC 7591) ──────────────────────────────────

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";
const AUTH_METHODS: readonly AuthMethod[] = ["none", "client_secret_post", "client_secret_basic"];
const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
export const MAX_CLIENT_NAME = 100;

export interface ClientRegistration {
  name: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  grantTypes: string[];
}

export type RegistrationResult =
  | { ok: true; client: ClientRegistration }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

/** A display name: control characters out, whitespace collapsed, at most MAX_CLIENT_NAME characters. */
export function cleanClientName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return [...raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim()]
    .slice(0, MAX_CLIENT_NAME)
    .join("")
    .trim();
}

/**
 * Checks an RFC 7591 registration. `ownOrigin`, this viewer's origin
 * (WEB_PUBLIC_URL's), is refused as a redirect URI's: no legitimate client
 * returns to the authorization server's own pages.
 */
export function validateRegistration(body: unknown, ownOrigin?: string): RegistrationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_client_metadata", description: "the body must be a JSON object" };
  }
  const meta = body as Record<string, unknown>;

  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: "invalid_redirect_uri", description: `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs` };
  }
  for (const uri of uris) {
    const problem = redirectUriProblem(uri);
    if (problem) return { ok: false, error: "invalid_redirect_uri", description: problem };
    if (ownOrigin && new URL(uri as string).origin === new URL(ownOrigin).origin) {
      return { ok: false, error: "invalid_redirect_uri", description: "a redirect URI must not point at this server" };
    }
  }

  const method = meta.token_endpoint_auth_method ?? "none";
  if (!AUTH_METHODS.includes(method as AuthMethod)) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic",
    };
  }

  const grants = meta.grant_types ?? [...GRANT_TYPES];
  if (
    !Array.isArray(grants) ||
    !grants.every((g) => (GRANT_TYPES as readonly unknown[]).includes(g)) ||
    !grants.includes("authorization_code")
  ) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "grant_types must include authorization_code and may add refresh_token, nothing else",
    };
  }

  const responseTypes = meta.response_types ?? ["code"];
  if (!Array.isArray(responseTypes) || !responseTypes.every((r) => r === "code")) {
    return { ok: false, error: "invalid_client_metadata", description: "response_types may only be code" };
  }

  if (meta.scope !== undefined && (typeof meta.scope !== "string" || grantedScope(meta.scope) === null)) {
    return { ok: false, error: "invalid_client_metadata", description: `the only scope is ${OAUTH_SCOPE}` };
  }

  return {
    ok: true,
    client: {
      name: cleanClientName(meta.client_name),
      redirectUris: [...new Set(uris as string[])],
      authMethod: method as AuthMethod,
      grantTypes: [...new Set(grants as string[])],
    },
  };
}

// ── authorization requests ──────────────────────────────────────────────────

/** What the authorization endpoint needs to know about a registered client. */
export interface KnownClient {
  id: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
}

/** A request the consent page may show and the decision route may grant. */
export interface AuthorizeRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
  state: string | null;
}

export type AuthorizeCheck =
  /** Nothing to redirect to safely: show an error page, never redirect. */
  | { kind: "fatal"; message: string }
  /** The client and redirect URI are good; send the error back there. */
  | { kind: "error"; redirectUri: string; error: string; description: string; state: string | null }
  | { kind: "ok"; request: AuthorizeRequest };

export const MAX_STATE_LENGTH = 2000;

/** The parameters of an authorization request, from a query string or the consent form. */
export type ParamReader = { get(name: string): string | null; getAll(name: string): string[] };

/**
 * Checks an authorization request against its client (`client`, looked up
 * by the caller from client_id; null when unknown) and this server's MCP
 * URL. Bad client or redirect URI → fatal; anything else → an error for the
 * client's redirect URI; else the request, normalised.
 */
export function checkAuthorizeRequest(params: ParamReader, client: KnownClient | null, resource: string | string[]): AuthorizeCheck {
  const single = (name: string) => {
    const all = params.getAll(name);
    return all.length > 1 ? undefined : (all[0] ?? null);
  };

  const clientId = single("client_id");
  if (!clientId) return { kind: "fatal", message: "The request does not name a client, or names more than one." };
  if (!client || client.id !== clientId) {
    return { kind: "fatal", message: "That app is not registered with this viewer. Start connecting again from the app." };
  }
  const redirectUri = single("redirect_uri");
  if (!redirectUri) return { kind: "fatal", message: "The request does not say where to send the answer." };
  if (!redirectUriMatches(client.redirectUris, redirectUri)) {
    return { kind: "fatal", message: "The request's return address is not one this app registered." };
  }

  const stateValue = single("state");
  const state = stateValue === undefined ? null : stateValue;
  const fail = (error: string, description: string): AuthorizeCheck => ({ kind: "error", redirectUri, error, description, state });
  if (stateValue === undefined || (state !== null && state.length > MAX_STATE_LENGTH)) {
    return fail("invalid_request", "state must be given at most once, and be at most 2000 characters");
  }

  const responseType = single("response_type");
  if (responseType === undefined || responseType === null) return fail("invalid_request", "response_type is required");
  if (responseType !== "code") return fail("unsupported_response_type", "only response_type=code is supported");
  if (!client.grantTypes.includes("authorization_code")) {
    return fail("unauthorized_client", "this client did not register for authorization_code");
  }

  const challenge = single("code_challenge");
  const method = single("code_challenge_method");
  if (!challenge || !method) return fail("invalid_request", "PKCE is required: code_challenge with code_challenge_method=S256");
  if (method !== "S256") return fail("invalid_request", "code_challenge_method must be S256");
  if (!isCodeChallenge(challenge)) return fail("invalid_request", "code_challenge must be 43 base64url characters");

  const scopeParam = single("scope");
  const scope = scopeParam === undefined ? null : grantedScope(scopeParam);
  if (!scope) return fail("invalid_scope", `the only scope is ${OAUTH_SCOPE}`);

  const resources = params.getAll("resource");
  const allowed = typeof resource === "string" ? [resource] : resource;
  const selected = resources[0] ? allowed.find((r) => resourceMatches(resources[0], r)) : allowed[0];
  if (resources.length > 1 || !selected) {
    return fail("invalid_target", "resource must be a supported API URL");
  }

  return {
    kind: "ok",
    request: {
      clientId,
      clientName: client.name,
      redirectUri,
      codeChallenge: challenge,
      scope,
      resource: resources[0] ? selected : null,
      state,
    },
  };
}

/** `redirectUri` with the given answer parameters added (its own query kept). */
export function redirectWith(redirectUri: string, values: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}
