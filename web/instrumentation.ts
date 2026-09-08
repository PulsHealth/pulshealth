// Runs once when the server starts (Next.js instrumentation hook). The only
// job here is to say, in `docker compose logs web`, whether the viewer is
// asking for a password — an unauthenticated health viewer is a reasonable
// choice on a loopback bind and a serious mistake anywhere else, and the
// difference should not be something you have to infer from a browser.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.WEB_AUTH_PASSWORD) {
    console.log(
      "[puls-web] HTTP Basic authentication is ON (WEB_AUTH_PASSWORD is set). " +
        "Any username is accepted; the password is the credential. /api/healthz stays open for health checks.",
    );
    return;
  }
  console.warn(
    "[puls-web] WEB_AUTH_PASSWORD is not set: this viewer has NO authentication. " +
      "Anyone who can reach this port can read every health record of the configured user. " +
      "Set WEB_AUTH_PASSWORD in server/.env (and `docker compose up -d web`), " +
      "or keep WEB_BIND_ADDR on loopback or a private network.",
  );
}
