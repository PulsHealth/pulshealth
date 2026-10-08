-- puls:rerun
-- Recording-quality read compatibility. Raw samples and original aggregate
-- buckets remain untouched. Supersedes the view definition in 009; keep this
-- file after 009 when rebuilding/baselining the schema.
--
-- Older clients bridged NSNumber(0/1) to Bool. Decode only this documented
-- integer enum; never coerce arbitrary boolean metadata such as HKWasUserEntered.
-- Unknown, absent, null, string and invalid enum values remain unknown (NULL).
CREATE OR REPLACE FUNCTION puls_heart_rate_motion_context(metadata jsonb)
RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  SELECT CASE metadata -> 'HKMetadataKeyHeartRateMotionContext'
    WHEN 'false'::jsonb THEN 0::smallint
    WHEN 'true'::jsonb THEN 1::smallint
    WHEN '0'::jsonb THEN 0::smallint
    WHEN '1'::jsonb THEN 1::smallint
    WHEN '2'::jsonb THEN 2::smallint
    ELSE NULL::smallint
  END
$$;
COMMENT ON FUNCTION puls_heart_rate_motion_context(jsonb) IS
  'Decode HealthKit heart-rate motion context: 0 not set, 1 sedentary, 2 active (including workouts). Legacy boolean 0/1 is decoded without changing raw metadata; invalid values return NULL.';

CREATE OR REPLACE VIEW metric_daily AS
WITH type_semantics AS (
  SELECT type_id,
         CASE WHEN bool_or(agg_func = 'sum') THEN 'cumulative'
              WHEN bool_or(agg_func = 'average') THEN 'discrete' END AS semantic
  FROM aggregate_series
  GROUP BY type_id
  HAVING bool_or(agg_func IN ('sum', 'average'))
),
candidates AS (
  SELECT t.identifier, s.type_id, b.user_id,
         (b.bucket_start AT TIME ZONE puls_time_zone())::date AS day,
         b.value,
         1 AS tier, b.updated_at, b.bucket_start
  FROM aggregate_samples b
  JOIN aggregate_series s USING (series_id)
  JOIN type_semantics ts USING (type_id)
  JOIN sample_types t ON t.type_id = s.type_id
  WHERE b.value IS NOT NULL
    AND s.interval_value = 1
    AND s.interval_unit = 'day'
    AND s.device_filter = 'all'
    -- A one-day series can retain buckets made under an older anchor/zone.
    -- Only complete local calendar boundaries belong in this daily view.
    -- Calendar arithmetic deliberately admits 23/25-hour DST days.
    AND b.bucket_start = ((b.bucket_start AT TIME ZONE puls_time_zone())::date::timestamp
                         AT TIME ZONE puls_time_zone())
    AND b.bucket_end = (((b.bucket_start AT TIME ZONE puls_time_zone())::date + 1)::timestamp
                       AT TIME ZONE puls_time_zone())
    AND ((ts.semantic = 'cumulative' AND s.agg_func = 'sum')
      OR (ts.semantic = 'discrete' AND s.agg_func = 'average'))
  UNION ALL
  SELECT t.identifier, ts.type_id, d.user_id, d.day, d.value,
         2, NULL::timestamptz, NULL::timestamptz
  FROM type_semantics ts
  JOIN sample_types t ON t.type_id = ts.type_id
  CROSS JOIN LATERAL (
    SELECT per_source.user_id, per_source.day,
           CASE WHEN ts.semantic = 'cumulative'
                THEN (array_agg(per_source.value ORDER BY per_source.value DESC))[1]
                ELSE sum(per_source.value * per_source.n) / nullif(sum(per_source.n), 0) END AS value
    FROM (
      SELECT r.user_id, r.source_id,
             (r.bucket AT TIME ZONE puls_time_zone())::date AS day,
             CASE WHEN ts.semantic = 'cumulative' THEN sum(r.sum_value)
                  ELSE sum(r.avg_value * r.n) / nullif(sum(r.n), 0) END AS value,
             sum(r.n) AS n
      FROM quantity_rollups r
      WHERE r.type_id = ts.type_id
      GROUP BY r.user_id, r.source_id, day
    ) per_source
    GROUP BY per_source.user_id, per_source.day
  ) d
),
ranked AS (
  SELECT *,
         row_number() OVER (
           PARTITION BY identifier, type_id, user_id, day
           ORDER BY tier, updated_at DESC, bucket_start DESC
         ) AS preference
  FROM candidates
)
SELECT identifier, type_id, user_id, day, value,
       CASE WHEN tier = 1 THEN 'aggregate' ELSE 'rollup' END AS source
FROM ranked
WHERE preference = 1;

