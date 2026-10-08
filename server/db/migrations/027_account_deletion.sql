-- Automatic account erasure. The privileged purge implementation is not
-- callable by web_app: only a user's authorized queue entry or an admin's
-- scoped purge can reach it. Eligibility is operator-owned, never writable
-- by web_app (which can otherwise forge account/session rows).
CREATE TABLE auth.personal_users (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE TABLE auth.deletion_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  default_user_id uuid NOT NULL
);
INSERT INTO auth.deletion_policy VALUES (true, '5ea4d000-0000-4000-8000-000000000001');
CREATE TABLE auth.account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES public.users(id) ON DELETE SET NULL,
  receipt_hash bytea UNIQUE NOT NULL CHECK (octet_length(receipt_hash) = 32),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz NOT NULL DEFAULT '-infinity',
  last_error_code text
);
-- Minimal restore suppression ledger. Export separately before any restore;
-- an old health snapshot alone cannot know who requested deletion afterward.
CREATE TABLE auth.deletion_tombstones (
  user_id uuid PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON auth.personal_users, auth.deletion_policy, auth.account_deletions, auth.deletion_tombstones FROM PUBLIC;

CREATE FUNCTION auth.can_delete_account(p_session bytea)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.session_owner(p_session) o
    WHERE NOT o.is_admin
      AND o.user_id <> '5ea4d000-0000-4000-8000-000000000001'::uuid
      AND (o.self_service OR EXISTS (SELECT 1 FROM auth.personal_users WHERE user_id = o.user_id))
      AND NOT EXISTS (SELECT 1 FROM auth.deletion_policy WHERE default_user_id = o.user_id)
      AND NOT EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = o.user_id)
  )
$$;
REVOKE ALL ON FUNCTION auth.can_delete_account(bytea) FROM PUBLIC;

