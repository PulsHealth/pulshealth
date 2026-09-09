#!/usr/bin/env python3
"""
Validation script for HealthKit Knowledge Base YAML files.

Usage:
    python validate.py              # Validate all YAML files
    python validate.py --verbose    # Show detailed output
    python validate.py path/to.yaml # Validate specific file
"""

import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("Error: PyYAML not installed. Run: pip install pyyaml")
    sys.exit(1)

try:
    import jsonschema
except ImportError:
    print("Error: jsonschema not installed. Run: pip install jsonschema")
    sys.exit(1)


def load_schema():
    """Load the JSON schema for validation."""
    schema_path = Path(__file__).parent / "schema.json"
    if not schema_path.exists():
        print(f"Error: Schema file not found at {schema_path}")
        sys.exit(1)

    with open(schema_path) as f:
        return json.load(f)


def validate_file(yaml_path: Path, schema: dict, verbose: bool = False) -> tuple[bool, str]:
    """
    Validate a single YAML file against the schema.

    Returns:
        tuple of (is_valid, error_message)
    """
    try:
        with open(yaml_path) as f:
            data = yaml.safe_load(f)

        if data is None:
            return False, "Empty file"

        jsonschema.validate(data, schema)

        # Additional custom validations
        errors = []

        # Check description length is meaningful
        if len(data.get("description", "")) < 200:
            errors.append("Description should be at least 200 characters for comprehensive documentation")

        # Check that HKQuantityType has units
        if data.get("type") == "HKQuantityType" and not data.get("default_unit"):
            errors.append("HKQuantityType should have a default_unit")

        # Check that HKCategoryType has category_values
        if data.get("type") == "HKCategoryType" and not data.get("category_values"):
            errors.append("HKCategoryType should have category_values defined")

        if errors:
            return False, "; ".join(errors)

        return True, ""

    except yaml.YAMLError as e:
        return False, f"YAML parse error: {e}"
    except jsonschema.ValidationError as e:
        return False, f"Schema validation error: {e.message}"
    except Exception as e:
        return False, f"Unexpected error: {e}"


def find_yaml_files(base_path: Path) -> list[Path]:
    """Find all YAML files in the knowledge base, excluding schema.yaml and node_modules."""
    yaml_files = []
    excluded_dirs = {"node_modules", "website", ".git", "__pycache__"}
    for pattern in ["**/*.yaml", "**/*.yml"]:
        for f in base_path.rglob(pattern.split("/")[-1]):
            # Skip excluded directories
            if any(excluded in f.parts for excluded in excluded_dirs):
                continue
            if f.name not in ("schema.yaml", "schema.yml"):
                yaml_files.append(f)
    return sorted(yaml_files)


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv

    # Check for specific file argument
    specific_file = None
    for arg in sys.argv[1:]:
        if not arg.startswith("-") and (arg.endswith(".yaml") or arg.endswith(".yml")):
            specific_file = Path(arg)
            break

    base_path = Path(__file__).parent
    schema = load_schema()

    if specific_file:
        if not specific_file.exists():
            print(f"Error: File not found: {specific_file}")
            sys.exit(1)
        yaml_files = [specific_file]
    else:
        yaml_files = find_yaml_files(base_path)

    if not yaml_files:
        print("No YAML files found to validate.")
        sys.exit(0)

    print(f"Validating {len(yaml_files)} YAML file(s)...\n")

    valid_count = 0
    error_count = 0
    errors = []

    for yaml_file in yaml_files:
        is_valid, error_msg = validate_file(yaml_file, schema, verbose)

        relative_path = yaml_file.relative_to(base_path) if yaml_file.is_relative_to(base_path) else yaml_file

        if is_valid:
            valid_count += 1
            if verbose:
                print(f"  {relative_path}")
        else:
            error_count += 1
            errors.append((relative_path, error_msg))
            print(f"  {relative_path}")
            print(f"    Error: {error_msg}")

    print()
    print("=" * 50)
    print(f"Results: {valid_count} valid, {error_count} errors")
    print("=" * 50)

    if error_count > 0:
        print("\nFiles with errors:")
        for path, msg in errors:
            print(f"  - {path}")
        sys.exit(1)
    else:
        print("\nAll files validated successfully!")
        sys.exit(0)


if __name__ == "__main__":
    main()
