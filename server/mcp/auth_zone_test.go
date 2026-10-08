package main

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// syncBuffer is a log sink safe for a handler and a test to share.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// mcpAttempt POSTs an initialize to /mcp with the given Authorization value
// from remoteAddr, optionally with an X-Forwarded-For.
func mcpAttempt(t *testing.T, h http.Handler, authorization, remoteAddr, forwardedFor string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	req.Header.Set("Content-Type", "application/json")
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	if forwardedFor != "" {
		req.Header.Set("X-Forwarded-For", forwardedFor)
	}
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// S4: --http mode's bearer surface throttles failed authentications like
// ingest and the API: refused before the comparison once the budget is
// spent (so even the right token learns nothing), successes never charged,
// every failure logged without the token.
func TestBearerAuthThrottlesFailuresOnly(t *testing.T) {
	var logs syncBuffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	reached := 0
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached++
		w.WriteHeader(http.StatusNoContent)
	})
	h := bearerAuth(staticAuth("mcp-secret"), newFailureLimiter(), false, logger, next)
	const attacker, friend = "198.51.100.9:5555", "203.0.113.4:6666"

	// A correct token is never throttled, however often it is used.
	for i := 0; i < authFailureBurst*3; i++ {
		if rec := mcpAttempt(t, h, "Bearer mcp-secret", friend, ""); rec.Code != http.StatusNoContent {
			t.Fatalf("success %d = %d, want it passed through", i, rec.Code)
		}
	}

	for i := 0; i < authFailureBurst; i++ {
		rec := mcpAttempt(t, h, "Bearer guess-"+strings.Repeat("x", i), attacker, "")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d = %d, want 401", i, rec.Code)
		}
	}
	// Budget spent: refused before the comparison, the right token included.
	rec := mcpAttempt(t, h, "Bearer mcp-secret", attacker, "")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("after the burst = %d (Retry-After %q), want 429 with Retry-After", rec.Code, rec.Header().Get("Retry-After"))
	}
	if reached != authFailureBurst*3 {
		t.Fatalf("handler reached %d times, want only the %d successes", reached, authFailureBurst*3)
	}
	// No bearer guesses nothing: answered 401 with the challenge, never 429,
	// and never charged (a fresh address stays unspent after many).
	if rec := mcpAttempt(t, h, "", attacker, ""); rec.Code != http.StatusUnauthorized || rec.Header().Get("WWW-Authenticate") == "" {
		t.Fatalf("no bearer from an exhausted address = %d, want 401 with a challenge", rec.Code)
	}
	for i := 0; i < authFailureBurst*2; i++ {
		mcpAttempt(t, h, "", "192.0.2.77:1", "")
	}
	if rec := mcpAttempt(t, h, "Bearer mcp-secret", "192.0.2.77:1", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("bearer-less requests charged the limiter: %d", rec.Code)
	}
	// Another address keeps its own bucket.
	if rec := mcpAttempt(t, h, "Bearer mcp-secret", friend, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("an untouched address = %d, want it served", rec.Code)
	}

	out := logs.String()
	if !strings.Contains(out, "auth failed") || !strings.Contains(out, "auth throttled") || !strings.Contains(out, "198.51.100.9") {
		t.Errorf("failures were not logged with the client address: %s", out)
	}
	if strings.Contains(out, "mcp-secret") || strings.Contains(out, "guess-") {
		t.Errorf("a token reached the log: %s", out)
	}
}

// Same rule as ingest and the API: X-Forwarded-For is ignored unless
// TRUST_PROXY_HEADERS, and then its LAST entry (the one the proxy appended)
// is the client — a client-written first entry cannot buy a fresh bucket.
func TestBearerAuthForwardedForRule(t *testing.T) {
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	const proxy = "127.0.0.1:40000"

	trusted := bearerAuth(staticAuth("mcp-secret"), newFailureLimiter(), true, discard, ok)
	for i := 0; i < authFailureBurst; i++ {
		mcpAttempt(t, trusted, "Bearer nope", proxy, "198.51.100."+strings.Repeat("1", i%3+1)+", 192.0.2.50")
	}
	if rec := mcpAttempt(t, trusted, "Bearer nope", proxy, "evil-fresh-bucket, 192.0.2.50"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("rotating the first X-Forwarded-For entry = %d, want 429: the last entry is the key", rec.Code)
	}
	if rec := mcpAttempt(t, trusted, "Bearer mcp-secret", proxy, "192.0.2.51"); rec.Code != http.StatusNoContent {
		t.Fatalf("another client behind the same proxy = %d, want it served", rec.Code)
	}

	untrusted := bearerAuth(staticAuth("mcp-secret"), newFailureLimiter(), false, discard, ok)
	for i := 0; i < authFailureBurst; i++ {
		mcpAttempt(t, untrusted, "Bearer nope", proxy, "192.0.2."+strings.Repeat("9", i%3+1))
	}
	if rec := mcpAttempt(t, untrusted, "Bearer nope", proxy, "192.0.2.200"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("untrusted X-Forwarded-For bought a fresh bucket: %d", rec.Code)
	}
}

