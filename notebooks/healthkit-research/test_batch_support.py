"""Evidence boundaries for quantities, category events and missing storage."""
import html
import gzip
import json
from pathlib import Path
import tempfile
import unittest

import nbformat
import pandas as pd

from batch_support import (FACETS, execute_notebooks, persist_research,
                           research_report, quality_audit)


class BatchEvidenceTests(unittest.TestCase):
    def test_compressed_export_is_available_for_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            data = self.fixture(directory)
            plain = Path(directory) / 'quantity.csv'
            with gzip.open(Path(directory) / 'quantity.csv.gz', 'wt') as handle:
                handle.write(plain.read_text())
            plain.unlink()
            report = research_report(data, 'example', special_analysis={'semantics': 'quantity'})
            self.assertEqual(report['facets']['values']['status'], 'sparse')
            self.assertEqual(report['facets']['coverage']['status'], 'sparse')

    def fixture(self, directory, kind='quantity'):
        path = Path(directory) / f'{kind}.csv'
        path.write_text('identifier,start_ts,end_ts,value,source_name,bundle_id,unit\n')
        frame = pd.DataFrame({'identifier': ['example'] * 3,
                              'start_ts': pd.to_datetime(['2026-07-01T12:00Z', '2026-07-01T13:00Z', '2026-07-02T12:00Z']),
                              'end_ts': pd.to_datetime(['2026-07-01T12:00Z', '2026-07-01T13:00Z', '2026-07-02T12:00Z']),
                              'value': [0, 1, 1], 'source_name': ['Device'] * 3,
                              'bundle_id': ['bundle'] * 3, 'unit': ['count'] * 3})
        return {kind: frame, '_input_dir': directory}

    def test_categories_keep_codes_not_numeric_ranges(self):
        with tempfile.TemporaryDirectory() as directory:
            report = research_report(self.fixture(directory, 'category'), 'example', kind='category',
                                     special_analysis={'allowed_codes': [0, 1], 'related_types': []})
            self.assertEqual(set(report['facets']), set(FACETS))
            self.assertEqual(report['facets']['values']['evidence'], {'1': 2, '0': 1})
            self.assertEqual(report['facets']['outliers']['status'], 'not_applicable')
            self.assertEqual(report['facets']['related_types']['status'], 'sparse')
            self.assertEqual(report['facets']['coverage']['evidence']['days_with_records'], 2)

    def test_absent_raw_preserves_aggregate_only_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            data = self.fixture(directory)
            data['aggregates'] = pd.DataFrame({'identifier': ['missing'], 'value': [200]})
            report = research_report(data, 'missing', special_analysis={'raw_cadence': 'unavailable'})
            self.assertEqual(report['facets']['values']['status'], 'absent')
            self.assertEqual(report['aggregate_evidence']['records'], 1)
            self.assertNotIn('p50', report['facets']['values'])

    def test_correlation_components_do_not_establish_pairing(self):
        with tempfile.TemporaryDirectory() as directory:
            report = research_report(self.fixture(directory), 'example', kind='correlation')
            self.assertEqual(report['facets']['coverage']['status'], 'unsupported')
            self.assertEqual(report['facets']['coverage']['evidence']['records'], 0)

    def test_missing_export_is_unsupported_not_verified_absence(self):
        with tempfile.TemporaryDirectory() as directory:
            report = research_report({'_input_dir': directory}, 'missing')
            self.assertEqual(report['facets']['values']['status'], 'unsupported')

    def test_matching_content_and_cross_source_overlap_are_only_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            data = self.fixture(directory)
            rows = data['quantity'].iloc[[0, 0]].copy().reset_index(drop=True)
            rows['uuid'] = ['retained', 'retained']
            rows['source_name'] = ['Device A', 'Device B']
            rows['end_ts'] = rows.start_ts + pd.Timedelta(minutes=1)
            result = quality_audit(rows, data)
            self.assertEqual(result['repeated_uuid_rows'], 2)
            self.assertEqual(result['identical_content_candidate_rows'], 2)
            self.assertEqual(result['identical_content_cross_source_groups'], 1)
            self.assertEqual(result['cross_source_interval_overlap_candidate_rows'], 2)
            self.assertEqual(len(rows), 2)

    def test_reports_execute_before_completion_and_reuse_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = root / 'input'
            inputs.mkdir()
            (inputs / 'quantity.csv').write_text('identifier,start_ts,end_ts,value\n')
            reports = []
            for identifier in ['first', 'second']:
                report = research_report({'_input_dir': str(inputs)}, identifier, special_analysis={})
                reports.append(persist_research(report, root / identifier, identifier,
                                               input_dir=inputs, special_code='{}'))
            execute_notebooks(reports, timeout=60)
            for path in reports:
                notebook = nbformat.read(path, as_version=4)
                codes = [c for c in notebook.cells if c.cell_type == 'code']
                self.assertTrue(all(c.execution_count is not None for c in codes))
                self.assertTrue(codes[0].outputs)
                self.assertEqual(json.loads(path.with_name('findings.json').read_text())['identifier'], path.parent.name)
                self.assertIn("script-src 'none'", html.unescape(path.with_suffix('.html').read_text()))


if __name__ == '__main__':
    unittest.main()
