package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Per-request user scoping (scopeUser in main.go): which user a request is
// answered for, and what the ?user= parameter may and may not do.

const (
	// A second user, in mixed case to prove comparisons are case-blind.
	otherUserID = "7B1E4C2A-9D3F-4E5A-8B6C-0F1D2E3A4B5C"
	// PULS_USER_ID for a deployment that does not serve the seeded default.
	configuredUserID = "c0ffee00-1234-4abc-8def-000000000042"
)

// scopedServer is a Server with an explicit default user and gate, over store.
func scopedServer(t *testing.T, store apiStore, defaultUser string, multiUser bool) *Server {
	t.Helper()
	return &Server{
		store:         store,
		token:         "secret",
		log:           slog.New(slog.NewTextHandler(testWriter{t}, nil)),
		defaultUserID: defaultUser,
		multiUser:     multiUser,
	}
}

func TestScopeUserDefaultsToConfiguredUser(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	srv := scopedServer(t, store, configuredUserID, false)
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/profile", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if store.lastUser != configuredUserID {
		t.Fatalf("store was asked about %q, want the configured default %q", store.lastUser, configuredUserID)
	}

	// A Server built without one — every existing test — serves the seeded
	// default, exactly as the API always has.
	bare := testServer(t, store)
	serveAuthorized(t, bare, http.MethodGet, "/v1/profile", nil)
	if store.lastUser != defaultUserID {
		t.Fatalf("a Server without defaultUserID asked about %q, want the seeded %q", store.lastUser, defaultUserID)
	}
}

func TestScopeUserHonoursUserWhenMultiUser(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	srv := scopedServer(t, store, configuredUserID, true)

	// Every authenticated data route, so a handler that forgot to read the
	// request user fails here rather than answering for the wrong person.
	for _, target := range []string{
		"/v1/profile",
		"/v1/catalog/types",
		"/v1/metrics/latest?types=HKQuantityTypeIdentifierHeartRate",
		"/v1/metrics/daily?types=HKQuantityTypeIdentifierHeartRate&start=1767225600000&end=1767312000000",
		"/v1/activity/summary?start=1767225600000&end=1767312000000",
		"/v1/workouts",
		"/v1/workouts/11111111-1111-4111-8111-111111111111",
		"/v1/workouts/11111111-1111-4111-8111-111111111111/series",
		"/v1/sleep/daily?start=1767225600000&end=1767312000000",
		"/v1/samples?type=HKQuantityTypeIdentifierHeartRate&start=1767225600000&end=1767312000000",
		"/v1/state-of-mind?start=1767225600000&end=1767312000000",
	} {
		store.lastUser = ""
		sep := "?"
		if strings.Contains(target, "?") {
			sep = "&"
		}
		rec := serveAuthorized(t, srv, http.MethodGet, target+sep+"user="+otherUserID, nil)
		if rec.Code != http.StatusOK && rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d: %s", target, rec.Code, rec.Body.String())
			continue
		}
		// Stored lower-cased, the way Postgres renders a uuid, so the catalog
		// cache keys and the store see one spelling.
		if store.lastUser != strings.ToLower(otherUserID) {
			t.Errorf("%s: store was asked about %q, want %q", target, store.lastUser, strings.ToLower(otherUserID))
		}
	}

	// Without the parameter the default still applies, gate or no gate.
	store.lastUser = ""
	serveAuthorized(t, srv, http.MethodGet, "/v1/profile", nil)
	if store.lastUser != configuredUserID {
		t.Fatalf("without ?user= the store was asked about %q, want %q", store.lastUser, configuredUserID)
	}
}

