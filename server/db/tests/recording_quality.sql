-- Disposable-database regression, invoked by test-migrate.sh. No persistent fixtures.
BEGIN;
SET LOCAL puls.time_zone = 'America/Los_Angeles';
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM (VALUES
    (NULL::jsonb, NULL::smallint), ('{}'::jsonb, NULL),
    ('{"HKMetadataKeyHeartRateMotionContext":false}'::jsonb, 0),
    ('{"HKMetadataKeyHeartRateMotionContext":true}'::jsonb, 1),
    ('{"HKMetadataKeyHeartRateMotionContext":0}'::jsonb, 0),
    ('{"HKMetadataKeyHeartRateMotionContext":1}'::jsonb, 1),
    ('{"HKMetadataKeyHeartRateMotionContext":2}'::jsonb, 2),
    ('{"HKMetadataKeyHeartRateMotionContext":2.0}'::jsonb, 2),
    ('{"HKMetadataKeyHeartRateMotionContext":"1"}'::jsonb, NULL),
    ('{"HKMetadataKeyHeartRateMotionContext":3}'::jsonb, NULL),
    ('{"HKMetadataKeyHeartRateMotionContext":0.5}'::jsonb, NULL),
    ('{"HKMetadataKeyHeartRateMotionContext":null}'::jsonb, NULL),
    ('{"HKWasUserEntered":true}'::jsonb, NULL)
  ) t(metadata, expected)
  WHERE puls_heart_rate_motion_context(metadata) IS DISTINCT FROM expected;
  IF bad <> 0 THEN RAISE EXCEPTION 'motion-context decoding: % failures', bad; END IF;
END $$;

INSERT INTO users(id,name) VALUES ('f0000000-0000-4000-8000-000000000023','Recording quality fixture');
INSERT INTO sample_types(identifier,kind,unit)
VALUES ('HKQuantityTypeIdentifierRecordingQualityFixture','quantity','count');
INSERT INTO aggregate_series(type_id,agg_func,interval_value,interval_unit,device_filter,unit)
SELECT type_id,'sum',1,'day','all','count' FROM sample_types
WHERE identifier='HKQuantityTypeIdentifierRecordingQualityFixture';

-- Aligned, newer shifted, wrong end, shifted-only day, spring 23h and fall 25h.
INSERT INTO aggregate_samples(series_id,user_id,bucket_start,bucket_end,value,updated_at)
SELECT series_id,'f0000000-0000-4000-8000-000000000023',v.lo::timestamptz,v.hi::timestamptz,v.value,v.updated::timestamptz
FROM aggregate_series s JOIN sample_types t USING(type_id), (VALUES
 ('2024-07-10 07:00Z','2024-07-11 07:00Z',100,'2024-07-12 00:00Z'),
 ('2024-07-11 06:00Z','2024-07-12 06:00Z',999,'2024-07-13 00:00Z'),
 ('2024-07-12 07:00Z','2024-07-13 06:00Z',888,'2024-07-14 00:00Z'),
 ('2024-03-10 08:00Z','2024-03-11 07:00Z',23,'2024-03-12 00:00Z'),
 ('2024-11-03 07:00Z','2024-11-04 08:00Z',25,'2024-11-05 00:00Z'),
 ('2024-07-14 06:00Z','2024-07-15 06:00Z',777,'2024-07-16 00:00Z')
) v(lo,hi,value,updated)
WHERE t.identifier='HKQuantityTypeIdentifierRecordingQualityFixture';
DO $$
DECLARE got numeric[];
BEGIN
 SELECT array_agg(value::numeric ORDER BY day) INTO got FROM metric_daily
 WHERE identifier='HKQuantityTypeIdentifierRecordingQualityFixture'
 AND user_id='f0000000-0000-4000-8000-000000000023';
 IF got IS DISTINCT FROM ARRAY[23,100,25]::numeric[] THEN
   RAISE EXCEPTION 'daily calendar boundaries: got %, expected [23,100,25]', got;
 END IF;
 IF (SELECT count(*) FROM metric_daily WHERE identifier='HKQuantityTypeIdentifierRecordingQualityFixture'
     AND user_id='f0000000-0000-4000-8000-000000000024') <> 0 THEN
   RAISE EXCEPTION 'daily view crossed user boundary';
 END IF;
 IF (SELECT count(*) FROM aggregate_samples a JOIN aggregate_series s USING(series_id)
     JOIN sample_types t USING(type_id) WHERE t.identifier='HKQuantityTypeIdentifierRecordingQualityFixture') <> 6 THEN
   RAISE EXCEPTION 'read fix modified source aggregates';
 END IF;
END $$;
ROLLBACK;
