package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// resultJSON asserts a successful tool result with one text block and
// decodes it into out.
func resultJSON(t *testing.T, res *mcp.CallToolResult, err error, out any) {
	t.Helper()
	if err != nil {
		t.Fatalf("tool error: %v", err)
	}
	if res == nil || len(res.Content) != 1 {
		t.Fatalf("result = %+v, want exactly one content block", res)
	}
	tc, ok := res.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("content = %T, want *mcp.TextContent", res.Content[0])
	}
	if err := json.Unmarshal([]byte(tc.Text), out); err != nil {
		t.Fatalf("result is not JSON: %v\n%s", err, tc.Text)
	}
}

// wantToolError asserts the handler failed before or after the API with a
// message mentioning each fragment.
func wantToolError(t *testing.T, err error, fragments ...string) {
	t.Helper()
	if err == nil {
		t.Fatal("no error")
	}
	for _, fragment := range fragments {
		if !strings.Contains(err.Error(), fragment) {
			t.Errorf("error %q does not mention %q", err, fragment)
		}
	}
}

func TestGetProfile(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/profile", http.StatusOK, fixtureProfile)
	s := f.service(t, "Europe/Berlin")

	var out profileOutput
	res, _, err := s.getProfile(context.Background(), nil, nil)
	resultJSON(t, res, err, &out)

	if out.UserID != fixtureProfile.UserID || *out.Name != "Test Person" || *out.BiologicalSex != "female" {
		t.Errorf("profile = %+v", out)
	}
	if out.DateOfBirth == nil || *out.DateOfBirth != "1990-09-08" {
		t.Errorf("date_of_birth = %v, want 1990-09-08", out.DateOfBirth)
	}
	// 2026-09-07 in Berlin is the day before the 36th birthday.
	if out.AgeYears == nil || *out.AgeYears != 35 {
		t.Errorf("age_years = %v, want 35", out.AgeYears)
	}
	if out.TimeZone != "Europe/Berlin" || out.Today != "2026-09-07" || out.Now != "2026-09-07T10:00:00+02:00" {
		t.Errorf("clock fields = %s / %s / %s", out.TimeZone, out.Today, out.Now)
	}
}

func TestGetProfile_PropagatesNotFound(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/profile", http.StatusNotFound, map[string]string{"error": "profile not found"})
	_, _, err := f.service(t, "UTC").getProfile(context.Background(), nil, nil)
	wantToolError(t, err, "404", "profile not found")
}

func TestListAvailableTypes(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/catalog/types", http.StatusOK, fixtureCatalog)
	s := f.service(t, "Europe/Berlin")

	// Decode into a generic map too, to check that absent fields are omitted
	// rather than rendered as null.
	var out catalogOutput
	var generic struct {
		Types []map[string]any `json:"types"`
	}
	res, _, err := s.listAvailableTypes(context.Background(), nil, nil)
	resultJSON(t, res, err, &out)
	resultJSON(t, res, err, &generic)

	if out.TimeZone != "Europe/Berlin" || out.Today != "2026-09-07" {
		t.Errorf("clock fields = %s / %s", out.TimeZone, out.Today)
	}
	if len(out.Types) != 2 {
		t.Fatalf("types = %d, want 2", len(out.Types))
	}
	steps := out.Types[0]
	if steps.Identifier != "HKQuantityTypeIdentifierStepCount" || *steps.Unit != "count" || steps.Rows != 1200 || steps.RawRows != 1000 || steps.AggregateRows != 200 {
		t.Errorf("steps = %+v", steps)
	}
	// January is CET (+01:00), September CEST (+02:00).
	if *steps.Earliest != "2024-01-01T09:00:00+01:00" || *steps.Latest != "2026-09-07T00:30:00+02:00" {
		t.Errorf("bounds = %s .. %s", *steps.Earliest, *steps.Latest)
	}
	workouts := generic.Types[1]
	for _, absent := range []string{"unit", "earliest", "latest"} {
		if _, present := workouts[absent]; present {
			t.Errorf("workout entry renders %s although the API had none: %v", absent, workouts)
		}
	}
}

