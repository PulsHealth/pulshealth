package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeStore struct {
	profile  Profile
	catalog  []CatalogType
	latest   []LatestMetric
	daily    []DailyMetric
	activity []ActivityDay
	workouts []WorkoutSummary
	workout  *WorkoutDetail
	calls    struct {
		catalog int
	}
	err error
}

func (f *fakeStore) Ping(context.Context) error { return f.err }

func (f *fakeStore) Profile(context.Context) (*Profile, error) {
	if f.err != nil {
		return nil, f.err
	}
	profile := f.profile
	return &profile, nil
}

func (f *fakeStore) CatalogTypes(context.Context) ([]CatalogType, error) {
	if f.err != nil {
		return nil, f.err
	}
	f.calls.catalog++
	return f.catalog, nil
}

func (f *fakeStore) LatestMetrics(context.Context, []string) ([]LatestMetric, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.latest, nil
}

func (f *fakeStore) DailyMetrics(context.Context, []string, time.Time, time.Time) ([]DailyMetric, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.daily, nil
}

func (f *fakeStore) ActivitySummary(context.Context, time.Time, time.Time) ([]ActivityDay, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.activity, nil
}

func (f *fakeStore) Workouts(context.Context, WorkoutFilters) ([]WorkoutSummary, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.workouts, nil
}

func (f *fakeStore) Workout(context.Context, string) (*WorkoutDetail, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.workout, nil
}

func TestHealthzWithoutAuthReturnsOK(t *testing.T) {
	t.Parallel()

	srv := &Server{
		store: &fakeStore{},
		token: "secret",
		log:   slog.New(slog.NewTextHandler(testWriter{t}, nil)),
	}

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if !body["ok"] || !body["db"] {
		t.Fatalf("body = %#v, want ok=true db=true", body)
	}
}

func TestIndexWithoutAuthAdvertisesDocs(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["docs"] != "/docs" {
		t.Fatalf("docs = %#v, want /docs", body["docs"])
	}
	if body["openapi"] != "/openapi.json" {
		t.Fatalf("openapi = %#v, want /openapi.json", body["openapi"])
	}
}

func TestUnknownPathsReturnNotFound(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{})
	for _, path := range []string{"/not-found", "/v1/profil"} {
		path := path
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			srv.routes().ServeHTTP(rec, req)

			if rec.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
			}
		})
	}
}

func TestDocsWithoutAuthReturnsHTML(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{})
	req := httptest.NewRequest(http.MethodGet, "/docs", nil)
	rec := httptest.NewRecorder()

	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Fatalf("content-type = %q, want text/html; charset=utf-8", got)
	}
	if !strings.Contains(rec.Body.String(), "PulsHealth Product API") {
		t.Fatalf("docs body missing title")
	}
}

