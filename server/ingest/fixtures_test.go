package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The protocol's fixture corpus (docs/protocol/fixtures) is what CI's stack
// smoke test posts to a running ingest, comparing every answer with the
// fixture's .expected.json. This is the same check without a database: every
// fixture parses (or is refused) as expected, the counts the parser alone
// decides match, and the ring dates are the ones the fixtures' `state` names.
// The counts that depend on what the store already holds (duplicates,
// deleted) are bounded rather than matched: the corpus is applied in order.
func TestProtocolFixtureCorpus(t *testing.T) {
	paths, err := filepath.Glob("../../docs/protocol/fixtures/*.ndjson")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) < 8 {
		t.Fatalf("found %d fixtures under docs/protocol/fixtures, want at least 8", len(paths))
	}
	for _, path := range paths {
		name := strings.TrimSuffix(filepath.Base(path), ".ndjson")
		t.Run(name, func(t *testing.T) {
			body, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var expected struct {
				Status   int              `json:"status"`
				Response map[string]int64 `json:"response"`
				State    struct {
					ActivitySummaries []struct {
						LocalDate string `json:"localDate"`
					} `json:"activitySummaries"`
				} `json:"state"`
			}
			raw, err := os.ReadFile(strings.TrimSuffix(path, ".ndjson") + ".expected.json")
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw, &expected); err != nil {
				t.Fatalf("expected.json: %v", err)
			}

			// Through the handler, as the smoke test sends it: gzip and
			// the protocol header.
			fs := &fakeStore{}
			srv := newTestServer(fs)
			var gz bytes.Buffer
			zw := gzip.NewWriter(&gz)
			_, _ = zw.Write(body)
			_ = zw.Close()
			req := httptest.NewRequest(http.MethodPost, "/v1/batches", &gz)
			req.Header.Set("Authorization", "Bearer secret")
			req.Header.Set("Content-Encoding", "gzip")
			req.Header.Set("X-Puls-Protocol", "1")
			rec := httptest.NewRecorder()
			srv.routes().ServeHTTP(rec, req)
			if rec.Code != expected.Status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, expected.Status, rec.Body.String())
			}
			if expected.Status != http.StatusOK {
				return
			}

			b, err := ParseBatch(bytes.NewReader(body))
			if err != nil {
				t.Fatalf("ParseBatch: %v", err)
			}
			resp := expected.Response
			if got := int64(len(b.Samples)); got != resp["accepted"]+resp["duplicates"] {
				t.Errorf("samples = %d, want accepted+duplicates = %d", got, resp["accepted"]+resp["duplicates"])
			}
			if got := int64(len(b.Deletions)); resp["deleted"] > got {
				t.Errorf("deleted %d of %d tombstones", resp["deleted"], got)
			}
			var routePoints, seriesPoints int64
			for _, r := range b.Routes {
				routePoints += int64(len(r.Route.Points))
			}
			for _, s := range b.Series {
				seriesPoints += int64(len(s.Series.Points))
			}
			if routePoints != resp["routePoints"] || seriesPoints != resp["seriesPoints"] {
				t.Errorf("route/series points = %d/%d, want %d/%d", routePoints, seriesPoints, resp["routePoints"], resp["seriesPoints"])
			}
			if got := int64(len(b.Aggregates)); got != resp["aggregateSamples"] {
				t.Errorf("aggregates = %d, want %d", got, resp["aggregateSamples"])
			}
			days := map[string]bool{}
			for i := range b.ActivitySummaries {
				day, err := activitySummaryDateKey(&b.ActivitySummaries[i].ActivitySummary)
				if err != nil {
					t.Fatalf("activity summary %d: %v", i+1, err)
				}
				days[day] = true
			}
			if got := int64(len(days)); got != resp["activitySummaries"] {
				t.Errorf("activity summary days = %d, want %d", got, resp["activitySummaries"])
			}
			for _, row := range expected.State.ActivitySummaries {
				if !days[row.LocalDate] {
					t.Errorf("state names ring day %s, which this fixture's lines do not key to (keys %v)", row.LocalDate, days)
				}
			}
		})
	}
}