CREATE FUNCTION auth.purge_user_data(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller  record;
  counts  jsonb := '{}'::jsonb;
  n       bigint;
  lo      timestamptz;
  hi      timestamptz;
  types   smallint[];
  srcs    smallint[];
  used    smallint[];
  wks     uuid[];
  mat     text;
BEGIN
  IF p_user = '5ea4d000-0000-4000-8000-000000000001'::uuid
     OR EXISTS (SELECT 1 FROM auth.deletion_policy WHERE default_user_id = p_user)
     OR EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = p_user)
     OR EXISTS (SELECT 1 FROM auth.accounts WHERE user_id = p_user AND is_admin) THEN
    RAISE EXCEPTION 'protected account' USING ERRCODE = '42501';
  END IF;
  -- Lock the user row: every insert that names this user (an account from
  -- an invite, a sync token, a batch) checks its foreign key with a lock
  -- that waits on this one, then fails once the row is gone. NOWAIT, so a
  -- second purge of the same user (an administrator retrying after the page
  -- timed out) fails at once instead of holding a connection while it waits.
  PERFORM 1 FROM public.users WHERE id = p_user FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no user %', p_user USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.accounts WHERE user_id = p_user AND disabled_at IS NULL) THEN
    RAISE EXCEPTION 'disable the account first' USING ERRCODE = '55000';
  END IF;

  UPDATE public.device_tokens SET status = 'revoked', revoked_at = now()
   WHERE user_id = p_user AND status = 'active';
  -- Same as ingest's InsertBatch: deleting from compressed chunks may
  -- decompress more tuples than the default per-transaction cap.
  PERFORM set_config('timescaledb.max_tuples_decompressed_per_dml_transaction', '0', true);

  SELECT min(start_ts), max(start_ts), array_agg(DISTINCT type_id), array_agg(DISTINCT source_id)
    INTO lo, hi, types, srcs FROM public.quantity_samples WHERE user_id = p_user;
  -- Every source the user's rows name, for the scrub at the end.
  SELECT coalesce(array_agg(DISTINCT s), '{}') INTO srcs FROM (
    SELECT unnest(srcs) AS s
    UNION SELECT source_id FROM public.category_samples       WHERE user_id = p_user
    UNION SELECT source_id FROM public.workouts               WHERE user_id = p_user
    UNION SELECT source_id FROM public.heartbeat_series       WHERE user_id = p_user
    UNION SELECT source_id FROM public.ecg_samples            WHERE user_id = p_user
    UNION SELECT source_id FROM public.state_of_mind          WHERE user_id = p_user
    UNION SELECT source_id FROM public.medication_dose_events WHERE user_id = p_user
  ) x WHERE s IS NOT NULL;
  IF lo IS NOT NULL THEN
    DELETE FROM public.quantity_samples
     WHERE user_id = p_user AND type_id = ANY (types) AND start_ts BETWEEN lo AND hi;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
    n := 0;
  END IF;
  counts := counts || jsonb_build_object('quantity_samples', n);

  -- workout_series_points is segmented by workout, so naming the workouts
  -- opens only their batches. Taken from the points themselves, not from
  -- workouts: ingest stores points whose workout row is missing or another
  -- user's, and one left behind would stop the user row's delete below.
  SELECT coalesce(array_agg(DISTINCT workout_uuid), '{}') INTO wks
    FROM public.workout_series_points WHERE user_id = p_user;
  DELETE FROM public.workout_series_points WHERE workout_uuid = ANY (wks) AND user_id = p_user;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('workout_series_points', n);
  DELETE FROM public.workout_route_points  WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('workout_route_points', n);
  DELETE FROM public.category_samples      WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('category_samples', n);
  DELETE FROM public.workouts              WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('workouts', n);
  DELETE FROM public.heartbeat_series      WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('heartbeat_series', n);
  DELETE FROM public.ecg_samples           WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ecg_samples', n);
  DELETE FROM public.state_of_mind         WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('state_of_mind', n);
  DELETE FROM public.medication_dose_events WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('medication_dose_events', n);
  DELETE FROM public.aggregate_samples     WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('aggregate_samples', n);
  DELETE FROM public.activity_summaries    WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('activity_summaries', n);
  DELETE FROM public.deleted_samples       WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('deleted_samples', n);

  -- The continuous aggregate's own rows for this user, which a refresh
  -- would only clear on its next run (and Grafana reads meanwhile).
  SELECT format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name)
    INTO mat FROM timescaledb_information.continuous_aggregates
   WHERE view_schema = 'public' AND view_name = 'quantity_rollups';
  IF mat IS NOT NULL THEN
    EXECUTE format('DELETE FROM %s WHERE user_id = $1', mat) USING p_user;
    GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('quantity_rollups', n);
  END IF;

  -- Device and app names are personal ("Pat's iPhone"), but `sources` is
  -- shared and has no user: blank the name of each source no one else's
  -- records still use. A rename, not a delete, so no table has to check its
  -- foreign keys. The new name is random, so no uploaded source can already
  -- hold it and fail the unique key. The rows are locked first (renaming a
  -- uniquely indexed column conflicts with a foreign-key check), so an
  -- upload starting to use one of them waits the second or two this takes
  -- rather than slipping in between the check and the rename.
  PERFORM 1 FROM public.sources WHERE source_id = ANY (srcs) FOR UPDATE;
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO used FROM (
    SELECT source_id AS u FROM public.quantity_samples WHERE source_id = ANY (srcs)
    UNION SELECT source_id FROM public.category_samples       WHERE source_id = ANY (srcs)
    UNION SELECT source_id FROM public.workouts               WHERE source_id = ANY (srcs)
    UNION SELECT source_id FROM public.heartbeat_series       WHERE source_id = ANY (srcs)
    UNION SELECT source_id FROM public.ecg_samples            WHERE source_id = ANY (srcs)
    UNION SELECT source_id FROM public.state_of_mind          WHERE source_id = ANY (srcs)
    UNION SELECT source_id FROM public.medication_dose_events WHERE source_id = ANY (srcs)
  ) x;
  UPDATE public.sources SET name = 'removed-' || gen_random_uuid()
   WHERE source_id = ANY (srcs) AND NOT source_id = ANY (used);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('sources_blanked', n);

  DELETE FROM public.batches               WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('batches', n);
  DELETE FROM public.ingest_rejections     WHERE user_id = p_user::text; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ingest_rejections', n);
  DELETE FROM public.device_tokens         WHERE user_id = p_user; GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('device_tokens', n);
  DELETE FROM auth.invites                 WHERE user_id = p_user;
  DELETE FROM auth.signup_requests         WHERE user_id = p_user;
  DELETE FROM auth.accounts                WHERE user_id = p_user;
  -- Last (self_service_users goes with it, by cascade): a table holding this
  -- user that the list above missed keeps its foreign key and fails this
  -- loudly instead of leaving data behind.
  DELETE FROM public.users                 WHERE id = p_user;
  RETURN counts;
END
$$;
REVOKE ALL ON FUNCTION auth.purge_user_data(uuid) FROM PUBLIC;

-- Restore tooling only (never web_app). Replay the independently recovered
-- deletion ledger before enabling services on a restored health snapshot.
CREATE FUNCTION auth.replay_account_deletion(p_user uuid, p_requested_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_user = '5ea4d000-0000-4000-8000-000000000001'::uuid
     OR EXISTS (SELECT 1 FROM auth.deletion_policy WHERE default_user_id = p_user)
     OR EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = p_user)
     OR EXISTS (SELECT 1 FROM auth.accounts WHERE user_id = p_user AND is_admin) THEN
    RAISE EXCEPTION 'protected account in deletion ledger' USING ERRCODE = '42501';
  END IF;
  INSERT INTO auth.deletion_tombstones (user_id, requested_at)
    VALUES (p_user, p_requested_at) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN RETURN; END IF;
  UPDATE auth.accounts SET disabled_at = now(), deletion_requested_at = p_requested_at WHERE user_id = p_user;
  PERFORM auth.purge_user_data(p_user);
