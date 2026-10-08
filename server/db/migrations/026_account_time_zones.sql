-- Each account has a stable reporting calendar. Existing/self-hosted users
-- retain the deployment default until they explicitly choose another zone.
-- Only newly approved hosted users initialize their zone from their first
-- phone upload; subsequent travel never silently rewrites their reporting day.
ALTER TABLE public.users ADD COLUMN time_zone text;
ALTER TABLE public.users ADD COLUMN time_zone_auto_initialize boolean NOT NULL DEFAULT false;

-- SECURITY INVOKER deliberately follows the caller's existing search_path:
-- api_reader/grafana read public.users; web_app reads the scoped web.users.
-- This grants no new access to other users' account settings.
CREATE FUNCTION public.puls_user_time_zone(p_user uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT time_zone FROM users WHERE id = p_user), public.puls_time_zone())
$$;

CREATE FUNCTION auth.set_my_time_zone(p_session bytea, p_zone text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM auth.session_owner(p_session);
  IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.device_pairing_policy WHERE demo_user_id = caller.user_id) THEN
    RAISE EXCEPTION 'only a signed-in personal account may change its reporting time zone' USING ERRCODE = '42501';
  END IF;
  IF p_zone IS NULL OR length(p_zone) > 100 OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_zone
  ) THEN
    RAISE EXCEPTION 'unknown reporting time zone' USING ERRCODE = '22023';
  END IF;
  UPDATE public.users SET time_zone = p_zone, time_zone_auto_initialize = false, updated_at = now()
   WHERE id = caller.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN p_zone;
