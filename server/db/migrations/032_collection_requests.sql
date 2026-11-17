-- Collection grants are deliberately separate from personal sync and its RLS views.
CREATE SCHEMA collections;
REVOKE ALL ON SCHEMA collections FROM PUBLIC;
CREATE TABLE collections.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  invite_hash bytea NOT NULL CHECK (octet_length(invite_hash) = 32),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  listing text NOT NULL DEFAULT 'private' CHECK (listing IN ('private','pending','approved','declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collections.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES collections.requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash bytea UNIQUE CHECK (octet_length(token_hash) = 32),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','stopped','complete')),
  metrics jsonb NOT NULL,
  start_ms bigint NOT NULL,
  end_ms bigint NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  consent_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz,
  UNIQUE(request_id,user_id), CHECK (end_ms > start_ms)
);
CREATE TABLE collections.records (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES collections.enrollments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  record_key text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(enrollment_id,record_key)
);
CREATE INDEX ON collections.records(enrollment_id,sequence);
CREATE TABLE collections.receipts (
  enrollment_id uuid NOT NULL REFERENCES collections.enrollments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  digest text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(enrollment_id,batch_id)
);

CREATE FUNCTION collections.request_json(r collections.requests) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT r.definition || jsonb_build_object('id',r.id,'status',r.status,'listing',r.listing,'version',1)
$$;
CREATE FUNCTION collections.enrollment_json(e collections.enrollments) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('id',e.id,'request',collections.request_json(r),'status',e.status,
 'metrics',e.metrics,'start',e.start_ms,'end',e.end_ms,'generation',e.generation,
 'lastReceived',extract(epoch FROM e.last_received_at)*1000,'consentedAt',extract(epoch FROM e.consent_at)*1000)
 FROM collections.requests r WHERE r.id=e.request_id
$$;

