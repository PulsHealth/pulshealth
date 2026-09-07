#!/bin/bash
# Creates/updates the scoped database roles with passwords taken from
# environment variables (see docker-compose.yml / .env):
#
#   grafana     read-only; Grafana datasource + web viewer   GRAFANA_DB_PASSWORD (required)
#   api_reader  read-only; product API, exact SELECT set     API_DB_PASSWORD     (required)
#   ingest      DML-only writer for the ingest server        INGEST_DB_PASSWORD  (optional)
#
# INGEST_DB_PASSWORD is optional on purpose so an unchanged .env keeps
# working: the Compose `db` service carries only the two required passwords,
# so on first startup this script runs from /docker-entrypoint-initdb.d
# without INGEST_DB_PASSWORD, skips the ingest role, and the ingest service
# keeps its Compose default of connecting as the superuser. Opt in on a
# running database by re-running the script with the variable set (it is safe
# to rerun: it creates missing roles, rotates passwords and re-applies the
# exact grants):
#
#   docker compose exec -T -e GRAFANA_DB_PASSWORD=... -e API_DB_PASSWORD=... \
#     -e INGEST_DB_PASSWORD=... db bash /docker-entrypoint-initdb.d/099_read_roles.sh
#
# then set INGEST_DB_USER=ingest / INGEST_DB_PASSWORD in .env and recreate the
# ingest service (see server/README.md).
set -euo pipefail

: "${GRAFANA_DB_PASSWORD:?GRAFANA_DB_PASSWORD must be set}"
: "${API_DB_PASSWORD:?API_DB_PASSWORD must be set}"
INGEST_DB_PASSWORD="${INGEST_DB_PASSWORD:-}"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"

psql -v ON_ERROR_STOP=1 \
     -v grafana_password="${GRAFANA_DB_PASSWORD}" \
     -v api_password="${API_DB_PASSWORD}" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana') THEN
    CREATE ROLE grafana LOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_reader') THEN
    CREATE ROLE api_reader LOGIN;
  END IF;
END
$$;

ALTER ROLE grafana LOGIN PASSWORD :'grafana_password';

-- Refuse to automate through unexpected ownership: DROP OWNED would delete
-- objects owned by this role. With ownership proven absent, it is the safest
-- way to clear every direct grant, including privileges added in new schemas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'api_reader')
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'api_reader owns database objects; refusing automatic reconciliation';
  END IF;
END
$$;

DO $$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT parent.rolname
    FROM pg_auth_members m
    JOIN pg_roles parent ON parent.oid = m.roleid
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'api_reader')
  LOOP
    EXECUTE format('REVOKE %I FROM api_reader', membership.rolname);
  END LOOP;

  FOR membership IN
    SELECT child.rolname
    FROM pg_auth_members m
    JOIN pg_roles child ON child.oid = m.member
    WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = 'api_reader')
  LOOP
    EXECUTE format('REVOKE api_reader FROM %I', membership.rolname);
  END LOOP;
END
$$;

DROP OWNED BY api_reader;
ALTER ROLE api_reader
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL 'infinity'
  PASSWORD :'api_password';
ALTER ROLE api_reader RESET ALL;
ALTER ROLE api_reader IN DATABASE :"DBNAME" RESET ALL;

GRANT CONNECT ON DATABASE :"DBNAME" TO grafana;
GRANT CONNECT ON DATABASE :"DBNAME" TO api_reader;
GRANT USAGE ON SCHEMA public TO grafana;
GRANT USAGE ON SCHEMA public TO api_reader;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana;

-- pg_sequences.last_value silently reads NULL for sequences the role cannot
-- select, so the "Lookup sequence near exhaustion" alert would evaluate to 0
-- and never fire — the exact blind spot behind the 2026-08-13 outage. SELECT
-- on a sequence exposes only its current value; it grants no ability to
-- advance it (that needs UPDATE/USAGE).
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO grafana;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO grafana;

-- Continuous aggregates live in materialized hypertables under the
-- _timescaledb_internal schema; Grafana queries the user-facing view, which
-- needs read access to the backing objects.
GRANT USAGE ON SCHEMA _timescaledb_internal TO grafana;
GRANT SELECT ON ALL TABLES IN SCHEMA _timescaledb_internal TO grafana;
ALTER DEFAULT PRIVILEGES IN SCHEMA _timescaledb_internal GRANT SELECT ON TABLES TO grafana;

