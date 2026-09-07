-- Rename + regroup the server-side hourly rollup of quantity_samples.
--
-- Old: quantity_hourly, grouped by (type_id, bucket) only. That both leaked
-- across users (no user_id, so it averaged/summed every person together) and
-- forced readers to collapse overlapping multi-device samples (iPhone + Watch
-- both log steps/energy/distance -> double counting, "numbers too high").
--
-- New: quantity_rollups, grouped by (type_id, source_id, user_id, bucket) so
-- each row is ONE source's rollup for ONE user. Readers pick a single source
-- per bucket (no dedup needed: within a source, cumulative samples don't
-- overlap), or blend sources with a weighted mean for discrete types.
--
-- A continuous aggregate's GROUP BY can't be ALTERed, so this drops and
-- recreates it. The same rebuild is required when adding aggregate columns
-- such as sum_value. Safe to re-run, but it rebuilds quantity_rollups even on
-- fresh volumes where 001 already created it.
--
-- /docker-entrypoint-initdb.d only runs on first startup. Apply to a live DB:
--   docker compose exec db psql -U postgres -d postgres -f \
--     /docker-entrypoint-initdb.d/008_quantity_rollups.sql
-- If metric_daily exists, the DROP ... CASCADE below removes it; apply
-- 009_metric_daily.sql after this file (it re-grants the read roles the
-- cascade discards).
-- The recreated view starts empty (WITH NO DATA); the refresh below fills it
-- immediately rather than waiting up to 30 min for the policy's first run.

DROP MATERIALIZED VIEW IF EXISTS quantity_hourly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS quantity_rollups CASCADE;

CREATE MATERIALIZED VIEW IF NOT EXISTS quantity_rollups
WITH (timescaledb.continuous) AS
SELECT type_id,
       source_id,
       user_id,
       time_bucket('1 hour', start_ts) AS bucket,
       sum(value)  AS sum_value,
       avg(value)  AS avg_value,
       min(value)  AS min_value,
       max(value)  AS max_value,
       count(*)    AS n
FROM quantity_samples
GROUP BY type_id, source_id, user_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('quantity_rollups',
    start_offset      => NULL,
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists     => TRUE);

-- Force an immediate full materialization (no-op on a fresh, empty volume).
-- Must run outside a transaction block; psql -f autocommits each statement.
CALL refresh_continuous_aggregate('quantity_rollups', NULL, NULL);
