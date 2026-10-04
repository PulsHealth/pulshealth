-- OAuth 2.1 for AI assistants: the web viewer (accounts mode) as the
-- authorization server for the MCP server (server/mcp), so the Claude apps,
-- claude.ai's custom connectors and Claude Code can read one signed-in
-- person's records through the product API. See web/README.md, "AI
-- assistants (OAuth)", and docs/ai.md.
--
-- Three tables in the account store (schema auth), written by the viewer as
-- web_app like auth.sessions: web_app gets SELECT, INSERT, UPDATE, DELETE on
-- them (099_read_roles.sh grants and asserts it). Nothing here holds health
-- data. Every secret is stored as the SHA-256 of 32 random bytes, like a
-- session: a copy of these tables signs nobody in and refreshes nothing.
-- Access tokens are not stored at all: they are self-contained HS256 tokens
-- the MCP server verifies on its own (30 minutes), so revoking a grant stops
-- refreshing at once and access within 30 minutes.
--
-- No triggers in schema auth (099_read_roles.sh asserts it): the housekeeping
-- is an hourly TimescaleDB job, like auth.prune_signups.

-- ── clients (RFC 7591 dynamic registration) ─────────────────────────────────
-- Anyone may register one (rate-limited per address in the viewer); a client
-- is only a name, its redirect URIs and, for a confidential client, its
-- secret's hash. client_name is self-reported and shown as such.
CREATE TABLE auth.oauth_clients (
    id            text        PRIMARY KEY CHECK (id ~ '^pc_[A-Za-z0-9_-]{16,64}$'),
    name          text        NOT NULL DEFAULT '' CHECK (char_length(name) <= 100),
    redirect_uris text[]      NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
    auth_method   text        NOT NULL DEFAULT 'none'
                              CHECK (auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
    secret_hash   bytea       CHECK (octet_length(secret_hash) = 32),
    grant_types   text[]      NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token'],
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- Advanced on every authorization and token request; a client unused for
    -- 30 days with no live grant is deleted by auth.prune_oauth.
    last_used_at  timestamptz NOT NULL DEFAULT now(),
    CHECK ((auth_method = 'none') = (secret_hash IS NULL))
);
CREATE INDEX oauth_clients_last_used_idx ON auth.oauth_clients (last_used_at);

-- ── grants (one per consent, carrying the current refresh token) ────────────
-- The refresh token rotates on every use: refresh_hash is the live one and
-- previous_refresh_hash the one it replaced, so presenting that one again
-- (a stolen copy, or the real client after a thief used it) revokes the
-- grant. Deleting the account deletes its grants.
CREATE TABLE auth.oauth_grants (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id            uuid        NOT NULL REFERENCES auth.accounts (id) ON DELETE CASCADE,
    client_id             text        NOT NULL REFERENCES auth.oauth_clients (id) ON DELETE CASCADE,
    scope                 text        NOT NULL,
    -- The MCP server's URL (RFC 8707 resource) the grant was made for.
    resource              text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    last_used_at          timestamptz NOT NULL DEFAULT now(),
    revoked_at            timestamptz,
    refresh_hash          bytea       NOT NULL UNIQUE CHECK (octet_length(refresh_hash) = 32),
    previous_refresh_hash bytea       CHECK (octet_length(previous_refresh_hash) = 32),
    -- 60 days after last use.
    refresh_expires_at    timestamptz NOT NULL
);
CREATE INDEX oauth_grants_account_idx ON auth.oauth_grants (account_id);
CREATE INDEX oauth_grants_client_idx ON auth.oauth_grants (client_id);
CREATE INDEX oauth_grants_previous_idx ON auth.oauth_grants (previous_refresh_hash);

-- ── authorization codes (5 minutes, single use) ─────────────────────────────
-- Bound to the client, the account that consented, the exact redirect URI
-- the authorization request used, the PKCE challenge, scope and resource.
-- A second exchange of a used code revokes the grant the first one made
-- (grant_id).
CREATE TABLE auth.oauth_codes (
    id             bytea       PRIMARY KEY CHECK (octet_length(id) = 32),
    client_id      text        NOT NULL REFERENCES auth.oauth_clients (id) ON DELETE CASCADE,
    account_id     uuid        NOT NULL REFERENCES auth.accounts (id) ON DELETE CASCADE,
    redirect_uri   text        NOT NULL,
    code_challenge text        NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
    scope          text        NOT NULL,
    resource       text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    used_at        timestamptz,
    grant_id       uuid        REFERENCES auth.oauth_grants (id) ON DELETE SET NULL
);
CREATE INDEX oauth_codes_expires_idx ON auth.oauth_codes (expires_at);
CREATE INDEX oauth_codes_grant_idx ON auth.oauth_codes (grant_id);
CREATE INDEX oauth_codes_account_idx ON auth.oauth_codes (account_id);

-- ── disabling and deleting revoke grants ────────────────────────────────────
-- As 018's auth.set_account_disabled and 016's auth.delete_my_account (same
-- signatures, owner, search_path and grants), each also revoking the
-- account's OAuth grants in the same transaction. The token endpoint
-- refuses a disabled account anyway; this makes the revocation show, and
-- keeps a later re-enable from bringing the assistants back. A password
-- change or an invite reset revokes them in the viewer
-- (web/lib/accounts/store.ts), which writes auth.accounts itself.
CREATE OR REPLACE FUNCTION auth.set_account_disabled(p_session bytea, p_account uuid, p_disabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
  target record;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR NOT caller.is_admin THEN
    RAISE EXCEPTION 'only an administrator may disable accounts' USING ERRCODE = '42501';
  END IF;
  SELECT a.id, a.user_id, a.is_admin, a.deletion_requested_at INTO target FROM auth.accounts a
   WHERE a.id = p_account
     AND EXISTS (SELECT 1 FROM auth.self_service_users ss WHERE ss.user_id = a.user_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no self-service account %', p_account USING ERRCODE = 'P0002';
  END IF;
  IF target.id = caller.account_id THEN
    RAISE EXCEPTION 'an administrator cannot disable or enable their own account here' USING ERRCODE = '42501';
  END IF;
  IF target.is_admin THEN
    RAISE EXCEPTION 'an administrator''s account is managed from the server, not here' USING ERRCODE = '42501';
  END IF;
  IF p_disabled THEN
    UPDATE auth.accounts SET disabled_at = now() WHERE id = p_account AND disabled_at IS NULL;
    DELETE FROM auth.sessions WHERE account_id = p_account;
    UPDATE public.device_tokens SET status = 'revoked', revoked_at = now()
     WHERE user_id = target.user_id AND status = 'active';
    UPDATE auth.oauth_grants SET revoked_at = now() WHERE account_id = p_account AND revoked_at IS NULL;
    DELETE FROM auth.oauth_codes WHERE account_id = p_account;
  ELSIF target.deletion_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'this person asked to be deleted; purge instead' USING ERRCODE = '55000';
  ELSE
    UPDATE auth.accounts SET disabled_at = NULL WHERE id = p_account;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION auth.set_account_disabled(bytea, uuid, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION auth.delete_my_account(p_session bytea)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR NOT caller.self_service OR caller.is_admin THEN
    RAISE EXCEPTION 'only a self-service account may delete itself here' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM auth.accounts WHERE id = caller.account_id FOR UPDATE;
  UPDATE auth.accounts SET disabled_at = now(), deletion_requested_at = now() WHERE id = caller.account_id;
  DELETE FROM auth.sessions WHERE account_id = caller.account_id;
  UPDATE public.device_tokens SET status = 'revoked', revoked_at = now()
   WHERE user_id = caller.user_id AND status = 'active';
  UPDATE auth.oauth_grants SET revoked_at = now() WHERE account_id = caller.account_id AND revoked_at IS NULL;
  DELETE FROM auth.oauth_codes WHERE account_id = caller.account_id;
  RETURN caller.user_id;
END
$$;
REVOKE ALL ON FUNCTION auth.delete_my_account(bytea) FROM PUBLIC;

-- ── housekeeping ────────────────────────────────────────────────────────────
-- Hourly: expired codes; dead grants (revoked, or their refresh token
-- expired — they refresh nothing, and the account page no longer lists
-- them); and clients nobody has used for 30 days that hold no live grant
-- (their codes and dead grants go with them, by cascade). A registration
-- that never led to a consent is gone 30 days later.
CREATE PROCEDURE auth.prune_oauth(job_id integer, config jsonb)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM auth.oauth_codes WHERE expires_at < now();
  DELETE FROM auth.oauth_grants WHERE revoked_at IS NOT NULL OR refresh_expires_at < now();
  DELETE FROM auth.oauth_clients c
   WHERE c.last_used_at < now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM auth.oauth_grants g
                      WHERE g.client_id = c.id AND g.revoked_at IS NULL AND g.refresh_expires_at > now());
END
$$;
REVOKE ALL ON PROCEDURE auth.prune_oauth(integer, jsonb) FROM PUBLIC;
SELECT add_job('auth.prune_oauth', INTERVAL '1 hour', initial_start => now() + INTERVAL '7 minutes');