func TestOpenAPIWithoutAuthAdvertisesProductPaths(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{})
	req := httptest.NewRequest(http.MethodGet, "/openapi.json", nil)
	rec := httptest.NewRecorder()

	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/openapi+json" {
		t.Fatalf("content-type = %q, want application/openapi+json", got)
	}

	var body struct {
		OpenAPI    string                    `json:"openapi"`
		Paths      map[string]map[string]any `json:"paths"`
		Components struct {
			Schemas map[string]json.RawMessage `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	for _, path := range []string{"/v1/profile", "/v1/catalog/types", "/v1/metrics/latest", "/v1/metrics/daily", "/v1/activity/summary", "/v1/workouts", "/v1/workouts/{uuid}"} {
		if _, ok := body.Paths[path]; !ok {
			t.Fatalf("openapi paths missing %s", path)
		}
	}
	if _, ok := body.Components.Schemas["WorkoutDetail"]; !ok {
		t.Fatal("openapi schemas missing WorkoutDetail")
	}
}

func TestProfileRejectsMissingBearerToken(t *testing.T) {
	t.Parallel()

	srv := &Server{
		store: &fakeStore{},
		token: "secret",
		log:   slog.New(slog.NewTextHandler(testWriter{t}, nil)),
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/profile", nil)
	rec := httptest.NewRecorder()

	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if got := rec.Header().Get("WWW-Authenticate"); got != "Bearer" {
		t.Fatalf("WWW-Authenticate = %q, want Bearer", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "unauthorized" {
		t.Fatalf("body error = %q, want %q", body["error"], "unauthorized")
	}
}

func TestProfileReturnsJSONWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := &Server{
		store: &fakeStore{
			profile: Profile{
				UserID:        defaultUserID,
				Name:          ptrString("Ada Example"),
				Email:         ptrString("ada@example.com"),
				DateOfBirth:   ptrInt64(631152000000),
				BiologicalSex: ptrString("male"),
			},
		},
		token: "secret",
		log:   slog.New(slog.NewTextHandler(testWriter{t}, nil)),
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/profile", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()

	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}

	var body Profile
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.UserID != defaultUserID {
		t.Fatalf("userID = %q, want %q", body.UserID, defaultUserID)
	}
	if got := deref(body.Name); got != "Ada Example" {
		t.Fatalf("name = %q, want %q", got, "Ada Example")
	}
	if body.DateOfBirth == nil || *body.DateOfBirth != 631152000000 {
		t.Fatalf("dateOfBirth = %v, want %d", body.DateOfBirth, int64(631152000000))
	}
}

func TestCatalogTypesReturnsTypesWhenAuthorized(t *testing.T) {
	t.Parallel()

	earliest := int64(1751328000000)
	latest := int64(1751562000000)
	srv := &Server{
		store: &fakeStore{
			catalog: []CatalogType{
				{
					Identifier:    "HKQuantityTypeIdentifierHeartRate",
					Kind:          "quantity",
					Unit:          ptrString("count/min"),
					Rows:          42,
					RawRows:       40,
					AggregateRows: 2,
					Earliest:      &earliest,
					Latest:        &latest,
				},
			},
		},
		token: "secret",
		log:   slog.New(slog.NewTextHandler(testWriter{t}, nil)),
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/catalog/types", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()

	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Types []CatalogType `json:"types"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Types) != 1 {
		t.Fatalf("types len = %d, want 1", len(body.Types))
	}
	if body.Types[0].Identifier != "HKQuantityTypeIdentifierHeartRate" {
		t.Fatalf("identifier = %q, want %q", body.Types[0].Identifier, "HKQuantityTypeIdentifierHeartRate")
	}
	if body.Types[0].Earliest == nil || *body.Types[0].Earliest != earliest {
		t.Fatalf("earliest = %v, want %d", body.Types[0].Earliest, earliest)
	}
	if body.Types[0].Latest == nil || *body.Types[0].Latest != latest {
		t.Fatalf("latest = %v, want %d", body.Types[0].Latest, latest)
	}
	if body.Types[0].Rows != 42 || body.Types[0].RawRows != 40 || body.Types[0].AggregateRows != 2 {
		t.Fatalf("catalog counts = %#v", body.Types[0])
	}
}

func TestCatalogTypesUsesCacheAcrossRequests(t *testing.T) {
	t.Parallel()

	store := &fakeStore{
		catalog: []CatalogType{{Identifier: "HKQuantityTypeIdentifierHeartRate", Kind: "quantity"}},
	}
	srv := testServer(t, store)

	rec1 := serveAuthorized(t, srv, http.MethodGet, "/v1/catalog/types", nil)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first status = %d, want %d", rec1.Code, http.StatusOK)
	}
	rec2 := serveAuthorized(t, srv, http.MethodGet, "/v1/catalog/types", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second status = %d, want %d", rec2.Code, http.StatusOK)
	}
	if store.calls.catalog != 1 {
		t.Fatalf("catalog calls = %d, want 1", store.calls.catalog)
	}
}

func TestCatalogTypesReturnsEmptyArrayWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{catalog: []CatalogType{}})
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/catalog/types", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	assertJSONKeyIsArray(t, rec.Body.Bytes(), "types")
}

func TestHealthzReturns503WhenPingFails(t *testing.T) {
	t.Parallel()

	srv := &Server{
		store: &fakeStore{err: errors.New("db down")},
		token: "secret",
		log:   slog.New(slog.NewTextHandler(testWriter{t}, nil)),
	}

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}

	var body map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["ok"] || body["db"] {
		t.Fatalf("body = %#v, want ok=false db=false", body)
	}
}

func TestLatestMetricsReturnsMetricsWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{
		latest: []LatestMetric{
			{
				Identifier: "HKQuantityTypeIdentifierHeartRate",
				Unit:       ptrString("count/min"),
				Value:      ptrFloat64(68),
				Timestamp:  1751562000000,
			},
		},
	})

	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/metrics/latest?types=HKQuantityTypeIdentifierHeartRate", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Metrics []LatestMetric `json:"metrics"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Metrics) != 1 || body.Metrics[0].Identifier != "HKQuantityTypeIdentifierHeartRate" {
		t.Fatalf("metrics = %#v", body.Metrics)
	}
}

func TestLatestMetricsReturnsEmptyArrayWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{latest: []LatestMetric{}})
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/metrics/latest?types=HKQuantityTypeIdentifierHeartRate", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	assertJSONKeyIsArray(t, rec.Body.Bytes(), "metrics")
}

func TestDailyMetricsReturnsMetricsWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{
		daily: []DailyMetric{
			{
				Identifier: "HKQuantityTypeIdentifierStepCount",
				Unit:       ptrString("count"),
				Days: []DailyPoint{
					{Date: "2026-07-01", Value: ptrFloat64(1234)},
				},
			},
		},
	})

	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/metrics/daily?types=HKQuantityTypeIdentifierStepCount&start=1751328000000&end=1751414400000", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Metrics []DailyMetric `json:"metrics"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Metrics) != 1 || body.Metrics[0].Identifier != "HKQuantityTypeIdentifierStepCount" {
		t.Fatalf("metrics = %#v", body.Metrics)
	}
}

func TestDailyMetricsReturnsEmptyArrayWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{daily: []DailyMetric{}})
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/metrics/daily?types=HKQuantityTypeIdentifierStepCount&start=1751328000000&end=1751414400000", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	assertJSONKeyIsArray(t, rec.Body.Bytes(), "metrics")
}

func TestActivitySummaryReturnsDaysWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{
		activity: []ActivityDay{
			{Date: "2026-07-01", MoveMode: ptrInt(1), MoveKcal: ptrFloat64(400)},
		},
	})

	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/activity/summary?start=1751328000000&end=1751414400000", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Days []ActivityDay `json:"days"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Days) != 1 || body.Days[0].Date != "2026-07-01" {
		t.Fatalf("days = %#v", body.Days)
	}
}

func TestActivitySummaryReturnsEmptyArrayWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{activity: []ActivityDay{}})
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/activity/summary?start=1751328000000&end=1751414400000", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	assertJSONKeyIsArray(t, rec.Body.Bytes(), "days")
}

