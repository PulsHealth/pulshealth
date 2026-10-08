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
  ny_standard integer;
  ny_daylight integer;
  howe_standard integer;
  howe_daylight integer;
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
  -- These look like one-day series but are incomplete or off-anchor. They
  -- must not displace the raw fallback (the deployed recording-quality rule).
  INSERT INTO aggregate_samples (series_id, bucket_start, bucket_end, value, user_id) VALUES
    (sid, '2100-01-02 05:30Z', '2100-01-03 05:00Z', 901, ny),
    (sid, '2100-01-02 05:15Z', '2100-01-03 05:15Z', 902, ny);
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
  INSERT INTO temporal_contexts (time_zone_id, utc_offset_seconds, source, confidence) VALUES
    ('America/New_York', -18000, 'test-calendar', 'inferred') RETURNING temporal_context_id INTO ny_standard;
  INSERT INTO temporal_contexts (time_zone_id, utc_offset_seconds, source, confidence) VALUES
    ('America/New_York', -14400, 'test-calendar', 'inferred') RETURNING temporal_context_id INTO ny_daylight;
  INSERT INTO temporal_contexts (time_zone_id, utc_offset_seconds, source, confidence) VALUES
    ('Australia/Lord_Howe', 37800, 'test-calendar', 'inferred') RETURNING temporal_context_id INTO howe_standard;
  INSERT INTO temporal_contexts (time_zone_id, utc_offset_seconds, source, confidence) VALUES
    ('Australia/Lord_Howe', 39600, 'test-calendar', 'inferred') RETURNING temporal_context_id INTO howe_daylight;
  UPDATE aggregate_samples SET bucket_start_temporal_context_id = ny_standard,
    bucket_end_temporal_context_id = ny_daylight
    WHERE series_id = sid AND user_id = ny AND bucket_start = '2026-03-08 05:00Z';
  INSERT INTO aggregate_samples (series_id, bucket_start, bucket_end,
    bucket_start_temporal_context_id, bucket_end_temporal_context_id, value, user_id) VALUES
    (sid, '2026-11-01 04:00Z', '2026-11-02 05:00Z', ny_daylight, ny_standard, 109, ny),
    (sid, '2026-10-03 13:30Z', '2026-10-04 13:00Z', howe_standard, howe_daylight, 113, ny),
    -- A clipped recorded-context bucket must stay excluded even when the
    -- account calendar differs from the phone calendar.
    (sid, '2026-11-01 04:30Z', '2026-11-02 05:00Z', ny_daylight, ny_standard, 903, ny);
  UPDATE users SET time_zone = 'America/Los_Angeles' WHERE id = ny;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2100-01-03';
  IF observed IS DISTINCT FROM 101::float8 THEN RAISE EXCEPTION 'changing reporting zone rewrote recorded phone day: %', observed; END IF;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2026-03-08';
  IF observed IS DISTINCT FROM 107::float8 THEN RAISE EXCEPTION 'recorded 23-hour day with another reporting zone: %', observed; END IF;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2026-11-01';
  IF observed IS DISTINCT FROM 109::float8 THEN RAISE EXCEPTION 'recorded 25-hour day/clipped exclusion: %', observed; END IF;
  SELECT value INTO observed FROM metric_daily WHERE type_id = tid AND user_id = ny AND day = '2026-10-04';
  IF observed IS DISTINCT FROM 113::float8 THEN RAISE EXCEPTION 'recorded half-hour DST day: %', observed; END IF;
END
$$;
ROLLBACK;
