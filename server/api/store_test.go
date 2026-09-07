package main

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func integrationStore(t *testing.T) (*Store, context.Context, func()) {
	t.Helper()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL is unset")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		cancel()
		t.Fatalf("pgxpool.New: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		cancel()
		t.Fatalf("pool.Ping: %v", err)
	}

	cleanup := func() {
		pool.Close()
		cancel()
	}
	loc, err := losAngelesLocation()
	if err != nil {
		cleanup()
		t.Fatalf("losAngelesLocation: %v", err)
	}
	return NewStore(pool, defaultUserID, loc), ctx, cleanup
}

// The day-range fixtures below were written against America/Los_Angeles. The
// zone is a per-deployment setting now (PULS_TIME_ZONE, loaded once in
// main.go and handed to NewStore), so the tests pass it explicitly.
func losAngelesLocation() (*time.Location, error) {
	return time.LoadLocation("America/Los_Angeles")
}

func writeIntegrationStore(t *testing.T) (*Store, context.Context, func()) {
	t.Helper()

	if os.Getenv("PULS_API_WRITE_INTEGRATION_TESTS") != "1" {
		t.Skip("PULS_API_WRITE_INTEGRATION_TESTS is not set to 1; skipping integration test that writes fixture rows")
	}
	return integrationStore(t)
}

func TestLocalDayRangeUsesLosAngelesDates(t *testing.T) {
	loc, err := losAngelesLocation()
	if err != nil {
		t.Fatalf("losAngelesLocation: %v", err)
	}

	start := time.Date(2026, 7, 1, 7, 30, 0, 0, time.UTC)
	end := time.Date(2026, 7, 2, 7, 30, 0, 0, time.UTC)
	gotStart, gotEnd, err := localDayRange(start, end, loc)
	if err != nil {
		t.Fatalf("localDayRange: %v", err)
	}
	wantStart := start.In(loc).Format("2006-01-02")
	wantEnd := "2026-07-03"
	if gotStart != wantStart || gotEnd != wantEnd {
		t.Fatalf("localDayRange = %q,%q want %q,%q", gotStart, gotEnd, wantStart, wantEnd)
	}
}

func TestLocalDayRangeCrossesLosAngelesDayBoundary(t *testing.T) {
	loc, err := losAngelesLocation()
	if err != nil {
		t.Fatalf("losAngelesLocation: %v", err)
	}
	start := time.Date(2026, 7, 2, 6, 30, 0, 0, time.UTC)
	end := time.Date(2026, 7, 2, 8, 30, 0, 0, time.UTC)
	gotStart, gotEnd, err := localDayRange(start, end, loc)
	if err != nil {
		t.Fatalf("localDayRange: %v", err)
	}
	wantStart := "2026-07-01"
	wantEnd := "2026-07-03"
	if gotStart != wantStart || gotEnd != wantEnd {
		t.Fatalf("localDayRange = %q,%q want %q,%q", gotStart, gotEnd, wantStart, wantEnd)
	}
}

func TestLocalDayRangeTouchedLosAngelesDays(t *testing.T) {
	loc, err := losAngelesLocation()
	if err != nil {
		t.Fatalf("losAngelesLocation: %v", err)
	}

	tests := []struct {
		name      string
		start     time.Time
		end       time.Time
		wantStart string
		wantEnd   string
	}{
		{
			name:      "single touched day exact midnight bounds",
			start:     time.Date(2026, 7, 2, 0, 0, 0, 0, loc),
			end:       time.Date(2026, 7, 3, 0, 0, 0, 0, loc),
			wantStart: "2026-07-02",
			wantEnd:   "2026-07-03",
		},
		{
			name:      "crosses into next day after midnight",
			start:     time.Date(2026, 7, 2, 23, 30, 0, 0, loc),
			end:       time.Date(2026, 7, 3, 1, 30, 0, 0, loc),
			wantStart: "2026-07-02",
			wantEnd:   "2026-07-04",
		},
		{
			name:      "end exactly at midnight excludes new day",
			start:     time.Date(2026, 7, 2, 23, 30, 0, 0, loc),
			end:       time.Date(2026, 7, 3, 0, 0, 0, 0, loc),
			wantStart: "2026-07-02",
			wantEnd:   "2026-07-03",
		},
		{
			name:      "small positive range across spring forward still counts both days",
			start:     time.Date(2026, 3, 7, 23, 30, 0, 0, loc),
			end:       time.Date(2026, 3, 8, 1, 30, 0, 0, loc),
			wantStart: "2026-03-07",
			wantEnd:   "2026-03-09",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotStart, gotEnd, err := localDayRange(tt.start, tt.end, loc)
			if err != nil {
				t.Fatalf("localDayRange: %v", err)
			}
			if gotStart != tt.wantStart || gotEnd != tt.wantEnd {
				t.Fatalf("localDayRange = %q,%q want %q,%q", gotStart, gotEnd, tt.wantStart, tt.wantEnd)
			}
		})
	}
}

