// Runs once when the server starts (Next.js instrumentation hook). The only
// job here is to say, in `docker compose logs web`, which access control the
// viewer is running (lib/mode.ts) — an unauthenticated health viewer is a
// reasonable choice on a loopback bind and a serious mistake anywhere else,
// and the difference should not be something you have to infer from a
// browser. Never logs a secret.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { parseFlag, viewerMode } = await import("./lib/mode");
  const mode = viewerMode();

  // Read the way ingest and the API read it; a value none of them accepts
  // stops the viewer here, as it stops them, rather than meaning "off".
  let trustProxy: boolean;
  try {
    trustProxy = parseFlag("TRUST_PROXY_HEADERS", process.env.TRUST_PROXY_HEADERS);
  } catch (e) {
    console.error(`[puls-web] ${e instanceof Error ? e.message : String(e)}. Fix it in server/.env and restart.`);
    process.exit(1);
  }

  if (mode === "accounts") {
    console.log(
      "[puls-web] mode=accounts: people sign in with their own email and password (invite-only: " +
        "`make web-invite`), and each sees only their own records. /api/healthz stays open for health checks.",
    );
    const { clientIpHeaderWarning } = await import("./lib/accounts/request");
    const ipWarning = clientIpHeaderWarning(trustProxy);
    if (ipWarning) console.warn(`[puls-web] ${ipWarning}`);
    if (process.env.NODE_ENV === "production" && !trustProxy) {
      console.warn(
        "[puls-web] TRUST_PROXY_HEADERS is not true, so every request looks like plain HTTP and accounts mode " +
          "refuses it. Run the viewer behind a TLS proxy (a Cloudflare Tunnel, Tailscale Serve, a reverse proxy) " +
          "that is the only way to reach it, and set TRUST_PROXY_HEADERS=true.",
      );
    }
    if (process.env.WEB_AUTH_PASSWORD) {
      console.warn("[puls-web] WEB_AUTH_PASSWORD is set but ignored: accounts mode signs people in itself.");
    }
    const publicUrl = process.env.WEB_PUBLIC_URL;
    if (publicUrl) {
      try {
        new URL(publicUrl);
      } catch {
        console.warn("[puls-web] WEB_PUBLIC_URL is not a URL; it is ignored.");
      }
    }
    // OAuth for AI assistants: said once here; a broken setting is an error
    // and leaves it off (every /oauth path a 404), never a crash.
    const { oauthConfig } = await import("./lib/oauth/config");
    const oauth = oauthConfig();
    if (oauth) {
      console.log(
        `[puls-web] OAuth for AI assistants is ON: issuer ${oauth.issuer}, tokens for the MCP server at ${oauth.resource}.`,
      );
    }
    return;
  }

  if (mode === "basic") {
    console.log(
      "[puls-web] mode=basic: HTTP Basic authentication is ON (WEB_AUTH_PASSWORD is set). " +
        "Any username is accepted; the password is the credential. /api/healthz stays open for health checks.",
    );
    return;
  }
  console.warn(
    "[puls-web] mode=open: WEB_AUTH_PASSWORD is not set and WEB_ACCOUNTS is off, so this viewer has NO authentication. " +
      "Anyone who can reach this port can read every health record in the database. " +
      "Set WEB_AUTH_PASSWORD in server/.env (and `docker compose up -d web`), " +
      "or keep WEB_BIND_ADDR on loopback or a private network.",
  );
}
