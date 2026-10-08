package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestAccountZonesConcurrentSelection(t *testing.T) {
	f := newFakeAPI(t)
	f.routes["/v1/users"] = func(w http.ResponseWriter, r *http.Request) {
		zone := "America/Los_Angeles"
		if r.URL.Query().Get("user") == otherUserID {
			zone = "America/New_York"
		}
		writeJSON(w, http.StatusOK, UsersResponse{Default: defaultUserID, MultiUser: true, TimeZone: zone,
			Users: []User{{UserID: defaultUserID, TimeZone: "America/Los_Angeles"}, {UserID: otherUserID, TimeZone: "America/New_York"}},
		})
	}
	f.respond("/v1/catalog/types", http.StatusOK, fixtureCatalog)
	f.routes["/v1/samples"] = func(w http.ResponseWriter, r *http.Request) {
		zone := "America/Los_Angeles"
		if r.URL.Query().Get("user") == otherUserID {
			zone = "America/New_York"
		}
		loc := mustZone(t, zone)
		start := time.Date(2026, 3, 8, 0, 0, 0, 0, loc)
		q := r.URL.Query()
		if q.Get("start") != fmt.Sprint(start.UnixMilli()) || q.Get("end") != fmt.Sprint(start.AddDate(0, 0, 1).UnixMilli()) {
			t.Errorf("wrong DST day for %s: %v", loc, q)
		}
		writeJSON(w, http.StatusOK, map[string]any{"samples": []any{}})
	}
	s := f.service(t, "UTC") // Legacy Compose setting must not override accounts.
	s.now = func() time.Time { return time.Date(2026, 3, 9, 5, 30, 0, 0, time.UTC) }
	session := connectInMemory(t, s)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		user, zone, today := defaultUserID, "America/Los_Angeles", "2026-03-08"
		if i%2 != 0 {
			user, zone, today = otherUserID, "America/New_York", "2026-03-09"
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_available_types", Arguments: map[string]any{"user": user}})
			if err != nil {
				t.Error(err)
				return
			}
			text := textOf(t, result)
			if result.IsError || !strings.Contains(text, zone) || !strings.Contains(text, today) {
				t.Errorf("%s: %s", user, text)
			}
			result, err = session.CallTool(context.Background(), &mcp.CallToolParams{Name: "get_samples", Arguments: map[string]any{"user": user, "type": "HKQuantityTypeIdentifierHeartRate", "start_date": "2026-03-08", "end_date": "2026-03-08"}})
			if err != nil || result.IsError {
				t.Errorf("samples: %v %+v", err, result)
			}
		}()
	}
	wg.Wait()
	if n := len(f.callsTo("/v1/users")); n != 40 {
		t.Errorf("zone lookups = %d, want one per incoming call", n)
	}
	ts, _ := oauthHarness(t, s)
	for _, tc := range []struct{ user, zone, today string }{{defaultUserID, "America/Los_Angeles", "2026-03-08"}, {otherUserID, "America/New_York", "2026-03-09"}} {
		oauth := connectHTTP(t, ts.URL, tokenFor(tc.user))
		resource, err := oauth.ReadResource(context.Background(), &mcp.ReadResourceParams{URI: typesURI})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(resource.Contents[0].Text, tc.zone) {
			t.Errorf("resource: %+v", resource)
		}
		prompt, err := oauth.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: "weekly_summary"})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(prompt.Description, tc.today) {
			t.Errorf("prompt: %+v", prompt)
		}
	}
}

func TestSelectedZoneLegacyAndRefresh(t *testing.T) {
	for _, tc := range []struct{ explicit, top, account, want string }{
		{"", "", "", "UTC"},
		{"", "Asia/Tokyo", "", "Asia/Tokyo"},
		{"Europe/Berlin", "Asia/Tokyo", "", "Europe/Berlin"},
		{"Europe/Berlin", "Asia/Tokyo", "America/New_York", "America/New_York"},
	} {
		t.Run(tc.explicit+"/"+tc.top+"/"+tc.account, func(t *testing.T) {
			f := newFakeAPI(t)
			response := UsersResponse{Default: defaultUserID, TimeZone: tc.top, Users: []User{{UserID: otherUserID, TimeZone: tc.account}}}
			f.respond("/v1/users", http.StatusOK, response)
			var explicit *time.Location
			if tc.explicit != "" {
				explicit = mustZone(t, tc.explicit)
			}
			s := newService(f.client(t), explicit)
			now := fixedNow
			s.now = func() time.Time { return now }
			api := s.api.ForUser(otherUserID)
			got, err := s.selectedZone(context.Background(), api)
			if err != nil || got.String() != tc.want {
				t.Fatalf("zone %v, err %v; want %s", got, err, tc.want)
			}
			response.Users[0].TimeZone = "Australia/Sydney"
			f.respond("/v1/users", http.StatusOK, response)
			got, err = s.selectedZone(context.Background(), api)
			if err != nil || got.String() != "Australia/Sydney" {
				t.Fatalf("refreshed zone %v, err %v", got, err)
			}
		})
	}
}

func TestAccountZoneChangeAppliesOnNextCall(t *testing.T) {
	f := newFakeAPI(t)
	var mu sync.Mutex
	zone := "America/Los_Angeles"
	f.routes["/v1/users"] = func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		writeJSON(w, http.StatusOK, UsersResponse{Default: defaultUserID, TimeZone: "UTC", Users: []User{{UserID: defaultUserID, TimeZone: zone}}})
	}
	f.respond("/v1/catalog/types", http.StatusOK, fixtureCatalog)
	s := f.service(t, "UTC")
	s.now = func() time.Time { return time.Date(2026, 3, 9, 5, 30, 0, 0, time.UTC) }
	session := connectInMemory(t, s)
	for _, want := range []struct{ zone, today string }{{"America/Los_Angeles", "2026-03-08"}, {"America/New_York", "2026-03-09"}} {
		mu.Lock()
		zone = want.zone
		mu.Unlock()
		result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_available_types", Arguments: map[string]any{}})
		if err != nil {
			t.Fatal(err)
		}
		text := textOf(t, result)
		if result.IsError || !strings.Contains(text, want.zone) || !strings.Contains(text, want.today) {
			t.Fatalf("expected %s %s, got %s", want.zone, want.today, text)
		}
	}
	if n := len(f.callsTo("/v1/users")); n != 2 {
		t.Errorf("lookups = %d, want 2", n)
	}
}
