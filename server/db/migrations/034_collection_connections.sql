-- Native Connections management and recipient-confirmed deletion requests.
ALTER TABLE collections.enrollments
 ADD COLUMN deletion_status text NOT NULL DEFAULT 'none' CHECK(deletion_status IN ('none','requested','confirmed')),
 ADD COLUMN deletion_requested_at timestamptz,
 ADD COLUMN deletion_confirmed_at timestamptz;
CREATE OR REPLACE FUNCTION collections.enrollment_json(e collections.enrollments) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('id',e.id,'request',collections.request_json(r),'status',e.status,
 'metrics',e.metrics,'start',e.start_ms,'end',e.end_ms,'generation',e.generation,
 'lastReceived',extract(epoch FROM e.last_received_at)*1000,'consentedAt',extract(epoch FROM e.consent_at)*1000,
 'deletionStatus',e.deletion_status)
 FROM collections.requests r WHERE r.id=e.request_id
$$;
ALTER FUNCTION collections.command(text,bytea,jsonb) RENAME TO command_before_connections;
REVOKE ALL ON FUNCTION collections.command_before_connections(text,bytea,jsonb) FROM PUBLIC;
CREATE FUNCTION collections.command(p_action text,p_session bytea,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE caller record; e collections.enrollments; r collections.requests;
BEGIN
 SELECT * INTO caller FROM auth.session_owner(p_session);
 IF NOT FOUND OR EXISTS(SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id=caller.user_id) THEN
   RAISE EXCEPTION 'personal sign-in required' USING ERRCODE='42501';
 END IF;
 IF p_action='list' THEN
   RETURN jsonb_build_object('requests',coalesce((SELECT jsonb_agg(collections.request_json(q) || jsonb_build_object(
     'participantCount',(SELECT count(*) FROM collections.enrollments WHERE request_id=q.id),
     'contributedCount',(SELECT count(*) FROM collections.enrollments WHERE request_id=q.id AND last_received_at IS NOT NULL),
     'lastContribution',(SELECT extract(epoch FROM max(last_received_at))*1000 FROM collections.enrollments WHERE request_id=q.id)) ORDER BY q.created_at DESC)
     FROM collections.requests q WHERE q.user_id=caller.user_id),'[]'::jsonb),
     'enrollments',coalesce((SELECT jsonb_agg(collections.enrollment_json(g) ORDER BY g.consent_at DESC)
       FROM collections.enrollments g WHERE g.user_id=caller.user_id),'[]'::jsonb));
 END IF;
 IF p_action IN ('request-deletion','confirm-deletion') THEN
   SELECT * INTO e FROM collections.enrollments WHERE id=(p_body->>'id')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'connection not found' USING ERRCODE='P0002'; END IF;
   SELECT * INTO r FROM collections.requests WHERE id=e.request_id;
   IF p_action='request-deletion' THEN
     IF e.user_id<>caller.user_id THEN RAISE EXCEPTION 'connection not found' USING ERRCODE='P0002'; END IF;
     IF jsonb_typeof(p_body->'withdraw') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'choose withdrawal' USING ERRCODE='22023'; END IF;
     -- Repeated requests are safe. Confirmation cannot coexist with active uploading.
     UPDATE collections.enrollments SET deletion_status='requested',deletion_requested_at=now(),deletion_confirmed_at=NULL,
       status=CASE WHEN p_body->>'withdraw'='true' THEN 'stopped' ELSE status END,
       token_hash=CASE WHEN p_body->>'withdraw'='true' THEN NULL ELSE token_hash END
       WHERE id=e.id RETURNING * INTO e;
   ELSE
     IF r.user_id<>caller.user_id THEN RAISE EXCEPTION 'connection not found' USING ERRCODE='P0002'; END IF;
     IF e.deletion_status<>'requested' THEN RAISE EXCEPTION 'no deletion requested' USING ERRCODE='22023'; END IF;
     UPDATE collections.enrollments SET status='stopped',token_hash=NULL WHERE id=e.id;
     DELETE FROM collections.records WHERE enrollment_id=e.id;
     DELETE FROM collections.receipts WHERE enrollment_id=e.id;
     UPDATE collections.enrollments SET deletion_status='confirmed',deletion_confirmed_at=now(),last_received_at=NULL
       WHERE id=e.id RETURNING * INTO e;
   END IF;
   RETURN collections.enrollment_json(e);
 ELSIF p_action='participants' THEN
   SELECT * INTO r FROM collections.requests WHERE id=(p_body->>'id')::uuid AND user_id=caller.user_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'request not found' USING ERRCODE='P0002'; END IF;
   RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'status',g.status,
     'lastReceived',extract(epoch FROM g.last_received_at)*1000,'deletionStatus',g.deletion_status))
     FROM collections.enrollments g WHERE request_id=r.id),'[]'::jsonb);
 END IF;
 IF p_action='join' THEN
   -- The creator already owns this immutable definition; no public invite is needed.
   SELECT * INTO r FROM collections.requests WHERE id=(p_body->>'id')::uuid AND user_id=caller.user_id;
   IF FOUND THEN p_body:=jsonb_set(p_body,'{inviteHash}',to_jsonb(encode(r.invite_hash,'hex'))); END IF;
 END IF;
 RETURN collections.command_before_connections(p_action,p_session,p_body);
END $$;
REVOKE ALL ON FUNCTION collections.command(text,bytea,jsonb) FROM PUBLIC;
-- The pre-existing web role may retain a grant across the rename on upgrades.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='web_app') THEN
 REVOKE ALL ON FUNCTION collections.command_before_connections(text,bytea,jsonb) FROM web_app;
END IF; END $$;
