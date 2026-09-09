package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// The product API (server/api) is the only thing this server talks to: it
// never opens a database connection, so the API's bearer token and read-only
// database role are the whole trust boundary. The shapes below mirror
// components.schemas in server/api/docs.go (the OpenAPI document); keep them
// in step when the API changes.

const (
	// maxAPIResponseBytes bounds what one product API answer may occupy
	// before it is decoded and re-encoded for the model.
	maxAPIResponseBytes = 16 << 20
	defaultAPITimeout   = 60 * time.Second
)

// Profile is GET /v1/profile. dateOfBirth is midnight UTC of the birth date
// in epoch milliseconds.
type Profile struct {
	UserID        string  `json:"userID"`
	Name          *string `json:"name"`
	Email         *string `json:"email"`
	DateOfBirth   *int64  `json:"dateOfBirth"`
	BiologicalSex *string `json:"biologicalSex"`
}

// CatalogType is one entry of GET /v1/catalog/types.
type CatalogType struct {
	Identifier    string  `json:"identifier"`
	Kind          string  `json:"kind"`
	Unit          *string `json:"unit"`
	Rows          int64   `json:"rows"`
	RawRows       int64   `json:"rawRows"`
	AggregateRows int64   `json:"aggregateRows"`
	Earliest      *int64  `json:"earliest"`
	Latest        *int64  `json:"latest"`
}

// LatestMetric is one entry of GET /v1/metrics/latest.
type LatestMetric struct {
	Identifier string   `json:"identifier"`
	Unit       *string  `json:"unit"`
	Value      *float64 `json:"value"`
	Timestamp  int64    `json:"timestamp"`
}

// DailyPoint is one local calendar day of a DailyMetric.
type DailyPoint struct {
	Date  string   `json:"date"`
	Value *float64 `json:"value"`
}

// DailyMetric is one entry of GET /v1/metrics/daily.
type DailyMetric struct {
	Identifier string       `json:"identifier"`
	Unit       *string      `json:"unit"`
	Days       []DailyPoint `json:"days"`
}

// ActivityDay is one entry of GET /v1/activity/summary.
type ActivityDay struct {
	Date            string   `json:"date"`
	MoveKcal        *float64 `json:"moveKcal"`
	MoveGoalKcal    *float64 `json:"moveGoalKcal"`
	ExerciseMin     *float64 `json:"exerciseMin"`
	ExerciseGoalMin *float64 `json:"exerciseGoalMin"`
	StandHours      *float64 `json:"standHours"`
	StandGoalHours  *float64 `json:"standGoalHours"`
	MoveMode        *int     `json:"moveMode"`
	MoveTimeMin     *float64 `json:"moveTimeMin"`
	MoveTimeGoalMin *float64 `json:"moveTimeGoalMin"`
}

// WorkoutSummary is one entry of GET /v1/workouts.
type WorkoutSummary struct {
	UUID             string   `json:"uuid"`
	ActivityType     string   `json:"activityType"`
	Start            int64    `json:"start"`
	End              int64    `json:"end"`
	DurationS        *float64 `json:"durationS"`
	DistanceM        *float64 `json:"distanceM"`
	EnergyKcal       *float64 `json:"energyKcal"`
	HasRoute         bool     `json:"hasRoute"`
	AvailableMetrics []string `json:"availableMetrics"`
}

// WorkoutStatDetail is one per-type entry of a workout's statisticsDetail.
type WorkoutStatDetail struct {
	Min *float64 `json:"min,omitempty"`
	Avg *float64 `json:"avg,omitempty"`
	Max *float64 `json:"max,omitempty"`
	Sum *float64 `json:"sum,omitempty"`
}

// WorkoutDetail is GET /v1/workouts/{uuid}.
type WorkoutDetail struct {
	WorkoutSummary
	StatisticsDetail map[string]WorkoutStatDetail `json:"statisticsDetail,omitempty"`
	Events           []map[string]any             `json:"events,omitempty"`
	Activities       []map[string]any             `json:"activities,omitempty"`
}

// WorkoutsPage is the envelope of GET /v1/workouts.
type WorkoutsPage struct {
	Workouts   []WorkoutSummary `json:"workouts"`
	NextOffset int              `json:"nextOffset"`
}