func TestGetLatestMetrics(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/metrics/latest", http.StatusOK, fixtureLatest)
	s := f.service(t, "Europe/Berlin")

	var out latestOutput
	res, _, err := s.getLatestMetrics(context.Background(), nil, typesInput{Types: []string{
		" HKQuantityTypeIdentifierBodyMass ", "HKQuantityTypeIdentifierHeartRate", "", "HKQuantityTypeIdentifierBodyMass",
	}})
	resultJSON(t, res, err, &out)

	if got := f.lastQuery(t, "/v1/metrics/latest").Get("types"); got != "HKQuantityTypeIdentifierBodyMass,HKQuantityTypeIdentifierHeartRate" {
		t.Errorf("types param = %q (should be trimmed, de-duplicated, comma-joined)", got)
	}
	if len(out.Metrics) != 1 || out.Metrics[0].Identifier != "HKQuantityTypeIdentifierBodyMass" {
		t.Fatalf("metrics = %+v", out.Metrics)
	}
	m := out.Metrics[0]
	if *m.Value != 82.4568 || *m.Unit != "kg" || m.Timestamp != "2026-09-06T08:05:00+02:00" {
		t.Errorf("metric = %+v", m)
	}
	if len(out.Missing) != 1 || out.Missing[0] != "HKQuantityTypeIdentifierHeartRate" {
		t.Errorf("missing = %v", out.Missing)
	}
	if out.AsOf != "2026-09-07T10:00:00+02:00" {
		t.Errorf("as_of = %s", out.AsOf)
	}
}

func TestGetLatestMetrics_ValidatesTypesBeforeCalling(t *testing.T) {
	f := newFakeAPI(t)
	s := f.service(t, "UTC")
	ctx := context.Background()

	_, _, err := s.getLatestMetrics(ctx, nil, typesInput{Types: []string{" ", ""}})
	wantToolError(t, err, "at least one")

	eleven := make([]string, 11)
	for i := range eleven {
		eleven[i] = "HKQuantityTypeIdentifierType" + string(rune('A'+i))
	}
	_, _, err = s.getLatestMetrics(ctx, nil, typesInput{Types: eleven})
	wantToolError(t, err, "11", "at most 10")

	if calls := f.callsTo("/v1/metrics/latest"); len(calls) != 0 {
		t.Errorf("invalid input reached the API: %v", calls)
	}
}

func TestGetDailyMetrics_MapsInclusiveDatesToAPIRange(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/metrics/daily", http.StatusOK, fixtureDaily)
	s := f.service(t, "Europe/Berlin")

	var out dailyOutput
	res, _, err := s.getDailyMetrics(context.Background(), nil, dailyInput{
		Types:     []string{"HKQuantityTypeIdentifierStepCount", "HKQuantityTypeIdentifierBodyMass"},
		StartDate: "2026-03-28",
		EndDate:   "2026-03-29",
	})
	resultJSON(t, res, err, &out)

	q := f.lastQuery(t, "/v1/metrics/daily")
	wantStart := time.Date(2026, 3, 27, 23, 0, 0, 0, time.UTC).UnixMilli() // 2026-03-28T00:00 CET
	wantEnd := time.Date(2026, 3, 29, 22, 0, 0, 0, time.UTC).UnixMilli()   // 2026-03-30T00:00 CEST
	if q.Get("start") != itoa(wantStart) || q.Get("end") != itoa(wantEnd) {
		t.Errorf("start/end = %s/%s, want %d/%d", q.Get("start"), q.Get("end"), wantStart, wantEnd)
	}
	if q.Get("types") != "HKQuantityTypeIdentifierStepCount,HKQuantityTypeIdentifierBodyMass" {
		t.Errorf("types = %q", q.Get("types"))
	}

	if out.TimeZone != "Europe/Berlin" || out.StartDate != "2026-03-28" || out.EndDate != "2026-03-29" {
		t.Errorf("echoed range = %s %s..%s", out.TimeZone, out.StartDate, out.EndDate)
	}
	if len(out.Metrics) != 1 || len(out.Metrics[0].Days) != 2 {
		t.Fatalf("metrics = %+v", out.Metrics)
	}
	if d := out.Metrics[0].Days[1]; d.Date != "2026-03-29" || *d.Value != 10456 {
		t.Errorf("day = %+v (value should be rounded)", d)
	}
	if len(out.Missing) != 1 || out.Missing[0] != "HKQuantityTypeIdentifierBodyMass" {
		t.Errorf("missing = %v", out.Missing)
	}
}

