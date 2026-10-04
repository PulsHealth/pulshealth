import { NextResponse, type NextRequest } from "next/server";

import { field, readForm, requestSession } from "@/lib/accounts/http";
import { notFound } from "@/lib/oauth/http";
import { oauthConfig } from "@/lib/oauth/config";
import { createCode, findClient } from "@/lib/oauth/store";
import { checkAuthorizeRequest, redirectWith } from "@/lib/oauth/validate";

// The consent form's answer. The form posts to /oauth/authorize; proxy.ts
// rewrites that POST to here after its same-origin check and with a live
// session, the same as any state-changing request. Every parameter is
// checked again (the form's hidden fields are the browser's to change):
// Deny → `error=access_denied`; Allow → a one-time code for this account,
// bound to the client, redirect URI, PKCE challenge, scope and resource. Both
// go back to the client's redirect URI by 303, with `state` and `iss`.
export const dynamic = "force-dynamic";

function text(status: number, body: string): NextResponse {
  return new NextResponse(`${body}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function seeOtherAbsolute(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const config = oauthConfig();
  if (!config) return notFound();
  const session = await requestSession(request);
  if (!session) return text(401, "Sign in required.");

  const form = await readForm(request);
  const params = new URLSearchParams();
  for (const [k, v] of form?.entries() ?? []) if (typeof v === "string") params.append(k, v);
  params.delete("decision");

  try {
    const client = await findClient(params.get("client_id"));
    const check = checkAuthorizeRequest(params, client, config.resource);
    if (check.kind === "fatal") return text(400, check.message);
    if (check.kind === "error") {
      return seeOtherAbsolute(
        redirectWith(check.redirectUri, { error: check.error, error_description: check.description, state: check.state, iss: config.issuer }),
      );
    }
    const req = check.request;
    if (field(form, "decision") !== "allow") {
      return seeOtherAbsolute(redirectWith(req.redirectUri, { error: "access_denied", state: req.state, iss: config.issuer }));
    }
    const code = await createCode(session.accountId, req);
    return seeOtherAbsolute(redirectWith(req.redirectUri, { code, state: req.state, iss: config.issuer }));
  } catch (e) {
    console.error("[puls-web] oauth consent failed:", e instanceof Error ? e.message : e);
    return text(503, "Connecting the app failed on the server. Go back to the app and try again.");
  }
}
