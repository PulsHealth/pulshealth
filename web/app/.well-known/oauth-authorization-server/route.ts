import { json, oauthOrNotFound, preflight } from "@/lib/oauth/http";
import { OAUTH_SCOPE } from "@/lib/oauth/config";

// RFC 8414 authorization server metadata, for the MCP clients that find this
// viewer through the MCP server's protected-resource metadata. Only while
// OAuth is on (lib/oauth/config.ts); a 404 otherwise. Not an OpenID
// provider, so no /.well-known/openid-configuration.
export const dynamic = "force-dynamic";

export function GET() {
  const { config, off } = oauthOrNotFound();
  if (off) return off;
  const iss = config.issuer;
  return json(200, {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    registration_endpoint: `${iss}/oauth/register`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [OAUTH_SCOPE],
    authorization_response_iss_parameter_supported: true,
  });
}

export function OPTIONS() {
  const { off } = oauthOrNotFound();
  return off ?? preflight();
}