func TestGetDailyMetrics_ValidatesBeforeCalling(t *testing.T) {
	f := newFakeAPI(t)
	s := f.service(t, "UTC")
	ctx := context.Background()
	types := []string{"HKQuantityTypeIdentifierStepCount"}

	_, _, err := s.getDailyMetrics(ctx, nil, dailyInput{Types: types, StartDate: "2026-09-08", EndDate: "2026-09-07"})
	wantToolError(t, err, "end_date 2026-09-07 is before start_date 2026-09-08")

	_, _, err = s.getDailyMetrics(ctx, nil, dailyInput{Types: types, StartDate: "2025-01-01", EndDate: "2026-09-07"})
	wantToolError(t, err, "at most 366 days")

	_, _, err = s.getDailyMetrics(ctx, nil, dailyInput{Types: types, StartDate: "last monday", EndDate: "2026-09-07"})
	wantToolError(t, err, "start_date", "YYYY-MM-DD")

	_, _, err = s.getDailyMetrics(ctx, nil, dailyInput{Types: nil, StartDate: "2026-09-01", EndDate: "2026-09-07"})
	wantToolError(t, err, "types")

	if calls := f.callsTo("/v1/metrics/daily"); len(calls) != 0 {
		t.Errorf("invalid input reached the API: %v", calls)
	}
}

func TestGetDailyMetrics_PropagatesAPIErrors(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/metrics/daily", http.StatusInternalServerError, map[string]string{"error": "daily metrics failed"})
	s := f.service(t, "UTC")
	_, _, err := s.getDailyMetrics(context.Background(), nil, dailyInput{
		Types: []string{"HKQuantityTypeIdentifierStepCount"}, StartDate: "2026-09-01", EndDate: "2026-09-07",
	})
	wantToolError(t, err, "500", "daily metrics failed", "/v1/metrics/daily")
}

func TestGetActivityRings(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/activity/summary", http.StatusOK, fixtureActivity)
	s := f.service(t, "Europe/Berlin")

	var out ringsOutput
	var generic struct {
		Days []map[string]any `json:"days"`
	}
	res, _, err := s.getActivityRings(context.Background(), nil, rangeInput{StartDate: "2026-09-06", EndDate: "2026-09-06"})
	resultJSON(t, res, err, &out)
	resultJSON(t, res, err, &generic)

	q := f.lastQuery(t, "/v1/activity/summary")
	wantStart := time.Date(2026, 9, 5, 22, 0, 0, 0, time.UTC).UnixMilli()
	wantEnd := time.Date(2026, 9, 6, 22, 0, 0, 0, time.UTC).UnixMilli()
	if q.Get("start") != itoa(wantStart) || q.Get("end") != itoa(wantEnd) {
		t.Errorf("start/end = %s/%s, want %d/%d", q.Get("start"), q.Get("end"), wantStart, wantEnd)
	}
	if len(out.Days) != 1 {
		t.Fatalf("days = %+v", out.Days)
	}
	d := out.Days[0]
	if d.Date != "2026-09-06" || *d.MoveKcal != 512.3 || *d.MoveGoalKcal != 500 || *d.ExerciseMin != 31 || *d.StandHours != 11 || *d.MoveMode != 1 {
		t.Errorf("day = %+v", d)
	}
	if _, present := generic.Days[0]["move_time_min"]; present {
		t.Errorf("null Move Time fields should be omitted: %v", generic.Days[0])
	}
}