// WorkoutFilters are the query parameters of GET /v1/workouts. Nil bounds
// are omitted; the API filters on the workout start time, [start, end).
type WorkoutFilters struct {
	StartMS      *int64
	EndMS        *int64
	ActivityType string
	Limit        int
	Offset       int
}

// SleepStages is the per-stage minutes of a SleepNight.
type SleepStages struct {
	Core        float64 `json:"core"`
	Deep        float64 `json:"deep"`
	REM         float64 `json:"rem"`
	Unspecified float64 `json:"unspecified"`
	Awake       float64 `json:"awake"`
}

// SleepNight is one entry of GET /v1/sleep/daily: one sleep session,
// attributed to the local day it ended on.
type SleepNight struct {
	Date          string      `json:"date"`
	Start         int64       `json:"start"`
	End           int64       `json:"end"`
	InBedMinutes  float64     `json:"inBedMinutes"`
	AsleepMinutes float64     `json:"asleepMinutes"`
	Stages        SleepStages `json:"stages"`
	Sources       int         `json:"sources"`
}

// Sample is one raw HealthKit record of GET /v1/samples.
type Sample struct {
	UUID   string   `json:"uuid"`
	Start  int64    `json:"start"`
	End    int64    `json:"end"`
	Value  *float64 `json:"value"`
	Label  *string  `json:"label"`
	Source *string  `json:"source"`
}

// SamplesPage is the envelope of GET /v1/samples.
type SamplesPage struct {
	Type       string   `json:"type"`
	Kind       string   `json:"kind"`
	Unit       *string  `json:"unit"`
	Samples    []Sample `json:"samples"`
	NextOffset int      `json:"nextOffset"`
}

// SeriesPoint is one [epoch milliseconds, value] pair of a WorkoutSeries.
// The API sends it as a two-element array.
type SeriesPoint struct {
	T int64
	V float64
}

func (p *SeriesPoint) UnmarshalJSON(b []byte) error {
	var raw []float64
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	if len(raw) != 2 {
		return fmt.Errorf("series point %s: want [t, value]", string(b))
	}
	p.T = int64(raw[0])
	p.V = raw[1]
	return nil
}

func (p SeriesPoint) MarshalJSON() ([]byte, error) {
	return json.Marshal([2]any{p.T, p.V})
}

// WorkoutSeries is one type's stream within a workout.
type WorkoutSeries struct {
	Type        string        `json:"type"`
	Unit        *string       `json:"unit"`
	TotalPoints int           `json:"totalPoints"`
	Points      []SeriesPoint `json:"points"`
}

// WorkoutSeriesResponse is GET /v1/workouts/{uuid}/series.
type WorkoutSeriesResponse struct {
	UUID      string          `json:"uuid"`
	Start     int64           `json:"start"`
	End       int64           `json:"end"`
	MaxPoints int             `json:"maxPoints"`
	Series    []WorkoutSeries `json:"series"`
}

// StateOfMindEntry is one entry of GET /v1/state-of-mind.
type StateOfMindEntry struct {
	UUID                  string   `json:"uuid"`
	Date                  string   `json:"date"`
	Timestamp             int64    `json:"timestamp"`
	Kind                  string   `json:"kind"`
	Valence               *float64 `json:"valence"`
	ValenceClassification *string  `json:"valenceClassification"`
	Labels                []string `json:"labels"`
	Associations          []string `json:"associations"`
}

// APIError is a non-2xx answer from the product API. It surfaces to the
// model as a tool error carrying the status, so the assistant can say what
// went wrong (token rejected, workout not found, ...) instead of guessing.
type APIError struct {
	Method  string
	Path    string
	Status  int
	Message string
}

func (e *APIError) Error() string {
	var b strings.Builder
	fmt.Fprintf(&b, "product API returned %d %s for %s %s", e.Status, http.StatusText(e.Status), e.Method, e.Path)
	if e.Message != "" {
		b.WriteString(": ")
		b.WriteString(e.Message)
	}
	if e.Status == http.StatusUnauthorized {
		b.WriteString(" (the MCP server's PULS_API_TOKEN does not match the product API's)")
	}
	return b.String()
}

// APIClient reads the product API with one bearer token.
type APIClient struct {
	base  *url.URL
	token string
	http  *http.Client
}

