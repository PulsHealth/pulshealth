import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("knowledge_validation", BASE / "validate.py")
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.schema = validation.load_schema()
        self.entry = validation.load_entry(BASE / "quantity_types/vital_signs/heart_rate.yaml")

    def validate(self, data):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "entry.yaml"
            path.write_text(validation.yaml.safe_dump(data))
            return validation.validate_file(path, self.schema)

    def test_recording_guidance_requires_evidence_and_valid_date(self):
        self.assertTrue(self.validate(self.entry)[0])
        for change in [
            {"reviewed_on": "2026-02-30"}, {"references": []},
            {"references": [{"title": "Broken", "url": "not a URL"}]},
            {"personal_sample_count": 123},
        ]:
            with self.subTest(change=change):
                entry = copy.deepcopy(self.entry)
                entry["recording_behavior"].update(change)
                self.assertFalse(self.validate(entry)[0])

    def research(self):
        return {
            "status": "complete", "reviewed_on": "2026-10-14",
            "workflow_version": "1", "artifact_key": "heart-rate",
            "facets": ["provenance", "coverage", "sources", "values", "outliers",
                       "cadence", "workout_context", "sleep_context", "time_patterns",
                       "related_types", "type_specific"],
            "limitations": "Timestamp context is inferred; one person is not a reference population.",
        }

    def test_research_completion_requires_all_facets_and_valid_date(self):
        entry = copy.deepcopy(self.entry)
        entry["data_research"] = self.research()
        self.assertTrue(self.validate(entry)[0])
        changes = [
            {"reviewed_on": "2026-02-30"}, {"status": "pending"},
            {"workflow_version": "unknown"}, {"artifact_key": "../private"},
            {"facets": self.research()["facets"][:-1]},
            {"facets": self.research()["facets"][:-1] + ["coverage"]},
            {"facets": self.research()["facets"] + ["unsupported"]},
            {"limitations": ""},
        ]
        for change in changes:
            with self.subTest(change=change):
                entry["data_research"] = dict(self.research(), **change)
                self.assertFalse(self.validate(entry)[0])
        entry["data_research"] = self.research()
        del entry["data_research"]["facets"]
        self.assertFalse(self.validate(entry)[0])

    def test_figures_require_accessible_content_and_safe_local_paths(self):
        figure = {
            "src": "/knowledge-base/figures/heart-rate/value-distribution.svg",
            "alt": "A distribution of recorded heart rate in beats per minute.",
            "title": "Recorded heart-rate distribution",
            "caption": "One person's values illustrate context rather than normal ranges.",
            "methods": "Counts use selected source records; sleep is assigned by interval overlap.",
            "section": "recording-cadence",
        }
        entry = copy.deepcopy(self.entry)
        entry["figures"] = [figure]
        self.assertTrue(self.validate(entry)[0])
        for path in [
            "https://example.com/figure.svg", "//example.com/figure.svg",
            "/knowledge-base/figures/heart-rate/../private.svg",
            "/knowledge-base/figures/heart-rate/%2e%2e.svg",
            "/knowledge-base/figures/heart-rate/chart.svg?user=private",
            "/knowledge-base/figures/heart-rate/chart.html",
            "/knowledge-base/figures/heart-rate/chart.svg\n",
        ]:
            with self.subTest(path=path):
                entry["figures"] = [dict(figure, src=path)]
                self.assertFalse(self.validate(entry)[0])
        for key in ["alt", "caption", "methods"]:
            entry["figures"] = [dict(figure)]
            del entry["figures"][0][key]
            self.assertFalse(self.validate(entry)[0])

    def test_figure_dimensions_are_positive_integers(self):
        figure = {
            "src": "/knowledge-base/figures/heart-rate/value-distribution.svg",
            "alt": "A distribution of recorded heart rate in beats per minute.",
            "title": "Recorded heart-rate distribution",
            "caption": "One person's values illustrate context rather than normal ranges.",
            "methods": "Counts use selected source records and matching interval context.",
            "width": 1200, "height": 720,
        }
        entry = copy.deepcopy(self.entry)
        entry["figures"] = [figure]
        self.assertTrue(self.validate(entry)[0])
        for key in ["width", "height"]:
            for value in [0, -1, 1.5, "1200"]:
                with self.subTest(key=key, value=value):
                    entry["figures"] = [dict(figure, **{key: value})]
                    self.assertFalse(self.validate(entry)[0])

    def test_duplicate_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "entry.yaml"
            path.write_text("identifier: first\nidentifier: second\n")
            valid, error = validation.validate_file(path, self.schema)
            self.assertFalse(valid)
            self.assertIn("duplicate key", error)

    def test_duplicate_category_values_are_rejected(self):
        entry = validation.load_entry(BASE / "category_types/activity_heart/sleep_analysis.yaml")
        entry["category_values"].append(copy.deepcopy(entry["category_values"][0]))
        self.assertFalse(self.validate(entry)[0])

    def test_worktree_git_parent_does_not_hide_corpus(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / ".git" / "wt-checkouts" / "task" / "knowledge-base"
            base.mkdir(parents=True)
            entry = base / "entry.yaml"
            entry.write_text("identifier: example\n")
            excluded = base / "node_modules"
            excluded.mkdir()
            (excluded / "dependency.yaml").write_text("ignored: true\n")
            self.assertEqual(validation.find_yaml_files(base), [entry])

    def test_entire_corpus_has_unique_identifiers_and_valid_content(self):
        entries = {}
        for path in validation.find_yaml_files(BASE):
            with self.subTest(path=path):
                valid, error = validation.validate_file(path, self.schema)
                self.assertTrue(valid, error)
                identifier = validation.load_entry(path)["identifier"]
                self.assertNotIn(identifier, entries)
                entries[identifier] = path
        self.assertGreater(len(entries), 0)