func TestLocalDayRangeRejectsEmptyOrNegativeRange(t *testing.T) {
	start := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	for _, end := range []time.Time{start, start.Add(-time.Nanosecond)} {
		if _, _, err := localDayRange(start, end, time.UTC); err == nil {
			t.Fatalf("expected error for start=%s end=%s", start, end)
		}
	}
}

func TestIntegrationCatalogTypesEmptyOrLive(t *testing.T) {
	store, ctx, cleanup := integrationStore(t)
	defer cleanup()

	types, err := store.CatalogTypes(ctx)
	if err != nil {
		t.Fatalf("CatalogTypes: %v", err)
	}
	for i, typ := range types {
		if typ.Identifier == "" {
			t.Fatalf("types[%d] has empty identifier: %#v", i, typ)
		}
	}
}

func TestIntegrationUnknownLatestMetricIsEmpty(t *testing.T) {
	store, ctx, cleanup := integrationStore(t)
	defer cleanup()

	metrics, err := store.LatestMetrics(ctx, []string{"HKQuantityTypeIdentifierDefinitelyMissingForIntegrationTest"})
	if err != nil {
		t.Fatalf("LatestMetrics: %v", err)
	}
	if len(metrics) != 0 {
		t.Fatalf("metrics len = %d, want 0", len(metrics))
	}
	if metrics == nil {
		t.Fatal("metrics is nil, want empty non-nil slice")
	}
}

func TestIntegrationActivitySummaryEmptyRangeIsNonNil(t *testing.T) {
	store, ctx, cleanup := integrationStore(t)
	defer cleanup()

	start := time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	days, err := store.ActivitySummary(ctx, start, end)
	if err != nil {
		t.Fatalf("ActivitySummary: %v", err)
	}
	if len(days) != 0 {
		t.Fatalf("days len = %d, want 0", len(days))
	}
	if days == nil {
		t.Fatal("days is nil, want empty non-nil slice")
	}
}

func TestIntegrationActivitySummaryUsesTouchedLocalDays(t *testing.T) {
	store, ctx, cleanup := writeIntegrationStore(t)
	defer cleanup()

	loc, err := losAngelesLocation()
	if err != nil {
		t.Fatalf("losAngelesLocation: %v", err)
	}
	firstDay := time.Date(2099, 9, 17, 0, 0, 0, 0, loc)
	secondDay := firstDay.AddDate(0, 0, 1)
	defer func() {
		_, _ = store.pool.Exec(
			context.Background(),
			`DELETE FROM activity_summaries WHERE user_id = $1 AND date IN ($2::date, $3::date)`,
			defaultUserID,
			firstDay.Format("2006-01-02"),
			secondDay.Format("2006-01-02"),
		)
	}()

	if _, err := store.pool.Exec(ctx, `
		INSERT INTO activity_summaries (user_id, date, move_kcal)
		VALUES ($1, $2::date, 100), ($1, $3::date, 200)`,
		defaultUserID,
		firstDay.Format("2006-01-02"),
		secondDay.Format("2006-01-02"),
	); err != nil {
		t.Fatalf("insert activity summaries: %v", err)
	}

	start := time.Date(2099, 9, 17, 23, 30, 0, 0, loc)
	end := time.Date(2099, 9, 18, 1, 30, 0, 0, loc)
	days, err := store.ActivitySummary(ctx, start, end)
	if err != nil {
		t.Fatalf("ActivitySummary: %v", err)
	}
	if len(days) != 2 {
		t.Fatalf("days = %#v, want both touched local days", days)
	}
	if days[0].Date != "2099-09-17" || days[1].Date != "2099-09-18" {
		t.Fatalf("day dates = %q,%q, want 2099-09-17,2099-09-18", days[0].Date, days[1].Date)
	}
}

