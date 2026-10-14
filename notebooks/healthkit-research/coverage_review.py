#!/usr/bin/env python3
"""Archive a coverage and primary-source review when measured data is unavailable.

Required paths are explicit. This reads an immutable private inventory and final
articles; it neither connects to a database nor creates analysis notebooks.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
from pathlib import Path

import yaml

FACETS = ('provenance', 'coverage', 'sources', 'values', 'outliers', 'cadence',
          'workout_context', 'sleep_context', 'time_patterns', 'related_types',
          'type_specific')
CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_inputs(input_dir):
    root = Path(input_dir)
    manifest = json.loads((root / 'manifest.json').read_text())
    files = manifest.get('files', {})
    if 'coverage.json' not in files:
        raise ValueError('Coverage inventory must be included in input manifest')
    verified = {}
    for name, expected in files.items():
        path = root / name
        if path.resolve().parent != root.resolve():
            raise ValueError('Input manifest filename must remain inside input directory')
        actual = digest(path)
        if actual != expected['sha256']:
            raise ValueError(f'Input integrity failure: {name}')
        verified[name] = actual
    return manifest, verified


def review_entry(article, coverage, catalog):
    identifier = article['identifier']
    matches = [entry for entry in coverage['entries'] if entry['identifier'] == identifier]
    if len(matches) != 1:
        raise ValueError(f'{identifier}: missing or duplicated requested coverage')
    entry = matches[0]
    tables = entry.get('tables', {})
    required = {'quantity_samples', 'category_samples', 'aggregate_samples', 'workout_series_points'}
    if not required.issubset(tables):
        raise ValueError(f'{identifier}: incomplete coverage inventory')
    if entry['status'] not in ('no_observations_in_snapshot', 'unsupported_storage') or any(
            table.get('records') != 0 for table in tables.values()):
        raise ValueError(f'{identifier}: measured data requires analysis review')
    research = article.get('data_research', {})
    if research.get('review_basis') != 'coverage_and_sources' or research.get('status') != 'complete':
        raise ValueError(f'{identifier}: final article lacks coverage/source completion metadata')
    if set(research.get('facets', [])) != set(FACETS):
        raise ValueError(f'{identifier}: missing standard facets')
    if article.get('figures'):
        raise ValueError(f'{identifier}: absent coverage cannot support measured figures')
    references = article.get('references', [])
    if not references or any(not ref.get('url', '').startswith('https://') for ref in references):
        raise ValueError(f'{identifier}: source references required')
    catalog_entries = [item for item in catalog['types'] if item['identifier'] == identifier]
    if len(catalog_entries) > 1:
        raise ValueError(f'{identifier}: duplicated catalog identifier')
    support = {'supported': bool(catalog_entries),
               'article_description': article.get('description'),
               'article_limitations': research.get('limitations')}
    # The recorded catalog snapshot is authoritative; retain the exact article
    # support statement as reviewed evidence without inferring support from SQL.
    reason = ('No observations in the bounded example snapshot. Missing records do not establish zero events or intake.'
              if entry['status'] == 'no_observations_in_snapshot' else entry.get('storage_note', 'Storage unsupported.'))
    facets = {name: {'status': 'unavailable', 'reason': reason} for name in FACETS}
    facets['provenance'] = {'status': 'verified', 'reason': 'Immutable extraction and inventory hashes verified.'}
    facets['coverage'] = {'status': entry['status'], 'evidence': entry}
    for name in ('sources', 'type_specific'):
        facets[name] = {'status': 'source_reviewed', 'reason': 'Primary-source documentation reviewed; no measured evidence claimed.',
                        'references': references}
    return {'identifier': identifier, 'name': article['human_readable_name'],
            'artifact_key': research['artifact_key'], 'review_basis': 'coverage_and_sources',
            'status': 'complete', 'reviewed_on': research['reviewed_on'], 'facets': facets,
            'recording_behavior': article.get('recording_behavior'), 'catalog_support': support,
            'sync_catalog': {'supported': bool(catalog_entries), 'entry': catalog_entries[0] if catalog_entries else None},
            'references': references, 'limitations': research.get('limitations')}


def document(title, body):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta http-equiv="Content-Security-Policy" content="' + html.escape(CSP, quote=True) + '">'
            '<title>' + html.escape(title) + '</title><style>body{font:17px/1.6 system-ui;max-width:950px;margin:40px auto;padding:0 24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:10px 0}</style>'
            '</head><body>' + body + '</body></html>')


def archive(repo, input_dir, output_dir, assignments, catalog_path):
    repo, root, output = Path(repo), Path(input_dir), Path(output_dir)
    manifest, hashes = verify_inputs(root)
    coverage = json.loads((root / 'coverage.json').read_text())
    if hashes.get('sync_catalog.json') != digest(catalog_path):
        raise ValueError('Sync catalog must match the immutable input manifest')
    catalog = json.loads(Path(catalog_path).read_text())
    reports = []
    keys = set()
    # Validate every entry before creating completion artifacts.
    for assignment in assignments:
        path = repo / assignment['path']
        article = yaml.safe_load(path.read_text())
        if article['identifier'] != assignment['identifier']:
            raise ValueError('Assigned article identifier mismatch')
        report = review_entry(article, coverage, catalog)
        key = report['artifact_key']
        if not key or key in keys or Path(key).name != key or key in ('.', '..'):
            raise ValueError('Artifact keys must be distinct safe directory names')
        keys.add(key)
        report.update(article_path=assignment['path'], article_sha256=digest(path),
                      input_manifest_sha256=digest(root / 'manifest.json'),
                      coverage_sha256=hashes['coverage.json'], sync_catalog_sha256=digest(catalog_path),
                      snapshot={k: manifest.get(k) for k in ('extracted_at', 'start', 'end_exclusive', 'timezone', 'provenance', 'consistency', 'boundary_note')})
        reports.append(report)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    receipts, links = [], []
    for report in reports:
        directory = output / report['artifact_key']
        directory.mkdir(exist_ok=True, mode=0o700)
        data_path = directory / 'coverage-source-review.json'
        data_path.write_text(json.dumps(report, indent=2) + '\n')
        view_path = directory / 'coverage-source-review.html'
        body = '<h1>' + html.escape(report['name']) + '</h1><p>Coverage and source review. No data analysis was required because measured records were unavailable.</p><pre>' + html.escape(json.dumps(report, indent=2)) + '</pre>'
        view_path.write_text(document(report['name'], body))
        receipts.append({'identifier': report['identifier'], 'artifact_key': report['artifact_key'],
                         'review_basis': report['review_basis'], 'article_sha256': report['article_sha256'],
                         'review_sha256': digest(data_path), 'html_sha256': digest(view_path),
                         'facets': list(report['facets'])})
        links.append('<li><a href="' + html.escape(report['artifact_key'], quote=True) + '/coverage-source-review.html">' + html.escape(report['name']) + '</a></li>')
    verify_inputs(root)
    receipt = {'review_basis': 'coverage_and_sources', 'completed_entries': len(receipts),
               'review_code_sha256': digest(__file__),
               'input_manifest_sha256': digest(root / 'manifest.json'), 'input_sha256': hashes,
               'sync_catalog_sha256': digest(catalog_path), 'entries': receipts,
               'note': 'Completion covers verified database absence or unsupported storage and primary-source editorial review. No measured ranges, cadence or relationships were inferred. Earlier optional notebooks are preserved separately and are not required completion evidence.'}
    (output / 'coverage-source-completion.json').write_text(json.dumps(receipt, indent=2) + '\n')
    optional = ('<p><a href="optional-notebooks.html">Optional prior coverage notebooks</a>: '
                'preserved before the scope change; not required completion evidence.</p>'
                if (output / 'optional-notebooks.html').exists() else '')
    (output / 'index.html').write_text(document('Private HealthKit coverage and source reviews',
        '<h1>Private HealthKit coverage and source reviews</h1><p>' + str(len(receipts)) + ' entries reviewed. No measured analysis required: all requested types lack observations or supported correlation storage in this bounded snapshot.</p><ul>' + ''.join(links) + '</ul><p>Integrity evidence: coverage-source-completion.json. Earlier optional notebooks remain private; this review does not rerun them.</p>' + optional))
    output.chmod(0o700)
    for path in output.rglob('*'):
        if path.is_symlink():
            raise ValueError('Private archive may not contain symbolic links')
        path.chmod(0o700 if path.is_dir() else 0o600)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--assignments', required=True, type=Path)
    parser.add_argument('--batch', required=True, type=int)
    parser.add_argument('--catalog', required=True, type=Path)
    args = parser.parse_args()
    batches = json.loads(args.assignments.read_text())['batches']
    assignment = next(item for item in batches if item['batch'] == args.batch)
    result = archive(args.repo, args.input, args.output, assignment['entries'], args.catalog)
    print(f"Archived {result['completed_entries']} coverage and source reviews")
