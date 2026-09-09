package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeAPI is an httptest stand-in for the product API, answering with the
// shapes in server/api/docs.go. Data routes need the bearer token; /healthz
// does not, like the real thing. Every request URL is recorded so tests can
// assert on the query the tools built.
type fakeAPI struct {
	srv    *httptest.Server
	token  string
	mu     sync.Mutex
	calls  []url.URL
	routes map[string]http.HandlerFunc
}

func newFakeAPI(t *testing.T) *fakeAPI {
	t.Helper()
	f := &fakeAPI{token: "api-token", routes: map[string]http.HandlerFunc{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeAPI) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.calls = append(f.calls, *r.URL)
	f.mu.Unlock()

	if r.URL.Path == "/healthz" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "db": true})
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+f.token {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	h, ok := f.routes[r.URL.Path]
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	h(w, r)
}

// respond makes path answer with a fixed status and JSON body.
func (f *fakeAPI) respond(path string, status int, body any) {
	f.routes[path] = func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, status, body)
	}
}

// raw makes path answer with arbitrary bytes.
func (f *fakeAPI) raw(path string, status int, body string) {
	f.routes[path] = func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

// callsTo returns the recorded requests for a path.
func (f *fakeAPI) callsTo(path string) []url.URL {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []url.URL
	for _, u := range f.calls {
		if u.Path == path {
			out = append(out, u)
		}
	}
	return out
}

// lastQuery returns the query of the most recent request to path, failing
// the test if there was none.
func (f *fakeAPI) lastQuery(t *testing.T, path string) url.Values {
	t.Helper()
	calls := f.callsTo(path)
	if len(calls) == 0 {
		t.Fatalf("no request reached %s; requests: %v", path, f.calls)
	}
	return calls[len(calls)-1].Query()
}

func (f *fakeAPI) client(t *testing.T) *APIClient {
	t.Helper()
	c, err := NewAPIClient(f.srv.URL, f.token, f.srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// fixedNow is "now" for every test: a Monday morning in Berlin.
var fixedNow = time.Date(2026, 9, 7, 8, 0, 0, 0, time.UTC)

func mustZone(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

// service builds a service over the fake API in the given zone with a fixed
// clock.
func (f *fakeAPI) service(t *testing.T, zone string) *service {
	t.Helper()
	s := newService(f.client(t), mustZone(t, zone))
	s.now = func() time.Time { return fixedNow }
	return s
}

// Fixtures, in the product API's own JSON.

func ptr[T any](v T) *T { return &v }

var fixtureProfile = Profile{
	UserID:        "5ea4d000-0000-4000-8000-000000000001",
	Name:          ptr("Test Person"),
	Email:         ptr("test@example.com"),
	DateOfBirth:   ptr(time.Date(1990, 9, 8, 0, 0, 0, 0, time.UTC).UnixMilli()),
	BiologicalSex: ptr("female"),
}

var fixtureCatalog = map[string]any{"types": []CatalogType{
	{
		Identifier: "HKQuantityTypeIdentifierStepCount", Kind: "quantity", Unit: ptr("count"),
		Rows: 1200, RawRows: 1000, AggregateRows: 200,
		Earliest: ptr(time.Date(2024, 1, 1, 8, 0, 0, 0, time.UTC).UnixMilli()),
		Latest:   ptr(time.Date(2026, 9, 6, 22, 30, 0, 0, time.UTC).UnixMilli()),
	},
	{Identifier: "HKWorkoutTypeIdentifier", Kind: "workout", Rows: 42, RawRows: 42},
}}

var fixtureLatest = map[string]any{"metrics": []LatestMetric{
	{Identifier: "HKQuantityTypeIdentifierBodyMass", Unit: ptr("kg"), Value: ptr(82.456789),
		Timestamp: time.Date(2026, 9, 6, 6, 5, 0, 0, time.UTC).UnixMilli()},
}}

var fixtureDaily = map[string]any{"metrics": []DailyMetric{
	{Identifier: "HKQuantityTypeIdentifierStepCount", Unit: ptr("count"), Days: []DailyPoint{
		{Date: "2026-03-28", Value: ptr(8123.0)},
		{Date: "2026-03-29", Value: ptr(10456.00001)},
	}},
}}

var fixtureActivity = map[string]any{"days": []ActivityDay{
	{Date: "2026-09-06", MoveKcal: ptr(512.3), MoveGoalKcal: ptr(500.0), ExerciseMin: ptr(31.0),
		ExerciseGoalMin: ptr(30.0), StandHours: ptr(11.0), StandGoalHours: ptr(12.0), MoveMode: ptr(1)},
}}

const workoutUUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d"

var fixtureWorkoutSummary = WorkoutSummary{
	UUID: workoutUUID, ActivityType: "running",
	Start:            time.Date(2026, 9, 6, 5, 30, 0, 0, time.UTC).UnixMilli(),
	End:              time.Date(2026, 9, 6, 6, 15, 0, 0, time.UTC).UnixMilli(),
	DurationS:        ptr(2700.0),
	DistanceM:        ptr(8012.5),
	EnergyKcal:       ptr(610.25),
	HasRoute:         true,
	AvailableMetrics: []string{"HKQuantityTypeIdentifierHeartRate"},
}

func fixtureWorkoutDetail() WorkoutDetail {
	return WorkoutDetail{
		WorkoutSummary: fixtureWorkoutSummary,
		StatisticsDetail: map[string]WorkoutStatDetail{
			"HKQuantityTypeIdentifierHeartRate": {Min: ptr(98.0), Avg: ptr(151.333333), Max: ptr(178.0)},
		},
		Events: []map[string]any{
			{"type": "pause", "start": float64(time.Date(2026, 9, 6, 5, 50, 0, 0, time.UTC).UnixMilli())},
			{"type": "lap", "start": float64(time.Date(2026, 9, 6, 5, 40, 0, 0, time.UTC).UnixMilli()), "end": float64(time.Date(2026, 9, 6, 5, 45, 0, 0, time.UTC).UnixMilli())},
		},
		Activities: []map[string]any{{"activityType": "running", "duration": 2700.0}},
	}
}

// A night from 22:40 on the 20th to 06:30 on the 21st, Berlin time, that a
// Watch and a phone both recorded.
var fixtureSleep = map[string]any{"nights": []SleepNight{{
	Date:          "2026-09-21",
	Start:         time.Date(2026, 9, 20, 20, 30, 0, 0, time.UTC).UnixMilli(), // 22:30 CEST
	End:           time.Date(2026, 9, 21, 4, 30, 0, 0, time.UTC).UnixMilli(),  // 06:30 CEST
	InBedMinutes:  480,
	AsleepMinutes: 460.000001,
	Stages:        SleepStages{Core: 340, Deep: 60, REM: 60, Awake: 10},
	Sources:       2,
}}}

var fixtureSamples = SamplesPage{
	Type: "HKCategoryTypeIdentifierSleepAnalysis", Kind: "category",
	Samples: []Sample{{
		UUID:   "11111111-1111-4111-8111-111111111111",
		Start:  time.Date(2026, 9, 20, 20, 40, 0, 0, time.UTC).UnixMilli(),
		End:    time.Date(2026, 9, 20, 23, 0, 0, 0, time.UTC).UnixMilli(),
		Value:  ptr(3.0),
		Label:  ptr("Asleep Core"),
		Source: ptr("Apple Watch"),
	}},
	NextOffset: 1,
}

// A heart-rate stream of four points, one per minute from the workout start.
func fixtureSeries() WorkoutSeriesResponse {
	start := fixtureWorkoutSummary.Start
	return WorkoutSeriesResponse{
		UUID: workoutUUID, Start: start, End: fixtureWorkoutSummary.End, MaxPoints: 500,
		Series: []WorkoutSeries{{
			Type: "HKQuantityTypeIdentifierHeartRate", Unit: ptr("count/min"), TotalPoints: 2700,
			Points: []SeriesPoint{
				{T: start, V: 98},
				{T: start + 60_000, V: 120.500001},
				{T: start + 120_000, V: 151},
				{T: start + 180_000, V: 143},
			},
		}},
	}
}

var fixtureStateOfMind = map[string]any{"entries": []StateOfMindEntry{{
	UUID:                  "22222222-2222-4222-8222-222222222222",
	Date:                  "2026-09-06",
	Timestamp:             time.Date(2026, 9, 6, 17, 0, 0, 0, time.UTC).UnixMilli(),
	Kind:                  "momentaryEmotion",
	Valence:               ptr(0.500001),
	ValenceClassification: ptr("slightlyPleasant"),
	Labels:                []string{"calm", "grateful"},
	Associations:          []string{"family"},
}}}

func TestNewAPIClient_ValidatesURL(t *testing.T) {
	for _, bad := range []string{"", "localhost:8081", "ftp://host", "http://", "not a url"} {
		if _, err := NewAPIClient(bad, "t", nil); err == nil {
			t.Errorf("NewAPIClient(%q) accepted an invalid URL", bad)
		}
	}
	c, err := NewAPIClient("https://host.example/api/", "t", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := c.BaseURL(); got != "https://host.example/api" {
		t.Errorf("BaseURL = %q, want trailing slash dropped", got)
	}
}

// This server hands its errors to a language model and its startup line to a
// log. A PULS_API_URL carrying userinfo used to print the password to both.
func TestNewAPIClient_DropsCredentialsFromTheURL(t *testing.T) {
	const secret = "sup3rsecret"

	c, err := NewAPIClient("http://alice:"+secret+"@host.example:8081/", "t", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := c.BaseURL(); strings.Contains(got, secret) || strings.Contains(got, "alice") {
		t.Fatalf("BaseURL = %q, want no userinfo", got)
	}
	if got, want := c.BaseURL(), "http://host.example:8081"; got != want {
		t.Fatalf("BaseURL = %q, want %q", got, want)
	}

	// The same string reaches the model on a transport error, so the request
	// path must not reintroduce it either. Point at a closed port to force one.
	closed, err := NewAPIClient("http://alice:"+secret+"@127.0.0.1:1/", "t", nil)
	if err != nil {
		t.Fatal(err)
	}
	err = closed.get(context.Background(), "/v1/profile", nil, &struct{}{})
	if err == nil {
		t.Fatal("expected a transport error from a closed port")
	}
	if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "alice") {
		t.Fatalf("the error handed to the model leaks credentials: %v", err)
	}

	// And the message for a URL that does not parse as http(s) is redacted too.
	_, err = NewAPIClient("ftp://alice:"+secret+"@host.example/", "t", nil)
	if err == nil {
		t.Fatal("expected an error for a non-http scheme")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("the validation error leaks the password: %v", err)
	}
}

func TestAPIClient_SendsBearerAndPath(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/profile", http.StatusOK, fixtureProfile)
	p, err := f.client(t).Profile(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if p.UserID != fixtureProfile.UserID || *p.Name != "Test Person" {
		t.Errorf("profile = %+v", p)
	}
	// A wrong token is a 401 the client reports with the hint.
	wrong, _ := NewAPIClient(f.srv.URL, "nope", f.srv.Client())
	_, err = wrong.Profile(context.Background())
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusUnauthorized {
		t.Fatalf("err = %v, want 401 APIError", err)
	}
	if !strings.Contains(err.Error(), "401") || !strings.Contains(err.Error(), "PULS_API_TOKEN") {
		t.Errorf("401 message lacks status or hint: %s", err)
	}
}

func TestAPIClient_ErrorPropagation(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/workouts/"+workoutUUID, http.StatusNotFound, map[string]string{"error": "workout not found"})
	f.raw("/v1/catalog/types", http.StatusInternalServerError, "<html>boom</html>")
	f.raw("/v1/profile", http.StatusOK, `{"userID": `)
	c := f.client(t)
	ctx := context.Background()

	_, err := c.Workout(ctx, workoutUUID)
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("err = %v, want APIError", err)
	}
	if apiErr.Status != 404 || apiErr.Message != "workout not found" || !strings.Contains(err.Error(), "404 Not Found") {
		t.Errorf("404 error = %+v (%s)", apiErr, err)
	}

	_, err = c.CatalogTypes(ctx)
	if !errors.As(err, &apiErr) || apiErr.Status != 500 || !strings.Contains(err.Error(), "boom") {
		t.Errorf("500 with a non-JSON body: %v", err)
	}

	if _, err = c.Profile(ctx); err == nil || !strings.Contains(err.Error(), "malformed JSON") {
		t.Errorf("truncated body: %v", err)
	}

	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	unreachable, _ := NewAPIClient(closed.URL, "t", nil)
	if _, err = unreachable.Profile(ctx); err == nil || !strings.Contains(err.Error(), "unreachable") {
		t.Errorf("closed server: %v", err)
	}
}

func TestAPIClient_WorkoutsQuery(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/workouts", http.StatusOK, WorkoutsPage{Workouts: []WorkoutSummary{}, NextOffset: 0})
	c := f.client(t)
	start, end := int64(1000), int64(2000)
	if _, err := c.Workouts(context.Background(), WorkoutFilters{StartMS: &start, EndMS: &end, ActivityType: "running", Limit: 20, Offset: 40}); err != nil {
		t.Fatal(err)
	}
	q := f.lastQuery(t, "/v1/workouts")
	for k, want := range map[string]string{"start": "1000", "end": "2000", "activityType": "running", "limit": "20", "offset": "40"} {
		if got := q.Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	if _, err := c.Workouts(context.Background(), WorkoutFilters{Limit: 50}); err != nil {
		t.Fatal(err)
	}
	q = f.lastQuery(t, "/v1/workouts")
	if q.Has("start") || q.Has("end") || q.Has("activityType") {
		t.Errorf("absent filters were sent: %v", q)
	}
}