-- All writes reauthorize inside the database. Definitions are immutable: changing
-- scope requires a new request and a new affirmative participant consent.
CREATE FUNCTION collections.command(p_action text, p_session bytea, p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE caller record; r collections.requests; e collections.enrollments; item jsonb;
 result jsonb; now_ms bigint := floor(extract(epoch FROM clock_timestamp())*1000);
BEGIN
 SELECT * INTO caller FROM auth.session_owner(p_session);
 IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id=caller.user_id) THEN
   RAISE EXCEPTION 'personal sign-in required' USING ERRCODE='42501';
 END IF;
 IF p_action='list' THEN
   RETURN jsonb_build_object('requests',coalesce((SELECT jsonb_agg(collections.request_json(q) ORDER BY q.created_at DESC)
     FROM collections.requests q WHERE q.user_id=caller.user_id),'[]'::jsonb),
     'enrollments',coalesce((SELECT jsonb_agg(collections.enrollment_json(g) ORDER BY g.consent_at DESC)
     FROM collections.enrollments g WHERE g.user_id=caller.user_id),'[]'::jsonb));
 ELSIF p_action='create' THEN
   IF (SELECT count(*) FROM collections.requests WHERE user_id=caller.user_id AND status='open')>=50 THEN
     RAISE EXCEPTION 'close an existing request first' USING ERRCODE='22023';
   END IF;
   IF jsonb_typeof(p_body->'definition') IS DISTINCT FROM 'object'
      OR NOT coalesce(p_body->'definition' ?& ARRAY['title','organizer','kind','purpose','contact','consentText','mode','historyDays','durationDays','retentionDays','metrics'],false)
      OR jsonb_typeof(p_body->'definition'->'metrics') IS DISTINCT FROM 'array' THEN
     RAISE EXCEPTION 'incomplete definition' USING ERRCODE='22023';
   END IF;
   IF NOT coalesce(length(p_body->'definition'->>'title') BETWEEN 1 AND 120
      AND length(p_body->'definition'->>'organizer') BETWEEN 1 AND 120
      AND length(p_body->'definition'->>'purpose') BETWEEN 1 AND 2000
      AND length(p_body->'definition'->>'contact') BETWEEN 1 AND 254
      AND length(p_body->'definition'->>'consentText') BETWEEN 1 AND 5000
      AND p_body->'definition'->>'kind' IN ('general','group','study')
      AND p_body->'definition'->>'mode' IN ('once','ongoing')
      AND (p_body->'definition'->>'historyDays')::integer BETWEEN 1 AND 3650
      AND (p_body->'definition'->>'durationDays')::integer BETWEEN 1 AND 365
      AND (p_body->'definition'->>'retentionDays')::integer BETWEEN 1 AND 365,false) THEN
     RAISE EXCEPTION 'invalid definition' USING ERRCODE='22023';
   END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(p_body->'definition'->'metrics') LOOP
     IF NOT coalesce(item ?& ARRAY['type','function','required','unit'],false)
       OR jsonb_typeof(item->'required') IS DISTINCT FROM 'boolean'
       OR NOT coalesce(item->>'function' IN ('raw','sum','average','min','max','mostRecent','duration'),false)
       OR NOT coalesce(item->>'type' ~ '^HK(Quantity|Category)TypeIdentifier[A-Za-z0-9]+$',false) THEN
       RAISE EXCEPTION 'invalid metric' USING ERRCODE='22023';
     END IF;
   END LOOP;
   IF length(p_body->'definition'->>'title') NOT BETWEEN 1 AND 120
     OR p_body->'definition'->>'mode' NOT IN ('once','ongoing')
     OR (p_body->'definition'->>'historyDays')::integer NOT BETWEEN 1 AND 3650
     OR (p_body->'definition'->>'durationDays')::integer NOT BETWEEN 1 AND 365
     OR (p_body->'definition'->>'retentionDays')::integer NOT BETWEEN 1 AND 365
     OR jsonb_array_length(p_body->'definition'->'metrics') NOT BETWEEN 1 AND 30 THEN
     RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
   END IF;
   INSERT INTO collections.requests(user_id,definition,invite_hash,listing)
   VALUES(caller.user_id,p_body->'definition',decode(p_body->>'inviteHash','hex'),
     CASE WHEN p_body->>'listed'='true' THEN 'pending' ELSE 'private' END) RETURNING * INTO r;
   RETURN collections.request_json(r);
 ELSIF p_action='review-list' THEN
   IF NOT caller.is_admin THEN RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
   RETURN coalesce((SELECT jsonb_agg(collections.request_json(q)) FROM collections.requests q WHERE listing='pending'),'[]'::jsonb);
 ELSIF p_action IN ('pause','resume','stop','finish','credential') THEN
   SELECT * INTO e FROM collections.enrollments WHERE id=(p_body->>'id')::uuid AND user_id=caller.user_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'sharing not found' USING ERRCODE='P0002'; END IF;
   SELECT * INTO r FROM collections.requests WHERE id=e.request_id;
   IF p_action='pause' AND e.status IN ('active','paused') AND r.definition->>'mode'='ongoing' THEN e.status:='paused'; e.token_hash:=NULL;
   ELSIF p_action='stop' THEN e.status:='stopped'; e.token_hash:=NULL;
   ELSIF p_action='finish' AND e.status='active' AND r.definition->>'mode'='once' THEN e.status:='complete'; e.token_hash:=NULL;
   ELSIF p_action IN ('resume','credential') THEN
     IF e.end_ms+604800000<now_ms OR r.status<>'open' OR e.status NOT IN ('active','paused') OR (p_action='credential' AND e.status<>'active') OR e.end_ms<=now_ms AND r.definition->>'mode'='ongoing' THEN
       RAISE EXCEPTION 'sharing has ended' USING ERRCODE='22023';
     END IF;
     IF p_action='resume' THEN
       IF e.status<>'paused' OR r.definition->>'mode'<>'ongoing' THEN RAISE EXCEPTION 'cannot resume' USING ERRCODE='22023'; END IF;
       e.start_ms:=now_ms;
     END IF;
     e.generation:=e.generation+1; e.status:='active'; e.token_hash:=decode(p_body->>'tokenHash','hex');
   ELSE RAISE EXCEPTION 'invalid sharing transition' USING ERRCODE='22023'; END IF;
   UPDATE collections.enrollments SET status=e.status,token_hash=e.token_hash,start_ms=e.start_ms,generation=e.generation WHERE id=e.id;
   RETURN collections.enrollment_json(e);
 END IF;
 SELECT * INTO r FROM collections.requests WHERE id=(p_body->>'id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'request not found' USING ERRCODE='P0002'; END IF;
 IF p_action='join' THEN
   IF r.status<>'open' OR NOT coalesce((r.listing='approved' OR r.invite_hash=decode(p_body->>'inviteHash','hex')),false) THEN
     RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';
   END IF;
   IF jsonb_typeof(p_body->'metrics') IS DISTINCT FROM 'array' OR p_body->>'accepted' IS DISTINCT FROM 'true' OR (p_body->>'version')::integer IS DISTINCT FROM 1
      OR jsonb_array_length(p_body->'metrics') NOT BETWEEN 1 AND jsonb_array_length(r.definition->'metrics') THEN
      RAISE EXCEPTION 'review and accept this request' USING ERRCODE='22023';
   END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(p_body->'metrics') LOOP
     IF NOT r.definition->'metrics' @> jsonb_build_array(item) THEN RAISE EXCEPTION 'scope mismatch' USING ERRCODE='22023'; END IF;
   END LOOP;
   FOR item IN SELECT value FROM jsonb_array_elements(r.definition->'metrics') LOOP
     IF item->>'required'='true' AND NOT p_body->'metrics' @> jsonb_build_array(item) THEN
       RAISE EXCEPTION 'required metric missing' USING ERRCODE='22023';
     END IF;
   END LOOP;
   INSERT INTO collections.enrollments(request_id,user_id,token_hash,metrics,start_ms,end_ms)
   VALUES(r.id,caller.user_id,decode(p_body->>'tokenHash','hex'),p_body->'metrics',
     now_ms-(r.definition->>'historyDays')::bigint*86400000,
     CASE WHEN r.definition->>'mode'='once' THEN now_ms ELSE now_ms+(r.definition->>'durationDays')::bigint*86400000 END)
   RETURNING * INTO e;
   RETURN collections.enrollment_json(e);
 END IF;
 IF p_action='review' THEN
   IF NOT caller.is_admin OR p_body->>'decision' NOT IN ('approved','declined') THEN
     RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
   UPDATE collections.requests SET listing=p_body->>'decision' WHERE id=r.id RETURNING * INTO r;
   RETURN collections.request_json(r);
 END IF;
 IF r.user_id<>caller.user_id THEN RAISE EXCEPTION 'request not found' USING ERRCODE='P0002'; END IF;
 IF p_action='close' THEN
   UPDATE collections.requests SET status='closed',listing='private' WHERE id=r.id RETURNING * INTO r;
   UPDATE collections.enrollments SET status='stopped',token_hash=NULL WHERE request_id=r.id AND status IN ('active','paused');
   RETURN collections.request_json(r);
 ELSIF p_action='invite' THEN
   UPDATE collections.requests SET invite_hash=decode(p_body->>'inviteHash','hex') WHERE id=r.id;
   RETURN collections.request_json(r);
 ELSIF p_action='participants' THEN
   RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'status',g.status,'metrics',g.metrics,
     'lastReceived',extract(epoch FROM g.last_received_at)*1000,'consentedAt',extract(epoch FROM g.consent_at)*1000))
     FROM collections.enrollments g WHERE request_id=r.id),'[]'::jsonb);
 ELSIF p_action='export' THEN
   RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('cursor',v.sequence,'participant',v.enrollment_id,'data',v.payload) ORDER BY v.sequence)
     FROM (SELECT d.* FROM collections.records d JOIN collections.enrollments g ON g.id=d.enrollment_id
       WHERE g.request_id=r.id AND d.sequence>coalesce((p_body->>'after')::bigint,0)
       AND d.received_at>now()-make_interval(days=>(r.definition->>'retentionDays')::integer)
       ORDER BY d.sequence LIMIT 1000) v),'[]'::jsonb);
 END IF;
 RAISE EXCEPTION 'unknown action' USING ERRCODE='22023';
