#!/usr/bin/env python3
"""Create candidate evidence and reject reuse after relevant inputs change."""

import argparse
import json
from pathlib import Path

from dev_evidence import IOS_INPUTS, fingerprint, git, sha256, timestamp, write_json

INPUTS = {
    "ios": IOS_INPUTS,
    "backend": ["server", "web", "docs/protocol", "scripts/bootstrap.sh"],
}


def create(root, component, version, build):
    if git(root, "status", "--porcelain"):
        raise ValueError("Create a candidate from a clean committed checkout")
    return {"schema": 1, "component": component, "version": version, "build": build,
            "source_sha": git(root, "rev-parse", "HEAD"), "created_at": timestamp(),
            "inputs_sha256": fingerprint(root, INPUTS[component]),
            "archive": None, "checks": [],
            "delivery": {"deployed": "unverified", "submitted": "unverified", "released": "unverified"}}


def verify(root, record):
    if fingerprint(root, INPUTS[record["component"]]) != record["inputs_sha256"]:
        raise ValueError("Candidate inputs changed; create a new record and reassess affected evidence")


def attach_archive(record, artifact):
    archive = {"name": artifact.name, "sha256": sha256(artifact)}
    if record["archive"] and record["archive"]["sha256"] != archive["sha256"]:
        raise ValueError("Archive bytes changed; create a new candidate instead of reusing acceptance")
    if not record["archive"] and any(check["method"] in ("physical-device", "maintainer-confirmed") for check in record["checks"]):
        raise ValueError("Attach the archive before recording device/maintainer acceptance")
    record["archive"] = archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["create", "verify", "record"])
    parser.add_argument("file", type=Path, help="Private JSON receipt path, outside the public working tree")
    parser.add_argument("--component", choices=INPUTS, default="ios")
    parser.add_argument("--version")
    parser.add_argument("--build")
    parser.add_argument("--name")
    parser.add_argument("--status", choices=["passed", "failed", "skipped", "unverified", "waived"])
    parser.add_argument("--method", choices=["automated", "signed-simulator", "physical-device", "maintainer-confirmed"])
    parser.add_argument("--reference", help="Evidence URL/path or precise maintainer acceptance; no credentials")
    parser.add_argument("--artifact", type=Path, help="Optional exported IPA or other immutable artifact to hash")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        if args.action == "create":
            if args.file.exists() or not args.version:
                parser.error("Use a new record path and supply --version")
            record = create(root, args.component, args.version, args.build)
        else:
            record = json.loads(args.file.read_text())
            verify(root, record)
            if args.action == "verify":
                print("Candidate inputs match. This does not imply acceptance, deployment or submission.")
                return
            if not all([args.name, args.status, args.method, args.reference]):
                parser.error("record requires --name, --status, --method and --reference")
            if args.method in ("physical-device", "maintainer-confirmed") and not record["archive"]:
                raise ValueError("Attach the candidate archive before recording device/maintainer acceptance")
            record["checks"].append({"name": args.name, "status": args.status, "method": args.method,
                                     "reference": args.reference, "recorded_at": timestamp(),
                                     "inputs_sha256": record["inputs_sha256"]})
        if args.artifact:
            attach_archive(record, args.artifact)
        write_json(args.file, record)
        print(f"Candidate evidence: {args.file}")
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
