#!/usr/bin/env python3
"""Preserve analysis code, portable executed notebooks and private HTML views.

Run only on a private research directory. It contains health data; never serve
this directory from the public website. The archived code makes evidence
independent of temporary task checkout paths.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter


STATIC_CSP = (
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; "
    "img-src data:; font-src data:; base-uri 'none'; form-action 'none'"
)


def static_document(body):
    """Keep a private HTML view readable without scripts or network resources."""
    body = re.sub(r'<script\b[^>]*>.*?</script\s*>', '', body,
                  flags=re.IGNORECASE | re.DOTALL)
    # nbconvert embeds its styles. Remove resource hints/stylesheets/icons so a
    # static private report cannot automatically fetch a remote asset.
    body = re.sub(r'<link\b[^>]*>', '', body, flags=re.IGNORECASE)
    policy = ('<meta http-equiv="Content-Security-Policy" content="' +
              html.escape(STATIC_CSP, quote=True) + '">')
    body, count = re.subn(r'(<head\b[^>]*>)', lambda match: match.group(1) + policy,
                         body, count=1, flags=re.IGNORECASE)
    if not count:
        body = '<!doctype html><html><head>' + policy + '</head><body>' + body + '</body></html>'
    return body


def render_static_notebook(notebook):
    """Render already-executed text and embedded figures; never execute cells."""
    exporter = HTMLExporter(template_name='lab', require_js_url='', mathjax_url='',
                            jquery_url='', mermaid_js_url='',
                            jupyter_widgets_base_url='', widget_renderer_url='')
    body, _ = exporter.from_notebook_node(notebook)
    return static_document(body)


def archive(root, execute=False, only=None):
    root = Path(root).resolve()
    source = Path(__file__).resolve().parent
    notebooks = sorted(root.glob('*/*.ipynb'))
    if not notebooks:
        raise ValueError('No private notebooks found')
    code = root / 'code'
    code.mkdir(exist_ok=True)
    hashes = {}
    for path in sorted(source.iterdir()):
        if path.suffix not in ('.py', '.txt', '.md'):
            continue
        target = code / path.name
        shutil.copy2(path, target)
        hashes[path.name] = hashlib.sha256(target.read_bytes()).hexdigest()
    receipts = []
    links = []
    for path in notebooks:
        notebook = nbformat.read(path, as_version=4)
        for cell in notebook.cells:
            if cell.cell_type != 'code':
                continue
            cell.source = cell.source.replace(str(source), str(code))
            # Re-running research must not overwrite public editorial assets.
            public_prefix = str(source.parents[1] / 'site/public/knowledge-base/figures')
            figure_root = root / 'regenerated-figures' if path.parent.name == 'heart-rate' else root
            cell.source = cell.source.replace(public_prefix, str(figure_root))
        if execute and (only is None or path.parent.name in only):
            NotebookClient(notebook, timeout=900, kernel_name='python3').execute()
        cells = [cell for cell in notebook.cells if cell.cell_type == 'code']
        errors = [output for cell in cells for output in cell.outputs if output.output_type == 'error']
        if errors or any(cell.execution_count is None for cell in cells):
            raise ValueError(f'{path.parent.name}: unexecuted cells or notebook errors')
        nbformat.write(notebook, path)
        body = render_static_notebook(notebook)
        view = path.with_suffix('.html')
        view.write_text(body)
        images = sum('image/png' in output.get('data', {}) for cell in cells for output in cell.outputs)
        receipt = {'artifact_key': path.parent.name, 'notebook': str(path.relative_to(root)),
                   'executed_code_cells': len(cells), 'error_outputs': len(errors),
                   'embedded_figures': images, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        receipts.append(receipt)
        key = html.escape(path.parent.name.replace('-', ' ').title())
        links.append(f'<li><a href="{html.escape(str(view.relative_to(root)))}">{key}: readable research</a> '
                     f'(<a href="{html.escape(str(path.relative_to(root)))}">notebook</a>) '
                     f'— {len(cells)} executed cells, {images} embedded figures</li>')
        print(f'{path.parent.name}: archived, {len(cells)} executed cells, {images} embedded figures', flush=True)
    (root / 'archive-manifest.json').write_text(json.dumps({'code_sha256': hashes, 'notebooks': receipts}, indent=2) + '\n')
    (root / 'index.html').write_text(static_document('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<title>Private HealthKit research</title><style>body{font:17px/1.6 system-ui;max-width:850px;margin:48px auto;padding:0 24px}li{margin:16px 0}a{color:#245bac}</style>'
        '</head><body>'
        '<h1>Private HealthKit research</h1><p>Executed analysis, original findings and figures. '
        'Personal health data: this index and linked notebooks remain private.</p><ul>' + ''.join(links) + '</ul>'
        '<p>Original CSV inputs and exact extraction queries: input/. Code snapshot: code/. '
        'Integrity receipts: input/manifest.json and archive-manifest.json. '
        'Public excerpts are observational cases, not population reference intervals.</p></body></html>'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--execute', action='store_true', help='rerun each notebook using the archived code')
    parser.add_argument('--only', nargs='+', help='execute only these artifact keys while preserving passing evidence for the others')
    args = parser.parse_args()
    archive(args.root, args.execute, args.only)
