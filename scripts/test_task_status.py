"""Exercise task inventory against real Git refs, including pruned upstreams."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("task_status", Path(__file__).with_name("task-status.py"))
task = importlib.util.module_from_spec(spec)
spec.loader.exec_module(task)


class UpstreamTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Test")
        self.git("commit", "-q", "--allow-empty", "-m", "initial")
        self.git("remote", "add", "origin", "https://example.invalid/repository")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.git("branch", "--set-upstream-to", "origin/main")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], text=True).strip()

    def test_available_upstream_reports_counts(self):
        item = task.inspect(self.root)["worktrees"][0]
        self.assertEqual(item["upstream"], "origin/main")
        self.assertEqual((item["ahead"], item["behind"]), (0, 0))
        self.assertEqual(item["upstream_status"], "available")

    def test_deleted_upstream_is_reported_without_failing_or_mutating(self):
        self.git("update-ref", "-d", "refs/remotes/origin/main")
        before = self.git("config", "--local", "--list")
        item = task.inspect(self.root)["worktrees"][0]
        self.assertIsNone(item["upstream"])
        self.assertEqual(item["upstream_status"], "unavailable")
        self.assertNotIn("ahead", item)
        self.assertEqual(before, self.git("config", "--local", "--list"))
        self.assertEqual(self.git("status", "--porcelain"), "")


if __name__ == "__main__":
    unittest.main()
