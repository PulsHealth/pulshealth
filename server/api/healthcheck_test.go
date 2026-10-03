package main

import (
	"bytes"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// `healthcheck` is what the Compose healthcheck runs inside the distroless
// image: 0 for a 200 from /healthz on loopback, 1 for anything else.
func TestRunHealthcheck(t *testing.T) {
	status := http.StatusOK
	var path string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.WriteHeader(status)
	}))
	defer ts.Close()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(ts.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}

	var stderr bytes.Buffer
	// The default (LISTEN_ADDR's ":port" form) is asked on loopback.
	if code := runHealthcheck(nil, ":"+port, &stderr); code != 0 || path != "/healthz" {
		t.Fatalf("healthy: exit %d, path %q, stderr %q; want 0 on /healthz", code, path, stderr.String())
	}
	// An argument overrides the default.
	if code := runHealthcheck([]string{"0.0.0.0:" + port}, ":1", &stderr); code != 0 {
		t.Fatalf("explicit address: exit %d, stderr %q", code, stderr.String())
	}

	status = http.StatusServiceUnavailable
	stderr.Reset()
	if code := runHealthcheck(nil, ":"+port, &stderr); code != 1 || !strings.Contains(stderr.String(), "503") {
		t.Fatalf("503: exit %d, stderr %q; want 1 naming the status", code, stderr.String())
	}

	ts.Close()
	stderr.Reset()
	if code := runHealthcheck(nil, ":"+port, &stderr); code != 1 || !strings.Contains(stderr.String(), "unhealthy") {
		t.Fatalf("nothing listening: exit %d, stderr %q; want 1", code, stderr.String())
	}

	for _, bad := range [][]string{{"no-port"}, {":1", ":2"}} {
		if code := runHealthcheck(bad, ":1", &stderr); code != 2 {
			t.Errorf("runHealthcheck(%q) = %d, want 2 (usage)", bad, code)
		}
	}
}

func TestHealthcheckURL(t *testing.T) {
	for addr, want := range map[string]string{
		":8080":          "http://127.0.0.1:8080/healthz",
		"0.0.0.0:8081":   "http://127.0.0.1:8081/healthz",
		"[::]:8082":      "http://127.0.0.1:8082/healthz",
		"127.0.0.1:9000": "http://127.0.0.1:9000/healthz",
		"[::1]:9000":     "http://[::1]:9000/healthz",
	} {
		if got, err := healthcheckURL(addr); err != nil || got != want {
			t.Errorf("healthcheckURL(%q) = %q, %v; want %q", addr, got, err, want)
		}
	}
	if _, err := healthcheckURL("8080"); err == nil {
		t.Error("a bare port was accepted")
	}
}