END
$$;
REVOKE ALL ON FUNCTION auth.replay_account_deletion(uuid,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION auth.purge_user(p_session bytea, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE caller record; result jsonb;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR NOT caller.is_admin
     OR NOT (EXISTS (SELECT 1 FROM auth.self_service_users WHERE user_id = p_user)
             OR EXISTS (SELECT 1 FROM auth.personal_users WHERE user_id = p_user)) THEN
    RAISE EXCEPTION 'only an administrator may purge personal data' USING ERRCODE = '42501';
  END IF;
  result := auth.purge_user_data(p_user);
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION auth.purge_user(bytea, uuid) FROM PUBLIC;

-- Preserve the existing function's return and revocation behavior; every
-- accepted request is now also queued durably. The web route supplies its
-- own random receipt through request_account_deletion below.
CREATE OR REPLACE FUNCTION auth.delete_my_account(p_session bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE caller record;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR NOT auth.can_delete_account(p_session) THEN
    RAISE EXCEPTION 'only a personal account may delete itself' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM auth.accounts WHERE id = caller.account_id FOR UPDATE;
  IF NOT auth.can_delete_account(p_session) THEN
    RAISE EXCEPTION 'session no longer authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO auth.deletion_tombstones (user_id) VALUES (caller.user_id) ON CONFLICT DO NOTHING;
  INSERT INTO auth.account_deletions (user_id, receipt_hash)
    VALUES (caller.user_id, sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')))
    ON CONFLICT (user_id) DO NOTHING;
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

CREATE FUNCTION auth.request_account_deletion(p_session bytea, p_receipt_hash bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE person uuid;
BEGIN
  IF octet_length(p_receipt_hash) <> 32 OR p_receipt_hash IS NULL THEN
    RAISE EXCEPTION 'invalid receipt' USING ERRCODE = '22023';
  END IF;
  person := auth.delete_my_account(p_session);
  UPDATE auth.account_deletions SET receipt_hash = p_receipt_hash WHERE user_id = person;
  RETURN person;
END
$$;
REVOKE ALL ON FUNCTION auth.request_account_deletion(bytea,bytea) FROM PUBLIC;

CREATE FUNCTION auth.complete_account_deletion(p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE request_id uuid;
BEGIN
  SELECT id INTO request_id FROM auth.account_deletions WHERE user_id = p_user AND completed_at IS NULL FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user); END IF;
  PERFORM auth.purge_user_data(p_user);
  UPDATE auth.account_deletions SET completed_at = now(), last_error_code = NULL WHERE id = request_id;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION auth.complete_account_deletion(uuid) FROM PUBLIC;

CREATE FUNCTION auth.deletion_status(p_receipt_hash bytea)
RETURNS TABLE (completed boolean) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT completed_at IS NOT NULL FROM auth.account_deletions
    WHERE receipt_hash = p_receipt_hash
      AND (completed_at IS NULL OR completed_at > now() - interval '30 days')
$$;
REVOKE ALL ON FUNCTION auth.deletion_status(bytea) FROM PUBLIC;

CREATE PROCEDURE auth.process_account_deletions(job_id integer, config jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE pending record;
BEGIN
  FOR pending IN SELECT id, user_id FROM auth.account_deletions WHERE completed_at IS NULL AND user_id IS NOT NULL
    AND (config->>'user_id' IS NULL OR user_id = (config->>'user_id')::uuid)
    ORDER BY last_attempt_at, requested_at LIMIT 20 LOOP
    BEGIN
      PERFORM auth.complete_account_deletion(pending.user_id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE auth.account_deletions SET attempts = attempts + 1, last_attempt_at = clock_timestamp(), last_error_code = SQLSTATE WHERE id = pending.id;
    END;
  END LOOP;
  -- An administrator may have purged an already requested account.
  UPDATE auth.account_deletions SET completed_at = now() WHERE user_id IS NULL AND completed_at IS NULL;
  DELETE FROM auth.account_deletions WHERE completed_at < now() - interval '30 days';
END
$$;
REVOKE ALL ON PROCEDURE auth.process_account_deletions(integer,jsonb) FROM PUBLIC;
SELECT add_job('auth.process_account_deletions', INTERVAL '1 minute', initial_start => now() + INTERVAL '1 minute');
