-- Read-only provenance audit. Supply user_id, from_ts and to_ts privately.
-- Compare source writers before attributing a stream to hardware.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '90s';
SET LOCAL jit = off;
SELECT w.uuid AS workout_uuid,
       s.name AS source_name,
       s.bundle_id,
       count(*) AS overlapping_quantity_objects
FROM workouts w
JOIN quantity_samples q
  ON q.user_id = w.user_id
 AND q.start_ts <= w.end_ts AND q.end_ts >= w.start_ts
JOIN sample_types t ON t.type_id = q.type_id
JOIN sources s ON s.source_id = q.source_id
WHERE w.user_id = :'user_id'::uuid
  AND w.start_ts >= :'from_ts'::timestamptz
  AND w.start_ts < :'to_ts'::timestamptz
  AND q.start_ts >= :'from_ts'::timestamptz - interval '1 day'
  AND q.start_ts < :'to_ts'::timestamptz
  AND t.identifier = 'HKQuantityTypeIdentifierHeartRate'
GROUP BY w.uuid, s.name, s.bundle_id
ORDER BY w.uuid, count(*) DESC;
ROLLBACK;
