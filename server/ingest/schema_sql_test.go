package main

import (
	"os"
	"strings"
	"testing"
)

func TestQuantityRollupsExposeSumValue(t *testing.T) {
	for _, path := range []string{
		"../db/init/001_schema.sql",
		"../db/init/008_quantity_rollups.sql",
	} {
		sql := readSQL(t, path)
		if !strings.Contains(sql, "sum(value)  AS sum_value") {
			t.Fatalf("%s does not add sum_value to quantity_rollups", path)
		}
	}
}

func TestMetricDailyUsesOnlyCanonicalDailyAggregates(t *testing.T) {
	sql := readSQL(t, "../db/init/009_metric_daily.sql")
	for _, want := range []string{
		"s.interval_value = 1",
		"s.interval_unit = 'day'",
		"s.device_filter = 'all'",
		"ts.semantic = 'cumulative' AND s.agg_func = 'sum'",
		"ts.semantic = 'discrete' AND s.agg_func = 'average'",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("metric_daily canonical aggregate filter missing %q", want)
		}
	}
	if strings.Contains(sql, "CASE s.device_filter") {
		t.Fatal("metric_daily still lets device-specific aggregates compete")
	}
}

func TestMetricDailyEnablesCurrentRollupData(t *testing.T) {
	sql := readSQL(t, "../db/init/009_metric_daily.sql")
	if !strings.Contains(sql,
		"ALTER MATERIALIZED VIEW quantity_rollups SET (timescaledb.materialized_only = false)") {
		t.Fatal("metric_daily migration does not enable real-time quantity_rollups")
	}
}

func TestMetricDailyFallbackSemanticsAreExplicit(t *testing.T) {
	sql := readSQL(t, "../db/init/009_metric_daily.sql")
	if !strings.Contains(sql, "sum(r.sum_value)") {
		t.Fatalf("metric_daily does not use quantity_rollups.sum_value for cumulative fallback")
	}
	if strings.Contains(sql, "THEN sum(r.avg_value * r.n)") {
		t.Fatalf("metric_daily still derives sums from avg_value * n")
	}
	for _, want := range []string{
		"bool_or(agg_func = 'sum') THEN 'cumulative'",
		"bool_or(agg_func = 'average') THEN 'discrete'",
		"HAVING bool_or(agg_func IN ('sum', 'average'))",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("metric_daily explicit semantics missing %q", want)
		}
	}
}

func TestTemporalContextsSchemaAddsActivitySummaryContext(t *testing.T) {
	sql := readSQL(t, "../db/init/011_temporal_contexts.sql")
	for _, want := range []string{
		"CREATE TABLE IF NOT EXISTS temporal_contexts",
		"utc_offset_seconds  integer NOT NULL",
		"ALTER TABLE activity_summaries",
		"temporal_context_id integer",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("temporal context schema missing %q", want)
		}
	}
}

func TestProductAPIReadRoleIncludesAggregateCatalogTables(t *testing.T) {
	script := readSQL(t, "../db/init/099_read_roles.sh")
	for _, table := range []string{"aggregate_series", "aggregate_samples"} {
		if !strings.Contains(script, table) {
			t.Fatalf("product API read-role script missing %s", table)
		}
	}
}

func TestProfileLineReplacesCompleteSnapshot(t *testing.T) {
	if strings.Contains(strings.ToLower(upsertUserSQL), "coalesce") {
		t.Fatal("profile upsert still preserves null fields with coalesce")
	}
	for _, assignment := range []string{
		"name           = EXCLUDED.name",
		"email          = EXCLUDED.email",
		"dob            = EXCLUDED.dob",
		"biological_sex = EXCLUDED.biological_sex",
	} {
		if !strings.Contains(upsertUserSQL, assignment) {
			t.Fatalf("profile snapshot assignment missing %q", assignment)
		}
	}
}

func readSQL(t *testing.T, path string) string {
	t.Helper()

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}