func TestLoadConfigTrustProxyHeaders(t *testing.T) {
	env := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}
	cfg, err := loadConfig(env(map[string]string{"PULS_API_TOKEN": "t", "TRUST_PROXY_HEADERS": " Yes "}))
	if err != nil || !cfg.trustProxyHeaders {
		t.Fatalf("TRUST_PROXY_HEADERS=Yes: %+v, %v", cfg, err)
	}
	if _, err := loadConfig(env(map[string]string{"PULS_API_TOKEN": "t", "TRUST_PROXY_HEADERS": "sure"})); err == nil || !strings.Contains(err.Error(), "TRUST_PROXY_HEADERS") {
		t.Fatalf("TRUST_PROXY_HEADERS=sure: err = %v, want a startup error naming it", err)
	}
}

// connectInMemory serves s over an in-memory transport and returns a client
// session.
func connectInMemory(t *testing.T, s *service) *mcp.ClientSession {
	t.Helper()
	ctx := context.Background()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := s.newServer("test").Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = serverSession.Close() })
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "0"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

// R20: without PULS_TIME_ZONE, every date is in the zone the product API
// reports on /v1/users, refreshed before each call — never the
// laptop's, never a silent UTC.
func TestZoneIsLearnedFromTheAPI(t *testing.T) {
	f := newFakeAPI(t)
	users := fixtureUsers
	users.TimeZone = "Asia/Tokyo"
	f.respond("/v1/users", http.StatusOK, users)
	f.respond("/v1/catalog/types", http.StatusOK, fixtureCatalog)
	s := newService(f.client(t), nil)
	s.log = slog.New(slog.NewTextHandler(io.Discard, nil))
	s.now = func() time.Time { return fixedNow }
	session := connectInMemory(t, s)

	for i := 0; i < 2; i++ {
		res, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_available_types", Arguments: map[string]any{}})
		if err != nil || res.IsError {
			t.Fatalf("list_available_types: %v %+v", err, res)
		}
		text := res.Content[0].(*mcp.TextContent).Text
		if !strings.Contains(text, `"time_zone":"Asia/Tokyo"`) || !strings.Contains(text, `"today":"2026-09-07"`) {
			t.Errorf("call %d answered %s, want Tokyo's zone and date", i, text)
		}
	}
	if n := len(f.callsTo("/v1/users")); n != 2 {
		t.Errorf("/v1/users asked %d times, want once per call", n)
	}
}

// An API that cannot be reached leaves the zone unknown: the call fails
// saying why (no date is guessed), and the next call asks again.
func TestZoneLookupFailureIsRetried(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/catalog/types", http.StatusOK, fixtureCatalog)
	s := newService(f.client(t), nil)
	s.log = slog.New(slog.NewTextHandler(io.Discard, nil))
	s.now = func() time.Time { return fixedNow }
	session := connectInMemory(t, s)

	f.respond("/v1/users", http.StatusServiceUnavailable, map[string]string{"error": "down"})
	_, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_available_types", Arguments: map[string]any{}})
	if err == nil || !strings.Contains(err.Error(), "time zone") {
		t.Fatalf("with the API down: err = %v, want an error about the time zone", err)
	}

	users := fixtureUsers
	users.TimeZone = "America/New_York"
	f.respond("/v1/users", http.StatusOK, users)
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_available_types", Arguments: map[string]any{}})
	if err != nil || res.IsError {
		t.Fatalf("after the API came back: %v %+v", err, res)
	}
	if text := res.Content[0].(*mcp.TextContent).Text; !strings.Contains(text, `"time_zone":"America/New_York"`) {
		t.Errorf("answered %s, want New York", text)
	}
}

