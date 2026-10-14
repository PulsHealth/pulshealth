"""Guard the boundary between absence/source review and measured analysis."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import yaml

from coverage_review import FACETS, archive, document, review_entry, verify_inputs


class CoverageReviewTests(unittest.TestCase):
    def fixture(self):
        article = {'identifier': 'example', 'human_readable_name': 'Example',
                   'catalog_support': {'supported': False},
                   'references': [{'title': 'Primary source', 'url': 'https://example.org/definition'}],
                   'data_research': {'status': 'complete', 'review_basis': 'coverage_and_sources',
                                     'facets': list(FACETS), 'artifact_key': 'example', 'reviewed_on': '2026-10-14'}}
        coverage = {'entries': [{'identifier': 'example', 'status': 'no_observations_in_snapshot',
                                'tables': {name: {'records': 0} for name in
                                           ('quantity_samples', 'category_samples', 'aggregate_samples', 'workout_series_points')}}]}
        return article, coverage, {'types': []}

    def test_absence_is_unavailable_not_measured(self):
        article, coverage, catalog = self.fixture()
        result = review_entry(article, coverage, catalog)
        for facet in ('values', 'outliers', 'cadence', 'workout_context', 'sleep_context', 'time_patterns', 'related_types'):
            self.assertEqual(result['facets'][facet]['status'], 'unavailable')
        self.assertFalse(result['sync_catalog']['supported'])
        catalog['types'].append({'identifier': 'example', 'kind': 'quantity'})
        self.assertTrue(review_entry(article, coverage, catalog)['sync_catalog']['supported'])

    def test_any_record_including_aggregate_requires_analysis(self):
        article, coverage, catalog = self.fixture()
        for table in coverage['entries'][0]['tables']:
            observed = copy.deepcopy(coverage)
            observed['entries'][0]['tables'][table]['records'] = 1
            with self.subTest(table=table), self.assertRaisesRegex(ValueError, 'requires analysis'):
                review_entry(article, observed, catalog)
        coverage['entries'][0]['status'] = 'observed'
        with self.assertRaisesRegex(ValueError, 'requires analysis'):
            review_entry(article, coverage, catalog)

    def test_missing_identifier_or_inventory_is_not_absence(self):
        article, coverage, catalog = self.fixture()
        with self.assertRaisesRegex(ValueError, 'missing or duplicated'):
            review_entry(article, {'entries': []}, catalog)
        del coverage['entries'][0]['tables']['aggregate_samples']
        with self.assertRaisesRegex(ValueError, 'incomplete coverage'):
            review_entry(article, coverage, catalog)

    def profile_fixture(self):
        article, coverage, catalog = self.fixture()
        identifier = 'HKCharacteristicTypeIdentifierDateOfBirth'
        article['identifier'] = identifier
        coverage['entries'][0].update(identifier=identifier, kind='characteristic',
            status='profile_value_available', profile={'column': 'dob', 'profiles': 1,
            'values_present': 1, 'value_exported': False,
            'measured_sample_analysis_applicable': False})
        return article, coverage, catalog

    def test_current_profile_availability_has_no_time_series_analysis(self):
        article, coverage, catalog = self.profile_fixture()
        result = review_entry(article, coverage, catalog)
        self.assertEqual(result['review_basis'], 'coverage_and_sources')
        self.assertEqual(result['profile_availability']['status'], 'verified')
        self.assertEqual(set(result['facets']), set(FACETS))
        for facet in ('values', 'outliers', 'cadence', 'workout_context', 'sleep_context', 'time_patterns', 'related_types'):
            self.assertEqual(result['facets'][facet]['status'], 'not_applicable')
        coverage['entries'][0]['status'] = 'unsupported_storage'
        self.assertEqual(review_entry(article, coverage, catalog)['facets']['cadence']['status'], 'not_applicable')

    def test_profile_presence_requires_specific_verified_property_evidence(self):
        article, coverage, catalog = self.profile_fixture()
        for key, value in (('column', 'blood_type'), ('profiles', 0), ('profiles', True),
                           ('values_present', 0), ('values_present', True),
                           ('value_exported', True), ('measured_sample_analysis_applicable', True)):
            invalid = copy.deepcopy(coverage)
            invalid['entries'][0]['profile'][key] = value
            with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, 'profile snapshot'):
                review_entry(article, invalid, catalog)
        for change in ({'kind': 'quantity'}, {'identifier': 'HKCharacteristicTypeIdentifierBloodType'}, {'profile': {}}):
            invalid = copy.deepcopy(coverage)
            invalid['entries'][0].update(change)
            test_article = dict(article, identifier=invalid['entries'][0]['identifier'])
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'profile snapshot'):
                review_entry(test_article, invalid, catalog)
        coverage['entries'][0]['tables']['quantity_samples']['records'] = 1
        with self.assertRaisesRegex(ValueError, 'requires analysis'):
            review_entry(article, coverage, catalog)

    def test_input_tampering_rejects_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory = root / 'coverage.json'
            inventory.write_text('{"entries": []}')
            expected = hashlib.sha256(inventory.read_bytes()).hexdigest()
            (root / 'manifest.json').write_text(json.dumps({'files': {'coverage.json': {'sha256': expected}}}))
            self.assertEqual(verify_inputs(root)[1]['coverage.json'], expected)
            inventory.write_text('{"entries": [{}]}')
            with self.assertRaisesRegex(ValueError, 'integrity failure'):
                verify_inputs(root)

    def test_private_html_cannot_run_scripts_or_load_resources(self):
        rendered = document('Example <entry>', '<p>Safe text</p>')
        self.assertIn("script-src &#x27;none&#x27;", rendered)
        self.assertIn('Example &lt;entry&gt;', rendered)
        self.assertNotIn('<script', rendered)

    def test_archive_binds_final_article_inventory_catalog_and_private_permissions(self):
        article, coverage, catalog = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = root / 'input'
            inputs.mkdir()
            for name, value in (('coverage.json', coverage), ('sync_catalog.json', catalog)):
                (inputs / name).write_text(json.dumps(value))
            hashes = {path.name: {'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                      for path in inputs.iterdir()}
            (inputs / 'manifest.json').write_text(json.dumps({'files': hashes}))
            source = root / 'example.yaml'
            source.write_text(yaml.safe_dump(article))
            output = root / 'archive'
            receipt = archive(root, inputs, output,
                              [{'identifier': 'example', 'path': 'example.yaml'}],
                              inputs / 'sync_catalog.json')
            self.assertEqual(receipt['completed_entries'], 1)
            self.assertEqual(receipt['entries'][0]['article_sha256'],
                             hashlib.sha256(source.read_bytes()).hexdigest())
            report = json.loads((output / 'example' / 'coverage-source-review.json').read_text())
            self.assertEqual(report['coverage_sha256'], hashes['coverage.json']['sha256'])
            self.assertFalse(report['catalog_support']['supported'])
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((output / 'index.html').stat().st_mode & 0o777, 0o600)
            altered = root / 'altered-catalog.json'
            altered.write_text('{"types": [{"identifier": "example"}]}')
            with self.assertRaisesRegex(ValueError, 'immutable input manifest'):
                archive(root, inputs, output,
                        [{'identifier': 'example', 'path': 'example.yaml'}], altered)


if __name__ == '__main__':
    unittest.main()
