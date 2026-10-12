"""Select PR checks conservatively; main and releases always run every job."""

import subprocess
import sys


def scopes(paths: list[str]) -> dict[str, bool]:
    backend = site = False
    for path in paths:
        if path.startswith("PulsHealth/"):
            # The app has its own PR workflow.
            continue
        if path == ".github/PULL_REQUEST_TEMPLATE.md":
            continue
        if path.startswith(("site/", "blog/")):
            site = True
        elif (path.startswith("docs/") and path.endswith(".md") and not path.startswith("docs/protocol/")) or ("/" not in path and path.endswith(".md")):
            # The site consumes repository Markdown by relative path.
            site = True
        else:
            # Shared catalog, protocol, knowledge, scripts, workflows,
            # backend/viewer, and unrecognised paths get the full suite.
            backend = site = True
    return {"backend": backend, "site": site}


def component_scopes(paths: list[str]) -> dict[str, bool]:
    shared = {"scripts/ci_scope.py", "scripts/test_ci_scope.py"}
    ios_inputs = shared | {
        ".github/workflows/ios-ci.yml",
        "docs/protocol/catalog.json",
        "scripts/gen-knowledge-json.py",
        "scripts/check-knowledge-json.sh",
    }
    return {
        "ios": any(
            path.startswith(("PulsHealth/", "PulsHealthSync/", "knowledge-base/"))
            or path in ios_inputs
            for path in paths
        ),

    }


if __name__ == "__main__":
    if len(sys.argv) == 1:
        selected = {"backend": True, "site": True, "ios": True}
    else:
        base, head = sys.argv[1:]
        changed = subprocess.check_output(
            ["git", "diff", "--no-renames", "--name-only", "-z", base, head]
        ).decode().split("\0")
        paths = [path for path in changed if path]
        selected = scopes(paths) | component_scopes(paths)
    for name, enabled in selected.items():
        print(f"{name}={str(enabled).lower()}")
