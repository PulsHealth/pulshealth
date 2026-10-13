#!/usr/bin/env python3
"""Build the portable design gallery from existing synthetic app screenshots."""

import base64
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
    assets = {
        key: "data:image/webp;base64,"
        + base64.b64encode(
            (ROOT / "site/public/screenshots" / filename).read_bytes()
        ).decode("ascii")
        for key, filename in ASSETS.items()
    }
    template = (HERE / "review.template.html").read_text()
    assert template.count("__EMBEDDED_ASSETS__") == 1
    result = template.replace("__EMBEDDED_ASSETS__", json.dumps(assets))
    destination = HERE / "review.html"
    destination.write_text(result)
    print(f"Built {destination.name}: {destination.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
