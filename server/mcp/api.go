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
func NewAPIClient(baseURL, token string, hc *http.Client) (*APIClient, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("PULS_API_URL %q must be an absolute http(s) URL such as http://127.0.0.1:8081", baseURL)
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	u.RawQuery = ""
	u.Fragment = ""
	if hc == nil {
		hc = &http.Client{Timeout: defaultAPITimeout}
	}
	return &APIClient{base: u, token: token, http: hc}, nil
}

// BaseURL is the normalised product API base.
func (c *APIClient) BaseURL() string { return c.base.String() }

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
		return fmt.Errorf("product API unreachable at %s: %w", c.base, err)
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
