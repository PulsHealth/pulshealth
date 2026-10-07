-- Every enabled personal account can connect its own phone, independently
-- of how its user was created. Deletion/purge remain self-service-only.
-- The public demo is excluded by an operator-owned policy, set by 022.
CREATE TABLE IF NOT EXISTS auth.device_pairing_policy (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    demo_user_id uuid
);
REVOKE ALL ON TABLE auth.device_pairing_policy FROM PUBLIC;
INSERT INTO auth.device_pairing_policy (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION auth.issue_device_token(p_session bytea, p_token_hash bytea, p_prefix text, p_name text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
  new_id bigint;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = caller.user_id) THEN
    RAISE EXCEPTION 'only a signed-in personal account may connect a phone here' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM auth.accounts WHERE id = caller.account_id AND disabled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account disabled' USING ERRCODE = '42501';
  END IF;
  IF octet_length(p_token_hash) <> 32 OR p_prefix !~ '^[0-9a-f]{8}$' THEN
    RAISE EXCEPTION 'malformed token' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.device_tokens WHERE user_id = caller.user_id AND status = 'active') >= 10 THEN
    RAISE EXCEPTION 'too many connected devices; disconnect one first' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.device_tokens (token_hash, token_prefix, user_id, name)
  VALUES (p_token_hash, p_prefix, caller.user_id, left(coalesce(p_name, ''), 100))
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;
REVOKE ALL ON FUNCTION auth.issue_device_token(bytea, bytea, text, text) FROM PUBLIC;

-- The caller's own sync tokens (personal accounts), for the account page.
CREATE OR REPLACE FUNCTION auth.my_devices(p_session bytea)
RETURNS TABLE (id bigint, name text, token_prefix text, status text, created_at timestamptz, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT d.id, d.name, d.token_prefix, d.status, d.created_at, d.last_seen_at
    FROM public.device_tokens d
    JOIN auth.session_owner(p_session) o ON o.user_id = d.user_id
     AND NOT EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = o.user_id)
   ORDER BY d.status = 'active' DESC, d.created_at DESC
$$;
REVOKE ALL ON FUNCTION auth.my_devices(bytea) FROM PUBLIC;

-- Revokes one of the caller's own sync tokens; true when one was revoked.
CREATE OR REPLACE FUNCTION auth.revoke_my_device(p_session bytea, p_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = caller.user_id) THEN
    RAISE EXCEPTION 'only a signed-in personal account may disconnect a phone here' USING ERRCODE = '42501';
  END IF;
  UPDATE public.device_tokens SET status = 'revoked', revoked_at = now()
   WHERE id = p_id AND user_id = caller.user_id AND status = 'active';
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION auth.revoke_my_device(bytea, bigint) FROM PUBLIC;
