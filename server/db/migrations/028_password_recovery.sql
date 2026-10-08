-- One-use recovery links. Only digests are stored; account deletion cascades.
CREATE TABLE IF NOT EXISTS auth.password_resets (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  account_id uuid NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_changed_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS password_resets_account ON auth.password_resets(account_id);
CREATE INDEX IF NOT EXISTS password_resets_expiry ON auth.password_resets(expires_at);
-- Hashed IP/email keys; short-lived counters survive restarts and replicas.
CREATE TABLE IF NOT EXISTS auth.password_reset_limits (
  key bytea PRIMARY KEY,
  started_at timestamptz NOT NULL,
  attempts integer NOT NULL
);
CREATE OR REPLACE PROCEDURE auth.prune_password_resets(job_id integer, config jsonb)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  DELETE FROM auth.password_resets WHERE expires_at <= now();
  DELETE FROM auth.password_reset_limits WHERE started_at < now() - interval '1 hour';
END
$$;
REVOKE ALL ON PROCEDURE auth.prune_password_resets(integer, jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.jobs WHERE proc_schema = 'auth' AND proc_name = 'prune_password_resets') THEN
    PERFORM add_job('auth.prune_password_resets', INTERVAL '1 hour', initial_start => now() + INTERVAL '9 minutes');
  END IF;
END $$;