func TestIntegrationWorkoutsEmptyFilterIsNonNil(t *testing.T) {
	store, ctx, cleanup := integrationStore(t)
	defer cleanup()

	start := time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	workouts, err := store.Workouts(ctx, WorkoutFilters{
		Start:  &start,
		End:    &end,
		Limit:  10,
		Offset: 0,
	})
	if err != nil {
		t.Fatalf("Workouts: %v", err)
	}
	if len(workouts) != 0 {
		t.Fatalf("workouts len = %d, want 0", len(workouts))
	}
	if workouts == nil {
		t.Fatal("workouts is nil, want empty non-nil slice")
	}
}

func TestIntegrationDailyMetricsFixture(t *testing.T) {
	store, ctx, cleanup := writeIntegrationStore(t)
	defer cleanup()

	suffix := time.Now().UTC().UnixNano()
	identifier := fmt.Sprintf("HKQuantityTypeIdentifierCodexDailyMetrics%d", suffix)

	var typeID int16
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO sample_types (identifier, kind, unit)
		VALUES ($1, 'quantity', 'count')
		RETURNING type_id`, identifier).Scan(&typeID); err != nil {
		t.Fatalf("insert sample_types: %v", err)
	}
	defer func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM aggregate_samples WHERE series_id IN (SELECT series_id FROM aggregate_series WHERE type_id = $1)`, typeID)
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM aggregate_series WHERE type_id = $1`, typeID)
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM sample_types WHERE type_id = $1`, typeID)
	}()

	var seriesID int16
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO aggregate_series (type_id, agg_func, interval_value, interval_unit, device_filter, unit)
		VALUES ($1, 'sum', 1, 'day', 'all', 'count')
		RETURNING series_id`, typeID).Scan(&seriesID); err != nil {
		t.Fatalf("insert aggregate_series: %v", err)
	}

	loc, err := losAngelesLocation()
	if err != nil {
		t.Fatalf("losAngelesLocation: %v", err)
	}
	dayStart := time.Date(2099, 7, 3, 0, 0, 0, 0, loc)
	dayEnd := dayStart.Add(24 * time.Hour)
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO aggregate_samples (series_id, bucket_start, bucket_end, value, user_id)
		VALUES ($1, $2, $3, $4, $5)`,
		seriesID, dayStart, dayEnd, 123.0, defaultUserID,
	); err != nil {
		t.Fatalf("insert aggregate_samples: %v", err)
	}

	rangeStart := time.Date(2099, 7, 3, 0, 0, 0, 0, loc)
	rangeEnd := time.Date(2099, 7, 4, 0, 0, 0, 0, loc)
	metrics, err := store.DailyMetrics(ctx, []string{identifier}, rangeStart, rangeEnd)
	if err != nil {
		t.Fatalf("DailyMetrics: %v", err)
	}
	if len(metrics) != 1 {
		t.Fatalf("metrics len = %d, want 1", len(metrics))
	}
	if metrics[0].Identifier != identifier {
		t.Fatalf("identifier = %q, want %q", metrics[0].Identifier, identifier)
	}
	if len(metrics[0].Days) != 1 {
		t.Fatalf("days len = %d, want 1", len(metrics[0].Days))
	}
	if metrics[0].Days[0].Value == nil || *metrics[0].Days[0].Value != 123 {
		t.Fatalf("value = %v, want 123", metrics[0].Days[0].Value)
	}

	catalog, err := store.CatalogTypes(ctx)
	if err != nil {
		t.Fatalf("CatalogTypes: %v", err)
	}
	for _, typ := range catalog {
		if typ.Identifier != identifier {
			continue
		}
		if typ.Rows != 1 || typ.RawRows != 0 || typ.AggregateRows != 1 {
			t.Fatalf("aggregate-only catalog counts = rows:%d raw:%d aggregate:%d, want 1/0/1",
				typ.Rows, typ.RawRows, typ.AggregateRows)
		}
		return
	}
	t.Fatalf("aggregate-only type %q missing from catalog", identifier)
}

