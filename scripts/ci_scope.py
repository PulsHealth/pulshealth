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


if __name__ == "__main__":
    if len(sys.argv) == 1:
        selected = {"backend": True, "site": True}
    else:
        base, head = sys.argv[1:]
        changed = subprocess.check_output(
            ["git", "diff", "--no-renames", "--name-only", "-z", base, head]
        ).decode().split("\0")
        selected = scopes([path for path in changed if path])
    for name, enabled in selected.items():
        print(f"{name}={str(enabled).lower()}")
