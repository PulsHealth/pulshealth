package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"
)

// Integration tests run only against a database (DATABASE_URL, and
// PULS_API_WRITE_INTEGRATION_TESTS=1 for the ones that write fixtures), so a
// developer without one still gets a green `go test ./...`. In CI that skip
// is a hazard: a job that lost either variable would pass while testing
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

// R20 against a real database: the role the store reads as can call
// puls_time_zone(), and the zone it reports passes the startup check, so a
// migrated stack with matching .env values starts.
func TestIntegrationDatabaseTimeZonePassesTheStartupCheck(t *testing.T) {
	store, ctx, cleanup := integrationStore(t)
	defer cleanup()

	var name string
	if err := store.pool.QueryRow(ctx, `SELECT puls_time_zone()`).Scan(&name); err != nil {
		t.Fatalf("SELECT puls_time_zone() as the store's role: %v", err)
	}
	loc, err := loadTimeZone(name)
	if err != nil {
		t.Fatalf("the database's zone %q does not load in Go: %v", name, err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	query := func(ctx context.Context) (string, error) {
		var got string
		err := store.pool.QueryRow(ctx, `SELECT puls_time_zone()`).Scan(&got)
		return got, err
	}
	if err := verifyTimeZone(ctx, query, loc, logger); err != nil {
		t.Fatalf("verifyTimeZone with the database's own zone: %v", err)
	}
}