// NewAPIClient validates baseURL (an absolute http(s) URL, any trailing slash
// dropped) and returns a client. A nil hc gets a client with a timeout.
//
// Any userinfo in the URL is discarded rather than carried. This server hands
// its errors to a language model and its startup line to a log, and both used
// to render the base URL verbatim — so a PULS_API_URL of the form
// http://alice:sup3rsecret@host:8081 printed the password to both. Credentials
// belong in PULS_API_TOKEN; a URL that carries them loses them here.
func NewAPIClient(baseURL, token string, hc *http.Client) (*APIClient, error) {
	trimmed := strings.TrimSpace(baseURL)
	u, err := url.Parse(trimmed)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		// Redacted() on the parse failure path too: an unparseable URL can
		// still contain a password, and this message reaches the operator.
		shown := trimmed
		if u != nil {
			shown = u.Redacted()
		}
		return nil, fmt.Errorf("PULS_API_URL %q must be an absolute http(s) URL such as http://127.0.0.1:8081", shown)
	}
	u.User = nil
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	u.RawQuery = ""
	u.Fragment = ""
	if hc == nil {
		hc = &http.Client{Timeout: defaultAPITimeout}
	}
	return &APIClient{base: u, token: token, http: hc}, nil
}

// BaseURL is the normalised product API base. It carries no credentials —
// NewAPIClient drops them — and Redacted() is belt and braces for a client
// built by some other path.
func (c *APIClient) BaseURL() string { return c.base.Redacted() }

func (c *APIClient) get(ctx context.Context, path string, query url.Values, out any) error {
	u := *c.base
	u.Path = c.base.Path + path
	u.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// c.BaseURL(), not c.base: this string is handed to the model.
		return fmt.Errorf("product API unreachable at %s: %w", c.BaseURL(), err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxAPIResponseBytes+1))
	if err != nil {
		return fmt.Errorf("reading product API response for GET %s: %w", path, err)
	}
	if len(body) > maxAPIResponseBytes {
		return fmt.Errorf("product API response for GET %s exceeds %d bytes; ask for a narrower range", path, maxAPIResponseBytes)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &APIError{Method: http.MethodGet, Path: path, Status: resp.StatusCode, Message: apiErrorMessage(body)}
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("product API returned malformed JSON for GET %s: %w", path, err)
	}
	return nil
}

// apiErrorMessage extracts {"error": "..."} from an error body; anything
// else is trimmed to a short excerpt.
func apiErrorMessage(body []byte) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &e) == nil && e.Error != "" {
		return e.Error
	}
	s := strings.TrimSpace(string(body))
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}

