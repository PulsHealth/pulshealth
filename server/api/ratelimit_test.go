package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

// These mirror server/ingest/ratelimit_test.go, because ratelimit.go is a copy
// of ingest's: if the two implementations drift, one of the two suites should
// notice.

// authAttempt sends one request through the real route table and reports the
// status code plus the Retry-After header, if any.
func authAttempt(t *testing.T, srv *Server, token, remoteAddr string, headers map[string]string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/profile", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	return rec.Code, rec.Header().Get("Retry-After")
}

func TestAuthFailuresAreThrottledPerIP(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})

	for i := range authFailureBurst {
		if code, _ := authAttempt(t, srv, "wrong", "203.0.113.7:5000", nil); code != http.StatusUnauthorized {
			t.Fatalf("failure %d: status = %d, want 401", i+1, code)
		}
	}
	code, retryAfter := authAttempt(t, srv, "wrong", "203.0.113.7:5000", nil)
	if code != http.StatusTooManyRequests {
		t.Fatalf("status after %d failures = %d, want 429", authFailureBurst, code)
	}
	seconds, err := strconv.Atoi(retryAfter)
	if err != nil || seconds < 1 {
		t.Fatalf("Retry-After = %q, want a positive integer", retryAfter)
	}
	if seconds > 10 {
		t.Fatalf("Retry-After = %d s, want the next token within ~7 s", seconds)
	}
}

// The whole point of refusing before the comparison: once an address is out of
// budget, even the correct token is not evaluated, so guessing buys nothing.
func TestThrottledIPIsRefusedBeforeTheTokenIsChecked(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})
	for range authFailureBurst {
		authAttempt(t, srv, "wrong", "203.0.113.8:5000", nil)
	}
	if code, _ := authAttempt(t, srv, "secret", "203.0.113.8:5000", nil); code != http.StatusTooManyRequests {
		t.Fatalf("the correct token from a throttled address returned %d, want 429", code)
	}
}

// A backfill or a polling assistant is thousands of authenticated calls in a
// row; throttling those would break the product.
func TestSuccessfulAuthIsNeverThrottled(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})
	for i := range authFailureBurst * 3 {
		if code, _ := authAttempt(t, srv, "secret", "203.0.113.9:5000", nil); code == http.StatusTooManyRequests {
			t.Fatalf("request %d was throttled despite a valid token", i+1)
		}
	}
}

func TestAuthFailureBucketsAreIndependentPerIP(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})
	for range authFailureBurst + 2 {
		authAttempt(t, srv, "wrong", "203.0.113.10:5000", nil)
	}
	// A different address has its own full bucket.
	if code, _ := authAttempt(t, srv, "wrong", "203.0.113.11:5000", nil); code != http.StatusUnauthorized {
		t.Fatalf("a different address got %d, want 401 — buckets are not independent", code)
	}
}

// X-Forwarded-For is attacker-controlled. Believing it by default would hand
// out a fresh bucket per request and defeat the limit entirely.
func TestForwardedHeaderIsIgnoredUnlessTrusted(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})
	for range authFailureBurst {
		authAttempt(t, srv, "wrong", "203.0.113.13:5000", map[string]string{"X-Forwarded-For": "198.51.100.1"})
	}
	// Same peer, a new claimed client: still throttled.
	code, _ := authAttempt(t, srv, "wrong", "203.0.113.13:5000", map[string]string{"X-Forwarded-For": "198.51.100.2"})
	if code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 — rotating X-Forwarded-For must not refresh the bucket", code)
	}
}

func TestForwardedHeaderIsUsedWhenTrusted(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})
	srv.trustProxyHeaders = true
	for range authFailureBurst {
		authAttempt(t, srv, "wrong", "203.0.113.14:5000", map[string]string{"X-Forwarded-For": "198.51.100.3"})
	}
	if code, _ := authAttempt(t, srv, "wrong", "203.0.113.14:5000", map[string]string{"X-Forwarded-For": "198.51.100.3"}); code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 for the same forwarded client", code)
	}
	// A genuinely different client behind the same proxy keeps its own bucket.
	if code, _ := authAttempt(t, srv, "wrong", "203.0.113.14:5000", map[string]string{"X-Forwarded-For": "198.51.100.4"}); code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for a different forwarded client", code)
	}
}

// The unauthenticated discovery and liveness routes must never be throttled:
// /healthz is what a container health check polls, and /openapi.json is how a
// client discovers the API at all.
func TestUnauthenticatedRoutesAreNotRateLimited(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})
	for range authFailureBurst + 5 {
		authAttempt(t, srv, "wrong", "203.0.113.15:5000", nil)
	}
	for _, path := range []string{"/healthz", "/openapi.json", "/docs", "/"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "203.0.113.15:5000"
		rec := httptest.NewRecorder()
		srv.routes().ServeHTTP(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("%s was throttled; unauthenticated routes must stay reachable", path)
		}
	}
}

