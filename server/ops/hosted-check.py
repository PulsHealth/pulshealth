#!/usr/bin/env python3
"""Read-only hosted-service checks. Emits no user IDs, health data or credentials.

Run on the Docker host from any directory. Exit 1 means operator attention.
This is not a penetration test or a proof of email delivery/physical disk security.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(os.environ["PULS_CHECK_ROOT"]) if os.environ.get("PULS_CHECK_ROOT") else Path(__file__).resolve().parents[2]
COMPOSE = ["docker", "compose", "-f", str(ROOT / "server/docker-compose.yml")]


def command(args, input_text=None):
    result = subprocess.run(args, input=input_text, text=True, capture_output=True, timeout=45)
    if result.returncode:
        # Commands may contain credentials or private database errors: never echo them.
        raise RuntimeError("command failed; inspect the service privately")
    return result.stdout.strip()


def sql(query):
    return command(COMPOSE + ["exec", "-T", "db", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], query)


def backup_problems(ages, keep_days, strict):
    problems = []
    if keep_days != 7 or not strict:
        problems.append("hosted backup retention must be strict, seven days")
    if not ages or min(ages) > 26 * 3600:
        problems.append("no successful backup within 26 hours")
    if ages and max(ages) > 7 * 86400 + 3660:
        problems.append("backup is past seven-day expiry plus hourly sweep allowance")
    if any(age < -300 for age in ages):
        problems.append("backup timestamps are in the future")
    return problems


def database_problems(facts):
    problems = []
    if facts["overdue"]:
        problems.append("account deletion pending more than 30 minutes")
    if facts["failed"]:
        problems.append("account deletion has failed attempts; investigate")
    if facts["jobs_unhealthy"]:
        problems.append("required deletion/retention job missing, disabled, failed or stale")
    if facts["broad_web_role"]:
        problems.append("web_app can bypass the account data boundary")
    return problems


DB_FACTS = """
SELECT json_build_object(
 'pending', (SELECT count(*) FROM auth.account_deletions WHERE completed_at IS NULL),
 'overdue', (SELECT count(*) FROM auth.account_deletions WHERE completed_at IS NULL AND requested_at < now()-interval '30 minutes'),
 'failed', (SELECT count(*) FROM auth.account_deletions WHERE completed_at IS NULL AND attempts > 0),
 'jobs_unhealthy', (SELECT count(*) FROM (VALUES
   ('process_account_deletions', interval '5 minutes'),
   ('prune_signups', interval '2 hours'), ('prune_oauth', interval '2 hours'),
   ('prune_password_resets', interval '2 hours')) expected(name, max_age)
   LEFT JOIN timescaledb_information.jobs j ON j.proc_schema='auth' AND j.proc_name=expected.name
   LEFT JOIN timescaledb_information.job_stats s USING(job_id)
   WHERE j.job_id IS NULL OR NOT j.scheduled OR s.last_successful_finish IS NULL
      OR s.last_successful_finish < now()-expected.max_age OR s.last_run_status='Failed'),
 'broad_web_role', (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='web_app')
    OR has_table_privilege('web_app','public.quantity_samples','SELECT')
    OR has_table_privilege('web_app','public.users','SELECT')
);
"""


def main():
    checks = []
    problems = []
    def check(name, fn):
        try:
            detail, errors = fn()
            checks.append({"check": name, "ok": not errors, **detail})
            problems.extend(errors)
        except (RuntimeError, subprocess.TimeoutExpired, ValueError, KeyError, OSError, StopIteration):
            checks.append({"check": name, "ok": False})
            problems.append(name + ": could not verify")

    containers = {}
    def services():
        errors = []
        for service in ("db", "web", "ingest", "api", "mcp", "backup"):
            cid = command(COMPOSE + ["ps", "-q", service])
            if not cid:
                errors.append(service + " is not running")
                continue
            data = json.loads(command(["docker", "inspect", cid]))[0]
            containers[service] = data
            if not data["State"]["Running"] or data["State"].get("Health", {}).get("Status", "healthy") != "healthy":
                errors.append(service + " is unhealthy")
            for bindings in (data["NetworkSettings"].get("Ports") or {}).values():
                for binding in bindings or []:
                    if binding["HostIp"] not in ("127.0.0.1", "::1"):
                        errors.append(service + " has a non-loopback published port")
        return {}, errors
    check("services", services)

    def settings():
        errors = []
        for service, role in (("web", "web_app"), ("ingest", "ingest"), ("api", "api_reader")):
            env = dict(item.split("=", 1) for item in containers[service]["Config"]["Env"])
            if urlsplit(env.get("DATABASE_URL", "")).username != role:
                errors.append(service + " is using the wrong database role")
            if service == "web" and env.get("WEB_ACCOUNTS") not in ("true", "1"):
                errors.append("hosted viewer must use accounts mode")
            if service == "ingest" and env.get("PULS_ALLOW_SHARED_TOKEN") not in ("false", "0"):
                errors.append("shared ingest tokens must be disabled")
        return {}, errors
    check("access_controls", settings)

    def database():
        facts = json.loads(sql(DB_FACTS))
        return {"pending": facts["pending"]}, database_problems(facts)
    check("deletion_and_retention_jobs", database)

    def ledger():
        # IDs are compared in memory only; output is counts, never identifiers.
        deleted = set(sql("SELECT user_id FROM auth.deletion_tombstones;").splitlines())
        js = '''const fs = require('fs'); const p = process.env.PULS_DELETION_LEDGER_DIR;
if (!p) throw Error('missing'); fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK);
const names=fs.readdirSync(p).filter(n=>n.endsWith('.json'));
for(const n of names){const r=JSON.parse(fs.readFileSync(p+'/'+n,'utf8'));
if(r.version!==1 || n!==r.user_id+'.json' || !Number.isFinite(Date.parse(r.requested_at))) throw Error('invalid');}
process.stdout.write(JSON.stringify(names.map(n=>n.slice(0,-5))));'''
        files = set(json.loads(command(COMPOSE + ["exec", "-T", "web", "node", "-e", js])))
        errors = ["deletion tombstone missing from independent restore ledger"] if deleted - files else []
        web_mounts = containers["web"]["Mounts"]
        backup_mounts = containers["backup"]["Mounts"]
        web_env = dict(item.split("=", 1) for item in containers["web"]["Config"]["Env"])
        mount = next(m for m in web_mounts if m["Destination"] == web_env["PULS_DELETION_LEDGER_DIR"])
        if not any(m["Source"] == mount["Source"] and m["Destination"] == "/deletion-ledger" for m in backup_mounts):
            errors.append("backup restore tooling does not share the independent ledger")
        if any(m["Source"] == mount["Source"] for m in containers["db"]["Mounts"]):
            errors.append("deletion ledger shares the database volume")
        return {"receipts": len(files)}, errors
    check("restore_ledger", ledger)

    def backups():
        env = dict(item.split("=", 1) for item in containers["backup"]["Config"]["Env"])
        raw = command(COMPOSE + ["exec", "-T", "backup", "bash", "-c",
            'find "${BACKUP_DIR:-/backups}" -maxdepth 1 -type f -name "puls-*.dump" -printf "%T@\\n"'])
        ages = [time.time() - float(value) for value in raw.splitlines()]
        return {"archives": len(ages)}, backup_problems(ages, int(env.get("PULS_BACKUP_KEEP_DAYS", "0")), env.get("PULS_BACKUP_STRICT_RETENTION") == "true")
    check("backup_freshness_and_expiry", backups)
    print(json.dumps({"ok": not problems, "checked_at": int(time.time()), "checks": checks, "problems": problems}, indent=2))
    return int(bool(problems))


if __name__ == "__main__":
    sys.exit(main())
