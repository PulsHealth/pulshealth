#!/usr/bin/env python3
"""Render the knowledge base into the app's bundled knowledge.json.

Reads every article in knowledge-base/**/*.yaml (schema.yaml excluded) and
writes PulsHealth/Sources/Resources/knowledge.json: one JSON object keyed by
HealthKit identifier, each value a trimmed article with a fixed shape so the
app can decode it with Foundation alone (the app has no YAML parser and no
third-party code — the privacy documents promise the latter).

The output is generated: never edit it by hand. Regenerate after any change
under knowledge-base/; scripts/check-knowledge-json.sh (CI, `validate` job)
fails until the checked-in file matches. Output is deterministic: sorted
keys, 2-space indent, trailing newline, byte-identical on rerun.

Fields kept per article, and how varying YAML shapes are normalised to one
JSON shape:

  identifier, human_readable_name, short_description, description, category,
  default_unit, unit_description, aggregation_type       — string or null
  deprecated, sensitive_data                             — bool (absent → false)
  typical_range   — {min, max, unit, notes} or null. min/max are numbers (or
                    null), unit and notes strings (or null). Three articles
                    use other keys there (systolic/diastolic, frequency/
                    duration_seconds); those are folded into `notes` as
                    "key: value" lines so nothing is lost and the shape holds.
  clinical_ranges — list, kept as written (free-form per-population rows);
                    null when absent.
  category_values — list of {value, name, description}, kept as written;
                    null when absent.
  devices         — list of {name, capability, series, accuracy, examples};
                    missing keys are null, `examples` is a list or null, and
                    the one file that says `models` has it folded into
                    `examples`.
  primary_source  — string or null.
  metadata_keys   — list of {key, description, values}; `values` a list or
                    null. Always a list (empty when the file has none).
  related_types   — list of {identifier, relationship}; a few files carry a
                    `description` instead of, or as well as, `relationship`,
                    and it is folded into `relationship`. Always a list.
  references      — list of {title, url, type}, kept as written. Always a list.
  ios_introduced, watchos_introduced — {version, year, notes} or null;
                    version a string, year an int, notes string or null.
  research_notes  — string, present only when the file has one.

Usage: scripts/gen-knowledge-json.py [--output PATH]
  Prints a one-line summary (articles, bytes) to stderr on success.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("gen-knowledge-json: PyYAML not installed. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "knowledge-base"
DEFAULT_OUTPUT = ROOT / "PulsHealth" / "Sources" / "Resources" / "knowledge.json"

STRING_FIELDS = (
    "identifier",
    "human_readable_name",
    "short_description",
    "description",
    "category",
    "default_unit",
    "unit_description",
    "aggregation_type",
    "primary_source",
)
BOOL_FIELDS = ("deprecated", "sensitive_data")


def text(value) -> str | None:
    """A string field: None stays None, anything else is stringified and trimmed."""
    if value is None:
        return None
    return str(value).strip()


def number(value):
    """A numeric field: ints and floats pass, anything else becomes None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def typical_range(value):
    if not isinstance(value, dict):
        return None
    notes = [text(value.get("notes"))] if value.get("notes") else []
    for key in sorted(value):
        if key in ("min", "max", "unit", "notes"):
            continue
        notes.append(f"{key}: {value[key]}")
    return {
        "min": number(value.get("min")),
        "max": number(value.get("max")),
        "unit": text(value.get("unit")),
        "notes": "\n".join(notes) if notes else None,
    }


def device(value):
    examples = value.get("examples")
    if examples is None and value.get("models") is not None:
        examples = [value["models"]]
    if isinstance(examples, str):
        examples = [examples]
    return {
        "name": text(value.get("name")),
        "capability": text(value.get("capability")),
        "series": text(value.get("series")),
        "accuracy": text(value.get("accuracy")),
        "examples": [text(e) for e in examples] if examples else None,
    }


def metadata_key(value):
    values = value.get("values")
    if isinstance(values, str):
        values = [values]
    return {
        "key": text(value.get("key")),
        "description": text(value.get("description")),
        "values": [text(v) for v in values] if values else None,
    }


def related_type(value):
    parts = [text(value.get("relationship")), text(value.get("description"))]
    parts = [p for p in parts if p]
    return {
        "identifier": text(value.get("identifier")),
        "relationship": " — ".join(parts) if parts else None,
    }


def introduced(value):
    if not isinstance(value, dict):
        return None
    year = value.get("year")
    return {
        "version": text(value.get("version")),
        "year": int(year) if isinstance(year, (int, float)) and not isinstance(year, bool) else None,
        "notes": text(value.get("notes")),
    }


def article(data: dict) -> dict:
    out = {field: text(data.get(field)) for field in STRING_FIELDS}
    for field in BOOL_FIELDS:
        out[field] = bool(data.get(field, False))
    out["typical_range"] = typical_range(data.get("typical_range"))
    out["clinical_ranges"] = data.get("clinical_ranges") or None
    out["category_values"] = data.get("category_values") or None
    out["devices"] = [device(d) for d in (data.get("devices") or [])]
    out["metadata_keys"] = [metadata_key(m) for m in (data.get("metadata_keys") or [])]
    out["related_types"] = [related_type(r) for r in (data.get("related_types") or [])]
    out["references"] = data.get("references") or []
    out["ios_introduced"] = introduced(data.get("ios_introduced"))
    out["watchos_introduced"] = introduced(data.get("watchos_introduced"))
    if data.get("research_notes"):
        out["research_notes"] = text(data["research_notes"])
    return out


def load_articles() -> dict[str, dict]:
    articles: dict[str, dict] = {}
    files = sorted(p for p in SOURCE.rglob("*.yaml") if p.name != "schema.yaml")
    if not files:
        sys.exit(f"gen-knowledge-json: no YAML files under {SOURCE}")
    for path in files:
        with path.open() as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict) or not data.get("identifier"):
            sys.exit(f"gen-knowledge-json: {path.relative_to(ROOT)} has no identifier")
        identifier = str(data["identifier"]).strip()
        if identifier in articles:
            sys.exit(f"gen-knowledge-json: duplicate identifier {identifier} in {path.relative_to(ROOT)}")
        articles[identifier] = article(data)
    return articles


def render(articles: dict[str, dict]) -> str:
    return json.dumps(articles, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"where to write (default: {DEFAULT_OUTPUT.relative_to(ROOT)})")
    args = parser.parse_args()

    articles = load_articles()
    rendered = render(articles)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(f"gen-knowledge-json: {len(articles)} articles, {len(rendered.encode('utf-8'))} bytes -> {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
