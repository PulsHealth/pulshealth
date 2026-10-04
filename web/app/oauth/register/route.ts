import type { NextRequest } from "next/server";

import { requestIp } from "@/lib/accounts/http";
import { takeAll } from "@/lib/accounts/ratelimit";
import { OAUTH_SCOPE } from "@/lib/oauth/config";
import { addressBucket, json, oauthError, oauthOrNotFound, preflight, readBodyCapped, registrations } from "@/lib/oauth/http";
import { registerClient } from "@/lib/oauth/store";
import { validateRegistration } from "@/lib/oauth/validate";

// RFC 7591 dynamic client registration: how claude.ai and Claude Code
// introduce themselves. Open to anyone (a client is only a name and its
// redirect URIs; nothing is readable until a signed-in person consents), so
// it is rate-limited per address (lib/oauth/http.ts, registrations), and the
// body is small JSON. The name is self-reported and the consent page says
// so. No redirect URI may point at this viewer itself: no legitimate client
// returns there, and one that did would make a code land on our own pages.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { config, off } = oauthOrNotFound();
  if (off) return off;

  const gate = takeAll(registrations, [`ip:${addressBucket(requestIp(request))}`]);
  if (!gate.allowed) {
    return oauthError(429, "temporarily_unavailable", "too many registrations; try again later", { "Retry-After": String(gate.retryAfterSeconds) });
  }

  let body: unknown;
  try {
    const text = await readBodyCapped(request);
    if (text === null) return oauthError(400, "invalid_client_metadata", "the registration is too large");
    body = JSON.parse(text);
  } catch {
    return oauthError(400, "invalid_client_metadata", "the body must be JSON");
  }
  const result = validateRegistration(body, new URL(config.issuer).origin);
  if (!result.ok) return oauthError(400, result.error, result.description);

  try {
    const client = await registerClient(result.client);
    return json(201, {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      ...(client.secret ? { client_secret: client.secret, client_secret_expires_at: 0 } : {}),
      client_name: result.client.name || undefined,
      redirect_uris: result.client.redirectUris,
      grant_types: result.client.grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: result.client.authMethod,
      scope: OAUTH_SCOPE,
    });
  } catch (e) {
    console.error("[puls-web] oauth registration failed:", e instanceof Error ? e.message : e);
    return oauthError(500, "server_error");
  }
}

export function OPTIONS() {
  const { off } = oauthOrNotFound();
  return off ?? preflight();
}
