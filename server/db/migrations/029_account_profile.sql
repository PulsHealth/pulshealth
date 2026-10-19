-- Short-lived, one-use PKCE handoffs. The custom URL contains no session token.
CREATE TABLE auth.native_handoffs (
  code_hash bytea PRIMARY KEY CHECK (octet_length(code_hash) = 32),
  challenge text NOT NULL CHECK (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  account_id uuid NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
  source_session bytea NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);

-- Account profile writes are authorized again inside the database. No caller-
-- supplied account/user ID can redirect a write to a different person.
CREATE FUNCTION auth.set_my_profile(p_session bytea, p_name text, p_email text,
                                   p_dob date, p_sex text, p_password_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE caller record; current_account record;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = caller.user_id) THEN
    RAISE EXCEPTION 'personal sign-in required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO current_account FROM auth.accounts WHERE id = caller.account_id FOR UPDATE;
  IF current_account.disabled_at IS NOT NULL OR current_account.password_hash IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions WHERE id = p_session AND expires_at > now()
      AND created_at > now() - interval '90 days'
  ) THEN
    RAISE EXCEPTION 'personal sign-in required' USING ERRCODE = '42501';
  END IF;
  IF p_email IS NULL OR p_email <> lower(btrim(p_email)) OR length(p_email) > 254
     OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     OR length(p_name) > 200 OR p_dob > CURRENT_DATE
     OR (p_sex IS NOT NULL AND p_sex NOT IN ('female', 'male', 'other')) THEN
    RAISE EXCEPTION 'invalid profile' USING ERRCODE = '22023';
  END IF;
  IF p_email <> current_account.email AND
     (p_password_hash IS NULL OR p_password_hash <> current_account.password_hash) THEN
    RAISE EXCEPTION 'current password required' USING ERRCODE = '42501';
  END IF;
  IF p_email <> current_account.email THEN
    DELETE FROM auth.password_resets WHERE account_id = caller.account_id;
    DELETE FROM auth.invites WHERE user_id = caller.user_id;
  END IF;
  UPDATE auth.accounts SET email = p_email WHERE id = caller.account_id;
  UPDATE public.users SET name = nullif(btrim(p_name), ''), email = p_email,
    dob = p_dob, biological_sex = p_sex, updated_at = now() WHERE id = caller.user_id;
END $$;
REVOKE ALL ON FUNCTION auth.set_my_profile(bytea, text, text, date, text, text) FROM PUBLIC;
