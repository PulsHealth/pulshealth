// Optional HTTP Basic authentication for the viewer (SRV-10).
//
// The viewer is a read-only window onto one person's health records, and until
// now its bind address was the only access control. Setting WEB_AUTH_PASSWORD
// turns on a password prompt in front of every page; leaving it unset keeps the
// old behaviour exactly, so an existing install does not lock itself out on
// upgrade.
//
// Basic rather than a signed-cookie login form: no session store, no signing
// key to generate and rotate, no login page to style, and `curl -u` keeps
// working for the same reason browsers do. It has no logout and it sends the
// password on every request, which is why the README insists the viewer stays
// behind TLS or a private network either way.
//
// This module is pure and runtime-agnostic (WebCrypto and atob only), so it
// runs in middleware under either the Edge or the Node.js runtime and is
// unit-testable without a server.

/** Shown by the browser's password prompt. */
export const AUTH_REALM = "PulsHealth viewer";

/**
 * Paths that must answer without credentials. The container health check polls
 * /api/healthz; a 401 there would make Compose and every orchestrator call a
 * perfectly healthy viewer dead.
 */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/api/healthz";
}

/** SHA-256 of the UTF-8 bytes of `value`. */
async function digest(value: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(hash);
}

/**
 * Compares two strings without leaking their contents (or their lengths)
 * through timing: both are hashed first, then the fixed-size digests are
 * compared with a branch-free XOR accumulation.
 */
export async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

/** The password half of an `Authorization: Basic` header, or null. */
export function basicAuthPassword(header: string | null | undefined): string | null {
  if (!header) return null;
  const space = header.indexOf(" ");
  if (space < 0) return null;
  if (header.slice(0, space).toLowerCase() !== "basic") return null;
  const encoded = header.slice(space + 1).trim();
  if (!encoded) return null;
  let decoded: string;
  try {
    const binary = atob(encoded);
    decoded = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  // The username is deliberately ignored: there is exactly one viewer and one
  // secret, and rejecting a typo'd username would only be a way to lock
  // yourself out of your own data.
  return decoded.slice(colon + 1);
}

export type AuthDecision = "open" | "allow" | "challenge";

/**
 * `open` — no password is configured, or the path is exempt: serve it.
 * `allow` — credentials checked out.
 * `challenge` — answer 401 with a WWW-Authenticate header.
 */
export async function authorize(request: {
  pathname: string;
  authorization: string | null | undefined;
  password: string | null | undefined;
}): Promise<AuthDecision> {
  const password = request.password ?? "";
  if (password === "") return "open";
  if (isPublicPath(request.pathname)) return "open";

  const supplied = basicAuthPassword(request.authorization);
  if (supplied === null) return "challenge";
  return (await constantTimeEquals(supplied, password)) ? "allow" : "challenge";
}
