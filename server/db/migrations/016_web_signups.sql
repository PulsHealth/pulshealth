-- Sign-up requests, and the few privileged steps the viewer's accounts mode
-- needs beyond reading one person's records (015_web_accounts.sql).
--
-- Anyone may ask for an account (/signup); nothing exists for them until an
-- administrator approves it on /admin. Approval creates the user, the
-- viewer then emails an invite, and only a signed-in person can connect
-- their own iPhone. So no data can arrive for anyone the operator has not
-- accepted: before approval there is no user, no account and no sync token.
--
-- Those steps write where web_app has no grant — `users`, `device_tokens`,
-- and (for a deletion) every table holding health data — so each is a
-- SECURITY DEFINER function owned by the migrating superuser, and web_app
-- may EXECUTE exactly these (099_read_roles.sh grants and asserts it). Each
-- takes the caller's session token in plaintext and checks it against
-- auth.sessions itself, which only ever stores SHA-256 hashes: a bug that
-- lets someone run SQL as web_app cannot borrow a session it has not seen.
-- (A compromised viewer process does see cookies, and could then act as the
-- people whose requests it sees — which is why each function is narrow.)
--
-- Every definer function pins search_path to pg_catalog and names its
-- objects in full, so nothing a caller creates can stand in for them.

-- ── requests ────────────────────────────────────────────────────────────────
CREATE TABLE auth.signup_requests (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text        NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
    name        text        NOT NULL DEFAULT '' CHECK (char_length(name) <= 200),
    note        text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
    status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Shown to the administrator deciding; not used for anything else.
    ip          inet,
    user_agent  text,
    decided_at  timestamptz,
    decided_by  uuid        REFERENCES auth.accounts (id) ON DELETE SET NULL,
    -- The user an approval created.
    user_id     uuid        REFERENCES users (id) ON DELETE SET NULL
);
-- One open request per address: asking twice does not queue twice.
CREATE UNIQUE INDEX signup_requests_pending_email ON auth.signup_requests (email) WHERE status = 'pending';
CREATE INDEX signup_requests_created_idx ON auth.signup_requests (created_at DESC);

-- Set when a person deletes their own account: it is disabled at once, its
-- sync tokens revoked, and its data waits for an administrator to purge it.
ALTER TABLE auth.accounts ADD COLUMN deletion_requested_at timestamptz;

-- ── session check ───────────────────────────────────────────────────────────
-- The live, enabled account a session token (the cookie's value, 32 bytes
-- in unpadded base64url) belongs to, or no row. Not granted to anyone: the
-- definer functions below call it.
CREATE FUNCTION auth.session_owner(p_session text)
RETURNS TABLE (account_id uuid, user_id uuid, is_admin boolean)
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT a.id, a.user_id, a.is_admin
    FROM auth.sessions s
    JOIN auth.accounts a ON a.id = s.account_id
   WHERE p_session ~ '^[A-Za-z0-9_-]{43}$'
     AND s.id = sha256(decode(translate(p_session, '-_', '+/') || '=', 'base64'))
     AND s.expires_at > now()
     AND a.disabled_at IS NULL
     AND a.password_hash IS NOT NULL
$$;
REVOKE ALL ON FUNCTION auth.session_owner(text) FROM PUBLIC;

-- ── approval (administrators) ───────────────────────────────────────────────
-- Approves a pending request: creates the person's user and records who
-- decided. The viewer then writes the invite (auth.invites, which it may
-- write itself) in the same transaction and emails it.
CREATE FUNCTION auth.approve_signup(p_session text, p_request uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
  req    record;
  new_user uuid := gen_random_uuid();
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR NOT caller.is_admin THEN
    RAISE EXCEPTION 'only an administrator may approve requests' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO req FROM auth.signup_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR req.status <> 'pending' THEN
    RAISE EXCEPTION 'no pending request %', p_request USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.accounts WHERE email = req.email) THEN
    RAISE EXCEPTION 'an account already signs in with that address' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.users (id) VALUES (new_user);
  UPDATE auth.signup_requests
     SET status = 'approved', user_id = new_user, decided_at = now(), decided_by = caller.account_id
   WHERE id = p_request;
  RETURN new_user;
END
$$;
REVOKE ALL ON FUNCTION auth.approve_signup(text, uuid) FROM PUBLIC;

-- Disables an account (it cannot sign in, its sessions end and every sync
-- token of its user is revoked, so its phone stops uploading) or enables it
-- again (tokens stay revoked: the person connects their phone afresh).
CREATE FUNCTION auth.set_account_disabled(p_session text, p_account uuid, p_disabled boolean)
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
  IF p_account = caller.account_id THEN
    RAISE EXCEPTION 'an administrator cannot disable their own account here' USING ERRCODE = '42501';
  END IF;
  SELECT id, user_id INTO target FROM auth.accounts WHERE id = p_account FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no account %', p_account USING ERRCODE = 'P0002';
  END IF;
  IF p_disabled THEN
    UPDATE auth.accounts SET disabled_at = now() WHERE id = p_account AND disabled_at IS NULL;
    DELETE FROM auth.sessions WHERE account_id = p_account;
    UPDATE public.device_tokens SET status = 'revoked', revoked_at = now()
     WHERE user_id = target.user_id AND status = 'active';
  ELSE
    UPDATE auth.accounts SET disabled_at = NULL, deletion_requested_at = NULL WHERE id = p_account;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION auth.set_account_disabled(text, uuid, boolean) FROM PUBLIC;

