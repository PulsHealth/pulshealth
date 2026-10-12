#!/usr/bin/env python3
"""Verify deployed revisions and populated viewer reads; no database writes."""

import argparse
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from dev_evidence import git, state_dir, timestamp, write_json  # noqa: E402


def revisions(root, services, expected):
    compose = ["docker", "compose", "--project-directory", str(root / "server"), "-f", str(root / "server/docker-compose.yml")]
    found = {}
    for service in services:
        ids = subprocess.check_output(compose + ["ps", "-q", service], text=True).split()
        if len(ids) != 1:
            raise RuntimeError(f"Expected one running {service} container")
        container = json.loads(subprocess.check_output(["docker", "inspect", ids[0]]))[0]
        sha = container["Config"].get("Labels", {}).get("org.opencontainers.image.revision")
        if sha != expected or not container["State"]["Running"]:
            raise RuntimeError(f"{service} revision/running state does not match candidate")
        health = container["State"].get("Health", {}).get("Status")
        if health != "healthy":
            raise RuntimeError(f"{service} does not have a passing healthcheck")
        found[service] = {"revision": sha, "image_id": container["Image"], "container_id": ids[0]}
    return found


def read_environment(container, user):
    deployed = dict(item.split("=", 1) for item in container["Config"]["Env"])
    if urlsplit(deployed.get("DATABASE_URL", "")).username not in ("web_app", "grafana"):
        raise RuntimeError("Deployed viewer must use a scoped read role")
    keys = ("DATABASE_URL", "WEB_ACCOUNTS", "WEB_AUTH_PASSWORD", "WEB_DB_POOL_SIZE",
            "PULS_TIME_ZONE", "PULS_USER_ID")
    env = {key: deployed[key] for key in keys if key in deployed}
    env.update(NODE_ENV="production", PULS_READ_PERF="1", PULS_READ_PERF_USER_ID=user)
    if any("\n" in value or "\r" in value for value in env.values()):
        raise RuntimeError("Multiline environment values are unsupported by Docker env files")
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--service", action="append", choices=["web", "ingest", "api", "mcp"], default=[])
    args = parser.parse_args()
    services = args.service or ["web", "ingest", "api", "mcp"]
    if "web" not in services:
        parser.error("Include web: this verifier includes viewer performance")
    if not os.environ.get("PULS_READ_PERF_USER_ID"):
        parser.error("Set PULS_READ_PERF_USER_ID to a populated acceptance account")
    if git(ROOT, "rev-parse", "HEAD") != args.expected_sha or git(ROOT, "status", "--porcelain"):
        parser.error("Use a clean checkout at the full expected deployed SHA")
    os.umask(0o077)
    stamp = timestamp().replace(":", "-")
    directory = state_dir(ROOT) / "deployments" / ("backend-" + stamp)
    directory.mkdir(parents=True)
    receipt = {"source_sha": args.expected_sha, "started_at": timestamp(), "status": "failed"}
    try:
        receipt["services"] = revisions(ROOT, services, args.expected_sha)
        container_id = receipt["services"]["web"]["container_id"]
        container = json.loads(subprocess.check_output(["docker", "inspect", container_id]))[0]
        env = read_environment(container, os.environ["PULS_READ_PERF_USER_ID"])
        env_file = directory / "runtime.env"
        env_file.write_text("\n".join(key + "=" + value for key, value in env.items()) + "\n")
        image = "pulshealth-read-check:" + args.expected_sha
        test_container = "puls-read-check-" + uuid.uuid4().hex[:12]
        try:
            with (directory / "checks.log").open("w") as log:
                subprocess.run(["docker", "build", "--target", "read-check", "-t", image, str(ROOT / "web")],
                               stdout=log, stderr=log, check=True, timeout=600)
                subprocess.run(["docker", "run", "--rm", "--name", test_container,
                                "--network", "container:" + container_id,
                                "--env-file", str(env_file),
                                "--mount", "type=bind,src=" + str(directory) + ",dst=/evidence", image],
                               stdout=log, stderr=log, check=True, timeout=120)
        finally:
            subprocess.run(["docker", "rm", "-f", test_container], capture_output=True, timeout=30)
            env_file.unlink(missing_ok=True)
        report = json.loads((directory / "tests.json").read_text())
        if not report.get("success") or report.get("numPassedTests", 0) < 4 or report.get("numPendingTests", 0):
            raise RuntimeError("Read checks must execute and pass, without skips")
        if revisions(ROOT, services, args.expected_sha) != receipt["services"]:
            raise RuntimeError("Deployment changed during verification")
        receipt["status"] = "verified"
        receipt["passed_tests"] = report["numPassedTests"]
        receipt["duration_ms"] = sum(item.get("endTime", 0) - item.get("startTime", 0) for item in report["testResults"])
    except Exception as error:
        receipt["error"] = type(error).__name__
        print("Verification failed; inspect the private receipt/logs", file=sys.stderr)
    finally:
        receipt["finished_at"] = timestamp()
        write_json(directory / "receipt.json", receipt)
        print(f"Backend verification receipt: {directory / 'receipt.json'}")
    return int(receipt["status"] != "verified")


if __name__ == "__main__":
    sys.exit(main())
