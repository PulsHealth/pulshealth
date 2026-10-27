"""Site-only notification ordering and failure isolation in the publisher."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from test_dev_workflow import site


class DeploymentNotifications(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'site/out').mkdir(parents=True)
        (self.root / 'site/out/index.html').write_text('built')

    def manifest(self):
        return {'source_sha': 'fixture', 'inputs_sha256': 'fingerprint', 'files': {'index.html': 'hash'}}

    def test_notifications_follow_verification_and_keep_failure_separate(self):
        record = self.manifest()
        args = SimpleNamespace(dry_run=False, no_invalidation=False, verify_path=[], indexnow_bootstrap=True)
        order = []
        with patch.object(site, 'git', return_value='head'), patch.object(site, 'state_dir', return_value=self.root / '.git/evidence'), patch.object(site.subprocess, 'run'), patch.object(site.subprocess, 'check_output', return_value=b'{"Invalidation":{"Id":"test"}}'), patch.object(site, 'verify_live', side_effect=lambda *a: order.append('verified') or [site.KEY_FILE]), patch.object(site, 'notify', side_effect=lambda *a, **kw: order.append('notified') or {'status': 'failed', 'error': 'TimeoutError'}):
            site.deploy_snapshot(self.root, args, record, self.root / 'site/out')
        receipt = json.loads(next((self.root / '.git/evidence/deployments').glob('*.json')).read_text())
        self.assertEqual(order, ['verified', 'notified'])
        self.assertEqual(receipt['status'], 'verified')
        self.assertEqual(receipt['indexnow']['status'], 'failed')
        self.assertIn(site.KEY_FILE, receipt['verified_files'])

    def test_unverified_upload_and_failed_verification_never_notify(self):
        record = self.manifest()
        args = SimpleNamespace(dry_run=False, no_invalidation=True, verify_path=[])
        with patch.object(site, 'git', return_value='head'), patch.object(site, 'state_dir', return_value=self.root / '.git/evidence'), patch.object(site.subprocess, 'run'), patch.object(site, 'notify') as notify:
            site.deploy_snapshot(self.root, args, record, self.root / 'site/out')
            notify.assert_not_called()
        args.no_invalidation = False
        with patch.object(site, 'git', return_value='head'), patch.object(site, 'state_dir', return_value=self.root / '.git/evidence'), patch.object(site.subprocess, 'run'), patch.object(site.subprocess, 'check_output', return_value=b'{"Invalidation":{"Id":"test"}}'), patch.object(site, 'verify_live', side_effect=RuntimeError('mismatch')), patch.object(site, 'notify') as notify:
            with self.assertRaisesRegex(RuntimeError, 'mismatch'):
                site.deploy_snapshot(self.root, args, record, self.root / 'site/out')
            notify.assert_not_called()


    def test_dry_run_never_notifies(self):
        args = SimpleNamespace(dry_run=True, no_invalidation=False, verify_path=[])
        with patch.object(site.subprocess, 'run'), patch.object(site, 'notify') as notify:
            site.deploy_snapshot(self.root, args, self.manifest(), self.root / 'site/out')
            notify.assert_not_called()


if __name__ == '__main__':
    unittest.main()