func TestThrottledResponseIsJSON(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})
	for range authFailureBurst {
		authAttempt(t, srv, "wrong", "203.0.113.16:5000", nil)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/profile", nil)
	req.RemoteAddr = "203.0.113.16:5000"
	req.Header.Set("Authorization", "Bearer wrong")
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("the 429 body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if body["error"] == "" {
		t.Fatalf("the 429 body carries no error message: %s", rec.Body.String())
	}
}

func TestFailureLimiterRefills(t *testing.T) {
	t.Parallel()
	l := newFailureLimiterWith(3, 60, time.Minute, 100) // one token per second
	start := time.Unix(1_700_000_000, 0)

	for range 3 {
		l.recordFailure("a", start)
	}
	if ok, wait := l.allow("a", start); ok {
		t.Fatal("bucket should be empty after three failures")
	} else if wait <= 0 {
		t.Fatalf("Retry-After hint = %v, want > 0", wait)
	}
	if ok, _ := l.allow("a", start.Add(500*time.Millisecond)); ok {
		t.Fatal("bucket refilled too early")
	}
	if ok, _ := l.allow("a", start.Add(2*time.Second)); !ok {
		t.Fatal("bucket did not refill after two seconds")
	}
	for range 3 {
		l.recordFailure("a", start.Add(time.Hour))
	}
	if ok, _ := l.allow("a", start.Add(time.Hour)); ok {
		t.Fatal("a long idle period must not raise the ceiling above the burst")
	}
}

func TestFailureLimiterForgetsIdleAddresses(t *testing.T) {
	t.Parallel()
	l := newFailureLimiterWith(2, 60, time.Minute, 100)
	start := time.Unix(1_700_000_000, 0)

	l.recordFailure("stale", start)
	if l.size() != 1 {
		t.Fatalf("size = %d, want 1", l.size())
	}
	l.recordFailure("fresh", start.Add(2*time.Hour))
	if l.size() != 1 {
		t.Fatalf("size = %d after the sweep, want 1 (only the fresh address)", l.size())
	}
	if ok, _ := l.allow("stale", start.Add(2*time.Hour)); !ok {
		t.Fatal("a forgotten address must start allowed")
	}
}

func TestFailureLimiterIsBoundedUnderAddressRotation(t *testing.T) {
	t.Parallel()
	const maxKeys = 40
	l := newFailureLimiterWith(1, 60, time.Hour, maxKeys)
	now := time.Unix(1_700_000_000, 0)
	for i := range maxKeys * 10 {
		now = now.Add(time.Millisecond)
		l.recordFailure("10.1."+strconv.Itoa(i/256)+"."+strconv.Itoa(i%256), now)
	}
	if n := l.size(); n > maxKeys {
		t.Fatalf("limiter tracks %d addresses, want at most %d", n, maxKeys)
	}
}

// Every authenticated handler except the export runs under a deadline, so a
// slow query returns its pool connection instead of holding it until the
// client goes away.
func TestAuthenticatedHandlersCarryADeadline(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})

	for _, rt := range srv.apiRoutes() {
		if !rt.auth || rt.path == "/v1/export" {
			continue
		}
		var deadline time.Time
		var hadDeadline bool
		probe := func(w http.ResponseWriter, r *http.Request) {
			deadline, hadDeadline = r.Context().Deadline()
		}
		handler := srv.auth(withTimeout(handlerTimeout, probe))

		req := httptest.NewRequest(http.MethodGet, "/v1/probe", nil)
		req.Header.Set("Authorization", "Bearer secret")
		handler(httptest.NewRecorder(), req)

		if !hadDeadline {
			t.Fatalf("%s ran with no deadline", rt.path)
		}
		if d := time.Until(deadline); d <= 0 || d > handlerTimeout+time.Second {
			t.Fatalf("%s deadline is %v away, want ~%v", rt.path, d, handlerTimeout)
		}
	}
}

// The export is deliberately exempt: it streams for as long as the download
// takes, and is bounded by its concurrency slots and range cap instead.
func TestExportIsExemptFromTheHandlerDeadline(t *testing.T) {
	t.Parallel()
	srv := testServer(t, &fakeStore{})

	var found bool
	for _, rt := range srv.apiRoutes() {
		if rt.path == "/v1/export" {
			found = true
		}
	}
	if !found {
		t.Fatal("/v1/export is no longer a route; the exemption in routes() needs revisiting")
	}
}