// Profile is GET /v1/profile.
func (c *APIClient) Profile(ctx context.Context) (*Profile, error) {
	var p Profile
	if err := c.get(ctx, "/v1/profile", nil, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// CatalogTypes is GET /v1/catalog/types.
func (c *APIClient) CatalogTypes(ctx context.Context) ([]CatalogType, error) {
	var out struct {
		Types []CatalogType `json:"types"`
	}
	if err := c.get(ctx, "/v1/catalog/types", nil, &out); err != nil {
		return nil, err
	}
	return out.Types, nil
}

// LatestMetrics is GET /v1/metrics/latest?types=a,b.
func (c *APIClient) LatestMetrics(ctx context.Context, types []string) ([]LatestMetric, error) {
	q := url.Values{"types": {strings.Join(types, ",")}}
	var out struct {
		Metrics []LatestMetric `json:"metrics"`
	}
	if err := c.get(ctx, "/v1/metrics/latest", q, &out); err != nil {
		return nil, err
	}
	return out.Metrics, nil
}

// DailyMetrics is GET /v1/metrics/daily?types=a,b&start=ms&end=ms. The API
// returns every local day (in its PULS_TIME_ZONE) overlapping [start, end).
func (c *APIClient) DailyMetrics(ctx context.Context, types []string, startMS, endMS int64) ([]DailyMetric, error) {
	q := url.Values{
		"types": {strings.Join(types, ",")},
		"start": {strconv.FormatInt(startMS, 10)},
		"end":   {strconv.FormatInt(endMS, 10)},
	}
	var out struct {
		Metrics []DailyMetric `json:"metrics"`
	}
	if err := c.get(ctx, "/v1/metrics/daily", q, &out); err != nil {
		return nil, err
	}
	return out.Metrics, nil
}

// ActivitySummary is GET /v1/activity/summary?start=ms&end=ms.
func (c *APIClient) ActivitySummary(ctx context.Context, startMS, endMS int64) ([]ActivityDay, error) {
	q := url.Values{
		"start": {strconv.FormatInt(startMS, 10)},
		"end":   {strconv.FormatInt(endMS, 10)},
	}
	var out struct {
		Days []ActivityDay `json:"days"`
	}
	if err := c.get(ctx, "/v1/activity/summary", q, &out); err != nil {
		return nil, err
	}
	return out.Days, nil
}

// Workouts is GET /v1/workouts with the given filters.
func (c *APIClient) Workouts(ctx context.Context, f WorkoutFilters) (*WorkoutsPage, error) {
	q := url.Values{
		"limit":  {strconv.Itoa(f.Limit)},
		"offset": {strconv.Itoa(f.Offset)},
	}
	if f.StartMS != nil {
		q.Set("start", strconv.FormatInt(*f.StartMS, 10))
	}
	if f.EndMS != nil {
		q.Set("end", strconv.FormatInt(*f.EndMS, 10))
	}
	if f.ActivityType != "" {
		q.Set("activityType", f.ActivityType)
	}
	var out WorkoutsPage
	if err := c.get(ctx, "/v1/workouts", q, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Workout is GET /v1/workouts/{uuid}.
func (c *APIClient) Workout(ctx context.Context, uuid string) (*WorkoutDetail, error) {
	var d WorkoutDetail
	if err := c.get(ctx, "/v1/workouts/"+url.PathEscape(uuid), nil, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

// SleepDaily is GET /v1/sleep/daily?start=ms&end=ms. Like the other daily
// endpoints it covers every local day overlapping [start, end); a night is
// returned on the day it ended.
func (c *APIClient) SleepDaily(ctx context.Context, startMS, endMS int64) ([]SleepNight, error) {
	q := url.Values{
		"start": {strconv.FormatInt(startMS, 10)},
		"end":   {strconv.FormatInt(endMS, 10)},
	}
	var out struct {
		Nights []SleepNight `json:"nights"`
	}
	if err := c.get(ctx, "/v1/sleep/daily", q, &out); err != nil {
		return nil, err
	}
	return out.Nights, nil
}

// Samples is GET /v1/samples for one type. The range is [start, end) on the
// sample start time and the API caps it at 31 days.
func (c *APIClient) Samples(ctx context.Context, typ string, startMS, endMS int64, limit, offset int) (*SamplesPage, error) {
	q := url.Values{
		"type":   {typ},
		"start":  {strconv.FormatInt(startMS, 10)},
		"end":    {strconv.FormatInt(endMS, 10)},
		"limit":  {strconv.Itoa(limit)},
		"offset": {strconv.Itoa(offset)},
	}
	var out SamplesPage
	if err := c.get(ctx, "/v1/samples", q, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// WorkoutSeries is GET /v1/workouts/{uuid}/series. An empty types slice asks
// for every recorded stream.
func (c *APIClient) WorkoutSeries(ctx context.Context, uuid string, types []string, maxPoints int) (*WorkoutSeriesResponse, error) {
	q := url.Values{"maxPoints": {strconv.Itoa(maxPoints)}}
	if len(types) > 0 {
		q.Set("types", strings.Join(types, ","))
	}
	var out WorkoutSeriesResponse
	if err := c.get(ctx, "/v1/workouts/"+url.PathEscape(uuid)+"/series", q, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// StateOfMind is GET /v1/state-of-mind?start=ms&end=ms.
func (c *APIClient) StateOfMind(ctx context.Context, startMS, endMS int64) ([]StateOfMindEntry, error) {
	q := url.Values{
		"start": {strconv.FormatInt(startMS, 10)},
		"end":   {strconv.FormatInt(endMS, 10)},
	}
	var out struct {
		Entries []StateOfMindEntry `json:"entries"`
	}
	if err := c.get(ctx, "/v1/state-of-mind", q, &out); err != nil {
		return nil, err
	}
	return out.Entries, nil
}

// Healthz probes the API's unauthenticated liveness endpoint, which also
// pings its database.
func (c *APIClient) Healthz(ctx context.Context) error {
	var out struct {
		OK bool `json:"ok"`
	}
	if err := c.get(ctx, "/healthz", nil, &out); err != nil {
		return err
	}
	if !out.OK {
		return errors.New("product API reports not ok")
	}
	return nil
}