func TestWorkoutsReturnsWorkoutsAndNextOffset(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{
		workouts: []WorkoutSummary{
			{UUID: "11111111-1111-4111-8111-111111111111", ActivityType: "HKWorkoutActivityTypeRunning", Start: 1751562000000, End: 1751565600000},
			{UUID: "22222222-2222-4222-8222-222222222222", ActivityType: "HKWorkoutActivityTypeWalking", Start: 1751552000000, End: 1751555600000},
		},
	})

	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/workouts?limit=50&offset=10", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Workouts   []WorkoutSummary `json:"workouts"`
		NextOffset int              `json:"nextOffset"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Workouts) != 2 {
		t.Fatalf("workouts len = %d, want 2", len(body.Workouts))
	}
	if body.NextOffset != 12 {
		t.Fatalf("nextOffset = %d, want 12", body.NextOffset)
	}
}

func TestWorkoutsReturnsEmptyArrayWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{workouts: []WorkoutSummary{}})
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/workouts?limit=50&offset=0", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	assertJSONKeyIsArray(t, rec.Body.Bytes(), "workouts")
}

func TestWorkoutReturnsDetailWhenAuthorized(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{
		workout: &WorkoutDetail{
			WorkoutSummary: WorkoutSummary{
				UUID:         "11111111-1111-4111-8111-111111111111",
				ActivityType: "HKWorkoutActivityTypeRunning",
				Start:        1751562000000,
				End:          1751565600000,
			},
			StatisticsDetail: map[string]WorkoutStatDetail{
				"HKQuantityTypeIdentifierHeartRate": {Avg: ptrFloat64(68)},
			},
		},
	})

	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/workouts/11111111-1111-4111-8111-111111111111", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body WorkoutDetail
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.UUID != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("uuid = %q", body.UUID)
	}
}

func TestWorkoutReturnsNotFoundWhenStoreReturnsNil(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{})
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/workouts/11111111-1111-4111-8111-111111111111", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	assertJSONError(t, rec.Body.Bytes(), "workout not found")
}

func TestResponseContractJSONShapes(t *testing.T) {
	t.Parallel()

	timestamp := int64(1751562000000)
	moveMode := 2
	start := int64(1751562000000)
	end := int64(1751565600000)

	latestMetricJSON := mustMarshal(t, LatestMetric{
		Identifier: "HKQuantityTypeIdentifierHeartRate",
		Unit:       ptrString("count/min"),
		Value:      ptrFloat64(68),
		Timestamp:  timestamp,
	})
	var latestMetricBody map[string]any
	if err := json.Unmarshal(latestMetricJSON, &latestMetricBody); err != nil {
		t.Fatalf("decode latest metric: %v", err)
	}
	if _, ok := latestMetricBody["timestamp"].(float64); !ok {
		t.Fatalf("timestamp type = %T, want numeric", latestMetricBody["timestamp"])
	}
	if got := int64(latestMetricBody["timestamp"].(float64)); got != timestamp {
		t.Fatalf("timestamp = %d, want %d", got, timestamp)
	}

	activityDayJSON := mustMarshal(t, ActivityDay{
		Date:     "2026-07-03",
		MoveMode: ptrInt(2),
	})
	var activityDayBody map[string]any
	if err := json.Unmarshal(activityDayJSON, &activityDayBody); err != nil {
		t.Fatalf("decode activity day: %v", err)
	}
	if _, ok := activityDayBody["moveMode"].(float64); !ok {
		t.Fatalf("moveMode type = %T, want numeric", activityDayBody["moveMode"])
	}
	if got := int(activityDayBody["moveMode"].(float64)); got != moveMode {
		t.Fatalf("moveMode = %d, want %d", got, moveMode)
	}

	workoutSummaryJSON := mustMarshal(t, WorkoutSummary{
		UUID:             "11111111-1111-4111-8111-111111111111",
		ActivityType:     "HKWorkoutActivityTypeRunning",
		Start:            start,
		End:              end,
		AvailableMetrics: []string{"HKQuantityTypeIdentifierHeartRate"},
	})
	var workoutSummaryBody map[string]any
	if err := json.Unmarshal(workoutSummaryJSON, &workoutSummaryBody); err != nil {
		t.Fatalf("decode workout summary: %v", err)
	}
	if _, ok := workoutSummaryBody["start"].(float64); !ok {
		t.Fatalf("start type = %T, want numeric", workoutSummaryBody["start"])
	}
	if got := int64(workoutSummaryBody["start"].(float64)); got != start {
		t.Fatalf("start = %d, want %d", got, start)
	}
	if _, ok := workoutSummaryBody["end"].(float64); !ok {
		t.Fatalf("end type = %T, want numeric", workoutSummaryBody["end"])
	}
	if got := int64(workoutSummaryBody["end"].(float64)); got != end {
		t.Fatalf("end = %d, want %d", got, end)
	}

	workoutDetailJSON := mustMarshal(t, WorkoutDetail{
		WorkoutSummary: WorkoutSummary{
			UUID:         "11111111-1111-4111-8111-111111111111",
			ActivityType: "HKWorkoutActivityTypeRunning",
			Start:        start,
			End:          end,
		},
		StatisticsDetail: map[string]WorkoutStatDetail{
			"HKQuantityTypeIdentifierHeartRate": {
				Avg: ptrFloat64(68),
			},
		},
	})
	var workoutDetailBody map[string]any
	if err := json.Unmarshal(workoutDetailJSON, &workoutDetailBody); err != nil {
		t.Fatalf("decode workout detail: %v", err)
	}
	stats, ok := workoutDetailBody["statisticsDetail"].(map[string]any)
	if !ok {
		t.Fatalf("statisticsDetail type = %T, want object", workoutDetailBody["statisticsDetail"])
	}
	if _, ok := stats["HKQuantityTypeIdentifierHeartRate"]; !ok {
		t.Fatalf("statisticsDetail = %#v, want HKQuantityTypeIdentifierHeartRate key", stats)
	}
	if metric, ok := stats["HKQuantityTypeIdentifierHeartRate"].(map[string]any); !ok {
		t.Fatalf("statisticsDetail metric type = %T, want object", stats["HKQuantityTypeIdentifierHeartRate"])
	} else if got := metric["avg"].(float64); got != 68 {
		t.Fatalf("statisticsDetail avg = %v, want 68", got)
	}
}

func TestParseTypesParam(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		query   string
		want    []string
		wantErr string
	}{
		{name: "missing", query: "", wantErr: "missing types"},
		{name: "empty", query: "types=%20%20%20", wantErr: "missing types"},
		{name: "empty member", query: "types=HKQuantityTypeIdentifierHeartRate,", wantErr: "types must not contain empty values"},
		{name: "two types", query: "types=HKQuantityTypeIdentifierHeartRate,HKQuantityTypeIdentifierStepCount", want: []string{"HKQuantityTypeIdentifierHeartRate", "HKQuantityTypeIdentifierStepCount"}},
		{name: "dedupes types", query: "types=HKQuantityTypeIdentifierHeartRate,HKQuantityTypeIdentifierHeartRate,HKQuantityTypeIdentifierStepCount", want: []string{"HKQuantityTypeIdentifierHeartRate", "HKQuantityTypeIdentifierStepCount"}},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			target := "/"
			if tc.query != "" {
				target += "?" + tc.query
			}
			req := httptest.NewRequest(http.MethodGet, target, nil)
			got, err := parseTypesParam(req)
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseTypesParam err = %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("len = %d, want %d", len(got), len(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("type[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestParseRange(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		query     string
		wantStart int64
		wantEnd   int64
		wantErr   string
	}{
		{name: "valid", query: "start=1751328000000&end=1751414400000", wantStart: 1751328000000, wantEnd: 1751414400000},
		{name: "invalid start", query: "start=nope&end=1751414400000", wantErr: "invalid start: must be epoch milliseconds"},
		{name: "end before start", query: "start=1751414400000&end=1751328000000", wantErr: "end must be after start"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/?"+tc.query, nil)
			start, end, err := parseRange(req)
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseRange err = %v", err)
			}
			if got := start.UnixMilli(); got != tc.wantStart {
				t.Fatalf("start = %d, want %d", got, tc.wantStart)
			}
			if got := end.UnixMilli(); got != tc.wantEnd {
				t.Fatalf("end = %d, want %d", got, tc.wantEnd)
			}
		})
	}
}

func TestParseLimitOffset(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		query      string
		wantLimit  int
		wantOffset int
		wantErr    string
	}{
		{name: "defaults", query: "", wantLimit: defaultLimit, wantOffset: 0},
		{name: "negative offset", query: "offset=-1", wantErr: "offset must be at least 0"},
		{name: "zero limit", query: "limit=0", wantErr: "limit must be at least 1"},
		{name: "invalid limit", query: "limit=abc", wantErr: "invalid limit: must be an integer"},
		{name: "clamps overlarge limit", query: "limit=999&offset=2", wantLimit: maxLimit, wantOffset: 2},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			target := "/"
			if tc.query != "" {
				target += "?" + tc.query
			}
			req := httptest.NewRequest(http.MethodGet, target, nil)
			limit, offset, err := parseLimitOffset(req)
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseLimitOffset err = %v", err)
			}
			if limit != tc.wantLimit || offset != tc.wantOffset {
				t.Fatalf("limit,offset = %d,%d want %d,%d", limit, offset, tc.wantLimit, tc.wantOffset)
			}
		})
	}
}

func TestHandleLatestMetricsRejectsMissingTypes(t *testing.T) {
	t.Parallel()

	rec := serveAuthorized(t, testServer(t, &fakeStore{}), http.MethodGet, "/v1/metrics/latest", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	assertJSONError(t, rec.Body.Bytes(), "missing types")
}

func TestHandleDailyMetricsRejectsInvalidStart(t *testing.T) {
	t.Parallel()

	rec := serveAuthorized(t, testServer(t, &fakeStore{}), http.MethodGet, "/v1/metrics/daily?types=HKQuantityTypeIdentifierHeartRate&start=nope&end=1751414400000", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	assertJSONError(t, rec.Body.Bytes(), "invalid start: must be epoch milliseconds")
}

func TestHandleWorkoutsRejectsInvalidLimitOffset(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		query   string
		wantErr string
	}{
		{name: "bad limit", query: "/v1/workouts?limit=abc", wantErr: "invalid limit: must be an integer"},
		{name: "bad offset", query: "/v1/workouts?offset=-1", wantErr: "offset must be at least 0"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			rec := serveAuthorized(t, testServer(t, &fakeStore{}), http.MethodGet, tc.query, nil)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
			}
			assertJSONError(t, rec.Body.Bytes(), tc.wantErr)
		})
	}
}

func TestHandleWorkoutRejectsInvalidUUID(t *testing.T) {
	t.Parallel()

	rec := serveAuthorized(t, testServer(t, &fakeStore{}), http.MethodGet, "/v1/workouts/not-a-uuid", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	assertJSONError(t, rec.Body.Bytes(), "invalid workout uuid")
}

func ptrString(v string) *string { return &v }

func ptrInt64(v int64) *int64 { return &v }

func ptrFloat64(v float64) *float64 { return &v }

func ptrInt(v int) *int { return &v }

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	return b
}

func testServer(t *testing.T, store apiStore) *Server {
	t.Helper()

	return &Server{
		store: store,
		token: "secret",
		log:   slog.New(slog.NewTextHandler(testWriter{t}, nil)),
	}
}

func serveAuthorized(t *testing.T, srv *Server, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(method, target, nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	return rec
}

func assertJSONError(t *testing.T, body []byte, want string) {
	t.Helper()

	var payload map[string]string
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if payload["error"] != want {
		t.Fatalf("error = %q, want %q", payload["error"], want)
	}
}

func assertJSONKeyIsArray(t *testing.T, body []byte, key string) {
	t.Helper()

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	raw, ok := payload[key]
	if !ok {
		t.Fatalf("missing key %q in %s", key, string(body))
	}
	if string(raw) != "[]" {
		t.Fatalf("%s = %s, want []", key, string(raw))
	}
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

type testWriter struct {
	t *testing.T
}

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Helper()
	return len(p), nil
}

func TestMsParamRejectsOutOfRangeValues(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{"-1", "253402300800000", "9223372036854775807"} {
		if _, err := msParam(raw, "start"); err == nil {
			t.Fatalf("msParam(%q) = nil error, want out-of-range error", raw)
		}
	}
	for _, raw := range []string{"0", "1751500000000", "253402300799999"} {
		if _, err := msParam(raw, "start"); err != nil {
			t.Fatalf("msParam(%q) = %v, want nil", raw, err)
		}
	}
}

func TestLoadTimeZone(t *testing.T) {
	if loc, err := loadTimeZone(""); err != nil || loc != time.UTC {
		t.Fatalf("loadTimeZone(\"\") = %v, %v; want UTC, nil", loc, err)
	}
	if loc, err := loadTimeZone(" Europe/Berlin "); err != nil || loc.String() != "Europe/Berlin" {
		t.Fatalf("loadTimeZone(Europe/Berlin) = %v, %v; want Europe/Berlin, nil", loc, err)
	}
	if _, err := loadTimeZone("Not/AZone"); err == nil || !strings.Contains(err.Error(), "PULS_TIME_ZONE") {
		t.Fatalf("loadTimeZone(Not/AZone) err = %v; want an error naming PULS_TIME_ZONE", err)
	}
}