func TestScopeUserRejectsMalformedUser(t *testing.T) {
	t.Parallel()

	for _, multiUser := range []bool{false, true} {
		store := &fakeStore{}
		srv := scopedServer(t, store, configuredUserID, multiUser)
		for _, raw := range []string{"not-a-uuid", "5ea4d000-0000-4000-8000-00000000000", "00000000-0000-4000-8000-00000000000g"} {
			rec := serveAuthorized(t, srv, http.MethodGet, "/v1/profile?user="+raw, nil)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("multiUser=%v user=%q: status = %d, want 400: %s", multiUser, raw, rec.Code, rec.Body.String())
			}
			assertJSONError(t, rec.Body.Bytes(), "invalid user: must be a UUID")
		}
		if store.lastUser != "" {
			t.Fatalf("multiUser=%v: the store was reached with %q despite a malformed user", multiUser, store.lastUser)
		}
		// A bad selector is a mistake by a caller holding the right token,
		// never a guess at the token, so it costs nothing on the limiter.
		if got := srv.limiter().size(); got != 0 {
			t.Fatalf("multiUser=%v: limiter tracks %d addresses after malformed ?user=, want 0", multiUser, got)
		}
	}
}

func TestScopeUserRefusesOtherUserWhenDisabled(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	srv := scopedServer(t, store, configuredUserID, false)

	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/profile?user="+otherUserID, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	assertJSONError(t, rec.Body.Bytes(), "multi-user reads are disabled")
	if store.lastUser != "" {
		t.Fatalf("the store was reached with %q; a refused request must never answer for anyone", store.lastUser)
	}
	// Same pattern as the ingest 403: a valid credential mis-addressed a
	// request. The auth-failure bucket for this address stays untouched.
	if got := srv.limiter().size(); got != 0 {
		t.Fatalf("limiter tracks %d addresses after a 403, want 0", got)
	}

	// Naming the default user is allowed with the gate off — it is what the
	// request would have got anyway — and the comparison ignores case.
	rec = serveAuthorized(t, srv, http.MethodGet, "/v1/profile?user="+strings.ToUpper(configuredUserID), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("naming the default user: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if store.lastUser != configuredUserID {
		t.Fatalf("store was asked about %q, want %q", store.lastUser, configuredUserID)
	}
}

// The token is checked before the selector: a caller without the token
// learns nothing about which users exist or whether the gate is on.
func TestScopeUserRunsAfterAuth(t *testing.T) {
	t.Parallel()

	srv := scopedServer(t, &fakeStore{}, configuredUserID, false)
	req := httptest.NewRequest(http.MethodGet, "/v1/profile?user="+otherUserID, nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 before any user handling", rec.Code)
	}
	// Unauthenticated routes take no user and refuse nobody.
	for _, target := range []string{"/healthz?user=nope", "/?user=" + otherUserID, "/openapi.json?user=" + otherUserID} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		rec := httptest.NewRecorder()
		srv.routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want 200", target, rec.Code)
		}
	}
}

func TestScopeUserAppliesToExport(t *testing.T) {
	t.Parallel()

	store := &fakeStore{
		samples:  &SamplesPage{Type: "HKQuantityTypeIdentifierHeartRate", Kind: "quantity", Samples: []Sample{{UUID: "a"}}},
		workouts: []WorkoutSummary{{UUID: "b"}},
	}
	srv := scopedServer(t, store, configuredUserID, true)

	for _, query := range []string{
		"format=csv&dataset=samples&type=HKQuantityTypeIdentifierHeartRate&" + exportRange,
		"format=jsonl&dataset=workouts&" + exportRange,
		"format=csv&dataset=activity&" + exportRange,
		"format=csv&dataset=sleep&" + exportRange,
		"format=csv&dataset=state_of_mind&" + exportRange,
		"format=csv&dataset=daily_metrics&types=HKQuantityTypeIdentifierStepCount&" + exportRange,
	} {
		store.lastUser = ""
		rec := getExport(t, srv, query+"&user="+otherUserID)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d: %s", query, rec.Code, rec.Body.String())
			continue
		}
		if store.lastUser != strings.ToLower(otherUserID) {
			t.Errorf("%s: store was asked about %q, want %q", query, store.lastUser, strings.ToLower(otherUserID))
		}
	}

	// And the gate applies to a download exactly as to a page: refused
	// before any byte, with the JSON error, not an empty file.
	closed := scopedServer(t, store, configuredUserID, false)
	rec := getExport(t, closed, "format=csv&dataset=workouts&"+exportRange+"&user="+otherUserID)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want the JSON error", got)
	}
}

