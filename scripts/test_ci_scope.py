"""Guard against skipping checks for shared contracts and mixed PRs."""

import unittest

from ci_scope import component_scopes, scopes


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


class ComponentScopeTests(unittest.TestCase):
    def test_unrelated_changes_skip_component_tests(self):
        self.assertEqual(
            component_scopes(["site/src/app/page.tsx", "CONTRIBUTING.md", "server/api/main.go"]),
            {"ios": False, "ha": False},
        )

    def test_ios_code_and_generated_inputs(self):
        for path in (
            "PulsHealth/Sources/AppModel.swift",
            "PulsHealthSync/Sources/Models.swift",
            "docs/protocol/catalog.json",
            "knowledge-base/type.yaml",
            "scripts/gen-knowledge-json.py",
            "scripts/check-knowledge-json.sh",
            ".github/workflows/ios-ci.yml",
        ):
            with self.subTest(path=path):
                self.assertEqual(component_scopes([path]), {"ios": True, "ha": False})

    def test_home_assistant_inputs(self):
        for path in (
            "custom_components/pulshealth/sensor.py",
            "integrations/homeassistant/tests/test_sensor.py",
            "hacs.json",
            ".github/workflows/home-assistant.yml",
        ):
            with self.subTest(path=path):
                self.assertEqual(component_scopes([path]), {"ios": False, "ha": True})

    def test_shared_selector_and_mixed_changes(self):
        for paths in (
            ["scripts/ci_scope.py"],
            ["scripts/test_ci_scope.py"],
            ["PulsHealth/Sources/AppModel.swift", "hacs.json"],
        ):
            with self.subTest(paths=paths):
                self.assertEqual(component_scopes(paths), {"ios": True, "ha": True})


if __name__ == "__main__":
    unittest.main()
