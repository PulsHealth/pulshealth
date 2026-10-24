#!/usr/bin/env python3
"""Build, bind and verify site exports; never trust an old out/ directory."""

import argparse
import hashlib
import os
import json
import subprocess
import shutil
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from dev_evidence import fingerprint, git, sha256, state_dir, timestamp, write_json

ROOT = Path(__file__).resolve().parents[1]
# All Markdown sources are conservative: docs.ts can add another input without
# silently escaping provenance. Generated public assets are gitignored.
INPUTS = ["site", "llms.txt", "blog", "knowledge-base", "server/api/openapi.json", "*.md",
          "**/*.md", "scripts/site-artifact.py", "scripts/dev_evidence.py",
          "scripts/deploy-site.sh"]
MANIFEST = ".puls-build.json"


def site_fingerprint(root):
    digest = hashlib.sha256(fingerprint(root, INPUTS).encode())
    # Sitemap lastmod depends on commit history, not only source bytes.
    for args in (("rev-parse", "HEAD"), ("rev-parse", "--is-shallow-repository"),
                 ("status", "--porcelain", "--", *INPUTS)):
        digest.update(git(root, *args).encode() + b"\0")
    for name in (".env", ".env.local", ".env.production", ".env.production.local"):
        path = root / "site" / name
        digest.update(name.encode() + b"\0")
        digest.update(path.read_bytes() if path.exists() else b"<absent>")
    # Only hashes leave memory; never serialize values or file contents.
    public_env = {key: value for key, value in os.environ.items() if key.startswith("NEXT_PUBLIC_")}
    digest.update(json.dumps(public_env, sort_keys=True).encode())
    if os.environ.get("NODE_ENV") not in (None, "production"):
        raise RuntimeError("Site release builds require NODE_ENV unset or production")
    return digest.hexdigest()


def inventory(out):
    return {str(p.relative_to(out)): sha256(p) for p in sorted(out.rglob("*"))
            if p.is_file()}


def build(root):
    before = site_fingerprint(root)
    subprocess.run(["bun", "run", "build:export"], cwd=root / "site", check=True)
    if site_fingerprint(root) != before:
        raise RuntimeError("Site inputs changed during build; rebuild before deploying")
    record = {"schema": 1, "source_sha": git(root, "rev-parse", "HEAD"),
              "inputs_sha256": before, "built_at": timestamp(),
              "source_dirty": bool(git(root, "status", "--porcelain")),
              "files": inventory(root / "site/out")}
    write_json(root / "site" / MANIFEST, record)
    return record


def validate(root):
    path = root / "site" / MANIFEST
    if not path.is_file():
        raise RuntimeError("No build manifest; run bun run build in site/ first")
    record = json.loads(path.read_text())
    if record.get("schema") != 1 or record["inputs_sha256"] != site_fingerprint(root):
        raise RuntimeError("Stale export: source inputs differ from the tested build")
    if record["files"] != inventory(root / "site/out"):
        raise RuntimeError("Export files changed after build; rebuild before deploying")
    subprocess.run(["bun", "run", "check:export"], cwd=root / "site", check=True)
    return record


REVALIDATE = "public,max-age=0,must-revalidate"
IMMUTABLE = "public,max-age=31536000,immutable"
MEDIA_CACHE = "public,max-age=86400,must-revalidate"
MEDIA_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg", ".ico", ".woff", ".woff2")


def cache_policy(name):
    if name.startswith("_next/static/"):
        return IMMUTABLE
    if Path(name).suffix.lower() in MEDIA_SUFFIXES:
        return MEDIA_CACHE
    return REVALIDATE


def upload_commands(snapshot):
    # cp deliberately refreshes metadata even when file bytes have not changed.
    # Mutually exclusive groups upload each object once. The final sync prunes
    # retired mutable objects; size-only skips everything copied successfully.
    # Assets go first, and old hashed chunks stay available for open browser tabs.
    source, destination = str(snapshot) + "/", "s3://pulshealth.com/"
    common = ["aws", "s3", "cp", source, destination, "--recursive", "--only-show-errors"]
    documents = common + ["--exclude", "_next/static/*"]
    media = common + ["--exclude", "*"]
    for suffix in MEDIA_SUFFIXES:
        documents += ["--exclude", "*" + suffix, "--exclude", "*" + suffix.upper()]
        media += ["--include", "*" + suffix, "--include", "*" + suffix.upper()]
    commands = []
    if (snapshot / "_next/static").is_dir():
        commands.append(["aws", "s3", "cp", str(snapshot / "_next/static") + "/",
                         destination + "_next/static/", "--recursive", "--only-show-errors",
                         "--cache-control", IMMUTABLE])
    commands.append(media + ["--exclude", "_next/static/*", "--cache-control", MEDIA_CACHE])
    commands.append(documents + ["--cache-control", REVALIDATE])
    commands.append(["aws", "s3", "sync", source, destination, "--delete", "--size-only",
                     "--exclude", "_next/static/*",
                     "--only-show-errors", "--cache-control", REVALIDATE])
    return commands