func TestListWorkouts(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/workouts", http.StatusOK, WorkoutsPage{Workouts: []WorkoutSummary{fixtureWorkoutSummary}, NextOffset: 1})
	s := f.service(t, "Europe/Berlin")
	ctx := context.Background()

	t.Run("defaults", func(t *testing.T) {
		var out workoutsOutput
		res, _, err := s.listWorkouts(ctx, nil, workoutsInput{})
		resultJSON(t, res, err, &out)
		q := f.lastQuery(t, "/v1/workouts")
		if q.Get("limit") != "50" || q.Get("offset") != "0" || q.Has("start") || q.Has("end") || q.Has("activityType") {
			t.Errorf("query = %v", q)
		}
		if len(out.Workouts) != 1 {
			t.Fatalf("workouts = %+v", out.Workouts)
		}
		w := out.Workouts[0]
		if w.UUID != workoutUUID || w.ActivityType != "running" || w.Start != "2026-09-06T07:30:00+02:00" || w.End != "2026-09-06T08:15:00+02:00" {
			t.Errorf("workout = %+v", w)
		}
		if *w.DurationS != 2700 || *w.DistanceM != 8012.5 || *w.EnergyKcal != 610.25 || !w.HasRoute || len(w.AvailableMetrics) != 1 {
			t.Errorf("workout = %+v", w)
		}
		if out.NextOffset != nil {
			t.Errorf("next_offset = %d for a page smaller than the limit", *out.NextOffset)
		}
	})

	t.Run("filters map to the API", func(t *testing.T) {
		var out workoutsOutput
		res, _, err := s.listWorkouts(ctx, nil, workoutsInput{
			StartDate: "2026-09-01", EndDate: "2026-09-06", ActivityType: " running ", Limit: 250, Offset: 20,
		})
		resultJSON(t, res, err, &out)
		q := f.lastQuery(t, "/v1/workouts")
		wantStart := time.Date(2026, 8, 31, 22, 0, 0, 0, time.UTC).UnixMilli()
		wantEnd := time.Date(2026, 9, 6, 22, 0, 0, 0, time.UTC).UnixMilli()
		if q.Get("start") != itoa(wantStart) || q.Get("end") != itoa(wantEnd) {
			t.Errorf("start/end = %s/%s, want %d/%d", q.Get("start"), q.Get("end"), wantStart, wantEnd)
		}
		if q.Get("activityType") != "running" || q.Get("limit") != "200" || q.Get("offset") != "20" {
			t.Errorf("query = %v (limit should clamp to 200, activity trimmed)", q)
		}
	})

	t.Run("one-sided ranges", func(t *testing.T) {
		if _, _, err := s.listWorkouts(ctx, nil, workoutsInput{StartDate: "2026-09-01"}); err != nil {
			t.Fatal(err)
		}
		q := f.lastQuery(t, "/v1/workouts")
		if !q.Has("start") || q.Has("end") {
			t.Errorf("query = %v", q)
		}
		if _, _, err := s.listWorkouts(ctx, nil, workoutsInput{EndDate: "2026-09-06"}); err != nil {
			t.Fatal(err)
		}
		q = f.lastQuery(t, "/v1/workouts")
		if q.Has("start") || q.Get("end") != itoa(time.Date(2026, 9, 6, 22, 0, 0, 0, time.UTC).UnixMilli()) {
			t.Errorf("query = %v", q)
		}
	})

	t.Run("next_offset when the page is full", func(t *testing.T) {
		var out workoutsOutput
		res, _, err := s.listWorkouts(ctx, nil, workoutsInput{Limit: 1, Offset: 3})
		resultJSON(t, res, err, &out)
		if out.NextOffset == nil || *out.NextOffset != 4 {
			t.Errorf("next_offset = %v, want 4", out.NextOffset)
		}
	})

	t.Run("rejects bad input before calling", func(t *testing.T) {
		before := len(f.callsTo("/v1/workouts"))
		_, _, err := s.listWorkouts(ctx, nil, workoutsInput{Limit: -1})
		wantToolError(t, err, "limit")
		_, _, err = s.listWorkouts(ctx, nil, workoutsInput{Offset: -1})
		wantToolError(t, err, "offset")
		_, _, err = s.listWorkouts(ctx, nil, workoutsInput{StartDate: "2026-09-07", EndDate: "2026-09-01"})
		wantToolError(t, err, "before start_date")
		_, _, err = s.listWorkouts(ctx, nil, workoutsInput{EndDate: "next week"})
		wantToolError(t, err, "end_date")
		if after := len(f.callsTo("/v1/workouts")); after != before {
			t.Errorf("invalid input reached the API")
		}
	})
}

