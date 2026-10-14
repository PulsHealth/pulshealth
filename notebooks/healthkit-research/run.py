"""Persist standard analysis from private, immutable CSV snapshots."""
import argparse
import json
from pathlib import Path

from common import input_manifest, load_data, standard_analysis, write_notebook


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    data = load_data(args.input)
    report = standard_analysis(data, args.identifier)
    report["inputs"] = input_manifest(args.input)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "standard-analysis.json").write_text(json.dumps(report, indent=2, allow_nan=False))
    code = ("from pathlib import Path\nimport sys, json\n"
            "# Update FRAMEWORK_DIR if moving this private notebook to another checkout.\n"
            f"FRAMEWORK_DIR = Path({str(Path(__file__).resolve().parent)!r})\n"
            "sys.path.insert(0, str(FRAMEWORK_DIR))\n"
            "from common import load_data, standard_analysis\n"
            f"INPUT_DIR = Path({str(args.input)!r})\n"
            f"report = standard_analysis(load_data(INPUT_DIR), {args.identifier!r})\n"
            "print(json.dumps(report, indent=2, allow_nan=False))")
    write_notebook(args.output / "standard-analysis.ipynb", args.identifier, [
        {"heading": "Method and provenance", "markdown": "Raw records are preserved. Sleep uses asleep categories only; contexts use half-open interval overlap. The focus window is July–September, with a full year for seasonal and source checks. Source revisions are grouped by bundle and display name. Cadence is reported within sources as well as pooled; pooled gaps can reflect competing devices."},
        {"heading": "Reproduce the standard facets", "code": code, "output": report}])
    import nbformat
    from nbclient import NotebookClient
    notebook_path = args.output / "standard-analysis.ipynb"
    notebook = nbformat.read(notebook_path, as_version=4)
    NotebookClient(notebook, timeout=600, kernel_name="python3").execute()
    nbformat.write(notebook, notebook_path)


if __name__ == "__main__":
    main()