END $$;

CREATE FUNCTION collections.discover(p_id uuid, p_invite bytea) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(jsonb_agg(collections.request_json(r) ORDER BY r.created_at DESC),'[]'::jsonb)
 FROM (SELECT q.* FROM collections.requests q JOIN auth.accounts a ON a.user_id=q.user_id
 WHERE q.status='open' AND a.disabled_at IS NULL
 AND ((p_id IS NULL AND q.listing='approved') OR (q.id=p_id AND (q.listing='approved' OR q.invite_hash=p_invite)))
 ORDER BY q.created_at DESC LIMIT 100) r
$$;

CREATE FUNCTION collections.upload(p_token bytea, p_batch uuid, p_digest text, p_records jsonb, p_deletions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE e collections.enrollments; r collections.requests; v jsonb; m jsonb; old_digest text;
BEGIN
 SELECT * INTO e FROM collections.enrollments WHERE token_hash=p_token FOR UPDATE;
 IF NOT FOUND OR e.status<>'active' THEN RAISE EXCEPTION 'sharing inactive' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM collections.requests WHERE id=e.request_id;
 IF r.status<>'open' OR floor(extract(epoch FROM now())*1000)>e.end_ms+604800000
 OR NOT EXISTS(SELECT 1 FROM auth.accounts WHERE user_id=e.user_id AND disabled_at IS NULL AND password_hash IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM auth.accounts WHERE user_id=r.user_id AND disabled_at IS NULL AND password_hash IS NOT NULL) THEN
   RAISE EXCEPTION 'sharing ended' USING ERRCODE='42501'; END IF;
 IF jsonb_array_length(p_records)>5000 OR jsonb_array_length(p_deletions)>5000 OR p_digest !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'invalid batch' USING ERRCODE='22023'; END IF;
 SELECT digest INTO old_digest FROM collections.receipts WHERE enrollment_id=e.id AND batch_id=p_batch;
 IF FOUND THEN
   IF old_digest<>p_digest THEN RAISE EXCEPTION 'batch conflict' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('batchID',p_batch,'digest',p_digest);
 END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   SELECT value INTO m FROM jsonb_array_elements(e.metrics) WHERE value->>'type'=v->>'type'
     AND value->>'function'=v->>'function';
   IF NOT FOUND OR NOT (v ?& ARRAY['key','type','function','start','end'])
     OR jsonb_typeof(v->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(v->'end') IS DISTINCT FROM 'number'
     OR (v->>'start')::bigint<e.start_ms OR (v->>'start')::bigint>=e.end_ms
     OR (v->>'end')::bigint<(v->>'start')::bigint OR (v->>'end')::bigint>e.end_ms
     OR (v->>'function'<>'raw' AND (v->>'end')::bigint-(v->>'start')::bigint NOT BETWEEN 82800000 AND 90000000)
     OR length(v->>'key') NOT BETWEEN 1 AND 240
     OR v - ARRAY['key','type','function','start','end','value','category','unit'] <> '{}'::jsonb
     OR (v->>'unit') IS DISTINCT FROM (m->>'unit') THEN
     RAISE EXCEPTION 'record outside approved scope' USING ERRCODE='22023'; END IF;
   IF v->>'function'='raw' THEN
     INSERT INTO collections.records(enrollment_id,user_id,record_key,payload) VALUES(e.id,e.user_id,v->>'key',v)
     ON CONFLICT(enrollment_id,record_key) DO NOTHING;
   ELSE
     INSERT INTO collections.records(enrollment_id,user_id,record_key,payload) VALUES(e.id,e.user_id,v->>'key',v)
     ON CONFLICT(enrollment_id,record_key) DO UPDATE SET payload=EXCLUDED.payload,received_at=now();
   END IF;
 END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements(p_deletions) LOOP
   DELETE FROM collections.records WHERE enrollment_id=e.id AND record_key=v#>>'{}';
 END LOOP;
 INSERT INTO collections.receipts(enrollment_id,user_id,batch_id,digest) VALUES(e.id,e.user_id,p_batch,p_digest);
 UPDATE collections.enrollments SET last_received_at=now() WHERE id=e.id;
 RETURN jsonb_build_object('batchID',p_batch,'digest',p_digest);
END $$;

CREATE PROCEDURE collections.prune(job_id integer, config jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 DELETE FROM collections.records d USING collections.enrollments e, collections.requests r
 WHERE d.enrollment_id=e.id AND e.request_id=r.id
 AND d.received_at<=now()-make_interval(days=>(r.definition->>'retentionDays')::integer);
 DELETE FROM collections.receipts WHERE received_at<now()-interval '14 days';
 UPDATE collections.enrollments SET token_hash=NULL,status='stopped'
 WHERE status IN ('active','paused') AND end_ms+604800000<extract(epoch FROM now())*1000;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA collections FROM PUBLIC;
REVOKE ALL ON PROCEDURE collections.prune(integer,jsonb) FROM PUBLIC;
SELECT add_job('collections.prune',INTERVAL '1 hour',initial_start=>now()+INTERVAL '10 minutes');
