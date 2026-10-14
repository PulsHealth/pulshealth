"""Boundary and nonfinite checks for the reusable analysis methods."""
import unittest
import tempfile
from pathlib import Path
import base64

import numpy as np
import pandas as pd

from common import describe, overlap_mask, summarize, annotate_context, write_notebook


def frame(starts, ends):
    return pd.DataFrame({"start_ts": pd.to_datetime(starts, utc=True),
                         "end_ts": pd.to_datetime(ends, utc=True)})


class CommonTests(unittest.TestCase):
    def test_merged_overlap_and_point_boundaries(self):
        context = frame(["2026-07-01T01:00Z", "2026-07-01T01:30Z"],
                        ["2026-07-01T02:00Z", "2026-07-01T03:00Z"])
        samples = frame(["2026-07-01T00:30Z", "2026-07-01T01:00Z", "2026-07-01T03:00Z", "2026-07-01T00:00Z"],
                        ["2026-07-01T01:00Z", "2026-07-01T01:00Z", "2026-07-01T03:00Z", "2026-07-01T04:00Z"])
        self.assertEqual(overlap_mask(samples, context).tolist(), [False, True, False, True])

    def test_nonfinite_values_are_not_numeric_outliers(self):
        report = describe([0, 10, np.inf, -np.inf, np.nan])
        self.assertEqual(report["finite_count"], 2)
        self.assertEqual(report["nonfinite_or_missing"], 3)
        self.assertEqual(report["p50"], 5)

    def test_missing_days_denominator_and_asleep_only(self):
        samples = frame(["2026-07-01T12:00Z"], ["2026-07-01T12:00Z"])
        samples["value"] = [80]
        sleep = frame(["2026-07-01T11:00Z"], ["2026-07-01T13:00Z"])
        sleep["value"] = [0]  # in bed is not asleep
        samples = annotate_context(samples, {"sleep": sleep})
        self.assertFalse(samples.sleep_overlap.iloc[0])
        report = summarize(samples, pd.Timestamp("2026-07-01", tz="America/Los_Angeles"),
                           pd.Timestamp("2026-07-04", tz="America/Los_Angeles"))
        self.assertEqual(report["calendar_days"], 3)
        self.assertEqual(report["days_with_records"], 1)
        self.assertEqual(report["coverage_fraction"], 1/3)

    def test_utc_midnight_bounds_rejected_for_local_calendar(self):
        samples = frame(["2026-07-01T01:00Z", "2026-07-01T20:00Z"],
                        ["2026-07-01T01:00Z", "2026-07-01T20:00Z"])
        samples["value"] = [70, 80]
        samples = annotate_context(samples, {})
        with self.assertRaisesRegex(ValueError, "reporting-calendar midnight"):
            summarize(samples, pd.Timestamp("2026-07-01", tz="UTC"),
                      pd.Timestamp("2026-07-02", tz="UTC"))

    def test_explicit_utc_calendar_recomputes_local_day_keys(self):
        samples = frame(["2026-07-01T01:00Z", "2026-07-01T20:00Z"],
                        ["2026-07-01T01:00Z", "2026-07-01T20:00Z"])
        samples["value"] = [70, 80]
        samples = annotate_context(samples, {})
        report = summarize(samples, pd.Timestamp("2026-07-01", tz="UTC"),
                           pd.Timestamp("2026-07-02", tz="UTC"), timezone="UTC")
        self.assertEqual(report["days_with_records"], 1)
        self.assertEqual(report["coverage_fraction"], 1)

    def test_notebook_figure_survives_execution(self):
        import nbformat
        from nbclient import NotebookClient
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "figure.png"
            image.write_bytes(base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBfkAAAAASUVORK5CYII="))
            path = Path(directory) / "evidence.ipynb"
            write_notebook(path, "Synthetic notebook boundary check", [{"figures": [image]}])
            notebook = nbformat.read(path, as_version=4)
            NotebookClient(notebook, timeout=60, kernel_name="python3").execute()
            image_cells = [cell for cell in notebook.cells if cell.cell_type == "code"]
            self.assertEqual(image_cells[0].execution_count, 1)
            self.assertIn("image/png", image_cells[0].outputs[0].data)


if __name__ == "__main__":
    unittest.main()
