import type { NextRequest } from "next/server";

import { requestIp } from "@/lib/accounts/http";
import { refundAll, takeAll } from "@/lib/accounts/ratelimit";
import {
  clientCredentials,
  formParam,
  json,
  oauthError,
  oauthOrNotFound,
  parseForm,
  preflight,
  readBodyCapped,
  revocationFailures,
} from "@/lib/oauth/http";
import { revokeRefreshToken } from "@/lib/oauth/store";

// RFC 7009 token revocation: a refresh token revokes the grant it belongs
// to (and with it every later refresh; access tokens already out run to
// their 30 minutes). Always 200, whatever the token was — an access token,
// someone else's, nothing — so the answer reveals nothing. Holding the
// refresh token is the proof; a client_id, when given, must be the grant's.
// A request that revokes nothing is charged to the client address
// (lib/oauth/http.ts, revocationFailures; taken up front, refunded when a
// grant was revoked or the server failed), as the token endpoint does; a
// body over 16 KiB is refused unread.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { off } = oauthOrNotFound();
  if (off) return off;

  const keys = [`ip:${requestIp(request)}`];
  const gate = takeAll(revocationFailures, keys);
  if (!gate.allowed) {
    return oauthError(429, "temporarily_unavailable", "too many requests; try again later", {
      "Retry-After": String(gate.retryAfterSeconds),
    });
  }
  // From here, returning without a refund records a failure.

  let form: FormData;
  try {
    const text = await readBodyCapped(request);
    if (text === null) return oauthError(400, "invalid_request", "the request is too large");
    form = parseForm(text);
  } catch {
    return json(200, {});
  }
  const token = formParam(form, "token");
  const creds = clientCredentials(request.headers.get("authorization"), form);
  if (token) {
    try {
      if (await revokeRefreshToken(token, creds.ok ? creds.clientId : null)) refundAll(revocationFailures, keys);
    } catch (e) {
      refundAll(revocationFailures, keys);
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
