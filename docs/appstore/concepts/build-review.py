#!/usr/bin/env python3
"""Build the portable design gallery from existing synthetic app screenshots."""

import base64
import argparse
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ASSETS = {
    "explore": "app-explore.webp",
    "export": "app-export.webp",
    "type": "app-type-page.webp",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, help="Private directory with iphone/ipad PNG captures")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    assets = {
        key: "data:image/webp;base64,"
        + base64.b64encode(
            (ROOT / "site/public/screenshots" / filename).read_bytes()
        ).decode("ascii")
        for key, filename in ASSETS.items()
    }
    if args.captures:
        if not args.output:
            parser.error("Production captures require an explicit private --output")
        for family in ("iphone", "ipad"):
            for screen in ("explore", "sync", "export", "type"):
                key = screen if family == "iphone" else "ipad-" + screen
                assets[key] = "data:image/png;base64," + base64.b64encode(
                    (args.captures / family / (screen + ".png")).read_bytes()
                ).decode("ascii")
    template = (HERE / "review.template.html").read_text()
    assert template.count("__EMBEDDED_ASSETS__") == 1
    result = template.replace("__EMBEDDED_ASSETS__", json.dumps(assets))
    destination = args.output or HERE / "review.html"
    destination.write_text(result)
    print(f"Built {destination.name}: {destination.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