func TestGetWorkout(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/workouts/"+workoutUUID, http.StatusOK, fixtureWorkoutDetail())
	s := f.service(t, "Europe/Berlin")
	ctx := context.Background()

	t.Run("rejects a non-uuid without calling", func(t *testing.T) {
		_, _, err := s.getWorkout(ctx, nil, workoutInput{UUID: "yesterday's run"})
		wantToolError(t, err, "not a workout uuid")
		if calls := f.callsTo("/v1/workouts/yesterday's run"); len(calls) != 0 {
			t.Error("reached the API")
		}
	})

	t.Run("detail", func(t *testing.T) {
		var out workoutOutput
		res, _, err := s.getWorkout(ctx, nil, workoutInput{UUID: strings.ToUpper(workoutUUID)})
		resultJSON(t, res, err, &out)
		if len(f.callsTo("/v1/workouts/"+workoutUUID)) != 1 {
			t.Errorf("uuid should be lower-cased in the path; calls: %v", f.calls)
		}
		if out.UUID != workoutUUID || out.Start != "2026-09-06T07:30:00+02:00" {
			t.Errorf("summary = %+v", out.workoutEntry)
		}
		hr := out.Statistics["HKQuantityTypeIdentifierHeartRate"]
		if hr.Min == nil || *hr.Avg != 151.3333 || *hr.Max != 178 || hr.Sum != nil {
			t.Errorf("heart rate stats = %+v", hr)
		}
		if len(out.Events) != 2 || out.EventsTruncated {
			t.Fatalf("events = %+v", out.Events)
		}
		if out.Events[0]["start"] != "2026-09-06T07:50:00+02:00" || out.Events[0]["type"] != "pause" {
			t.Errorf("event 0 = %v (epoch-ms start should read as ISO 8601)", out.Events[0])
		}
		if out.Events[1]["end"] != "2026-09-06T07:45:00+02:00" {
			t.Errorf("event 1 = %v", out.Events[1])
		}
		if len(out.Activities) != 1 || out.Activities[0]["duration"] != 2700.0 {
			t.Errorf("activities = %v", out.Activities)
		}
	})

	t.Run("not found", func(t *testing.T) {
		other := "ffffffff-ffff-4fff-8fff-ffffffffffff"
		f.respond("/v1/workouts/"+other, http.StatusNotFound, map[string]string{"error": "workout not found"})
		_, _, err := s.getWorkout(ctx, nil, workoutInput{UUID: other})
		wantToolError(t, err, "404", "workout not found")
	})

	t.Run("caps events", func(t *testing.T) {
		big := fixtureWorkoutDetail()
		big.Events = make([]map[string]any, maxWorkoutEvents+50)
		for i := range big.Events {
			big.Events[i] = map[string]any{"type": "lap", "index": i}
		}
		f.respond("/v1/workouts/"+workoutUUID, http.StatusOK, big)
		var out workoutOutput
		res, _, err := s.getWorkout(ctx, nil, workoutInput{UUID: workoutUUID})
		resultJSON(t, res, err, &out)
		if len(out.Events) != maxWorkoutEvents || !out.EventsTruncated {
			t.Errorf("events = %d, truncated = %v", len(out.Events), out.EventsTruncated)
		}
	})
}

func itoa(ms int64) string { return strconv.FormatInt(ms, 10) }

