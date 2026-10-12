"""Verification must use deployed settings, never an unrelated caller database."""
import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("verify_release", Path(__file__).with_name("verify-release.py"))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class EnvironmentTests(unittest.TestCase):
    def test_settings_come_from_deployed_container(self):
        container = {"Config": {"Env": ["DATABASE_URL=postgres://web_app:fixture@db/health", "WEB_ACCOUNTS=true", "WEB_DB_POOL_SIZE=8", "PULS_TIME_ZONE=UTC", "UNRELATED_SECRET=omit"]}}
        with patch.dict(os.environ, {"DATABASE_URL": "postgres://postgres@wrong/scratch", "WEB_DB_POOL_SIZE": "50"}):
            env = verify.read_environment(container, "fixture-user")
        self.assertEqual(env["DATABASE_URL"], "postgres://web_app:fixture@db/health")
        self.assertEqual(env["WEB_DB_POOL_SIZE"], "8")
        self.assertEqual(env["NODE_ENV"], "production")
        self.assertNotIn("UNRELATED_SECRET", env)

    def test_admin_role_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "scoped read role"):
            verify.read_environment({"Config": {"Env": ["DATABASE_URL=postgres://postgres@db/health"]}}, "fixture")

    def test_multiline_env_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "Multiline"):
            verify.read_environment({"Config": {"Env": ["DATABASE_URL=postgres://web_app@db/health", "WEB_AUTH_PASSWORD=one\ntwo"]}}, "fixture")


if __name__ == "__main__":
    unittest.main()
