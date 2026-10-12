#!/usr/bin/env python3
"""Inspect worktree ownership and Git/PR state. Read-only unless --claim is supplied."""

import argparse
import json
import subprocess
from pathlib import Path

from dev_evidence import git, timestamp, write_json


def worktrees(root):
    raw = subprocess.check_output(["git", "-C", str(root), "worktree", "list", "--porcelain", "-z"])
    records, current = [], {}
    for entry in raw.decode().split("\0"):
        if not entry:
            if current:
                records.append(current)
                current = {}
            continue
        key, _, value = entry.partition(" ")
        current[key] = value or True
    return records


def owner_file(root):
    return Path(git(root, "rev-parse", "--absolute-git-dir")) / "puls-task.json"


def inspect(root, github=False):
    results = []
    for entry in worktrees(root):
        path = Path(entry["worktree"])
        result = {"path": str(path), "branch": str(entry.get("branch", "detached")).removeprefix("refs/heads/"),
                  "sha": entry["HEAD"], "locked": entry.get("locked", False)}
        if not path.exists():
            result["status"] = "missing; do not auto-prune"
            results.append(result)
            continue
        result["changes"] = git(path, "status", "--porcelain").splitlines()
        record = owner_file(path)
        result["ownership"] = json.loads(record.read_text()) if record.exists() else {"owner": "unknown"}
        upstream = subprocess.run(["git", "-C", str(path), "rev-parse", "--abbrev-ref", "@{upstream}"], capture_output=True, text=True)
        result["upstream"] = upstream.stdout.strip() or None
        if result["upstream"]:
            ahead, behind = git(path, "rev-list", "--left-right", "--count", "HEAD...@{upstream}").split()
            result.update(ahead=int(ahead), behind=int(behind))
        if github and result["branch"] != "detached":
            response = subprocess.run(["gh", "pr", "list", "--head", result["branch"], "--state", "all", "--limit", "5", "--json", "number,url,state,headRefOid,mergeCommit"], cwd=path, capture_output=True, text=True)
            result["pull_requests"] = json.loads(response.stdout) if response.returncode == 0 else "lookup unavailable"
        results.append(result)
    return {"observed_at": timestamp(), "remote_refs": "local snapshot; fetch before making merge/cleanup decisions", "worktrees": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--github", action="store_true")
    parser.add_argument("--claim", help="Explicitly record this checkout's owner/session; never overwrites another owner")
    args = parser.parse_args()
    root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel"))
    if args.claim:
        if git(root, "branch", "--show-current") == "main":
            parser.error("Keep main authoritative; claim a task worktree")
        path = owner_file(root)
        if path.exists() and json.loads(path.read_text())["owner"] != args.claim:
            parser.error("Checkout already has another owner; do not take it over")
        write_json(path, {"owner": args.claim, "claimed_at": timestamp(), "base_sha": git(root, "rev-parse", "HEAD")})
    print(json.dumps(inspect(root, args.github), indent=2))


if __name__ == "__main__":
    main()