func TestGetSleep(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/sleep/daily", http.StatusOK, fixtureSleep)
	s := f.service(t, "Europe/Berlin")
	ctx := context.Background()

	var out sleepOutput
	res, _, err := s.getSleep(ctx, nil, rangeInput{StartDate: "2026-09-21", EndDate: "2026-09-21"})
	resultJSON(t, res, err, &out)

	// One inclusive local day maps to that day's [midnight, midnight) range.
	q := f.lastQuery(t, "/v1/sleep/daily")
	wantStart := time.Date(2026, 9, 20, 22, 0, 0, 0, time.UTC).UnixMilli()
	wantEnd := time.Date(2026, 9, 21, 22, 0, 0, 0, time.UTC).UnixMilli()
	if q.Get("start") != itoa(wantStart) || q.Get("end") != itoa(wantEnd) {
		t.Errorf("start/end = %s/%s, want %d/%d", q.Get("start"), q.Get("end"), wantStart, wantEnd)
	}

	if out.TimeZone != "Europe/Berlin" || out.StartDate != "2026-09-21" || out.EndDate != "2026-09-21" {
		t.Errorf("echoed range = %s %s..%s", out.TimeZone, out.StartDate, out.EndDate)
	}
	if len(out.Nights) != 1 {
		t.Fatalf("nights = %+v", out.Nights)
	}
	n := out.Nights[0]
	// The night is dated by its wake-up day even though it began the evening
	// before, and its instants read as local time.
	if n.Date != "2026-09-21" || n.Start != "2026-09-20T22:30:00+02:00" || n.End != "2026-09-21T06:30:00+02:00" {
		t.Errorf("night = %+v", n)
	}
	if n.InBedMin != 480 || n.AsleepMin != 460 || n.SourceCount != 2 {
		t.Errorf("night totals = %+v (asleep_min should be rounded)", n)
	}
	if n.Stages != (sleepStageBreak{CoreMin: 340, DeepMin: 60, REMMin: 60, AwakeMin: 10}) {
		t.Errorf("stages = %+v", n.Stages)
	}
	// Every stage key is present, zeroes included, so "no REM" is visible.
	var generic struct {
		Nights []map[string]any `json:"nights"`
	}
	resultJSON(t, res, err, &generic)
	stages, ok := generic.Nights[0]["stages"].(map[string]any)
	if !ok || stages["unspecified_min"] != 0.0 || len(stages) != 5 {
		t.Errorf("stages json = %v", generic.Nights[0]["stages"])
	}
}

func TestGetSleep_ValidatesBeforeCalling(t *testing.T) {
	f := newFakeAPI(t)
	s := f.service(t, "UTC")
	ctx := context.Background()

	_, _, err := s.getSleep(ctx, nil, rangeInput{StartDate: "2026-09-08", EndDate: "2026-09-07"})
	wantToolError(t, err, "end_date 2026-09-07 is before start_date 2026-09-08")

	_, _, err = s.getSleep(ctx, nil, rangeInput{StartDate: "2025-01-01", EndDate: "2026-09-07"})
	wantToolError(t, err, "at most 366 days")

	if calls := f.callsTo("/v1/sleep/daily"); len(calls) != 0 {
		t.Errorf("invalid input reached the API: %v", calls)
	}

	f.respond("/v1/sleep/daily", http.StatusBadRequest, map[string]string{"error": "range covers 400 days; at most 366 days per request"})
	_, _, err = s.getSleep(ctx, nil, rangeInput{StartDate: "2026-09-01", EndDate: "2026-09-07"})
	wantToolError(t, err, "400", "at most 366 days per request")
}

func TestGetSamples(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/samples", http.StatusOK, fixtureSamples)
	s := f.service(t, "Europe/Berlin")
	ctx := context.Background()

	t.Run("defaults and shape", func(t *testing.T) {
		var out samplesOutput
		res, _, err := s.getSamples(ctx, nil, samplesInput{
			Type: " HKCategoryTypeIdentifierSleepAnalysis ", StartDate: "2026-09-20", EndDate: "2026-09-21",
		})
		resultJSON(t, res, err, &out)

		q := f.lastQuery(t, "/v1/samples")
		if q.Get("type") != "HKCategoryTypeIdentifierSleepAnalysis" || q.Get("limit") != "500" || q.Get("offset") != "0" {
			t.Errorf("query = %v", q)
		}
		if out.Kind != "category" || out.StartDate != "2026-09-20" || out.EndDate != "2026-09-21" {
			t.Errorf("out = %+v", out)
		}
		if len(out.Samples) != 1 {
			t.Fatalf("samples = %+v", out.Samples)
		}
		sample := out.Samples[0]
		if sample.Start != "2026-09-20T22:40:00+02:00" || *sample.Value != 3 || *sample.Label != "Asleep Core" || *sample.Source != "Apple Watch" {
			t.Errorf("sample = %+v", sample)
		}
		// A short page is the end of the data, so no paging hint.
		if out.NextOffset != nil {
			t.Errorf("next_offset = %v, want none for a short page", *out.NextOffset)
		}
	})

	t.Run("a full page offers the next offset", func(t *testing.T) {
		var out samplesOutput
		res, _, err := s.getSamples(ctx, nil, samplesInput{
			Type: "HKCategoryTypeIdentifierSleepAnalysis", StartDate: "2026-09-20", EndDate: "2026-09-21", Limit: 1,
		})
		resultJSON(t, res, err, &out)
		if out.NextOffset == nil || *out.NextOffset != 1 {
			t.Errorf("next_offset = %v, want 1", out.NextOffset)
		}
	})

	t.Run("clamps the limit", func(t *testing.T) {
		if _, _, err := s.getSamples(ctx, nil, samplesInput{
			Type: "HKCategoryTypeIdentifierSleepAnalysis", StartDate: "2026-09-20", EndDate: "2026-09-21", Limit: 999999,
		}); err != nil {
			t.Fatal(err)
		}
		if q := f.lastQuery(t, "/v1/samples"); q.Get("limit") != itoa(maxSampleLimit) {
			t.Errorf("limit = %q, want %d", q.Get("limit"), maxSampleLimit)
		}
	})
}

