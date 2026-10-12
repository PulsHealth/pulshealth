#!/usr/bin/env python3
"""CI-only synthetic chart fixtures for the throwaway stack smoke test."""
import datetime as dt
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
USER = "11111111-1111-4111-8111-111111111111"


def main():
    if os.environ.get("CI") != "true" or os.environ.get("PULS_SCRATCH_STACK") != "1":
        raise SystemExit("Only run in CI's explicitly marked scratch stack")
    # Use the existing wholly synthetic fixture, never the personal demo pack.
    sys.path.insert(0, str(ROOT / "scripts/demo-data"))
    spec = importlib.util.spec_from_file_location("demo_fixture", ROOT / "scripts/demo-data/test_demo_data.py")
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    import load
    pack, _ = fixture.make_pack()
    timeline = load.Timeline(pack, "UTC", None)
    now = dt.datetime.now(dt.timezone.utc)
    start = timeline.midnight_ms(now.date() - dt.timedelta(days=13))
    lines = load.build(pack, timeline, start, now.timestamp() * 1000)
    settings = dict(line.split("=", 1) for line in (ROOT / "server/.env").read_text().splitlines() if "=" in line and not line.startswith("#"))
    token = settings["PULS_TOKEN"]
    for batch_id, body in load.batches(*lines, pack["profile"], "backfill"):
        load.post("http://127.0.0.1:8080/v1/batches", token, USER, batch_id, body)
    print("Synthetic read-check fixtures loaded")


if __name__ == "__main__":
    main()
