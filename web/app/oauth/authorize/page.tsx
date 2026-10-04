import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AuthCard } from "@/components/AuthCard";
import { oauthConfig } from "@/lib/oauth/config";
import { findClient } from "@/lib/oauth/store";
import { checkAuthorizeRequest, redirectWith } from "@/lib/oauth/validate";
import { currentSession } from "@/lib/viewer";

// The authorization endpoint's consent page (OAuth on, accounts mode only).
// proxy.ts has already sent anyone without a session to /login, which comes
// back here with the whole query. A bad client or redirect URI is an error
// page — never a redirect to an address nobody registered; any other
// problem goes back to the client as `error=`. The form posts to
// /oauth/authorize, which proxy.ts hands to ./decision/route.ts after the
// same-origin and session checks; that route checks every parameter again.
// The page cannot be framed (frame-ancestors 'none', X-Frame-Options DENY),
// and its CSP form-action names the redirect URI's origin, so the browser
// follows the 303 there (lib/securityHeaders.ts).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an app — PulsHealth" };

type Search = Promise<Record<string, string | string[] | undefined>>;

function searchParamsOf(search: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) params.append(k, value);
  }
  return params;
}

/** Where the app is: its host, or "an app on this computer" for a loopback address. */
function destination(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === "http:" ? `an app on this computer (${url.host})` : url.host;
}

export default async function AuthorizePage({ searchParams }: { searchParams: Search }) {
  const config = oauthConfig();
  if (!config) notFound();
  const params = searchParamsOf(await searchParams);
  const session = await currentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`);

  const client = await findClient(params.get("client_id"));
  const check = checkAuthorizeRequest(params, client, config.resource);
  if (check.kind === "fatal") {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: "32px 0" }}>
        <AuthCard title="This link cannot connect an app" error={check.message} />
      </div>
    );
  }
  if (check.kind === "error") {
    redirect(
      redirectWith(check.redirectUri, {
        error: check.error,
        error_description: check.description,
        state: check.state,
        iss: config.issuer,
      }),
    );
  }

  const req = check.request;
  const name = req.clientName || "An unnamed app";
  return (
    <div style={{ display: "grid", placeItems: "center", padding: "32px 0" }}>
      <AuthCard title={`Connect ${name}?`} subtitle={<>Signed in as {session.email}.</>}>
        <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.55 }}>
          <strong style={{ fontWeight: 600 }}>{name}</strong>{" "}
          <span style={{ color: "var(--muted)" }}>(the name the app gave itself; this viewer cannot vouch for it)</span>{" "}
          is asking to read your PulsHealth data. If you allow it, it is sent back to{" "}
          <span className="mono">{destination(req.redirectUri)}</span>.
        </p>
        <div className="panel" style={{ padding: "12px 14px", marginBottom: 14, fontSize: 13.5, lineHeight: 1.55 }}>
          It will be able to <strong style={{ fontWeight: 600 }}>read all health data on this account</strong>, including
          your profile — name, date of birth — until you revoke it. Read-only: it cannot change or delete anything.
        </div>
        <p className="form-hint" style={{ margin: "0 0 18px", lineHeight: 1.5 }}>
          Revoke it any time under AI assistants on your <a href="/account" style={{ textDecoration: "underline" }}>account
          page</a>; it loses access within 30 minutes. Only allow an app you just asked to connect.
        </p>
        <form method="post" action="/oauth/authorize">
          <input type="hidden" name="client_id" value={req.clientId} />
          <input type="hidden" name="redirect_uri" value={req.redirectUri} />
          <input type="hidden" name="response_type" value="code" />
          <input type="hidden" name="code_challenge" value={req.codeChallenge} />
          <input type="hidden" name="code_challenge_method" value="S256" />
          <input type="hidden" name="scope" value={req.scope} />
          {req.resource !== null && <input type="hidden" name="resource" value={req.resource} />}
          {req.state !== null && <input type="hidden" name="state" value={req.state} />}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" name="decision" value="allow" className="btn btn-primary" style={{ flex: 1 }}>
              Allow
            </button>
            <button type="submit" name="decision" value="deny" className="btn" style={{ flex: 1 }}>
              Deny
            </button>
          </div>
        </form>
      </AuthCard>
    </div>
  );
}