-- Keep product API credentials scoped to the exact current query surface.
GRANT SELECT ON TABLE
  users,
  sample_types,
  quantity_samples,
  category_samples,
  workouts,
  heartbeat_series,
  ecg_samples,
  state_of_mind,
  medication_dose_events,
  activity_summaries,
  aggregate_series,
  aggregate_samples,
  metric_daily,
  workout_route_points,
  workout_series_points
TO api_reader;

-- Prove the direct ACL and role configuration are exact before committing.
-- PUBLIC grants from extensions may still be effective; this assertion makes
-- sure api_reader itself never receives extra privileges.
DO $$
DECLARE
  api_oid oid := (SELECT oid FROM pg_roles WHERE rolname = 'api_reader');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = api_oid
      AND rolcanlogin
      AND NOT rolsuper
      AND NOT rolinherit
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolreplication
      AND NOT rolbypassrls
      AND rolconnlimit = -1
      AND rolconfig IS NULL
  ) THEN
    RAISE EXCEPTION 'api_reader role attributes are not exact';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members WHERE roleid = api_oid OR member = api_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = api_oid
      AND deptype = 'o'
  ) OR EXISTS (
    SELECT 1 FROM pg_db_role_setting WHERE setrole = api_oid
  ) THEN
    RAISE EXCEPTION 'api_reader has memberships, ownership, or database settings';
  END IF;

  IF EXISTS (
    WITH expected_public(nspname, relname, privilege_type, is_grantable) AS (VALUES
      ('public', 'users', 'SELECT', false),
      ('public', 'sample_types', 'SELECT', false),
      ('public', 'quantity_samples', 'SELECT', false),
      ('public', 'category_samples', 'SELECT', false),
      ('public', 'workouts', 'SELECT', false),
      ('public', 'heartbeat_series', 'SELECT', false),
      ('public', 'ecg_samples', 'SELECT', false),
      ('public', 'state_of_mind', 'SELECT', false),
      ('public', 'medication_dose_events', 'SELECT', false),
      ('public', 'activity_summaries', 'SELECT', false),
      ('public', 'aggregate_series', 'SELECT', false),
      ('public', 'aggregate_samples', 'SELECT', false),
      ('public', 'metric_daily', 'SELECT', false),
      ('public', 'workout_route_points', 'SELECT', false),
      ('public', 'workout_series_points', 'SELECT', false)
    ), allowed_ht AS (
      SELECT id, compressed_hypertable_id
      FROM _timescaledb_catalog.hypertable
      WHERE schema_name = 'public'
        AND table_name IN (
          'quantity_samples', 'workout_route_points', 'workout_series_points'
        )
    ), allowed_ht_ids(id) AS (
      SELECT id FROM allowed_ht
      UNION
      SELECT compressed_hypertable_id FROM allowed_ht
      WHERE compressed_hypertable_id IS NOT NULL
    ), managed_relations(nspname, relname, privilege_type, is_grantable) AS (
      SELECT h.schema_name::text, h.table_name::text, 'SELECT', false
      FROM _timescaledb_catalog.hypertable h
      WHERE h.id IN (
        SELECT compressed_hypertable_id FROM allowed_ht
        WHERE compressed_hypertable_id IS NOT NULL
      )
      UNION
      SELECT c.schema_name::text, c.table_name::text, 'SELECT', false
      FROM _timescaledb_catalog.chunk c
      WHERE c.hypertable_id IN (SELECT id FROM allowed_ht_ids)
    ), expected AS (
      SELECT * FROM expected_public
      UNION
      SELECT * FROM managed_relations
    ), actual AS (
      SELECT n.nspname, c.relname, acl.privilege_type, acl.is_grantable
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) acl
      WHERE acl.grantee = api_oid
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'api_reader relation ACL set is not exact';
  END IF;

  IF EXISTS (
    WITH expected(nspname, privilege_type, is_grantable) AS (
      VALUES ('public', 'USAGE', false)
    ), actual AS (
      SELECT n.nspname, acl.privilege_type, acl.is_grantable
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(n.nspacl) acl
      WHERE acl.grantee = api_oid
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'api_reader schema ACL set is not exact';
  END IF;

  IF EXISTS (
    WITH expected(datname, privilege_type, is_grantable) AS (
      VALUES (current_database(), 'CONNECT', false)
    ), actual AS (
      SELECT d.datname, acl.privilege_type, acl.is_grantable
      FROM pg_database d
      CROSS JOIN LATERAL aclexplode(d.datacl) acl
      WHERE acl.grantee = api_oid
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'api_reader database ACL set is not exact';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE acl.grantee = api_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) acl
    WHERE acl.grantee = api_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_type t
    CROSS JOIN LATERAL aclexplode(t.typacl) acl
    WHERE acl.grantee = api_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE acl.grantee = api_oid
  ) THEN
    RAISE EXCEPTION 'api_reader has unexpected column, function, type, or default ACLs';
  END IF;
END
$$;

COMMIT;
EOSQL

# ---------------------------------------------------------------------------
# ingest: the scoped writer the ingest server connects as once opted in.
# ---------------------------------------------------------------------------
if [[ -z "$INGEST_DB_PASSWORD" ]]; then
  echo "099_read_roles: INGEST_DB_PASSWORD is not set; skipping the ingest role" \
       "(the ingest service keeps connecting as ${POSTGRES_USER})." \
       "Re-run this script with -e INGEST_DB_PASSWORD=... to opt in."
  exit 0
fi

psql -v ON_ERROR_STOP=1 \
     -v ingest_password="${INGEST_DB_PASSWORD}" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest') THEN
    CREATE ROLE ingest LOGIN;
  END IF;
END
$$;

-- Same reconciliation as api_reader: refuse to continue if the role owns
-- anything (DROP OWNED would delete it), strip memberships, then DROP OWNED to
-- clear every direct grant and default privilege before re-applying the exact
-- set below. DROP OWNED also removes the role from every TimescaleDB chunk ACL
-- the earlier grants propagated to.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'ingest')
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'ingest owns database objects; refusing automatic reconciliation';
  END IF;
END
$$;

DO $$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT parent.rolname
    FROM pg_auth_members m
    JOIN pg_roles parent ON parent.oid = m.roleid
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'ingest')
  LOOP
    EXECUTE format('REVOKE %I FROM ingest', membership.rolname);
  END LOOP;

  FOR membership IN
    SELECT child.rolname
    FROM pg_auth_members m
    JOIN pg_roles child ON child.oid = m.member
    WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = 'ingest')
  LOOP
    EXECUTE format('REVOKE ingest FROM %I', membership.rolname);
  END LOOP;
