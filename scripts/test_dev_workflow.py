"""Failure-path checks for release tooling, without cloud or simulator mutations."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from dev_evidence import fingerprint, write_json


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


REAL_RUN = subprocess.run


def mock_build_commands(command, **kwargs):
    return REAL_RUN(command, **kwargs) if command[0] == 'git' else None


site = module('site-artifact')
ios = module('test-ios')
task = module('task-status')
release = module('release-record')


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(self.root)], check=True)
        subprocess.run(['git', '-C', str(self.root), 'config', 'user.email', 'test@example.invalid'], check=True)
        subprocess.run(['git', '-C', str(self.root), 'config', 'user.name', 'Test'], check=True)
        (self.root / '.gitignore').write_text('site/out/\nsite/.puls-build.json\n')
        (self.root / 'site/out').mkdir(parents=True)
        (self.root / 'site/source.txt').write_text('source')
        (self.root / 'site/out/index.html').write_text('built')
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(self.root), 'commit', '-qm', 'fixture'], check=True)

    def manifest(self):
        record = {'schema': 1, 'source_sha': 'fixture', 'inputs_sha256': site.site_fingerprint(self.root), 'files': site.inventory(self.root / 'site/out')}
        write_json(self.root / 'site' / site.MANIFEST, record)
        return record

    def test_stale_source_and_tampered_export_are_rejected(self):
        self.manifest()
        with patch.object(site.subprocess, 'run', side_effect=mock_build_commands):
            site.validate(self.root)
            (self.root / 'site/source.txt').write_text('new source')
            with self.assertRaisesRegex(RuntimeError, 'Stale export'):
                site.validate(self.root)
            self.manifest()
            (self.root / 'site/out/index.html').write_text('old output copied in')
            with self.assertRaisesRegex(RuntimeError, 'Export files changed'):
                site.validate(self.root)

    def test_private_build_overrides_invalidate_export_without_exposing_values(self):
        self.manifest()
        (self.root / "site/.env.local").write_text("NEXT_PUBLIC_FORM_ENDPOINT=https://example.invalid/override")
        with self.assertRaisesRegex(RuntimeError, 'Stale export'):
            site.validate(self.root)
        self.manifest()
        with patch.dict('os.environ', {"NEXT_PUBLIC_FORM_ENDPOINT": "https://example.invalid/another"}):
            with self.assertRaisesRegex(RuntimeError, 'Stale export'):
                site.validate(self.root)

    def test_new_untracked_input_invalidates_export(self):
        self.manifest()
        (self.root / 'site/new.txt').write_text('new')
        with self.assertRaisesRegex(RuntimeError, 'Stale export'):
            site.validate(self.root)

    def test_build_rejects_inputs_changed_while_building(self):
        def concurrent_edit(command, **kwargs):
            if command[0] == 'git':
                return REAL_RUN(command, **kwargs)
            (self.root / 'site/source.txt').write_text('concurrent edit')
        with patch.object(site.subprocess, 'run', side_effect=concurrent_edit):
            with self.assertRaisesRegex(RuntimeError, 'changed during build'):
                site.build(self.root)

    def test_dry_run_never_invalidates_or_writes_receipt(self):
        self.manifest()
        args = SimpleNamespace(skip_build=True, dry_run=True, no_invalidation=False, verify_path=[])
        with patch.object(site.subprocess, 'run', side_effect=mock_build_commands) as run:
            site.deploy(self.root, args)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertTrue(any('--dryrun' in command for command in commands))
        self.assertFalse(any('cloudfront' in command for command in commands))
        self.assertFalse((self.root / '.git/pulshealth/deployments').exists())

    def test_failed_invalidation_never_reports_verified(self):
        record = self.manifest()
        args = SimpleNamespace(skip_build=True, dry_run=False, no_invalidation=False, verify_path=[])
        def run(command, **_kwargs):
            if 'wait' in command:
                raise subprocess.CalledProcessError(255, command)
        with patch.object(site, 'site_fingerprint', return_value=record['inputs_sha256']), patch.object(site, 'validate', return_value=record), patch.object(site, 'git', side_effect=['', 'head']), patch.object(site, 'state_dir', return_value=self.root / '.git/evidence'), patch.object(site.subprocess, 'run', side_effect=run), patch.object(site.subprocess, 'check_output', return_value=b'{"Invalidation":{"Id":"test"}}'), patch.object(site, 'verify_live') as live:
            with self.assertRaises(subprocess.CalledProcessError):
                site.deploy(self.root, args)
        receipt = json.loads(next((self.root / '.git/evidence/deployments').glob('*.json')).read_text())
        self.assertEqual(receipt['status'], 'failed')
        live.assert_not_called()

    def test_live_mismatch_fails(self):
        from io import BytesIO
        class Response(BytesIO):
            status = 200
        with patch.object(site, 'urlopen', return_value=Response(b'stale CDN')):
            with self.assertRaisesRegex(RuntimeError, 'differs'):
                site.verify_live(self.root / 'site/out', 'https://example.invalid', ['index.html'])

    def test_task_status_does_not_change_git_or_claim_ownership(self):
        before = subprocess.check_output(['git', '-C', str(self.root), 'status', '--porcelain'])
        status = task.inspect(self.root)
        self.assertEqual(status['worktrees'][0]['branch'], 'main')
        self.assertEqual(status['worktrees'][0]['ownership']['owner'], 'unknown')
        self.assertEqual(before, subprocess.check_output(['git', '-C', str(self.root), 'status', '--porcelain']))
        self.assertFalse(task.owner_file(self.root).exists())

    def test_archive_replacement_cannot_reuse_acceptance(self):
        record = release.create(self.root, 'ios', 'test', '1')
        archive = self.root / 'fixture.ipa'
        archive.write_bytes(b'first')
        release.attach_archive(record, archive)
        archive.write_bytes(b'other archive')
        with self.assertRaisesRegex(ValueError, 'Archive bytes changed'):
            release.attach_archive(record, archive)

    def test_catalog_changes_invalidate_ios_evidence(self):
        record = release.create(self.root, 'ios', 'test', '1')
        catalog = self.root / 'docs/protocol/catalog.json'
        catalog.parent.mkdir(parents=True)
        catalog.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'inputs changed'):
            release.verify(self.root, record)

    def test_candidate_evidence_reuse_depends_on_component_inputs(self):
        record = release.create(self.root, 'ios', 'test', '1')
        (self.root / 'notes.md').write_text('unrelated prose')
        release.verify(self.root, record)
        (self.root / 'PulsHealth').mkdir()
        (self.root / 'PulsHealth/code.swift').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'inputs changed'):
            release.verify(self.root, record)


class SimulatorTests(unittest.TestCase):
    def test_empty_or_skipped_focused_results_are_not_acceptance(self):
        with self.assertRaises(RuntimeError):
            ios.require_executed_tests({'passedTests': 0, 'skippedTests': 1}, focused=True)
        with self.assertRaises(RuntimeError):
            ios.require_executed_tests({'passedTests': 1, 'skippedTests': 1}, focused=True)
        ios.require_executed_tests({'passedTests': 4, 'skippedTests': 0}, focused=True)

    def test_selects_available_pinned_runtime(self):
        runtimes = [{'identifier': 'old', 'version': '26.5', 'isAvailable': False}, {'identifier': 'new', 'version': '27.0', 'isAvailable': True}]
        self.assertIsNone(ios.available_runtime(runtimes, '26.5'))
        self.assertEqual(ios.available_runtime(runtimes, '27.0'), 'new')

    def test_boot_retry_only_removes_owned_devices(self):
        runner = ios.Runner(Path('.'), Path('.'))
        with patch.object(ios.subprocess, 'check_output', side_effect=['own-1', 'own-2']), patch.object(ios.subprocess, 'run') as cleanup, patch.object(runner, 'command', side_effect=[RuntimeError('boot unavailable'), None, None]):
            runner.prepare('pinned-runtime')
        self.assertEqual(runner.device, 'own-2')
        self.assertEqual([c.args[0] for c in cleanup.call_args_list], [['xcrun', 'simctl', 'shutdown', 'own-1'], ['xcrun', 'simctl', 'delete', 'own-1']])

    def test_test_failure_is_not_retried_and_project_is_regenerated(self):
        runner = ios.Runner(Path('.'), Path('.'))
        runner.device = 'owned'
        with patch.object(runner, 'command', side_effect=[None, RuntimeError('assertion failed')]) as command:
            with self.assertRaisesRegex(RuntimeError, 'assertion failed'):
                runner.test('app')
        self.assertEqual(command.call_count, 2)
        self.assertEqual(command.call_args_list[0].args[0], ['xcodegen', 'generate'])


if __name__ == '__main__':
    unittest.main()
