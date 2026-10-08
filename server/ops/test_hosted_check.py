import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('hosted_check', Path(__file__).with_name('hosted-check.py'))
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class HostedChecks(unittest.TestCase):
    def test_failed_backups_cannot_hide_behind_old_archive(self):
        self.assertTrue(checks.backup_problems([27 * 3600], 7, True))
        self.assertTrue(checks.backup_problems([], 7, True))

    def test_retention_checks_oldest_not_just_newest(self):
        self.assertTrue(checks.backup_problems([60, 8 * 86400], 7, True))
        self.assertFalse(checks.backup_problems([60, 7 * 86400 + 1800], 7, True))
        self.assertTrue(checks.backup_problems([60], 7, False))

    def test_deletion_failure_detected_even_before_deadline(self):
        facts = dict(pending=1, overdue=0, failed=0, jobs_unhealthy=0, broad_web_role=False)
        self.assertFalse(checks.database_problems(facts))
        for field in ('overdue', 'failed', 'jobs_unhealthy', 'broad_web_role'):
            self.assertTrue(checks.database_problems({**facts, field: 1}))