END
$$;

DROP OWNED BY ingest;
ALTER ROLE ingest
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL 'infinity'
  PASSWORD :'ingest_password';
ALTER ROLE ingest RESET ALL;
ALTER ROLE ingest IN DATABASE :"DBNAME" RESET ALL;

-- Exactly the DML surface of server/ingest/store.go: row reads and writes on
-- the tables in public, including the ones future init files add. No CREATE
-- on the schema and no TRUNCATE/REFERENCES/TRIGGER, so an ingest bug or a
-- leaked token cannot alter the schema, drop data wholesale, change roles, or
-- reach superuser-only paths such as COPY TO PROGRAM.
GRANT CONNECT ON DATABASE :"DBNAME" TO ingest;
GRANT USAGE ON SCHEMA public TO ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ingest;

-- The lookup tables' ids are identity columns, whose nextval runs without a
-- privilege check, so inserts need nothing here. USAGE keeps a future
-- serial/DEFAULT nextval column working; SELECT makes pg_sequences.last_value
-- readable (TestIntegration_LookupSequencesDoNotBurnOnRepeat watches it as
-- this role). No UPDATE: nothing calls setval.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ingest;

-- InsertBatch opens every transaction with this SET LOCAL. Prove the role may
-- set it now, at opt-in, instead of finding out as 500s on the first batch if
-- a TimescaleDB upgrade ever turns the GUC superuser-only.
SET ROLE ingest;
SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;
RESET ROLE;

