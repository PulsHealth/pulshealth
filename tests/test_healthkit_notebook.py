"""Executes notebooks/healthkit_database_exploration.ipynb end to end.

The notebook analyzes one user's synced data — coverage, activity trends,
resting heart rate and HRV, sleep, workouts, a few correlations. Every
analysis cell must run on a sparse database (it prints a note and skips
the chart when a type has nothing).

Runs in CI: the `db-integration` job in .github/workflows/ci.yml installs
notebooks/requirements.txt and runs this file after the Go integration
suites. The main test needs Docker and `psql` on the host — it starts its own
throwaway TimescaleDB (the image pinned in server/docker-compose.yml) on a
random loopback port, applies the schema with server/db/migrate.sh, seeds two
weeks of daily aggregates, rings, sleep and workouts so every section takes
its populated branch, writes a temporary `.env` at the repository root and
executes every cell with nbclient. Locally:

    pip install -r notebooks/requirements.txt
    python -m pytest tests/test_healthkit_notebook.py -rs

Without Docker that test skips. The second test runs the notebook against
whatever a real `.env` at the repository root points at and skips when there
is none (CI), so it is the one to run by hand after changing the notebook's
connection code.
"""

import os
import re
import subprocess
import time
from pathlib import Path

import nbformat
import pytest
from nbclient import NotebookClient


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK = ROOT / "notebooks" / "healthkit_database_exploration.ipynb"
DB_PASSWORD = "puls_notebook_test"
# The exact PostgreSQL + TimescaleDB image the compose stack pins (x-db-image in
# server/docker-compose.yml), so the throwaway database matches a real install.
DB_IMAGE = re.search(
    r"timescale/timescaledb-ha:[\w.\-]+",
    (ROOT / "server" / "docker-compose.yml").read_text(),
).group(0)


