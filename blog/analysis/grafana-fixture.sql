-- Synthetic teaching fixture ONLY. Run in an empty, disposable PostgreSQL DB.
-- These minimal tables exercise the tutorial queries, not the production schema.
CREATE FUNCTION puls_time_zone() RETURNS text LANGUAGE sql AS $$ SELECT 'UTC'::text $$;
CREATE TABLE metric_daily (day date, value double precision, source text, identifier text, user_id uuid);
CREATE TABLE workouts (start_ts timestamptz, duration_s double precision, user_id uuid);
CREATE TABLE batches (received_at timestamptz, user_id uuid);
INSERT INTO metric_daily
SELECT '2026-09-01'::date + n::integer - 1, steps,
       CASE WHEN n IN (4, 9) THEN 'rollup' ELSE 'aggregate' END,
       'HKQuantityTypeIdentifierStepCount', '00000000-0000-0000-0000-000000000000'::uuid
FROM unnest(ARRAY[6420,8150,7340,5800,9100,10200,6800,7400,6200,8300,9600,7100,8800,7900])
     WITH ORDINALITY AS t(steps,n);
INSERT INTO workouts VALUES
('2026-09-02 07:00Z',1800,'00000000-0000-0000-0000-000000000000'),
('2026-09-04 18:00Z',2700,'00000000-0000-0000-0000-000000000000'),
('2026-09-06 09:00Z',3600,'00000000-0000-0000-0000-000000000000'),
('2026-09-09 07:00Z',2100,'00000000-0000-0000-0000-000000000000'),
('2026-09-11 18:00Z',3000,'00000000-0000-0000-0000-000000000000'),
('2026-09-13 09:00Z',4500,'00000000-0000-0000-0000-000000000000');
-- Receipt age is intentionally relative to fixture creation, not the chart dates.
INSERT INTO batches VALUES (now() - interval '2 hours','00000000-0000-0000-0000-000000000000');
-- Sentinels must never appear in the selected user's September screenshot.
INSERT INTO metric_daily VALUES
('2026-09-02',99999,'aggregate','HKQuantityTypeIdentifierStepCount','11111111-1111-4111-8111-111111111111'),
('2026-08-01',99999,'aggregate','HKQuantityTypeIdentifierStepCount','00000000-0000-0000-0000-000000000000');
CREATE ROLE grafana LOGIN;
GRANT USAGE ON SCHEMA public TO grafana;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana;
