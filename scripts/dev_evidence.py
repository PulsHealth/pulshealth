"""Small, shared provenance helpers. Receipts stay outside the public source tree."""

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def fingerprint(root, paths):
    """Hash names and contents, including untracked inputs (not ignored build outputs)."""
    raw = subprocess.check_output([
        "git", "-C", str(root), "ls-files", "-z", "--cached", "--others",
        "--exclude-standard", "--", *paths,
    ])
    digest = hashlib.sha256()
    for name in sorted(set(raw.decode().split("\0")) - {""}):
        path = root / name
        digest.update(name.encode() + b"\0")
        digest.update(path.read_bytes() if path.is_file() else b"<deleted>")
        digest.update(b"\0")
    return digest.hexdigest()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def state_dir(root):
    common = Path(git(root, "rev-parse", "--git-common-dir"))
    return (root / common).resolve() / "pulshealth"


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n")
    temporary.replace(path)


IOS_INPUTS = ["PulsHealth", "PulsHealthSync", "docs/protocol/catalog.json",
              "knowledge-base", "scripts/gen-knowledge-json.py",
              "scripts/check-knowledge-json.sh", "scripts/test-ios.py",
              "scripts/dev_evidence.py", ".github/workflows/ios-ci.yml"]
