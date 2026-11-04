package hosting

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestConnectorAcknowledgmentAndCursor(t *testing.T) {
	participant := UUID()
	page := []byte("synthetic NDJSON")
	status := 503
	var received []byte
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-User-ID") != participant || r.Header.Get("Authorization") != "Bearer customer-secret" {
			t.Error("wrong identity")
		}
		g, e := gzip.NewReader(r.Body)
		if e != nil {
			t.Error(e)
			w.WriteHeader(400)
			return
		}
		defer g.Close()
		received, _ = io.ReadAll(g)
		w.WriteHeader(status)
	}))
	defer target.Close()
	if ImportPage(context.Background(), target.URL, "customer-secret", participant, page) == nil {
		t.Fatal("failure acknowledged")
	}
	status = 200
	if e := ImportPage(context.Background(), target.URL, "customer-secret", participant, page); e != nil {
		t.Fatal(e)
	}
	if string(received) != string(page) {
		t.Fatal("wrong page")
	}
	cursor := Cursor{Destination: "https://customer.example.invalid", Server: "https://example.invalid", Participant: participant, RecipientFingerprint: "synthetic"}
	path := filepath.Join(t.TempDir(), "cursor.json")
	loaded, e := LoadCursor(path, cursor)
	if e != nil || loaded.Sequence != 0 {
		t.Fatal(e)
	}
	cursor.Sequence = 3
	if e = SaveCursor(path, cursor); e != nil {
		t.Fatal(e)
	}
	loaded, e = LoadCursor(path, cursor)
	if e != nil || loaded.Sequence != 3 {
		t.Fatal(e)
	}
	other := cursor
	other.Destination = "https://different.example.invalid"
	if _, e = LoadCursor(path, other); e == nil {
		t.Fatal("cross-destination cursor accepted")
	}
	cursor.Participant = UUID()
	if _, e = LoadCursor(path, cursor); e == nil {
		t.Fatal("cross-source cursor accepted")
	}
}
func TestTraditionalPolicy(t *testing.T) {
	spec := Spec{Types: []string{"HKQuantityTypeIdentifierStepCount"}, StartMs: 1000}
	cases := []struct {
		body  string
		valid bool
	}{
		{"{\"schemaVersion\":1}\n{\"type\":\"HKQuantityTypeIdentifierStepCount\",\"start\":1000}\n", true},
		{"{\"schemaVersion\":1}\n{\"type\":\"HKQuantityTypeIdentifierStepCount\",\"start\":1000.123456}\n", true},
		{"{\"schemaVersion\":1}\n{\"type\":\"HKQuantityTypeIdentifierStepCount\",\"start\":999}\n", false},
		{"{\"schemaVersion\":1}\n{\"type\":\"HKQuantityTypeIdentifierHeartRate\",\"start\":1000}\n", false},
		{"{\"schemaVersion\":1}\n{\"profile\":{}}\n", false},
	}
	for _, v := range cases {
		var b bytes.Buffer
		g := gzip.NewWriter(&b)
		g.Write([]byte(v.body))
		g.Close()
		if (validateTraditional(b.Bytes(), spec) == nil) != v.valid {
			t.Errorf("policy: %s", v.body)
		}
	}
}

func TestEndpointValidation(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1:8099@evil.example", "http://evil.example", "https://user:secret@example.invalid", "https://example.invalid/?token=secret", "https://example.invalid/#secret"} {
		if _, e := NormalizeEndpoint(raw); e == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	for _, raw := range []string{"http://127.0.0.1:8099/", "https://example.invalid/path/", "http://[::1]:8099"} {
		if _, e := NormalizeEndpoint(raw); e != nil {
			t.Errorf("refused %s", raw)
		}
	}
}