def verify_live(out, base_url, paths):
    import hashlib
    checked = []
    for name in paths:
        path = out / name
        if not path.is_file() or not path.resolve().is_relative_to(out.resolve()):
            raise RuntimeError(f"Invalid verification file: {name}")
        url_path = name[:-10] if name.endswith("index.html") else name
        request = Request(base_url.rstrip("/") + "/" + url_path,
                          headers={"User-Agent": "PulsHealth-release-check", "Cache-Control": "no-cache"})
        with urlopen(request, timeout=30) as response:
            body = response.read()
            if response.status != 200 or hashlib.sha256(body).hexdigest() != sha256(path):
                raise RuntimeError(f"Live artifact differs from tested build: {name}")
            if response.headers.get("Cache-Control", "").replace(" ", "") != cache_policy(name):
                raise RuntimeError(f"Live cache policy differs from release policy: {name}")
        checked.append(name)
    return checked


def deploy(root, args):
    if git(root, "status", "--porcelain"):
        raise RuntimeError("Deploy from a clean committed checkout")
    if not args.skip_build:
        subprocess.run(["bun", "install", "--frozen-lockfile"], cwd=root / "site", check=True)
        subprocess.run(["bun", "run", "build"], cwd=root / "site", check=True)
    record = validate(root)
    with tempfile.TemporaryDirectory(prefix="puls-site-deploy-") as temporary:
        snapshot = Path(temporary) / "out"
        shutil.copytree(root / "site/out", snapshot)
        if inventory(snapshot) != record["files"] or site_fingerprint(root) != record["inputs_sha256"]:
            raise RuntimeError("Build changed while staging deployment")
        deploy_snapshot(root, args, record, snapshot)


def deploy_snapshot(root, args, record, snapshot):
    commands = upload_commands(snapshot)
    if args.dry_run:
        for command in commands:
            subprocess.run(command + ["--dryrun"], check=True)
        print("Dry run complete: no upload or invalidation")
        return
    receipt = {"schema": 1, "source_sha": git(root, "rev-parse", "HEAD"),
               "built_from_sha": record["source_sha"],
               "build_source_dirty": record.get("source_dirty", False),
               "inputs_sha256": record["inputs_sha256"], "started_at": timestamp(),
               "status": "uploading", "verified_files": []}
    receipt_path = state_dir(root) / "deployments" / (receipt["started_at"].replace(":", "-") + ".json")
    write_json(receipt_path, receipt)
    try:
        for command in commands:
            subprocess.run(command, check=True)
        if args.no_invalidation:
            receipt["status"] = "uploaded-unverified"
            print("Uploaded; CDN invalidation and live verification are still required")
        else:
            result = json.loads(subprocess.check_output([
                "aws", "cloudfront", "create-invalidation", "--distribution-id", "E2B9BMUXL8SCC8",
                "--paths", "/*", "--output", "json",
            ]))
            receipt["invalidation_id"] = result["Invalidation"]["Id"]
            write_json(receipt_path, receipt)
            subprocess.run(["aws", "cloudfront", "wait", "invalidation-completed",
                            "--distribution-id", "E2B9BMUXL8SCC8", "--id", receipt["invalidation_id"]], check=True)
            paths = ["index.html", "privacy/index.html", "sitemap.xml", "robots.txt", "screenshots/app-explore.webp"]
            for suffix in (".js", ".css"):
                asset = next((p for p in record["files"] if p.startswith("_next/") and p.endswith(suffix)), None)
                if asset:
                    paths.append(asset)
            paths.extend(args.verify_path)
            receipt["verified_files"] = verify_live(snapshot, "https://pulshealth.com", sorted(set(paths)))
            receipt["status"] = "verified"
            print("Deployment verified: CDN complete and live artifacts match the build")
    except Exception as error:
        receipt["status"] = "failed"
        receipt["error"] = type(error).__name__
        raise
    finally:
        receipt["finished_at"] = timestamp()
        write_json(receipt_path, receipt)
        print(f"Deployment receipt: {receipt_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "verify", "deploy"])
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--no-invalidation", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verify-path", action="append", default=[], help="Additional exported file, e.g. blog/my-post/index.html")
    args = parser.parse_args()
    try:
        if args.action == "build":
            build(ROOT)
        elif args.action == "verify":
            validate(ROOT)
        else:
            deploy(ROOT, args)
    except (RuntimeError, OSError, subprocess.CalledProcessError, ValueError, KeyError) as error:
        parser.exit(1, f"site-artifact: {error}\n")


if __name__ == "__main__":
    main()