-- Prove the role configuration and ACL set are exact before committing. Unlike
-- api_reader, ingest legitimately holds default ACLs (tables and sequences
-- created later in public) and DML on every relation in public plus the chunks
-- and internal hypertables TimescaleDB derives from them; the checks below pin
-- those sets rather than forbid them.
DO $$
DECLARE
  ingest_oid oid := (SELECT oid FROM pg_roles WHERE rolname = 'ingest');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = ingest_oid
      AND rolcanlogin
      AND NOT rolsuper
      AND NOT rolinherit
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolreplication
      AND NOT rolbypassrls
      AND rolconnlimit = -1
      AND rolconfig IS NULL
  ) THEN
    RAISE EXCEPTION 'ingest role attributes are not exact';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members WHERE roleid = ingest_oid OR member = ingest_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = ingest_oid
      AND deptype = 'o'
  ) OR EXISTS (
    SELECT 1 FROM pg_db_role_setting WHERE setrole = ingest_oid
  ) THEN
    RAISE EXCEPTION 'ingest has memberships, ownership, or database settings';
  END IF;

  IF EXISTS (
    WITH expected(nspname, privilege_type, is_grantable) AS (
      VALUES ('public', 'USAGE', false)
    ), actual AS (
      SELECT n.nspname::text, acl.privilege_type, acl.is_grantable
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(n.nspacl) acl
      WHERE acl.grantee = ingest_oid
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'ingest schema ACL set is not exact';
  END IF;

  IF EXISTS (
    WITH expected(datname, privilege_type, is_grantable) AS (
      VALUES (current_database(), 'CONNECT', false)
    ), actual AS (
      SELECT d.datname::text, acl.privilege_type, acl.is_grantable
      FROM pg_database d
      CROSS JOIN LATERAL aclexplode(d.datacl) acl
      WHERE acl.grantee = ingest_oid
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'ingest database ACL set is not exact';
  END IF;

  -- Every relation grant must be a non-grantable DML privilege on a relation in
  -- public, or on a TimescaleDB-managed relation in _timescaledb_internal that
  -- the grant hook derived from one (chunks, compressed/materialized
  -- hypertables, continuous-aggregate helper views); or USAGE/SELECT on a
  -- sequence in public. Anything else (TRUNCATE, REFERENCES, TRIGGER,
  -- MAINTAIN, WITH GRANT OPTION, other schemas) fails the opt-in.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl
    WHERE acl.grantee = ingest_oid
      AND NOT (
        NOT acl.is_grantable
        AND (
          (n.nspname = 'public'
             AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
             AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
          OR (n.nspname = 'public'
             AND c.relkind = 'S'
             AND acl.privilege_type IN ('USAGE', 'SELECT'))
          OR (n.nspname = '_timescaledb_internal'
             AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
             AND (
               EXISTS (SELECT 1 FROM _timescaledb_catalog.chunk ch
                       WHERE ch.schema_name = n.nspname AND ch.table_name = c.relname)
               OR EXISTS (SELECT 1 FROM _timescaledb_catalog.hypertable h
                          WHERE h.schema_name = n.nspname AND h.table_name = c.relname)
               OR EXISTS (SELECT 1 FROM _timescaledb_catalog.continuous_agg ca
                          WHERE (ca.partial_view_schema = n.nspname AND ca.partial_view_name = c.relname)
                             OR (ca.direct_view_schema = n.nspname AND ca.direct_view_name = c.relname))
             ))
        )
      )
  ) THEN
    RAISE EXCEPTION 'ingest relation ACL set is not exact';
  END IF;

  -- Coverage: every table, view and sequence in public carries the full set,
  -- so a new init file's table is writable the moment it is created.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND NOT (
        has_table_privilege(ingest_oid, c.oid, 'SELECT')
        AND has_table_privilege(ingest_oid, c.oid, 'INSERT')
        AND has_table_privilege(ingest_oid, c.oid, 'UPDATE')
        AND has_table_privilege(ingest_oid, c.oid, 'DELETE')
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND NOT (
        has_sequence_privilege(ingest_oid, c.oid, 'USAGE')
        AND has_sequence_privilege(ingest_oid, c.oid, 'SELECT')
      )
  ) THEN
    RAISE EXCEPTION 'ingest is missing a DML or sequence privilege in public';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE acl.grantee = ingest_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) acl
    WHERE acl.grantee = ingest_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_type t
    CROSS JOIN LATERAL aclexplode(t.typacl) acl
    WHERE acl.grantee = ingest_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_parameter_acl p
    CROSS JOIN LATERAL aclexplode(p.paracl) acl
    WHERE acl.grantee = ingest_oid
  ) THEN
    RAISE EXCEPTION 'ingest has unexpected column, function, type, or parameter ACLs';
  END IF;

  -- Default ACLs: exactly the two declared above, granted for objects the
  -- superuser running this script creates in public.
  IF EXISTS (
    WITH expected(defaclrole, nspname, objtype, privilege_type, is_grantable) AS (VALUES
      (current_user::text, 'public', 'r', 'SELECT', false),
      (current_user::text, 'public', 'r', 'INSERT', false),
      (current_user::text, 'public', 'r', 'UPDATE', false),
      (current_user::text, 'public', 'r', 'DELETE', false),
      (current_user::text, 'public', 'S', 'USAGE', false),
      (current_user::text, 'public', 'S', 'SELECT', false)
    ), actual AS (
      SELECT r.rolname::text, n.nspname::text, d.defaclobjtype::text,
             acl.privilege_type, acl.is_grantable
      FROM pg_default_acl d
      JOIN pg_roles r ON r.oid = d.defaclrole
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
      WHERE acl.grantee = ingest_oid
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'ingest default ACL set is not exact';
  END IF;
END
$$;

COMMIT;
EOSQL