func TestGetSamples_ValidatesBeforeCalling(t *testing.T) {
	f := newFakeAPI(t)
	s := f.service(t, "UTC")
	ctx := context.Background()
	const typ = "HKQuantityTypeIdentifierHeartRate"

	_, _, err := s.getSamples(ctx, nil, samplesInput{Type: "  ", StartDate: "2026-09-01", EndDate: "2026-09-07"})
	wantToolError(t, err, "type must name one HealthKit identifier")

	// The 31-day cap is the API's; the tool rejects a longer span itself.
	_, _, err = s.getSamples(ctx, nil, samplesInput{Type: typ, StartDate: "2026-08-01", EndDate: "2026-09-07"})
	wantToolError(t, err, "at most 31 days")

	_, _, err = s.getSamples(ctx, nil, samplesInput{Type: typ, StartDate: "2026-09-07", EndDate: "2026-09-01"})
	wantToolError(t, err, "before start_date")

	_, _, err = s.getSamples(ctx, nil, samplesInput{Type: typ, StartDate: "2026-09-01", EndDate: "2026-09-07", Limit: -1})
	wantToolError(t, err, "limit must be at least 1")

	_, _, err = s.getSamples(ctx, nil, samplesInput{Type: typ, StartDate: "2026-09-01", EndDate: "2026-09-07", Offset: -1})
	wantToolError(t, err, "offset must be at least 0")

	if calls := f.callsTo("/v1/samples"); len(calls) != 0 {
		t.Errorf("invalid input reached the API: %v", calls)
	}

	// Exactly 31 days is fine.
	f.respond("/v1/samples", http.StatusOK, SamplesPage{Type: typ, Kind: "quantity", Samples: []Sample{}})
	if _, _, err := s.getSamples(ctx, nil, samplesInput{Type: typ, StartDate: "2026-08-08", EndDate: "2026-09-07"}); err != nil {
		t.Errorf("31 days rejected: %v", err)
	}
}