END
$$;
REVOKE ALL ON FUNCTION auth.set_my_time_zone(bytea, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION auth.approve_signup(p_session bytea, p_request uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller   record;
  req      record;
  the_user uuid;
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
  SELECT r.user_id INTO the_user
    FROM auth.signup_requests r
    JOIN auth.self_service_users ss ON ss.user_id = r.user_id
   WHERE r.email = req.email AND r.status = 'approved'
     AND NOT EXISTS (SELECT 1 FROM auth.accounts a WHERE a.user_id = r.user_id)
   ORDER BY r.decided_at DESC
   LIMIT 1;
  IF the_user IS NULL THEN
    the_user := gen_random_uuid();
    INSERT INTO public.users (id, time_zone_auto_initialize) VALUES (the_user, true);
    INSERT INTO auth.self_service_users (user_id, request_id) VALUES (the_user, p_request);
  END IF;
  UPDATE auth.signup_requests
     SET status = 'approved', user_id = the_user, decided_at = now(), decided_by = caller.account_id
   WHERE id = p_request;
  RETURN the_user;
END
$$;
REVOKE ALL ON FUNCTION auth.approve_signup(bytea, uuid) FROM PUBLIC;

-- 009, 008 and 023_recording_quality are intentionally re-runnable. 099 calls this function before
-- restoring web views/grants so a baseline or rollup rebuild cannot regress
-- the daily calendar to the old shared-zone view. No new stored health data.
CREATE FUNCTION public.puls_create_metric_daily() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
CREATE OR REPLACE VIEW public.metric_daily AS
WITH type_semantics AS (
  SELECT type_id,
         CASE WHEN bool_or(agg_func = 'sum') THEN 'cumulative'
              WHEN bool_or(agg_func = 'average') THEN 'discrete' END AS semantic
  FROM public.aggregate_series
  GROUP BY type_id
  HAVING bool_or(agg_func IN ('sum', 'average'))
),
candidates AS (
  SELECT t.identifier, s.type_id, b.user_id,
         calendar.local_start::date AS day,
         b.value,
         1 AS tier, b.updated_at, b.bucket_start
  FROM public.aggregate_samples b
  JOIN public.aggregate_series s USING (series_id)
  JOIN type_semantics ts USING (type_id)
  JOIN public.sample_types t ON t.type_id = s.type_id
  JOIN public.users u ON u.id = b.user_id
  LEFT JOIN public.temporal_contexts tc ON tc.temporal_context_id = b.bucket_start_temporal_context_id
  LEFT JOIN public.temporal_contexts ec ON ec.temporal_context_id = b.bucket_end_temporal_context_id
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN tc.temporal_context_id IS NOT NULL
           THEN (b.bucket_start AT TIME ZONE 'UTC') + make_interval(secs => tc.utc_offset_seconds)
           ELSE b.bucket_start AT TIME ZONE coalesce(u.time_zone, public.puls_time_zone()) END AS local_start,
      CASE WHEN ec.temporal_context_id IS NOT NULL
           THEN (b.bucket_end AT TIME ZONE 'UTC') + make_interval(secs => ec.utc_offset_seconds)
           WHEN tc.temporal_context_id IS NOT NULL THEN
             CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = tc.time_zone_id)
                  THEN b.bucket_end AT TIME ZONE tc.time_zone_id
                  ELSE (b.bucket_end AT TIME ZONE 'UTC') + make_interval(secs => tc.utc_offset_seconds) END
           ELSE b.bucket_end AT TIME ZONE coalesce(u.time_zone, public.puls_time_zone()) END AS local_end
  ) calendar
  WHERE b.value IS NOT NULL
    AND s.interval_value = 1
    AND s.interval_unit = 'day'
    AND s.device_filter = 'all'
    -- Preserve deployed 023's recording-quality rule: a one-day series may
    -- retain clipped/misaligned buckets from an older anchor. Only complete
    -- local midnight-to-midnight days enter the headline, using recorded
    -- phone context for travel and the account zone for legacy buckets.
    -- Separate boundary offsets preserve 23/25-hour (and half-hour) DST days.
    AND calendar.local_start = calendar.local_start::date::timestamp
    AND calendar.local_end = (calendar.local_start::date + 1)::timestamp
    AND (tc.temporal_context_id IS NULL OR ec.temporal_context_id IS NULL
         OR tc.time_zone_id = ec.time_zone_id)
    AND ((ts.semantic = 'cumulative' AND s.agg_func = 'sum')
      OR (ts.semantic = 'discrete' AND s.agg_func = 'average'))
  UNION ALL
  SELECT t.identifier, ts.type_id, d.user_id, d.day, d.value,
         2, NULL::timestamptz, NULL::timestamptz
  FROM type_semantics ts
  JOIN public.sample_types t ON t.type_id = ts.type_id
  CROSS JOIN LATERAL (
    SELECT per_source.user_id, per_source.day,
           CASE WHEN ts.semantic = 'cumulative'
                THEN (array_agg(per_source.value ORDER BY per_source.value DESC))[1]
                ELSE sum(per_source.total) / nullif(sum(per_source.n), 0) END AS value
    FROM (
      SELECT r.user_id, r.source_id, parts.day,
             CASE WHEN ts.semantic = 'cumulative' THEN sum(parts.total)
                  ELSE sum(parts.total) / nullif(sum(parts.n), 0) END AS value,
             sum(parts.total) AS total, sum(parts.n) AS n
      FROM public.quantity_rollups r
      JOIN public.users u ON u.id = r.user_id
      CROSS JOIN LATERAL (
        SELECT coalesce(u.time_zone, public.puls_time_zone()) AS zone
      ) z
      CROSS JOIN LATERAL (
        SELECT (r.bucket AT TIME ZONE z.zone)::date AS first_day,
               ((r.bucket + interval '1 hour' - interval '1 microsecond') AT TIME ZONE z.zone)::date AS last_day
      ) bounds
      CROSS JOIN LATERAL (
        -- Most hourly rollups lie within one account day. Retain that cheap
        -- path. Fractional-offset midnight (e.g. Kathmandu at UTC18:15) can
        -- split an hour; only that hour is read from raw rows to avoid moving
        -- samples across days or inventing a proportional split.
        SELECT bounds.first_day AS day,
               CASE WHEN ts.semantic = 'cumulative' THEN r.sum_value ELSE r.avg_value * r.n END AS total, r.n
         WHERE bounds.first_day = bounds.last_day
        UNION ALL
        SELECT (q.start_ts AT TIME ZONE z.zone)::date AS day,
               CASE WHEN ts.semantic = 'cumulative' THEN sum(q.value) ELSE avg(q.value) * count(*) END AS total, count(*) AS n
          FROM public.quantity_samples q
         WHERE bounds.first_day <> bounds.last_day
           AND q.user_id = r.user_id AND q.type_id = r.type_id AND q.source_id IS NOT DISTINCT FROM r.source_id
           AND q.start_ts >= r.bucket AND q.start_ts < r.bucket + interval '1 hour'
         GROUP BY day
      ) parts
      WHERE r.type_id = ts.type_id
      GROUP BY r.user_id, r.source_id, parts.day
    ) per_source
    GROUP BY per_source.user_id, per_source.day
  ) d
),
ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY identifier, type_id, user_id, day
    ORDER BY tier, updated_at DESC, bucket_start DESC
  ) AS preference FROM candidates
)
SELECT identifier, type_id, user_id, day, value,
       CASE WHEN tier = 1 THEN 'aggregate' ELSE 'rollup' END AS source
FROM ranked WHERE preference = 1;
END
$fn$;
REVOKE ALL ON FUNCTION public.puls_create_metric_daily() FROM PUBLIC;
SELECT public.puls_create_metric_daily();
