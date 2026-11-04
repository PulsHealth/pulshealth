-- Experimental, separate database only. Applied by this experiment's migrate service.
CREATE TABLE IF NOT EXISTS programs (
 id uuid PRIMARY KEY, manager_hash text UNIQUE NOT NULL, spec jsonb NOT NULL,
 closed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS invitations (
 hash text PRIMARY KEY, program_id uuid NOT NULL REFERENCES programs,
 expires_at timestamptz NOT NULL, participant_id uuid
);
CREATE TABLE IF NOT EXISTS participants (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES programs,
 token_hash text UNIQUE NOT NULL, consent_version text NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT now(), revoked boolean NOT NULL DEFAULT false,
 sequence bigint NOT NULL DEFAULT 0, stored_bytes bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS objects (
 participant_id uuid NOT NULL REFERENCES participants, id uuid NOT NULL,
 body bytea NOT NULL CHECK(octet_length(body) <= 1048640), digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(participant_id,id)
);
CREATE TABLE IF NOT EXISTS commits (
 participant_id uuid NOT NULL REFERENCES participants, id uuid NOT NULL,
 sequence bigint NOT NULL, objects jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(participant_id,id), UNIQUE(participant_id,sequence)
);
-- The application connects with this role, never the migration administrator.
DO $$ BEGIN CREATE ROLE experiment_app LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO experiment_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON programs,invitations,participants,objects,commits TO experiment_app;
