#!/usr/bin/env bash
# Deploy a provenance-checked site export and verify CDN completion/live bytes.
# Usage: scripts/deploy-site.sh [--skip-build] [--dry-run]
#        [--verify-path blog/<slug>/index.html] [--no-invalidation]
# --no-invalidation explicitly leaves the deployment uploaded-unverified.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec python3 "$script_dir/site-artifact.py" deploy "$@"
