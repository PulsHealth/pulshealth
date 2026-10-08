-- Daily steps by provenance
SELECT day::timestamp AT TIME ZONE puls_time_zone() AS time,
       value, source AS metric
FROM metric_daily
WHERE identifier = 'HKQuantityTypeIdentifierStepCount'
  AND user_id = ${user:sqlstring}::uuid
  AND day >= ($__timeFrom()::timestamptz AT TIME ZONE puls_time_zone())::date
  AND day <= ($__timeTo()::timestamptz AT TIME ZONE puls_time_zone())::date
ORDER BY time;

-- Hours since latest received batch (90-day lookback)
SELECT EXTRACT(EPOCH FROM (now() - max(received_at))) / 3600 AS hours
FROM batches
WHERE user_id = ${user:sqlstring}::uuid
  AND received_at >= now() - interval '90 days';

-- Recorded workout duration
SELECT start_ts AS time, duration_s / 60.0 AS minutes
FROM workouts
WHERE user_id = ${user:sqlstring}::uuid
  AND $__timeFilter(start_ts)
ORDER BY time;

-- Daily step provenance
SELECT day::text AS day, value AS steps, source
FROM metric_daily
WHERE identifier = 'HKQuantityTypeIdentifierStepCount'
  AND user_id = ${user:sqlstring}::uuid
  AND day >= ($__timeFrom()::timestamptz AT TIME ZONE puls_time_zone())::date
  AND day <= ($__timeTo()::timestamptz AT TIME ZONE puls_time_zone())::date
ORDER BY day DESC;
