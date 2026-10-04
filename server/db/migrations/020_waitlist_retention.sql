-- The sign-up waitlist (2026-10-04). Sign-ups at /signup are now a waitlist:
-- the PulsHealth database is offered, but the operator lets people in only
-- as capacity allows, so a request nobody has decided yet is a place in the
-- queue, kept until an administrator approves or declines it (or the person
-- asks to be removed). 018_web_accounts_hardening.sql deleted undecided
-- requests after 30 days; this drops that step and keeps the rest:
--  * a declined request is deleted when it is declined (auth.decline_signups,
--    unchanged);
--  * an approved request is deleted 30 days after the decision;
--  * an approved person with no account and no invite in 30 days is removed
--    with their invites;
--  * expired sessions (sliding expiry, or the 90-day cap) are deleted.
-- A flood no longer drains by itself: the viewer bounds it instead (a daily
-- intake and an overall ceiling, web/lib/accounts/signups.ts), and /admin
-- declines in bulk. 018 is applied and so immutable: this replaces the
-- procedure in place, with the same signature, owner and grants, so the
-- hourly TimescaleDB job 016 scheduled keeps pointing at it.
CREATE OR REPLACE PROCEDURE auth.prune_signups(job_id integer, config jsonb)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  u uuid;
BEGIN
  DELETE FROM auth.signup_requests WHERE status <> 'pending' AND decided_at < now() - interval '30 days';
  DELETE FROM auth.sessions WHERE expires_at < now() OR created_at < now() - interval '90 days';
  FOR u IN
    SELECT ss.user_id FROM auth.self_service_users ss
     WHERE ss.approved_at < now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM auth.accounts a WHERE a.user_id = ss.user_id)
       AND NOT EXISTS (SELECT 1 FROM auth.invites i WHERE i.user_id = ss.user_id AND i.created_at > now() - interval '30 days')
  LOOP
    BEGIN
      DELETE FROM auth.invites WHERE user_id = u;
      DELETE FROM public.users WHERE id = u;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'prune_signups: user % still has rows elsewhere; left in place', u;
    END;
  END LOOP;
END
$$;
REVOKE ALL ON PROCEDURE auth.prune_signups(integer, jsonb) FROM PUBLIC;
