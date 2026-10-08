-- Invoked by test-migrate.sh against its throwaway database. The rollback
-- keeps these fixtures out of subsequent migrator scenarios.
BEGIN;
DO $$
DECLARE
  ny uuid := gen_random_uuid();
  la uuid := gen_random_uuid();
  ktm uuid := gen_random_uuid();
  legacy uuid := gen_random_uuid();
  tid smallint;
  sid smallint;
  travel_context integer;
  observed float8;
BEGIN
  INSERT INTO users (id, time_zone) VALUES
    (ny, 'America/New_York'), (la, 'America/Los_Angeles'), (ktm, 'Asia/Kathmandu'), (legacy, NULL);
  IF puls_user_time_zone(ny) <> 'America/New_York' OR puls_user_time_zone(legacy) <> puls_time_zone() THEN
    RAISE EXCEPTION 'account/fallback reporting zone was not preserved';
  END IF;
  INSERT INTO sample_types (identifier, kind, unit)
    VALUES ('test-calendar-' || gen_random_uuid(), 'quantity', 'count') RETURNING type_id INTO tid;
  INSERT INTO aggregate_series (type_id, agg_func, interval_value, interval_unit, device_filter, unit)
    VALUES (tid, 'sum', 1, 'day', 'all', 'count') RETURNING series_id INTO sid;
  -- A single UTC instant belongs to different NY and LA calendar days.
  INSERT INTO quantity_samples (uuid, type_id, start_ts, end_ts, value, user_id) VALUES
    (gen_random_uuid(), tid, '2100-01-02 06:00Z', '2100-01-02 06:00Z', 7, ny),
    (gen_random_uuid(), tid, '2100-01-02 06:00Z', '2100-01-02 06:00Z', 9, la),
    -- Kathmandu midnight divides a UTC rollup hour. NULL source is legal.
    (gen_random_uuid(), tid, '2100-01-02 18:10Z', '2100-01-02 18:10Z', 11, ktm),
    (gen_random_uuid(), tid, '2100-01-02 18:20Z', '2100-01-02 18:20Z', 13, ktm);
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2100-01-02';
  IF observed IS DISTINCT FROM 7::float8 THEN RAISE EXCEPTION 'NY raw day: %', observed; END IF;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = la AND day = '2100-01-01';
  IF observed IS DISTINCT FROM 9::float8 THEN RAISE EXCEPTION 'LA raw day: %', observed; END IF;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ktm AND day = '2100-01-02';
  IF observed IS DISTINCT FROM 11::float8 THEN RAISE EXCEPTION 'Kathmandu raw day before midnight: %', observed; END IF;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ktm AND day = '2100-01-03';
  IF observed IS DISTINCT FROM 13::float8 THEN RAISE EXCEPTION 'Kathmandu raw day after midnight: %', observed; END IF;
  INSERT INTO temporal_contexts (time_zone_id, utc_offset_seconds, source, confidence)
    VALUES ('Asia/Tokyo', 32400, 'deviceCalendar', 'inferred') RETURNING temporal_context_id INTO travel_context;
  INSERT INTO aggregate_samples (series_id, bucket_start, bucket_end, bucket_start_temporal_context_id, value, user_id) VALUES
    (sid, '2100-01-02 15:00Z', '2100-01-03 15:00Z', travel_context, 101, ny),
    -- Legacy contextless buckets use the user's reporting calendar.
    (sid, '2100-01-10 05:00Z', '2100-01-11 05:00Z', NULL, 103, ny),
    -- A spring-forward day is 23 hours, never assumed to be 86,400 seconds.
    (sid, '2026-03-08 05:00Z', '2026-03-09 04:00Z', NULL, 107, ny);
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2100-01-03';
  IF observed IS DISTINCT FROM 101::float8 THEN RAISE EXCEPTION 'travel aggregate lost its recorded calendar day: %', observed; END IF;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2100-01-10';
  IF observed IS DISTINCT FROM 103::float8 THEN RAISE EXCEPTION 'legacy aggregate reporting day: %', observed; END IF;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2026-03-08';
  IF observed IS DISTINCT FROM 107::float8 THEN RAISE EXCEPTION 'DST aggregate reporting day: %', observed; END IF;
  UPDATE users SET time_zone = 'America/Los_Angeles' WHERE id = ny;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2100-01-03';
  IF observed IS DISTINCT FROM 101::float8 THEN RAISE EXCEPTION 'changing reporting zone rewrote recorded phone day: %', observed; END IF;
END
$$;
ROLLBACK;
