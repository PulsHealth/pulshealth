"""Guard against skipping checks for shared contracts and mixed PRs."""

import unittest

from ci_scope import scopes


class ScopeTests(unittest.TestCase):
    def test_component_only_changes(self):
        for path in ("PulsHealth/Sources/AppModel.swift", "custom_components/pulshealth/sensor.py", "integrations/homeassistant/tests/test_sensor.py", "hacs.json", ".github/PULL_REQUEST_TEMPLATE.md"):
            with self.subTest(path=path):
                self.assertEqual(scopes([path]), {"backend": False, "site": False})

    def test_site_and_document_inputs(self):
        for path in ("site/src/app/page.tsx", "blog/example.mdx", "docs/database-guide.md", "CONTRIBUTING.md"):
            with self.subTest(path=path):
                self.assertEqual(scopes([path]), {"backend": False, "site": True})

    def test_shared_and_unknown_inputs_run_everything(self):
        for path in ("PulsHealthSync/Sources/Models.swift", "docs/protocol/catalog.json", "knowledge-base/type.yaml", "scripts/gen-knowledge-json.py", ".github/workflows/ci.yml", "server/db/migrations/100_example.sql", "web/lib/db.ts", "new-component/example.py", "docs/new-check.py", "Makefile"):
            with self.subTest(path=path):
                self.assertEqual(scopes([path]), {"backend": True, "site": True})

    def test_mixed_changes_keep_shared_checks(self):
        self.assertEqual(scopes(["site/src/app/page.tsx", "server/api/main.go"]), {"backend": True, "site": True})


if __name__ == "__main__":
    unittest.main()