-- Deletes everything stored for a user whose account is disabled (or who
-- has none): health data in every table, sync tokens and batches, the
-- account, its requests and invites, and the user row itself. Compressed
-- chunks are decompressed as needed, so a long history takes a while.
-- Returns the number of rows removed per table.
CREATE FUNCTION auth.purge_user(p_session text, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller  record;
  counts  jsonb := '{}'::jsonb;
  n       bigint;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR NOT caller.is_admin THEN
    RAISE EXCEPTION 'only an administrator may delete data' USING ERRCODE = '42501';
  END IF;
  IF p_user = caller.user_id THEN
    RAISE EXCEPTION 'an administrator cannot delete their own data here' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.accounts WHERE user_id = p_user AND disabled_at IS NULL) THEN
    RAISE EXCEPTION 'disable the account first' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'no user %', p_user USING ERRCODE = 'P0002';
  END IF;

  -- Revoke first, so nothing new arrives while the rest goes.
  UPDATE public.device_tokens SET status = 'revoked', revoked_at = now()
   WHERE user_id = p_user AND status = 'active';
  -- Deleting from compressed chunks decompresses them; lift the
  -- per-transaction cap the way ingest's InsertBatch does.
  PERFORM set_config('timescaledb.max_tuples_decompressed_per_dml_transaction', '0', true);

  DELETE FROM public.workout_route_points  WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('workout_route_points', n);
  DELETE FROM public.workout_series_points WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('workout_series_points', n);
  DELETE FROM public.quantity_samples      WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('quantity_samples', n);
  DELETE FROM public.category_samples      WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('category_samples', n);
  DELETE FROM public.workouts              WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('workouts', n);
  DELETE FROM public.heartbeat_series      WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('heartbeat_series', n);
  DELETE FROM public.ecg_samples           WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ecg_samples', n);
  DELETE FROM public.state_of_mind         WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('state_of_mind', n);
  DELETE FROM public.medication_dose_events WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('medication_dose_events', n);
  DELETE FROM public.aggregate_samples     WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('aggregate_samples', n);
  DELETE FROM public.activity_summaries    WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('activity_summaries', n);
  DELETE FROM public.deleted_samples       WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('deleted_samples', n);
  DELETE FROM public.batches               WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('batches', n);
  DELETE FROM public.ingest_rejections     WHERE user_id = p_user::text; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ingest_rejections', n);
  DELETE FROM public.device_tokens         WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('device_tokens', n);
  DELETE FROM auth.invites                 WHERE user_id = p_user;
  DELETE FROM auth.signup_requests         WHERE user_id = p_user;
  DELETE FROM auth.accounts                WHERE user_id = p_user;
  -- Last: any table holding this user that the list above missed keeps its
  -- foreign key, and this fails loudly instead of leaving data behind.
  DELETE FROM public.users                 WHERE id = p_user;
  RETURN counts;
END
$$;
REVOKE ALL ON FUNCTION auth.purge_user(text, uuid) FROM PUBLIC;

-- ── the signed-in person's own phone ────────────────────────────────────────
-- Records a sync token for the caller's own user, minted by the viewer (32
-- random bytes, hex, the same shape as `ingest devices issue`; only its
-- SHA-256 over the ASCII hex is stored, as ingest expects). The plaintext is
-- shown once, as a pairing code, and never stored. At most ten active
-- tokens per user.
CREATE FUNCTION auth.issue_device_token(p_session text, p_token_hash bytea, p_prefix text, p_name text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
  new_id bigint;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION auth.issue_device_token(text, bytea, text, text) FROM PUBLIC;

-- The caller's own sync tokens, for the account page.
CREATE FUNCTION auth.my_devices(p_session text)
RETURNS TABLE (id bigint, name text, token_prefix text, status text, created_at timestamptz, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT d.id, d.name, d.token_prefix, d.status, d.created_at, d.last_seen_at
    FROM public.device_tokens d
    JOIN auth.session_owner(p_session) o ON o.user_id = d.user_id
   ORDER BY d.status = 'active' DESC, d.created_at DESC
$$;
REVOKE ALL ON FUNCTION auth.my_devices(text) FROM PUBLIC;

-- Revokes one of the caller's own sync tokens; true when one was revoked.
CREATE FUNCTION auth.revoke_my_device(p_session text, p_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  UPDATE public.device_tokens SET status = 'revoked', revoked_at = now()
   WHERE id = p_id AND user_id = caller.user_id AND status = 'active';
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION auth.revoke_my_device(text, bigint) FROM PUBLIC;

-- The caller deletes their own account: disabled at once, sessions ended,
-- sync tokens revoked, and the deletion recorded for an administrator, who
-- purges the data (auth.purge_user). Returns the user, for the notice the
-- viewer sends. Not for administrators, who could lock everyone out.
CREATE FUNCTION auth.delete_my_account(p_session text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF caller.is_admin THEN
    RAISE EXCEPTION 'an administrator account cannot delete itself here' USING ERRCODE = '42501';
  END IF;
  UPDATE auth.accounts SET disabled_at = now(), deletion_requested_at = now() WHERE id = caller.account_id;
  DELETE FROM auth.sessions WHERE account_id = caller.account_id;
  UPDATE public.device_tokens SET status = 'revoked', revoked_at = now()
   WHERE user_id = caller.user_id AND status = 'active';
  RETURN caller.user_id;
END
$$;
REVOKE ALL ON FUNCTION auth.delete_my_account(text) FROM PUBLIC;
