"""Private static evidence views retain outputs without external autoloads."""
import unittest
from html.parser import HTMLParser

import nbformat

from archive import render_static_notebook, static_document


class Resources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class StaticArchiveTests(unittest.TestCase):
    def test_render_preserves_executed_outputs_and_blocks_autoloads(self):
        png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBfkAAAAASUVORK5CYII='
        notebook = nbformat.v4.new_notebook(cells=[
            nbformat.v4.new_markdown_cell('[Method reference](https://example.org/method)'),
            nbformat.v4.new_code_cell('print("observed-record-count: 42")', execution_count=1, outputs=[
                nbformat.v4.new_output('stream', name='stdout', text='observed-record-count: 42\n'),
                nbformat.v4.new_output('display_data', data={'image/png': png})])])
        body = render_static_notebook(notebook)
        parsed = Resources()
        parsed.feed(body)
        self.assertNotIn('script', [tag for tag, _ in parsed.tags])
        self.assertNotIn('link', [tag for tag, _ in parsed.tags])
        self.assertIn('observed-record-count: 42', body)
        self.assertTrue(any(tag == 'img' and attrs.get('src') == 'data:image/png;base64,' + png
                            for tag, attrs in parsed.tags))
        self.assertTrue(any(tag == 'a' and attrs.get('href') == 'https://example.org/method'
                            for tag, attrs in parsed.tags))
        policies = [attrs['content'] for tag, attrs in parsed.tags
                    if tag == 'meta' and attrs.get('http-equiv') == 'Content-Security-Policy']
        self.assertEqual(len(policies), 1)
        self.assertIn("default-src 'none'", policies[0])
        self.assertIn("img-src data:", policies[0])
        self.assertIn("font-src data:", policies[0])
        self.assertNotIn('cdnjs.cloudflare.com', body)

    def test_removes_scripts_and_resource_hints_without_removing_links(self):
        body = static_document('<html><head><script src="https://example.org/a.js"></script>'
            '<script>fetch("https://example.org/data")</script>'
            '<link rel="preconnect" href="https://example.org"></head><body>'
            '<a href="report.ipynb">Notebook</a><p>Evidence</p></body></html>')
        parsed = Resources()
        parsed.feed(body)
        self.assertNotIn('script', [tag for tag, _ in parsed.tags])
        self.assertNotIn('link', [tag for tag, _ in parsed.tags])
        self.assertIn('Notebook', body)
        self.assertIn('Evidence', body)


if __name__ == '__main__':
    unittest.main()
