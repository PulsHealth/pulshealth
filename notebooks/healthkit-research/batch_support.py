"""Per-entry evidence reports and bounded shared-kernel notebook execution.

Reads immutable private CSV snapshots only. Nothing here connects to a database,
creates clinical reference ranges, or publishes personal records.
"""
from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path

import numpy as np
import pandas as pd

from common import (YEAR_START, YEAR_END, TIME_ZONE, annotate_context, cadence,
                    describe, input_manifest, load_data, overlap_mask, standard_analysis,
                    timestamp, write_notebook)

FACETS = ('provenance', 'coverage', 'sources', 'values', 'outliers', 'cadence',
          'workout_context', 'sleep_context', 'time_patterns', 'related_types',
          'type_specific')


def clean_json(value):
    if isinstance(value, dict):
        return {str(k): clean_json(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [clean_json(v) for v in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


@lru_cache(maxsize=2)
def load_snapshot(input_dir):
    """Read once per group/kernel; callers must not mutate cached frames."""
    root = Path(input_dir).resolve()
    data = load_data(root)
    for name in ('category', 'characteristics', 'activity_summaries', 'heartbeat_series', 'ecg_samples', 'sample_types', 'category_labels', 'schema_columns'):
        path = root / f'{name}.csv'
        if path.exists():
            try:
                frame = pd.read_csv(path, low_memory=False)
            except pd.errors.EmptyDataError:
                frame = pd.DataFrame()
            for column in ('start_ts', 'end_ts'):
                if column in frame:
                    frame[column] = timestamp(frame[column])
            if 'value' in frame and name == 'category':
                frame['value'] = pd.to_numeric(frame.value, errors='coerce')
            data[name] = frame
        else:
            data[name] = pd.DataFrame()
    coverage_path = root / 'coverage.json'
    data['_coverage'] = json.loads(coverage_path.read_text()) if coverage_path.exists() else {}
    data['_input_dir'] = str(root)
    data['_manifest'] = input_manifest(root)
    return data


def select_rows(data, identifier, kind='quantity'):
    table = {'quantity': 'quantity', 'category': 'category',
             'characteristic': 'characteristics'}.get(kind)
    frame = data.get(table, pd.DataFrame()) if table else pd.DataFrame()
    if 'identifier' not in frame:
        return pd.DataFrame()
    rows = frame[frame.identifier == identifier].copy()
    if 'start_ts' in rows:
        rows = rows[(rows.start_ts >= YEAR_START) & (rows.start_ts < YEAR_END)]
    return rows


def quality_audit(rows, data):
    """Candidate duplicate/overlap evidence; retain every original record.

    Matching content and interval overlap do not prove duplicate measurements.
    Source revisions are provenance groups, not permanent device identities.
    """
    if rows.empty:
        return {'records': 0}
    frame = annotate_context(rows, data)
    uuid = frame.get('uuid', pd.Series(index=frame.index, dtype='object'))
    columns = [c for c in ('start_ts', 'end_ts', 'value', 'unit') if c in frame]
    same_content = frame.duplicated(columns, keep=False)
    content_groups = frame.groupby(columns, dropna=False)['source_group'].nunique()
    cross_source_contents = content_groups[content_groups > 1]
    overlap = np.zeros(len(frame), dtype=bool)
    groups = list(frame.groupby('source_group'))
    for source, selected in groups:
        others = frame[frame.source_group != source]
        if not others.empty:
            positions = frame.index.get_indexer(selected.index)
            overlap[positions] = overlap_mask(selected, others)
    finite = pd.to_numeric(frame.value, errors='coerce')
    return {'records': len(frame), 'repeated_uuid_rows': int(uuid.notna().mul(uuid.duplicated(keep=False)).sum()),
            'missing_uuid_rows': int(uuid.isna().sum()),
            'identical_content_candidate_rows': int(same_content.sum()),
            'identical_content_cross_source_groups': len(cross_source_contents),
            'cross_source_interval_overlap_candidate_rows': int(overlap.sum()),
            'nonfinite_value_rows': int((~np.isfinite(finite)).sum()),
            'missing_start_rows': int(frame.start_ts.isna().sum()),
            'missing_end_rows': int(frame.end_ts.isna().sum()),
            'negative_duration_rows': int((frame.end_ts < frame.start_ts).sum()),
            'units': frame.unit.fillna('<missing>').value_counts().to_dict() if 'unit' in frame else {},
            'note': 'Counts are candidate checks, not deletions, clinical invalidity or inferred device identities. Point observations at the same instant may match content but are not positive interval overlap.'}


def _facet(status, reason, evidence=None):
    result = {'status': status, 'reason': reason}
    if evidence is not None:
        result['evidence'] = evidence
    return result


def research_report(data, identifier, *, kind='quantity', special_analysis=None,
                    related_identifiers=(), references=()):
    """Eleven common facets, with absent/unsupported/sparse evidence explicit.

    Category codes are counts, never numeric averages or clinical outliers.
    Correlations require storage/link evidence; components alone cannot prove
    HealthKit correlation pairing. Related quantities use source-specific daily
    medians and are exploratory rather than causal.
    """
    rows = select_rows(data, identifier, kind)
    n = len(rows)
    observed = 'sparse' if 0 < n < 10 else 'measured'
    unsupported = kind not in ('quantity', 'category', 'characteristic')
    table = {'quantity': 'quantity', 'category': 'category', 'characteristic': 'characteristics'}.get(kind)
    available = table is not None and bool(data.get('_input_dir')) and any(
        (Path(data['_input_dir']) / f'{table}{suffix}').exists() for suffix in ('.csv', '.csv.gz'))
    absent_status = 'unsupported' if unsupported or not available else 'absent'
    reason = ('No exported storage table supports this kind; component rows do not establish correlation linkage.'
              if unsupported else 'No records in the selected reporting window.' if available
              else 'Required snapshot table was not exported; absence of data is not verified.')
    facets = {name: _facet(absent_status, reason) for name in FACETS}
    facets['provenance'] = _facet('measured', 'Private immutable snapshot; source files and analysis bounds retained.', {
        'manifest': data.get('_manifest', []), 'window': [YEAR_START.isoformat(), YEAR_END.isoformat()],
        'timezone': TIME_ZONE, 'kind': kind})
    coverage_entry = next((entry for entry in data.get('_coverage', {}).get('entries', [])
                           if entry.get('identifier') == identifier), None)
    if coverage_entry and table:
        storage_table = {'quantity': 'quantity_samples', 'category': 'category_samples'}.get(kind)
        declared = coverage_entry.get('tables', {}).get(storage_table, {}).get('records')
        if declared is not None and n != declared:
            raise ValueError(f'{identifier}: snapshot rows {n} disagree with verified database count {declared}')
    facets['coverage'] = _facet('unsupported' if unsupported or not available else observed if n else 'absent',
                               reason if not n else 'Start-selected records; unrecorded days are missing, not zero.',
                               {'records': n})
    report = {'identifier': identifier, 'kind': kind, 'facets': facets,
              'database_coverage': coverage_entry,
              'references': list(references), 'limitations': [
                  'Example observational data are not population reference ranges.',
                  'Missing observations do not establish zero values, non-wear or absence of symptoms.',
                  'Temporal overlap does not establish a causal or explicit HealthKit association.',
                  'Start-selected extraction can omit context intervals beginning before the boundary.']}
    if n and kind == 'quantity':
        standard = standard_analysis(data, identifier)
        report['standard_analysis'] = standard
        report['quality_audit'] = quality_audit(rows, data)
        mapping = {'coverage': ['year', 'focus'], 'sources': ['source_revisions', 'units'],
                   'values': ['year', 'focus'], 'outliers': ['invalid_timestamps', 'by_source_context'],
                   'cadence': ['source_revisions'], 'workout_context': ['by_source_context'],
                   'sleep_context': ['by_source_context'], 'time_patterns': ['monthly', 'local_hour_record_counts']}
        for name, keys in mapping.items():
            facets[name] = _facet(observed, 'Source-aware descriptive evidence; inspect denominator and limitations.',
                                 {key: standard.get(key) for key in keys})
    elif n and kind == 'category':
        annotated = annotate_context(rows, data)
        report['quality_audit'] = quality_audit(rows, data)
        counts = {str(k): int(v) for k, v in rows.value.value_counts(dropna=False).items()}
        facets['sources'] = _facet(observed, 'Source grouping does not identify a permanent device.',
                                  annotated.groupby('source_group').size().to_dict())
        facets['values'] = _facet(observed, 'Categorical code frequencies; codes are not a continuous scale.', counts)
        facets['sources']['evidence'] = {'source_records': facets['sources']['evidence'], 'quality_audit': report['quality_audit']}
        facets['outliers'] = _facet('not_applicable', 'Clinical numeric outlier methods do not apply to category codes; review allowed values in type-specific analysis.')
        facets['cadence'] = _facet(observed, 'Intervals between recorded category entries are logging cadence, not occurrence rates.',
                                  {str(s): cadence(g) for s, g in annotated.groupby('source_group')})
        for facet, flag in [('workout_context', 'workout_overlap'), ('sleep_context', 'sleep_overlap')]:
            facets[facet] = _facet(observed, 'Temporal overlap only; no recording opportunity denominator is available.',
                                   {'records': n, 'overlapping_records': int(annotated[flag].sum())})
        facets['time_patterns'] = _facet(observed, 'Counts reflect recorded entries; no entries is not zero events.',
                                        annotated.groupby('local_month').size().to_dict())
        facets['coverage']['evidence']['days_with_records'] = int(annotated.local_day.nunique())
    elif n and kind == 'characteristic':
        facets['sources'] = _facet(observed, 'Exported characteristic provenance.', rows.to_dict(orient='records'))
        facets['values'] = _facet(observed, 'Characteristic availability, not a physiological time series.', rows.to_dict(orient='records'))
        for name in ('outliers', 'cadence', 'workout_context', 'sleep_context', 'time_patterns'):
            facets[name] = _facet('not_applicable', 'A characteristic has no observation interval for this analysis.')
    aggregate = data.get('aggregates', pd.DataFrame())
    if 'identifier' in aggregate:
        agg = aggregate[aggregate.identifier == identifier].copy()
        report['aggregate_evidence'] = {'records': len(agg), 'note': 'Aggregate rows cannot recover raw ranges, outliers, cadence or explicit linkage.'}
        if len(agg):
            report['aggregate_evidence']['columns'] = list(agg.columns)
            report['aggregate_evidence']['examples'] = agg.head(12).to_dict(orient='records')
    related = []
    if n and kind == 'quantity':
        primary = annotate_context(rows, data)
        for other_id in related_identifiers:
            other = select_rows(data, other_id)
            if other.empty:
                related.append({'identifier': other_id, 'status': 'absent', 'paired_days': 0})
                continue
            other = annotate_context(other, data)
            for source_a, a in primary.groupby('source_group'):
                for source_b, b in other.groupby('source_group'):
                    pairs = pd.concat([a.groupby('local_day').value.median().rename('a'),
                                       b.groupby('local_day').value.median().rename('b')], axis=1).dropna()
                    # Boundary day can omit sleep/workout intervals; pairing is all-day only.
                    related.append({'identifier': other_id, 'primary_source': source_a, 'related_source': source_b,
                                    'paired_days': len(pairs), 'status': ('absent' if pairs.empty else 'constant' if pairs.a.nunique() < 2 or pairs.b.nunique() < 2 else 'measured' if len(pairs) >= 10 else 'sparse'),
                                    'spearman_daily_medians': pairs.corr(method='spearman').iloc[0, 1] if len(pairs) >= 10 and pairs.a.nunique() >= 2 and pairs.b.nunique() >= 2 else None})
        relation_status = ('measured' if any(item['status'] == 'measured' for item in related) else
                           'sparse' if any(item['status'] == 'sparse' for item in related) else
                           'not_applicable' if not related else 'unsupported' if any(item['status'] == 'constant' for item in related) else 'absent')
        facets['related_types'] = _facet(relation_status,
                                        'Exploratory source-paired reporting-day medians; no causality or adjusted relationship.', related)
    if n and 'quality_audit' in report:
        facets['sources']['quality_audit'] = report['quality_audit']
    if isinstance(special_analysis, dict) and 'related_types' in special_analysis:
        related_evidence = special_analysis['related_types']
        facets['related_types'] = _facet(
            observed if n else absent_status,
            'Type-specific relationship investigation; inspect each denominator and support status.',
            related_evidence)
    if special_analysis:
        facets['type_specific'] = _facet('measured' if n else absent_status,
                                        'Type-specific questions evaluated; inspect explicit support for each result.', special_analysis)
    else:
        facets['type_specific'] = _facet('unsupported', 'No type-specific analysis was supplied; editorial completion must wait.')
    return clean_json(report)


def persist_research(report, output_dir, title, *, input_dir, special_code='None',
                     related_identifiers=(), references=(), setup_code='', figures=()):
    """Write reproducible notebook and provisional findings; execute before editing.

    special_code is an executable expression; setup_code can import the family's
    public analysis function. No results are trusted from the provisional JSON.
    execute_notebooks recomputes the report and saves its executed outputs.
    """
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    script_dir = Path(__file__).resolve().parent
    code = (f'import sys\nsys.path.insert(0, {str(script_dir)!r})\n'
            'from batch_support import load_snapshot, research_report, clean_json\nimport json\nfrom pathlib import Path\n'
            f'data = load_snapshot({str(Path(input_dir).resolve())!r})\n' + setup_code + '\n'
            f'report = research_report(data, {report["identifier"]!r}, kind={report["kind"]!r}, '
            f'special_analysis={special_code}, related_identifiers={tuple(related_identifiers)!r}, references={list(references)!r})\n'
            f'Path({str(output / "findings.json")!r}).write_text(json.dumps(report, indent=2, allow_nan=False, default=str))\n'
            'print(json.dumps(report, indent=2, allow_nan=False, default=str))')
    sections = [{'heading': 'Reproducible eleven-facet investigation', 'code': code},
                {'heading': 'Observed example figures', 'figures': list(figures)}]
    path = output / 'research.ipynb'
    write_notebook(path, title, sections)
    return path


def execute_notebooks(paths, *, timeout=900):
    """Execute independent reports in one kernel, then persist each with HTML.

    Repeated load_snapshot calls share the cache. Each saved notebook also runs
    independently from its setup cell. Any error aborts completion marking.
    """
    import nbformat
    from nbclient import NotebookClient
    from archive import render_static_notebook
    notebooks = [(Path(p), nbformat.read(p, as_version=4)) for p in paths]
    cells, spans = [], []
    for path, notebook in notebooks:
        start = len(cells)
        cells.extend(notebook.cells)
        spans.append((start, len(cells)))
    combined = nbformat.v4.new_notebook(cells=cells)
    NotebookClient(combined, timeout=timeout, kernel_name='python3').execute()
    for (path, notebook), (start, end) in zip(notebooks, spans):
        notebook.cells = combined.cells[start:end]
        notebook.metadata['research_execution'] = {'status': 'executed', 'shared_kernel': True}
        nbformat.write(notebook, path)
        path.with_suffix('.html').write_text(render_static_notebook(notebook))
    return [str(path) for path, _ in notebooks]
