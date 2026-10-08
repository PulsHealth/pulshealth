-- psql parameters are required. See README.md. Read-only summary extraction.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '25s';
SET LOCAL TIME ZONE :'time_zone';

SELECT json_build_object(
    'hrv_daily', (
        SELECT json_agg(t)
        FROM (
            SELECT start_ts::date AS day,
                   count(*) AS n,
                   round(avg(value)::numeric, 2) AS mean,
                   round(
                       percentile_cont(.5) WITHIN GROUP (ORDER BY value)::numeric,
                       2
                   ) AS median,
                   round(min(value)::numeric, 2) AS minimum,
                   round(max(value)::numeric, 2) AS maximum
            FROM quantity_samples q
            JOIN sample_types st USING (type_id)
            WHERE user_id = :'owner_id'
              AND start_ts >= :'start_date'
              AND start_ts < :'end_date'
              AND st.identifier = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
            GROUP BY 1
            ORDER BY 1
        ) t
    ),
    'hrv_hour', (
        SELECT json_agg(t)
        FROM (
            SELECT extract(hour FROM start_ts)::int AS hour,
                   count(*) AS n
            FROM quantity_samples q
            JOIN sample_types st USING (type_id)
            WHERE user_id = :'owner_id'
              AND start_ts >= :'start_date'
              AND start_ts < :'end_date'
              AND st.identifier = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
            GROUP BY 1
            ORDER BY 1
        ) t
    ),
    'vo2', (
        SELECT json_agg(t)
        FROM (
            SELECT start_ts::date AS day,
                   count(*) AS n,
                   round(avg(value)::numeric, 2) AS value
            FROM quantity_samples q
            JOIN sample_types st USING (type_id)
            WHERE user_id = :'owner_id'
              AND start_ts >= :'vo2_start_date'
              AND start_ts < :'end_date'
              AND st.identifier = 'HKQuantityTypeIdentifierVO2Max'
            GROUP BY 1
            ORDER BY 1
        ) t
    ),
    'sleep', (
        SELECT json_agg(t)
        FROM (
            SELECT end_ts::date AS day,
                   cl.label AS stage,
                   count(*) AS n,
                   round(
                       sum(extract(epoch FROM end_ts - start_ts) / 3600)::numeric,
                       3
                   ) AS hours
            FROM category_samples c
            JOIN sample_types st USING (type_id)
            LEFT JOIN category_labels cl
              ON cl.type_identifier = st.identifier
             AND cl.value = c.value
            WHERE user_id = :'owner_id'
              AND start_ts >= :'start_date'
              AND start_ts < :'end_date'
              AND st.identifier = 'HKCategoryTypeIdentifierSleepAnalysis'
            GROUP BY 1, 2
            ORDER BY 1, 2
        ) t
    ),
    'steps_sources', (
        SELECT json_agg(t)
        FROM (
            SELECT start_ts::date AS day,
                   q.source_id,
                   count(*) AS n,
                   sum(value) AS steps
            FROM quantity_samples q
            JOIN sample_types st USING (type_id)
            WHERE user_id = :'owner_id'
              AND start_ts >= :'start_date'
              AND start_ts < :'end_date'
              AND st.identifier = 'HKQuantityTypeIdentifierStepCount'
            GROUP BY 1, 2
            ORDER BY 1, 2
        ) t
    ),
    'steps_daily', (
        SELECT json_agg(t)
        FROM (
            SELECT day, value, source
            FROM metric_daily
            WHERE user_id = :'owner_id'
              AND day >= :'start_date'
              AND day < :'end_date'
              AND identifier = 'HKQuantityTypeIdentifierStepCount'
            ORDER BY 1
        ) t
    )
);

COMMIT;