// An API from before /v1/users carried timeZone: UTC, as this server always
// assumed without PULS_TIME_ZONE, with a warning saying how to fix it.
func TestZoneFromAnOlderAPIIsUTCWithAWarning(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/users", http.StatusOK, fixtureUsers) // no timeZone
	var logs syncBuffer
	s := newService(f.client(t), nil)
	s.log = slog.New(slog.NewTextHandler(&logs, nil))
	if err := s.ensureZone(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := s.location().String(); got != "UTC" {
		t.Errorf("zone = %s, want UTC", got)
	}
	if !strings.Contains(logs.String(), "PULS_TIME_ZONE") || !strings.Contains(logs.String(), "level=WARN") {
		t.Errorf("no warning: %s", logs.String())
	}
}

// PULS_TIME_ZONE set wins and the API is never asked for a zone before a
// call; set to something else than the API's, it is logged loudly.
func TestExplicitZoneIsCheckedAgainstTheAPI(t *testing.T) {
	f := newFakeAPI(t)
	users := fixtureUsers
	users.TimeZone = "Europe/Berlin"
	f.respond("/v1/users", http.StatusOK, users)
	var logs syncBuffer

	s := newService(f.client(t), mustZone(t, "Europe/Berlin"))
	s.log = slog.New(slog.NewTextHandler(&logs, nil))
	if !s.checkZoneAgainstAPI(context.Background()) || strings.Contains(logs.String(), "disagrees") {
		t.Fatalf("matching zones: %s", logs.String())
	}

	s = newService(f.client(t), mustZone(t, "America/Chicago"))
	s.log = slog.New(slog.NewTextHandler(&logs, nil))
	if !s.checkZoneAgainstAPI(context.Background()) {
		t.Fatal("the API answered but the check says it did not")
	}
	out := logs.String()
	if !strings.Contains(out, "disagrees") || !strings.Contains(out, "America/Chicago") || !strings.Contains(out, "Europe/Berlin") {
		t.Errorf("mismatch not logged with both zones: %s", out)
	}
	if got := s.location().String(); got != "America/Chicago" {
		t.Errorf("zone = %s, want the explicit one kept", got)
	}

	// An API that does not answer is "try again later", never an error.
	f.respond("/v1/users", http.StatusServiceUnavailable, map[string]string{"error": "down"})
	if s.checkZoneAgainstAPI(context.Background()) {
		t.Error("an unreachable API was reported as checked")
	}
}

// A learned zone is asked again after zoneRefreshEvery, so an instance that
// outlives a change of the stack's PULS_TIME_ZONE follows it; a failed re-ask
// keeps answering in the zone it knows.
func TestLearnedZoneIsRefreshed(t *testing.T) {
	f := newFakeAPI(t)
	users := fixtureUsers
	users.TimeZone = "Europe/Berlin"
	f.respond("/v1/users", http.StatusOK, users)
	now := fixedNow
	s := newService(f.client(t), nil)
	s.log = slog.New(slog.NewTextHandler(io.Discard, nil))
	s.now = func() time.Time { return now }

	if err := s.ensureZone(context.Background()); err != nil || s.location().String() != "Europe/Berlin" {
		t.Fatalf("first lookup: %v, zone %s", err, s.location())
	}
	users.TimeZone = "Asia/Tokyo"
	f.respond("/v1/users", http.StatusOK, users)
	now = now.Add(zoneRefreshEvery - time.Minute)
	if err := s.ensureZone(context.Background()); err != nil || s.location().String() != "Europe/Berlin" || len(f.callsTo("/v1/users")) != 1 {
		t.Fatalf("within the hour: %v, zone %s, %d lookups", err, s.location(), len(f.callsTo("/v1/users")))
	}
	now = now.Add(2 * time.Minute)
	if err := s.ensureZone(context.Background()); err != nil || s.location().String() != "Asia/Tokyo" {
		t.Fatalf("after the hour: %v, zone %s, want the API's new zone", err, s.location())
	}
	f.respond("/v1/users", http.StatusServiceUnavailable, map[string]string{"error": "down"})
	now = now.Add(2 * zoneRefreshEvery)
	if err := s.ensureZone(context.Background()); err != nil || s.location().String() != "Asia/Tokyo" {
		t.Fatalf("a failed re-ask: %v, zone %s, want the known zone kept without an error", err, s.location())
	}
}
