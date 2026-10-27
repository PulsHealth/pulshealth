"""IndexNow contracts; no real service requests or deployment mutations."""
import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import site_indexnow as indexnow


class Response(BytesIO):
    def __init__(self, status):
        super().__init__(b'')
        self.status = status


class IndexNowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.out = self.root / 'out'
        self.out.mkdir()
        self.state = self.root / 'private/state.json'
        (self.out / indexnow.KEY_FILE).write_text('public-verification-key')
        self.pages({'/': 'Hello', '/docs/setup/': 'Setup'})

    def pages(self, pages):
        entries = []
        for path, text in pages.items():
            url = indexnow.ORIGIN + path
            file = self.out / indexnow.page_path(url)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(f'<title>{text}</title><main><h1>{text}</h1></main>')
            entries.append(f'<url><loc>{url}</loc></url>')
        (self.out / 'sitemap.xml').write_text('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join(entries)+'</urlset>')

    def test_semantic_changes_ignore_build_noise(self):
        before = '<title>Hello</title><link href="old.css"><main class="old"><h1>Hello</h1><a href="/a/">Read</a></main><script>build1</script><footer>Chrome</footer>'
        after = before.replace('old', 'new').replace('build1', 'build2').replace('Chrome', 'Other chrome')
        self.assertEqual(indexnow.content_hash(before), indexnow.content_hash(after))
        for changed in [after.replace('Hello', 'Goodbye'), after.replace('/a/', '/b/'), after+'<meta name="description" content="Description">', after+'<script type="application/ld+json">{"name":"Product"}</script>']:
            self.assertNotEqual(indexnow.content_hash(before), indexnow.content_hash(changed))

    def test_baseline_and_unchanged_publish_never_send(self):
        with patch.object(indexnow, 'urlopen') as send:
            self.assertEqual(indexnow.notify(self.out, self.state)['status'], 'baseline-initialized')
            self.assertEqual(indexnow.notify(self.out, self.state)['status'], 'unchanged')
            send.assert_not_called()

    def test_only_changed_added_and_removed_public_urls_are_sent(self):
        indexnow.notify(self.out, self.state)
        self.pages({'/': 'Hello', '/new/': 'New'})
        with patch.object(indexnow, 'urlopen', return_value=Response(200)) as send:
            result = indexnow.notify(self.out, self.state)
        self.assertEqual(result['status'], 'accepted')
        request = send.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload['urlList'], [indexnow.ORIGIN+'/docs/setup/', indexnow.ORIGIN+'/new/'])
        self.assertEqual(payload['keyLocation'], indexnow.ORIGIN+'/'+indexnow.KEY_FILE)
        self.assertEqual(request.full_url, indexnow.ENDPOINT)
        self.assertEqual(send.call_args.kwargs['timeout'], 20)
        self.assertEqual(indexnow.notify(self.out, self.state)['status'], 'unchanged')

    def test_failed_bootstrap_retries_on_normal_publish(self):
        with patch.object(indexnow, 'urlopen', side_effect=HTTPError(indexnow.ENDPOINT,429,'rate limited',{},None)) as send:
            result = indexnow.notify(self.out, self.state, bootstrap=True)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['http_status'], 429)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(json.loads(self.state.read_text())['pages'], {})
        with patch.object(indexnow, 'urlopen', return_value=Response(202)):
            result = indexnow.notify(self.out, self.state)
        self.assertEqual(result['status'], 'accepted-pending-verification')
        self.assertEqual(len(result['urls']), 2)

    def test_bad_key_bootstrap_can_retry_after_key_fix_without_bootstrap_flag(self):
        (self.out / indexnow.KEY_FILE).write_text('bad')
        with patch.object(indexnow, 'urlopen') as send:
            self.assertEqual(indexnow.notify(self.out,self.state,bootstrap=True)['status'], 'failed')
            send.assert_not_called()
        (self.out / indexnow.KEY_FILE).write_text('correct-public-key')
        with patch.object(indexnow, 'urlopen', return_value=Response(200)) as send:
            result = indexnow.notify(self.out,self.state)
        self.assertEqual(result['status'], 'accepted')
        self.assertEqual(len(json.loads(send.call_args.args[0].data)['urlList']), 2)

    def test_failures_keep_last_accepted_fingerprints(self):
        indexnow.notify(self.out, self.state)
        saved = self.state.read_bytes()
        self.pages({'/': 'Updated', '/docs/setup/': 'Setup'})
        for error in [TimeoutError(), HTTPError(indexnow.ENDPOINT,403,'forbidden',{},None)]:
            with patch.object(indexnow, 'urlopen', side_effect=error):
                self.assertEqual(indexnow.notify(self.out, self.state)['status'], 'failed')
            self.assertEqual(self.state.read_bytes(), saved)

    def test_chunks_respect_service_limit(self):
        with patch.object(indexnow, 'MAX_URLS', 1), patch.object(indexnow, 'urlopen', side_effect=[Response(200),Response(200)]) as send:
            result = indexnow.notify(self.out, self.state, bootstrap=True)
        self.assertEqual(send.call_count, 2)
        self.assertEqual([b['count'] for b in result['batches']], [1,1])

    def test_partial_failure_checkpoints_only_acknowledged_urls(self):
        with patch.object(indexnow, 'MAX_URLS', 1), patch.object(indexnow, 'urlopen', side_effect=[Response(200),TimeoutError()]):
            result = indexnow.notify(self.out, self.state, bootstrap=True)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(list(json.loads(self.state.read_text())['pages']), [indexnow.ORIGIN+'/'])
        with patch.object(indexnow, 'urlopen', return_value=Response(200)) as send:
            result = indexnow.notify(self.out, self.state)
        self.assertEqual(json.loads(send.call_args.args[0].data)['urlList'], [indexnow.ORIGIN+'/docs/setup/'])
        self.assertEqual(result['status'], 'accepted')

    def test_reject_foreign_noncanonical_and_traversal_urls(self):
        for url in ['http://pulshealth.com/', 'https://other.invalid/', 'https://pulshealth.com:443/', 'https://pulshealth.com/../', 'https://pulshealth.com/%2e%2e/', 'https://pulshealth.com/?token=x', 'https://pulshealth.com/docs', 'https://pulshealth.com/#anchor']:
            with self.assertRaises(ValueError):
                indexnow.page_path(url)
        (self.out/'sitemap.xml').write_text('<urlset><url><loc>https://other.invalid/</loc></url></urlset>')
        with patch.object(indexnow, 'urlopen') as send:
            self.assertEqual(indexnow.notify(self.out,self.state,bootstrap=True)['status'],'failed')
            send.assert_not_called()

    def test_invalid_state_never_triggers_mass_resubmission(self):
        self.state.parent.mkdir()
        self.state.write_text('{"schema":99}')
        with patch.object(indexnow, 'urlopen') as send:
            self.assertEqual(indexnow.notify(self.out,self.state,bootstrap=True)['status'],'failed')
            send.assert_not_called()
        self.assertEqual(self.state.read_text(), '{"schema":99}')


if __name__ == '__main__':
    unittest.main()