func TestCatalogCacheIsPerUser(t *testing.T) {
	t.Parallel()

	store := &fakeStore{catalog: []CatalogType{{Identifier: "HKQuantityTypeIdentifierHeartRate", Kind: "quantity"}}}
	srv := scopedServer(t, store, configuredUserID, true)

	for i := range 2 {
		if rec := serveAuthorized(t, srv, http.MethodGet, "/v1/catalog/types", nil); rec.Code != http.StatusOK {
			t.Fatalf("default user call %d: status = %d", i+1, rec.Code)
		}
	}
	if store.calls.catalog != 1 {
		t.Fatalf("catalog queries for one user = %d, want 1 (cached)", store.calls.catalog)
	}
	if rec := serveAuthorized(t, srv, http.MethodGet, "/v1/catalog/types?user="+otherUserID, nil); rec.Code != http.StatusOK {
		t.Fatalf("other user: status = %d", rec.Code)
	}
	if store.calls.catalog != 2 {
		t.Fatalf("catalog queries after a second user = %d, want 2 — one user's cache must not answer for another", store.calls.catalog)
	}
	// The same user spelled differently is the same cache entry.
	serveAuthorized(t, srv, http.MethodGet, "/v1/catalog/types?user="+strings.ToLower(otherUserID), nil)
	if store.calls.catalog != 2 {
		t.Fatalf("catalog queries after re-spelling the user = %d, want 2", store.calls.catalog)
	}
}

// An authenticated caller can spray ?user= values; the cache must not grow
// with them.
func TestCatalogCacheIsBounded(t *testing.T) {
	t.Parallel()

	store := &fakeStore{catalog: []CatalogType{}}
	srv := scopedServer(t, store, configuredUserID, true)
	for i := range catalogCacheMaxUsers * 3 {
		user := fmt.Sprintf("00000000-0000-4000-8000-%012d", i)
		if rec := serveAuthorized(t, srv, http.MethodGet, "/v1/catalog/types?user="+user, nil); rec.Code != http.StatusOK {
			t.Fatalf("user %d: status = %d: %s", i, rec.Code, rec.Body.String())
		}
	}
	if got := srv.catalogCacheSize(); got > catalogCacheMaxUsers {
		t.Fatalf("catalog cache holds %d users, want at most %d", got, catalogCacheMaxUsers)
	}
	// The most recent user is still served from the cache after the
	// eviction: it is the newest entry, never the one evicted.
	user := fmt.Sprintf("00000000-0000-4000-8000-%012d", catalogCacheMaxUsers*3-1)
	before := store.calls.catalog
	serveAuthorized(t, srv, http.MethodGet, "/v1/catalog/types?user="+user, nil)
	if store.calls.catalog != before {
		t.Fatalf("the newest user was evicted from the cache")
	}
}

func TestParseBoolEnv(t *testing.T) {
	for raw, want := range map[string]bool{"": false, " true ": true, "1": true, "FALSE": false, "0": false} {
		t.Setenv("PULS_TEST_BOOL", raw)
		got, err := parseBoolEnv("PULS_TEST_BOOL", false)
		if err != nil || got != want {
			t.Fatalf("parseBoolEnv(%q) = %v, %v; want %v, nil", raw, got, err, want)
		}
	}
	t.Setenv("PULS_TEST_BOOL", "")
	if got, err := parseBoolEnv("PULS_TEST_BOOL", true); err != nil || !got {
		t.Fatalf("parseBoolEnv(unset, default true) = %v, %v; want true", got, err)
	}
	t.Setenv("PULS_TEST_BOOL", "maybe")
	if _, err := parseBoolEnv("PULS_TEST_BOOL", false); err == nil || !strings.Contains(err.Error(), "PULS_TEST_BOOL") {
		t.Fatalf("parseBoolEnv(maybe) err = %v; want an error naming the variable", err)
	}
}
