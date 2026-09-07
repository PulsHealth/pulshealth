-- Rename aggregate_buckets -> aggregate_samples on databases provisioned before
-- 003 was updated to create the table under its new name.
--
-- Idempotent: a fresh volume already has aggregate_samples (003 now creates it
-- directly), so these IF EXISTS renames are no-ops there. /docker-entrypoint-initdb.d
-- only runs on first startup, so apply to a live database manually:
--   docker compose exec db psql -U postgres -d postgres \
--     -f /docker-entrypoint-initdb.d/004_rename_aggregate_buckets.sql

ALTER TABLE IF EXISTS aggregate_buckets RENAME TO aggregate_samples;
ALTER INDEX IF EXISTS aggregate_buckets_series_ts_idx RENAME TO aggregate_samples_series_ts_idx;
