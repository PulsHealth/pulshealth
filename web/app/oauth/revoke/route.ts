import type { NextRequest } from "next/server";

import { clientCredentials, formParam, json, oauthOrNotFound, preflight } from "@/lib/oauth/http";
import { revokeRefreshToken } from "@/lib/oauth/store";

// RFC 7009 token revocation: a refresh token revokes the grant it belongs
// to (and with it every later refresh; access tokens already out run to
// their 30 minutes). Always 200, whatever the token was — an access token,
// someone else's, nothing — so the answer reveals nothing. Holding the
// refresh token is the proof; a client_id, when given, must be the grant's.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { off } = oauthOrNotFound();
  if (off) return off;
  let form: FormData;
  try {
    const text = await request.text();
    form = new FormData();
    if (text.length <= 16 * 1024) for (const [k, v] of new URLSearchParams(text)) form.append(k, v);
  } catch {
    return json(200, {});
  }
  const token = formParam(form, "token");
  const creds = clientCredentials(request.headers.get("authorization"), form);
  if (token) {
    try {
      await revokeRefreshToken(token, creds.ok ? creds.clientId : null);
    } catch (e) {
      console.error("[puls-web] oauth revocation failed:", e instanceof Error ? e.message : e);
      return json(503, { error: "temporarily_unavailable" }, { "Retry-After": "30" });
    }
  }
  return json(200, {});
}

export function OPTIONS() {
  const { off } = oauthOrNotFound();
  return off ?? preflight();
}