func TestGetWorkoutSeries(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/workouts/"+workoutUUID+"/series", http.StatusOK, fixtureSeries())
	s := f.service(t, "Europe/Berlin")
	ctx := context.Background()

	t.Run("defaults and offsets", func(t *testing.T) {
		var out workoutSeriesOutput
		res, _, err := s.getWorkoutSeries(ctx, nil, workoutSeriesInput{UUID: strings.ToUpper(workoutUUID)})
		resultJSON(t, res, err, &out)

		q := f.lastQuery(t, "/v1/workouts/"+workoutUUID+"/series")
		if q.Get("maxPoints") != "500" || q.Has("types") {
			t.Errorf("query = %v", q)
		}
		if out.UUID != workoutUUID || out.Start != "2026-09-06T07:30:00+02:00" {
			t.Errorf("out = %+v", out)
		}
		if len(out.Series) != 1 {
			t.Fatalf("series = %+v", out.Series)
		}
		series := out.Series[0]
		if series.Type != "HKQuantityTypeIdentifierHeartRate" || *series.Unit != "count/min" {
			t.Errorf("series = %+v", series)
		}
		if series.TotalPoints != 2700 || series.ReturnedPoints != 4 || !series.Downsampled {
			t.Errorf("counts = %+v", series)
		}
		// Points are [seconds after the workout start, value], rounded.
		want := [][2]float64{{0, 98}, {60, 120.5}, {120, 151}, {180, 143}}
		for i, p := range series.Points {
			if p != want[i] {
				t.Errorf("point %d = %v, want %v", i, p, want[i])
			}
		}
	})

	t.Run("types filter and max_points clamp", func(t *testing.T) {
		if _, _, err := s.getWorkoutSeries(ctx, nil, workoutSeriesInput{
			UUID:      workoutUUID,
			Types:     []string{"HKQuantityTypeIdentifierHeartRate", " ", "HKQuantityTypeIdentifierRunningPower", "HKQuantityTypeIdentifierHeartRate"},
			MaxPoints: 999999,
		}); err != nil {
			t.Fatal(err)
		}
		q := f.lastQuery(t, "/v1/workouts/"+workoutUUID+"/series")
		if q.Get("types") != "HKQuantityTypeIdentifierHeartRate,HKQuantityTypeIdentifierRunningPower" {
			t.Errorf("types = %q (blanks and duplicates should be dropped)", q.Get("types"))
		}
		if q.Get("maxPoints") != itoa(maxSeriesPoints) {
			t.Errorf("maxPoints = %q, want %d", q.Get("maxPoints"), maxSeriesPoints)
		}
	})

	t.Run("rejects bad input before calling", func(t *testing.T) {
		_, _, err := s.getWorkoutSeries(ctx, nil, workoutSeriesInput{UUID: "yesterday's run"})
		wantToolError(t, err, "is not a workout uuid")

		_, _, err = s.getWorkoutSeries(ctx, nil, workoutSeriesInput{UUID: workoutUUID, MaxPoints: -5})
		wantToolError(t, err, "max_points must be at least 1")
	})

	t.Run("not found", func(t *testing.T) {
		other := "ffffffff-ffff-4fff-8fff-ffffffffffff"
		f.respond("/v1/workouts/"+other+"/series", http.StatusNotFound, map[string]string{"error": "workout not found"})
		_, _, err := s.getWorkoutSeries(ctx, nil, workoutSeriesInput{UUID: other})
		wantToolError(t, err, "404", "workout not found")
	})
}

func TestGetStateOfMind(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/state-of-mind", http.StatusOK, fixtureStateOfMind)
	s := f.service(t, "Europe/Berlin")
	ctx := context.Background()

	var out stateOfMindOutput
	res, _, err := s.getStateOfMind(ctx, nil, rangeInput{StartDate: "2026-09-06", EndDate: "2026-09-06"})
	resultJSON(t, res, err, &out)

	q := f.lastQuery(t, "/v1/state-of-mind")
	wantStart := time.Date(2026, 9, 5, 22, 0, 0, 0, time.UTC).UnixMilli()
	wantEnd := time.Date(2026, 9, 6, 22, 0, 0, 0, time.UTC).UnixMilli()
	if q.Get("start") != itoa(wantStart) || q.Get("end") != itoa(wantEnd) {
		t.Errorf("start/end = %s/%s, want %d/%d", q.Get("start"), q.Get("end"), wantStart, wantEnd)
	}
	if len(out.Entries) != 1 {
		t.Fatalf("entries = %+v", out.Entries)
	}
	e := out.Entries[0]
	if e.Date != "2026-09-06" || e.Timestamp != "2026-09-06T19:00:00+02:00" || e.Kind != "momentaryEmotion" {
		t.Errorf("entry = %+v", e)
	}
	if *e.Valence != 0.5 || *e.ValenceClassification != "slightlyPleasant" {
		t.Errorf("valence = %v / %v (should be rounded)", e.Valence, e.ValenceClassification)
	}
	if strings.Join(e.Labels, ",") != "calm,grateful" || strings.Join(e.Associations, ",") != "family" {
		t.Errorf("labels/associations = %v / %v", e.Labels, e.Associations)
	}

	_, _, err = s.getStateOfMind(ctx, nil, rangeInput{StartDate: "2025-01-01", EndDate: "2026-09-07"})
	wantToolError(t, err, "at most 366 days")
}