def run(cmd, *, env=None, check=True):
    return subprocess.run(
        cmd,
        cwd=ROOT,
        env=env,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def wait_for_postgres(database_url):
    env = {**os.environ, "PGCONNECT_TIMEOUT": "2"}
    for _ in range(60):
        result = run(["psql", database_url, "-c", "select 1"], env=env, check=False)
        if result.returncode == 0:
            return
        time.sleep(1)
    raise AssertionError("temporary Postgres did not become ready")


def apply_schema(port):
    # The same path a fresh `docker compose up -d` takes: server/db/migrate.sh
    # applies every file in server/db/migrations/ in order (recording them in
    # schema_migrations) and runs the role and time-zone scripts, here against
    # the throwaway container over TCP with the superuser password.
    env = {
        **os.environ,
        "PGHOST": "127.0.0.1",
        "PGPORT": port,
        "PGPASSWORD": DB_PASSWORD,
        "POSTGRES_USER": "postgres",
        "POSTGRES_DB": "postgres",
        "MIGRATIONS_DIR": str(ROOT / "server" / "db" / "migrations"),
        "GRAFANA_DB_PASSWORD": DB_PASSWORD,
        "API_DB_PASSWORD": DB_PASSWORD,
        "INGEST_DB_PASSWORD": DB_PASSWORD,
        "PULS_TIME_ZONE": "UTC",
    }
    run(["bash", str(ROOT / "server" / "db" / "migrate.sh")], env=env)


def seed_healthkit_rows(database_url):
    seed_sql = """
    INSERT INTO sample_types (identifier, kind, unit) VALUES
      ('HKQuantityTypeIdentifierBodyMass', 'quantity', 'kg'),
      ('HKQuantityTypeIdentifierHeartRate', 'quantity', 'count/min'),
      ('HKQuantityTypeIdentifierStepCount', 'quantity', 'count'),
      ('HKQuantityTypeIdentifierActiveEnergyBurned', 'quantity', 'kcal'),
      ('HKQuantityTypeIdentifierRestingHeartRate', 'quantity', 'count/min'),
      ('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'quantity', 'ms'),
      ('HKCategoryTypeIdentifierSleepAnalysis', 'category', NULL)
    ON CONFLICT (identifier) DO NOTHING;

    INSERT INTO sources (name, bundle_id, version) VALUES
      ('Apple Watch', 'com.apple.health', '26.0'),
      ('Withings', 'com.withings.wiScale', '7.0')
    ON CONFLICT (name, bundle_id, version) DO NOTHING;

    INSERT INTO quantity_samples
      (uuid, type_id, start_ts, end_ts, value, source_id, user_id)
    VALUES
      ('00000000-0000-4000-8000-000000000101',
       (SELECT type_id FROM sample_types WHERE identifier = 'HKQuantityTypeIdentifierBodyMass'),
       '2026-06-15 08:00:00-07', '2026-06-15 08:00:00-07', 82.1,
       (SELECT source_id FROM sources WHERE name = 'Withings' LIMIT 1),
       '5ea4d000-0000-4000-8000-000000000001'),
      ('00000000-0000-4000-8000-000000000102',
       (SELECT type_id FROM sample_types WHERE identifier = 'HKQuantityTypeIdentifierHeartRate'),
       '2026-06-15 08:05:00-07', '2026-06-15 08:05:05-07', 64,
       (SELECT source_id FROM sources WHERE name = 'Apple Watch' LIMIT 1),
       '5ea4d000-0000-4000-8000-000000000001'),
      ('00000000-0000-4000-8000-000000000103',
       (SELECT type_id FROM sample_types WHERE identifier = 'HKQuantityTypeIdentifierStepCount'),
       '2026-06-15 09:00:00-07', '2026-06-15 10:00:00-07', 1200,
       (SELECT source_id FROM sources WHERE name = 'Apple Watch' LIMIT 1),
       '5ea4d000-0000-4000-8000-000000000001')
    ON CONFLICT DO NOTHING;

    INSERT INTO category_samples
      (uuid, type_id, start_ts, end_ts, value, source_id, user_id)
    VALUES
      ('00000000-0000-4000-8000-000000000201',
       (SELECT type_id FROM sample_types WHERE identifier = 'HKCategoryTypeIdentifierSleepAnalysis'),
       '2026-06-15 23:00:00-07', '2026-06-16 06:30:00-07', 3,
       (SELECT source_id FROM sources WHERE name = 'Apple Watch' LIMIT 1),
       '5ea4d000-0000-4000-8000-000000000001')
    ON CONFLICT DO NOTHING;

    -- Two weeks of the daily surfaces the notebook analyzes, on fixed dates
    -- (the notebook's window ends on the last day with data, not today).
    -- One canonical daily series per type is what metric_daily's tier 1
    -- reads: sum for cumulative types, average for discrete ones.
    INSERT INTO aggregate_series
      (type_id, agg_func, interval_value, interval_unit, device_filter, unit)
    SELECT st.type_id, f.agg_func, 1, 'day', 'all', st.unit
    FROM sample_types st
    JOIN (VALUES
      ('HKQuantityTypeIdentifierStepCount', 'sum'),
      ('HKQuantityTypeIdentifierActiveEnergyBurned', 'sum'),
      ('HKQuantityTypeIdentifierRestingHeartRate', 'average'),
      ('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'average')
    ) AS f(identifier, agg_func) ON f.identifier = st.identifier
    ON CONFLICT DO NOTHING;

    INSERT INTO aggregate_samples (series_id, bucket_start, bucket_end, value, user_id)
    SELECT s.series_id, d, d + interval '1 day',
      CASE st.identifier
        WHEN 'HKQuantityTypeIdentifierStepCount' THEN 6000 + (extract(day FROM d)::int * 537) % 5000
        WHEN 'HKQuantityTypeIdentifierActiveEnergyBurned' THEN 350 + (extract(day FROM d)::int * 41) % 300
        WHEN 'HKQuantityTypeIdentifierRestingHeartRate' THEN 55 + (extract(day FROM d)::int * 7) % 9
        WHEN 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' THEN 35 + (extract(day FROM d)::int * 11) % 25
      END,
      '5ea4d000-0000-4000-8000-000000000001'
    FROM aggregate_series s
    JOIN sample_types st USING (type_id)
    CROSS JOIN generate_series('2026-06-02 00:00:00+00'::timestamptz,
                               '2026-06-15 00:00:00+00'::timestamptz,
                               interval '1 day') AS d
    WHERE s.interval_unit = 'day' AND s.device_filter = 'all'
    ON CONFLICT DO NOTHING;

    INSERT INTO activity_summaries
      (date, user_id, move_kcal, move_goal_kcal, exercise_min, exercise_goal_min,
       stand_hours, stand_goal_hours)
    SELECT d::date, '5ea4d000-0000-4000-8000-000000000001',
      350 + (extract(day FROM d)::int * 41) % 300, 500,
      20 + (extract(day FROM d)::int * 13) % 40, 30,
      8 + (extract(day FROM d)::int * 3) % 5, 12
    FROM generate_series('2026-06-02'::date, '2026-06-15'::date, interval '1 day') AS d
    ON CONFLICT DO NOTHING;

    -- One core-sleep sample per night, ending on the wake-up morning.
    INSERT INTO category_samples
      (uuid, type_id, start_ts, end_ts, value, source_id, user_id)
    SELECT gen_random_uuid(),
      (SELECT type_id FROM sample_types WHERE identifier = 'HKCategoryTypeIdentifierSleepAnalysis'),
      d + interval '23 hours' + ((extract(day FROM d)::int * 7) % 40) * interval '1 minute',
      d + interval '1 day 6 hours 30 minutes' + ((extract(day FROM d)::int * 11) % 50) * interval '1 minute',
      3,
      (SELECT source_id FROM sources WHERE name = 'Apple Watch' LIMIT 1),
      '5ea4d000-0000-4000-8000-000000000001'
    FROM generate_series('2026-06-01 00:00:00+00'::timestamptz,
                         '2026-06-14 00:00:00+00'::timestamptz,
                         interval '1 day') AS d
    ON CONFLICT DO NOTHING;

    INSERT INTO workouts
      (uuid, activity_type, start_ts, end_ts, duration_s, energy_kcal, distance_m,
       source_id, user_id)
    VALUES
      ('00000000-0000-4000-8000-000000000401', 'running',
       '2026-06-03 07:00:00+00', '2026-06-03 07:35:00+00', 2100, 320, 5200,
       (SELECT source_id FROM sources WHERE name = 'Apple Watch' LIMIT 1),
       '5ea4d000-0000-4000-8000-000000000001'),
      ('00000000-0000-4000-8000-000000000402', 'cycling',
       '2026-06-07 09:00:00+00', '2026-06-07 10:00:00+00', 3600, 450, 18000,
       (SELECT source_id FROM sources WHERE name = 'Apple Watch' LIMIT 1),
       '5ea4d000-0000-4000-8000-000000000001'),
      ('00000000-0000-4000-8000-000000000403', 'running',
       '2026-06-12 07:00:00+00', '2026-06-12 07:30:00+00', 1800, 280, 4500,
       (SELECT source_id FROM sources WHERE name = 'Apple Watch' LIMIT 1),
       '5ea4d000-0000-4000-8000-000000000001')
    ON CONFLICT DO NOTHING;

    INSERT INTO batches
      (batch_id, device_id, user_id, type_identifier, reason, sample_count,
       deletion_count, bytes, exported_at, received_at, trigger, parse_ms,
       insert_ms, aggregate_count, activity_summary_count)
    VALUES
      ('00000000-0000-4000-8000-000000000301', 'pytest-device',
       '5ea4d000-0000-4000-8000-000000000001',
       'HKQuantityTypeIdentifierBodyMass', 'manual', 1, 0, 1024,
       '2026-06-15 08:00:05-07', '2026-06-15 08:00:06-07',
       'foreground', 2, 4, 0, 0)
    ON CONFLICT DO NOTHING;
    """
    run(["psql", database_url, "-v", "ON_ERROR_STOP=1", "-c", seed_sql])


def test_healthkit_notebook_executes_against_seeded_database(tmp_path):
    assert NOTEBOOK.exists(), f"missing notebook: {NOTEBOOK}"
    docker_check = run(["docker", "info"], check=False)
    if docker_check.returncode != 0:
        pytest.skip("Docker daemon is not available")

    container_name = f"puls-notebook-test-{int(time.time() * 1000)}"
    container_id = None
    env_path = ROOT / ".env"
    original_env = env_path.read_text() if env_path.exists() else None
    try:
        container = run(
            [
                "docker",
                "run",
                "-d",
                "--rm",
                "--name",
                container_name,
                "-e",
                f"POSTGRES_PASSWORD={DB_PASSWORD}",
                "-p",
                "127.0.0.1::5432",
                DB_IMAGE,
            ]
        )
        container_id = container.stdout.strip()

        port = run(
            ["docker", "port", container_id, "5432/tcp"],
        ).stdout.strip().rsplit(":", 1)[1]
        database_url = f"postgresql://postgres:{DB_PASSWORD}@127.0.0.1:{port}/postgres"

        wait_for_postgres(database_url)
        apply_schema(port)
        seed_healthkit_rows(database_url)
        env_path.write_text(
            "\n".join(
                [
                    f"PULS_DB_PASSWORD={DB_PASSWORD}",
                    f"PULS_DB_PORT={port}",
                    "PULS_DB_HOST=127.0.0.1",
                    "PULS_DB_NAME=postgres",
                    "PULS_DB_USER=postgres",
                    "",
                ]
            )
        )

        notebook = nbformat.read(NOTEBOOK, as_version=4)
        client = NotebookClient(notebook, timeout=120, kernel_name="python3")
        client.execute(
            cwd=str(ROOT),
            env={
                **os.environ,
                "DATABASE_URL": "",
                "PULS_DB_PASSWORD": "",
                "POSTGRES_PASSWORD": "",
                # No PULS_ANALYSIS_TZ: the notebook must pick the zone up
                # from the database's puls_time_zone() (UTC, from apply_schema).
                "PULS_LOOKBACK_DAYS": "30",
            },
        )

        executed = tmp_path / "executed-healthkit-notebook.ipynb"
        nbformat.write(notebook, executed)

        code_cells = [cell for cell in notebook.cells if cell.cell_type == "code"]
        assert code_cells
        assert any(cell.get("outputs") for cell in code_cells)
    finally:
        if original_env is None:
            env_path.unlink(missing_ok=True)
        else:
            env_path.write_text(original_env)
        if container_id:
            run(["docker", "rm", "-f", container_id], check=False)


def test_healthkit_notebook_executes_from_notebooks_directory_with_root_env():
    env_path = ROOT / ".env"
    if not env_path.exists():
        pytest.skip("local .env is not available")

    notebook = nbformat.read(NOTEBOOK, as_version=4)
    client = NotebookClient(notebook, timeout=180, kernel_name="python3")
    env = os.environ.copy()
    for key in (
        "DATABASE_URL",
        "PULS_DB_PASSWORD",
        "POSTGRES_PASSWORD",
        "PULS_DB_HOST",
        "PULS_DB_PORT",
        "PULS_DB_NAME",
        "PULS_DB_USER",
        "PULS_DB_SSH_HOST",
        "PULS_DB_SSH_REMOTE_HOST",
        "PULS_DB_SSH_REMOTE_PORT",
    ):
        env.pop(key, None)
    env.update(
        {
            "PULS_ANALYSIS_TZ": "America/Los_Angeles",
            "PULS_LOOKBACK_DAYS": "7",
        }
    )

    client.execute(cwd=str(ROOT / "notebooks"), env=env)

    code_cells = [cell for cell in notebook.cells if cell.cell_type == "code"]
    assert any(cell.get("outputs") for cell in code_cells)


def test_healthkit_notebook_does_not_commit_database_secrets():
    notebook = nbformat.read(NOTEBOOK, as_version=4)
    source = "\n".join(
        "".join(cell.get("source", []))
        for cell in notebook.cells
        if cell.cell_type == "code"
    )

    assert "HARDCODED_DB_PASSWORD" not in source
    assert not re.search(r"(?i)(password|token).*['\"][a-f0-9]{32,}['\"]", source)
    assert "load_env_file" in source
    assert "PULS_DB_PASSWORD" in source
    assert "PULS_DB_SSH_HOST" in source
