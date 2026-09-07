package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type dashboardFile struct {
	Annotations struct {
		List []struct {
			Name   string `json:"name"`
			Target *struct {
				RawSQL string `json:"rawSql"`
			} `json:"target"`
		} `json:"list"`
	} `json:"annotations"`
	Panels []struct {
		ID      int    `json:"id"`
		Title   string `json:"title"`
		Targets []struct {
			RawSQL string `json:"rawSql"`
		} `json:"targets"`
	} `json:"panels"`
	Templating struct {
		List []struct {
			Name    string `json:"name"`
			Type    string `json:"type"`
			Query   string `json:"query"`
			Hide    int    `json:"hide"`
			Refresh int    `json:"refresh"`
			Current struct {
				Value any `json:"value"`
			} `json:"current"`
		} `json:"list"`
	} `json:"templating"`
}

func loadHealthDashboard(t *testing.T) dashboardFile {
	t.Helper()
	b, err := os.ReadFile("../grafana/dashboards/puls-health.json")
	if err != nil {
		t.Fatalf("read dashboard: %v", err)
	}
	var dashboard dashboardFile
	if err := json.Unmarshal(b, &dashboard); err != nil {
		t.Fatalf("parse dashboard JSON: %v", err)
	}
	return dashboard
}

func loadOpsDashboard(t *testing.T) dashboardFile {
	t.Helper()
	b, err := os.ReadFile("../grafana/dashboards/puls-ops.json")
	if err != nil {
		t.Fatalf("read ops dashboard: %v", err)
	}
	var dashboard dashboardFile
	if err := json.Unmarshal(b, &dashboard); err != nil {
		t.Fatalf("parse ops dashboard JSON: %v", err)
	}
	return dashboard
}

func assertDashboardQueryScoped(t *testing.T, label, query string) {
	t.Helper()
	if !strings.Contains(query, "${user}") || !strings.Contains(query, "user_id") {
		t.Fatalf("%s is not scoped by the user dashboard variable: %s", label, query)
	}
}

// The dashboard ships with no install-specific values baked in. The user
// variable is a query over `users` resolved on dashboard load (Grafana picks
// the first row, i.e. the seeded default on a fresh install) and the hidden
// tz variable reads the database's puls.time_zone setting (puls_time_zone(),
// written from PULS_TIME_ZONE by 013_time_zone.sh). Both used to be pinned
// constants: one person's UUID and one person's zone.
func TestHealthDashboardVariablesAreNotPinned(t *testing.T) {
	dashboard := loadHealthDashboard(t)
	found := map[string]bool{"user": false, "tz": false}
	for _, variable := range dashboard.Templating.List {
		switch variable.Name {
		case "user":
			found["user"] = true
			if variable.Type != "query" || !strings.Contains(variable.Query, "FROM users") {
				t.Fatalf("user variable must be a query over users, got type %q query %q", variable.Type, variable.Query)
			}
			if variable.Refresh != 1 { // 1 = refresh on dashboard load
				t.Fatalf("user variable refresh = %d, want 1 (on dashboard load)", variable.Refresh)
			}
			if variable.Current.Value != nil {
				t.Fatalf("user variable is pinned to %#v; it must resolve from the users table", variable.Current.Value)
			}
		case "tz":
			found["tz"] = true
			if variable.Type != "query" || !strings.Contains(variable.Query, "puls_time_zone()") {
				t.Fatalf("tz variable must query puls_time_zone(), got type %q query %q", variable.Type, variable.Query)
			}
			if variable.Hide != 2 { // 2 = hidden from the dashboard header
				t.Fatalf("tz variable hide = %d, want 2 (hidden)", variable.Hide)
			}
			if variable.Current.Value != nil {
				t.Fatalf("tz variable is pinned to %#v; it must come from the database setting", variable.Current.Value)
			}
		}
	}
	for name, ok := range found {
		if !ok {
			t.Fatalf("dashboard has no %s variable", name)
		}
	}
}

func TestEveryHealthDashboardQueryIsUserScoped(t *testing.T) {
	dashboard := loadHealthDashboard(t)
	panelQueries := 0
	for _, panel := range dashboard.Panels {
		for _, target := range panel.Targets {
			if target.RawSQL == "" {
				continue
			}
			panelQueries++
			assertDashboardQueryScoped(t, panel.Title, target.RawSQL)
		}
	}
	if panelQueries != 12 {
		t.Fatalf("checked %d panel queries, want all 12", panelQueries)
	}

	for _, annotation := range dashboard.Annotations.List {
		if annotation.Target != nil && annotation.Target.RawSQL != "" {
			assertDashboardQueryScoped(t, "annotation "+annotation.Name, annotation.Target.RawSQL)
		}
	}

	scopedVariables := map[string]bool{
		"metric":     false,
		"agg_series": false,
		"workout":    false,
	}
	for _, variable := range dashboard.Templating.List {
		if _, ok := scopedVariables[variable.Name]; ok {
			assertDashboardQueryScoped(t, "variable "+variable.Name, variable.Query)
			scopedVariables[variable.Name] = true
		}
	}
	for name, found := range scopedVariables {
		if !found {
			t.Fatalf("dashboard variable %s is missing", name)
		}
	}
}

func TestOpsDashboardShowsDurableIngestRejections(t *testing.T) {
	dashboard := loadOpsDashboard(t)
	required := map[string]bool{
		"Rejected Batches (24h)":  false,
		"Recent Rejected Batches": false,
	}
	for _, panel := range dashboard.Panels {
		if _, ok := required[panel.Title]; !ok {
			continue
		}
		for _, target := range panel.Targets {
			if strings.Contains(target.RawSQL, "ingest_rejections") {
				required[panel.Title] = true
			}
		}
	}
	for title, found := range required {
		if !found {
			t.Fatalf("ops dashboard panel %q is missing or does not query ingest_rejections", title)
		}
	}
}
