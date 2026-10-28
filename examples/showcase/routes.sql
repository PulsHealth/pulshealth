-- Execute with psql -X -A -t using a read-only connection and explicit user/range.
-- Output matches the app's flat workout_routes JSONL fields.
BEGIN READ ONLY;
SELECT json_build_object(
  'workoutUUID', r.workout_uuid,
  't', (extract(epoch FROM r.ts) * 1000)::bigint,
  'lat', r.lat, 'lon', r.lon
)::text
FROM workout_route_points r
JOIN workouts w ON w.uuid = r.workout_uuid AND w.user_id = r.user_id
WHERE w.user_id = :'user_id'::uuid
  AND w.start_ts >= :'start_ts'::timestamptz
  AND w.start_ts < :'end_ts'::timestamptz
  AND r.ts >= :'start_ts'::timestamptz
  AND r.ts < :'end_ts'::timestamptz
ORDER BY r.workout_uuid, r.ts;
COMMIT;