func TestIntegrationWorkoutFixture(t *testing.T) {
	store, ctx, cleanup := writeIntegrationStore(t)
	defer cleanup()

	suffix := time.Now().UTC().UnixNano()
	identifier := fmt.Sprintf("HKQuantityTypeIdentifierCodexWorkout%d", suffix)
	workoutUUID := fmt.Sprintf("aaaaaaaa-aaaa-4aaa-8aaa-%012d", suffix%1_000_000_000_000)
	workoutUUID2 := fmt.Sprintf("bbbbbbbb-bbbb-4bbb-8bbb-%012d", suffix%1_000_000_000_000)
	start := time.Date(2099, 8, 1, 10, 0, 0, 0, time.UTC)
	end := start.Add(45 * time.Minute)

	var typeID int16
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO sample_types (identifier, kind, unit)
		VALUES ($1, 'quantity', 'count/min')
		RETURNING type_id`, identifier).Scan(&typeID); err != nil {
		t.Fatalf("insert sample_types: %v", err)
	}
	defer func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM workout_route_points WHERE workout_uuid IN ($1, $2)`, workoutUUID, workoutUUID2)
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM workout_series_points WHERE workout_uuid IN ($1, $2)`, workoutUUID, workoutUUID2)
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM workouts WHERE uuid IN ($1, $2)`, workoutUUID, workoutUUID2)
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM sample_types WHERE type_id = $1`, typeID)
	}()

	if _, err := store.pool.Exec(ctx, `
		INSERT INTO workouts (uuid, activity_type, start_ts, end_ts, duration_s, energy_kcal, distance_m, user_id, stats_detail, events, activities)
		VALUES ($1, 'HKWorkoutActivityTypeRunning', $2, $3, 2700, 500, 6000, $4,
		        '{"`+identifier+`":{"avg":68,"max":175}}'::jsonb,
		        '[{"kind":"lap","lap":1}]'::jsonb,
		        '[{"activityType":"HKWorkoutActivityTypeRunning"}]'::jsonb)`,
		workoutUUID, start, end, defaultUserID,
	); err != nil {
		t.Fatalf("insert workout: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO workouts (uuid, activity_type, start_ts, end_ts, duration_s, user_id)
		VALUES ($1, 'HKWorkoutActivityTypeRunning', $2, $3, 2700, $4)`,
		workoutUUID2, start, end, defaultUserID,
	); err != nil {
		t.Fatalf("insert tied-start workout: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO workout_series_points (workout_uuid, type_id, ts, value, user_id)
		VALUES ($1, $2, $3, $4, $5)`,
		workoutUUID, typeID, start.Add(5*time.Minute), 68.0, defaultUserID,
	); err != nil {
		t.Fatalf("insert workout_series_points: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO workout_route_points (workout_uuid, ts, lat, lon, user_id)
		VALUES ($1, $2, $3, $4, $5)`,
		workoutUUID, start.Add(2*time.Minute), 37.0, -122.0, defaultUserID,
	); err != nil {
		t.Fatalf("insert workout_route_points: %v", err)
	}

	detail, err := store.Workout(ctx, workoutUUID)
	if err != nil {
		t.Fatalf("Workout: %v", err)
	}
	if detail == nil {
		t.Fatal("detail is nil")
	}
	if detail.UUID != workoutUUID {
		t.Fatalf("uuid = %q, want %q", detail.UUID, workoutUUID)
	}
	if !detail.HasRoute {
		t.Fatal("hasRoute = false, want true")
	}
	if len(detail.AvailableMetrics) != 1 || detail.AvailableMetrics[0] != identifier {
		t.Fatalf("availableMetrics = %#v, want [%q]", detail.AvailableMetrics, identifier)
	}
	stat, ok := detail.StatisticsDetail[identifier]
	if !ok || stat.Avg == nil || *stat.Avg != 68 {
		t.Fatalf("stats detail = %#v", detail.StatisticsDetail)
	}
	if len(detail.Events) != 1 || detail.Events[0]["kind"] != "lap" {
		t.Fatalf("events = %#v", detail.Events)
	}
	if len(detail.Activities) != 1 || detail.Activities[0]["activityType"] != "HKWorkoutActivityTypeRunning" {
		t.Fatalf("activities = %#v", detail.Activities)
	}

	rangeStart := start.Add(-time.Second)
	rangeEnd := end.Add(time.Second)
	firstPage, err := store.Workouts(ctx, WorkoutFilters{Start: &rangeStart, End: &rangeEnd, Limit: 1})
	if err != nil {
		t.Fatalf("Workouts first page: %v", err)
	}
	secondPage, err := store.Workouts(ctx, WorkoutFilters{Start: &rangeStart, End: &rangeEnd, Limit: 1, Offset: 1})
	if err != nil {
		t.Fatalf("Workouts second page: %v", err)
	}
	if len(firstPage) != 1 || len(secondPage) != 1 {
		t.Fatalf("page lengths = %d,%d, want 1,1", len(firstPage), len(secondPage))
	}
	if firstPage[0].UUID != workoutUUID2 || secondPage[0].UUID != workoutUUID {
		t.Fatalf("tied-start UUID order = %q,%q, want %q,%q", firstPage[0].UUID, secondPage[0].UUID, workoutUUID2, workoutUUID)
	}
}
