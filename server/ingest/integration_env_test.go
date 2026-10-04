package main

import (
	"os"
	"testing"
)

// Integration tests run only against a database (DATABASE_URL), so a
// developer without one still gets a green `go test ./...`. In CI that skip
// is a hazard: a job that lost its DATABASE_URL would pass while testing
// nothing. PULS_CI_REQUIRE_INTEGRATION=1 (set by CI's db-integration job)
// turns every such skip into a failure.

// integrationRequired reports whether a missing precondition must fail the
// test instead of skipping it. An unparseable value is itself an error.
func integrationRequired(getenv func(string) string) (bool, error) {
	return parseBoolEnv("PULS_CI_REQUIRE_INTEGRATION", getenv("PULS_CI_REQUIRE_INTEGRATION"), false)
}

// skipIntegration skips t for reason, or fails it when CI requires the
// integration tests to run.
func skipIntegration(t *testing.T, reason string) {
	t.Helper()
	required, err := integrationRequired(os.Getenv)
	if err != nil {
		t.Fatal(err)
	}
	if required {
		t.Fatalf("%s, but PULS_CI_REQUIRE_INTEGRATION is set: this job must run the integration tests", reason)
	}
	t.Skip(reason + "; skipping integration test")
}

// integrationDatabaseURL is DATABASE_URL, or skips (fails, in CI) without it.
func integrationDatabaseURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		skipIntegration(t, "DATABASE_URL not set")
	}
	return url
}

func TestIntegrationRequired(t *testing.T) {
	for raw, want := range map[string]bool{"": false, "0": false, "1": true, "true": true} {
		got, err := integrationRequired(func(string) string { return raw })
		if err != nil || got != want {
			t.Errorf("PULS_CI_REQUIRE_INTEGRATION=%q: %v, %v; want %v", raw, got, err, want)
		}
	}
	if _, err := integrationRequired(func(string) string { return "sometimes" }); err == nil {
		t.Error("an unparseable PULS_CI_REQUIRE_INTEGRATION was accepted")
	}
}
