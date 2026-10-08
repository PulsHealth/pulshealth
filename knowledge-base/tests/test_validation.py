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
