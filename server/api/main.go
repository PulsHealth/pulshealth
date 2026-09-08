package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	// Embed the IANA zone database so PULS_TIME_ZONE resolves even in an
	// image without /usr/share/zoneinfo.
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultUserID   = "5ea4d000-0000-4000-8000-000000000001"
	shutdownTimeout = 15 * time.Second
	defaultLimit    = 50
	maxLimit        = 200
	catalogTTL      = 5 * time.Minute
	// Accepted range for epoch-millisecond query parameters: 1970-01-01 to
	// 9999-12-31T23:59:59.999Z, the widest span the `date` casts can carry.
	minEpochMS int64 = 0
	maxEpochMS int64 = 253402300799999
)

type apiStore interface {
	Ping(context.Context) error
	Profile(context.Context) (*Profile, error)
	CatalogTypes(context.Context) ([]CatalogType, error)
	LatestMetrics(context.Context, []string) ([]LatestMetric, error)
	DailyMetrics(context.Context, []string, time.Time, time.Time) ([]DailyMetric, error)
	ActivitySummary(context.Context, time.Time, time.Time) ([]ActivityDay, error)
	Workouts(context.Context, WorkoutFilters) ([]WorkoutSummary, error)
	Workout(context.Context, string) (*WorkoutDetail, error)
	SleepDaily(context.Context, time.Time, time.Time) ([]SleepNight, error)
	Samples(context.Context, SampleFilters) (*SamplesPage, error)
	WorkoutSeries(context.Context, string, []string, int) (*WorkoutSeriesResponse, error)
	StateOfMind(context.Context, time.Time, time.Time) ([]StateOfMindEntry, error)
}

type Server struct {
	store apiStore
	token string
	log   *slog.Logger

	catalogMu      sync.Mutex
	catalogTypes   []CatalogType
	catalogExpires time.Time
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("fatal", "err", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	token := os.Getenv("PULS_API_TOKEN")
	if token == "" {
		return errors.New("PULS_API_TOKEN must be set")
	}
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL must be set")
	}
	// The user every read is scoped to. The web viewer already honours
	// PULS_USER_ID; the API hardcoded the seeded default, so changing the
	// viewer's user silently left the API answering for user 1.
	userID := os.Getenv("PULS_USER_ID")
	if userID == "" {
		userID = defaultUserID
	}
	if !isUUID(userID) {
		return errors.New("PULS_USER_ID must be a UUID")
	}
	// The calendar zone for the daily endpoints. Same value the database's
	// puls.time_zone setting holds (db/migrations/013_time_zone.sh), so the API's
	// day ranges and metric_daily's day column agree. Fail fast on a typo
	// rather than serve misaligned days.
	loc, err := loadTimeZone(os.Getenv("PULS_TIME_ZONE"))
	if err != nil {
		return err
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8081"
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := connectWithRetry(ctx, dbURL, logger)
	if err != nil {
		return err
	}
	defer pool.Close()

	srv := &Server{store: NewStore(pool, userID, loc), token: token, log: logger}
	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	logger.Info("shutting down")
	shCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	return httpSrv.Shutdown(shCtx)
}

// loadTimeZone resolves PULS_TIME_ZONE (an IANA name; empty means UTC).
func loadTimeZone(name string) (*time.Location, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("PULS_TIME_ZONE %q is not a valid IANA time zone: %w", name, err)
	}
	return loc, nil
}

func connectWithRetry(ctx context.Context, url string, logger *slog.Logger) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	deadline := time.Now().Add(60 * time.Second)
	for {
		pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err = pool.Ping(pingCtx)
		cancel()
		if err == nil {
			return pool, nil
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			pool.Close()
			return nil, fmt.Errorf("database unreachable: %w", err)
		}
		logger.Warn("waiting for database", "err", err.Error())
		select {
		case <-time.After(2 * time.Second):
		case <-ctx.Done():
			pool.Close()
			return nil, ctx.Err()
		}
	}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /docs", s.handleDocs)
	mux.HandleFunc("GET /openapi.json", s.handleOpenAPI)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /v1/profile", s.auth(s.handleProfile))
	mux.HandleFunc("GET /v1/catalog/types", s.auth(s.handleCatalogTypes))
	mux.HandleFunc("GET /v1/metrics/latest", s.auth(s.handleLatestMetrics))
	mux.HandleFunc("GET /v1/metrics/daily", s.auth(s.handleDailyMetrics))
	mux.HandleFunc("GET /v1/activity/summary", s.auth(s.handleActivitySummary))
	mux.HandleFunc("GET /v1/workouts", s.auth(s.handleWorkouts))
	mux.HandleFunc("GET /v1/workouts/{uuid}", s.auth(s.handleWorkout))
	mux.HandleFunc("GET /v1/workouts/{uuid}/series", s.auth(s.handleWorkoutSeries))
	mux.HandleFunc("GET /v1/sleep/daily", s.auth(s.handleSleepDaily))
	mux.HandleFunc("GET /v1/samples", s.auth(s.handleSamples))
	mux.HandleFunc("GET /v1/state-of-mind", s.auth(s.handleStateOfMind))
	return mux
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "db": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "db": true})
}

func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	profile, err := s.store.Profile(r.Context())
	if err != nil {
		s.log.Error("profile query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "profile failed"})
		return
	}
	if profile == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "profile not found"})
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (s *Server) handleCatalogTypes(w http.ResponseWriter, r *http.Request) {
	if types, ok := s.cachedCatalogTypes(); ok {
		writeJSON(w, http.StatusOK, map[string][]CatalogType{"types": types})
		return
	}

	types, err := s.store.CatalogTypes(r.Context())
	if err != nil {
		s.log.Error("catalog types query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "catalog types failed"})
		return
	}
	types = cloneCatalogTypes(types)
	s.storeCatalogTypes(types)
	writeJSON(w, http.StatusOK, map[string][]CatalogType{"types": types})
}

func (s *Server) handleLatestMetrics(w http.ResponseWriter, r *http.Request) {
	types, err := parseTypesParam(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	metrics, err := s.store.LatestMetrics(r.Context(), types)
	if err != nil {
		s.log.Error("latest metrics query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "latest metrics failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string][]LatestMetric{"metrics": metrics})
}

func (s *Server) handleDailyMetrics(w http.ResponseWriter, r *http.Request) {
	types, start, end, err := dailyMetricsRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	metrics, err := s.store.DailyMetrics(r.Context(), types, start, end)
	if err != nil {
		s.log.Error("daily metrics query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "daily metrics failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string][]DailyMetric{"metrics": metrics})
}

func (s *Server) handleActivitySummary(w http.ResponseWriter, r *http.Request) {
	start, end, err := parseRange(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	days, err := s.store.ActivitySummary(r.Context(), start, end)
	if err != nil {
		s.log.Error("activity summary query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "activity summary failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string][]ActivityDay{"days": days})
}

func (s *Server) handleWorkouts(w http.ResponseWriter, r *http.Request) {
	filters, err := workoutFiltersFromRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	workouts, err := s.store.Workouts(r.Context(), filters)
	if err != nil {
		s.log.Error("workouts query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "workouts failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"workouts":   workouts,
		"nextOffset": filters.Offset + len(workouts),
	})
}

func (s *Server) handleWorkout(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	if !isUUID(uuid) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout uuid"})
		return
	}
	workout, err := s.store.Workout(r.Context(), uuid)
	if err != nil {
		s.log.Error("workout query failed", "uuid", uuid, "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "workout failed"})
		return
	}
	if workout == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workout not found"})
		return
	}
	writeJSON(w, http.StatusOK, workout)
}

func (s *Server) handleSleepDaily(w http.ResponseWriter, r *http.Request) {
	start, end, err := parseRange(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	nights, err := s.store.SleepDaily(r.Context(), start, end)
	if err != nil {
		s.writeStoreError(w, err, "sleep")
		return
	}
	writeJSON(w, http.StatusOK, map[string][]SleepNight{"nights": nights})
}

func (s *Server) handleSamples(w http.ResponseWriter, r *http.Request) {
	filters, err := sampleFiltersFromRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	page, err := s.store.Samples(r.Context(), filters)
	if err != nil {
		s.writeStoreError(w, err, "samples")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleWorkoutSeries(w http.ResponseWriter, r *http.Request) {
	uuid := r.PathValue("uuid")
	if !isUUID(uuid) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout uuid"})
		return
	}
	types, maxPoints, err := workoutSeriesRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	series, err := s.store.WorkoutSeries(r.Context(), uuid, types, maxPoints)
	if err != nil {
		s.log.Error("workout series query failed", "uuid", uuid, "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "workout series failed"})
		return
	}
	if series == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workout not found"})
		return
	}
	writeJSON(w, http.StatusOK, series)
}

func (s *Server) handleStateOfMind(w http.ResponseWriter, r *http.Request) {
	start, end, err := parseRange(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	entries, err := s.store.StateOfMind(r.Context(), start, end)
	if err != nil {
		s.writeStoreError(w, err, "state of mind")
		return
	}
	writeJSON(w, http.StatusOK, map[string][]StateOfMindEntry{"entries": entries})
}

// writeStoreError answers a failed store call: a requestError is the
// caller's fault and comes back as a 400 with its message; anything else is
// logged and answered with a generic 500.
func (s *Server) writeStoreError(w http.ResponseWriter, err error, what string) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": reqErr.Error()})
		return
	}
	s.log.Error(what+" query failed", "err", err.Error())
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": what + " failed"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func parseTypesParam(r *http.Request) ([]string, error) {
	raw := strings.TrimSpace(r.URL.Query().Get("types"))
	if raw == "" {
		return nil, errors.New("missing types")
	}
	parts := strings.Split(raw, ",")
	types := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil, errors.New("types must not contain empty values")
		}
		if _, ok := seen[part]; ok {
			continue
		}
		seen[part] = struct{}{}
		types = append(types, part)
	}
	return types, nil
}

func msParam(s, name string) (time.Time, error) {
	if s == "" {
		return time.Time{}, fmt.Errorf("missing %s", name)
	}
	ms, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid %s: must be epoch milliseconds", name)
	}
	// Any int64 parses, but the day-range formatting downstream casts to a
	// Postgres `date`; a value beyond year 9999 blew up there as a 500
	// instead of a 400.
	if ms < minEpochMS || ms > maxEpochMS {
		return time.Time{}, fmt.Errorf("invalid %s: epoch milliseconds out of range", name)
	}
	return time.UnixMilli(ms).UTC(), nil
}

func parseRange(r *http.Request) (time.Time, time.Time, error) {
	q := r.URL.Query()
	start, err := msParam(q.Get("start"), "start")
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	end, err := msParam(q.Get("end"), "end")
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	if !end.After(start) {
		return time.Time{}, time.Time{}, errors.New("end must be after start")
	}
	return start, end, nil
}

func optionalMSParam(raw, name string) (*time.Time, error) {
	if raw == "" {
		return nil, nil
	}
	t, err := msParam(raw, name)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func parseLimitOffset(r *http.Request) (limit, offset int, err error) {
	return parseLimitOffsetBounds(r, defaultLimit, maxLimit)
}

// parseLimitOffsetBounds reads limit (default def, clamped to max) and
// offset (default 0) from the query.
func parseLimitOffsetBounds(r *http.Request, def, max int) (limit, offset int, err error) {
	q := r.URL.Query()
	limit = def
	offset = 0

	if raw := q.Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			return 0, 0, errors.New("invalid limit: must be an integer")
		}
	}
	if limit < 1 {
		return 0, 0, errors.New("limit must be at least 1")
	}
	if limit > max {
		limit = max
	}

	if raw := q.Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil {
			return 0, 0, errors.New("invalid offset: must be an integer")
		}
	}
	if offset < 0 {
		return 0, 0, errors.New("offset must be at least 0")
	}

	return limit, offset, nil
}

func dailyMetricsRequest(r *http.Request) ([]string, time.Time, time.Time, error) {
	types, err := parseTypesParam(r)
	if err != nil {
		return nil, time.Time{}, time.Time{}, err
	}
	start, end, err := parseRange(r)
	if err != nil {
		return nil, time.Time{}, time.Time{}, err
	}
	return types, start, end, nil
}

func workoutFiltersFromRequest(r *http.Request) (WorkoutFilters, error) {
	var filters WorkoutFilters

	limit, offset, err := parseLimitOffset(r)
	if err != nil {
		return filters, err
	}
	q := r.URL.Query()
	start, err := optionalMSParam(q.Get("start"), "start")
	if err != nil {
		return filters, err
	}
	end, err := optionalMSParam(q.Get("end"), "end")
	if err != nil {
		return filters, err
	}
	if start != nil && end != nil && !end.After(*start) {
		return filters, errors.New("end must be after start")
	}

	filters.Start = start
	filters.End = end
	filters.ActivityType = q.Get("activityType")
	filters.Limit = limit
	filters.Offset = offset
	return filters, nil
}

// sampleFiltersFromRequest reads GET /v1/samples: exactly one type, a
// required [start, end) range of at most maxSampleRange, and paging.
func sampleFiltersFromRequest(r *http.Request) (SampleFilters, error) {
	var f SampleFilters
	q := r.URL.Query()

	f.Type = strings.TrimSpace(q.Get("type"))
	if f.Type == "" {
		return f, errors.New("missing type")
	}
	if strings.Contains(f.Type, ",") {
		return f, errors.New("type must name exactly one HealthKit identifier")
	}
	start, end, err := parseRange(r)
	if err != nil {
		return f, err
	}
	if end.Sub(start) > maxSampleRange {
		return f, fmt.Errorf("range must not exceed %d days", int(maxSampleRange.Hours()/24))
	}
	limit, offset, err := parseLimitOffsetBounds(r, defaultSampleLimit, maxSampleLimit)
	if err != nil {
		return f, err
	}
	f.Start, f.End = start, end
	f.Limit, f.Offset = limit, offset
	return f, nil
}

// workoutSeriesRequest reads GET /v1/workouts/{uuid}/series: an optional
// comma-separated types filter and maxPoints (default defaultSeriesPoints,
// clamped to maxSeriesPoints).
func workoutSeriesRequest(r *http.Request) ([]string, int, error) {
	var types []string
	if strings.TrimSpace(r.URL.Query().Get("types")) != "" {
		var err error
		if types, err = parseTypesParam(r); err != nil {
			return nil, 0, err
		}
	}
	maxPoints := defaultSeriesPoints
	if raw := r.URL.Query().Get("maxPoints"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return nil, 0, errors.New("invalid maxPoints: must be an integer")
		}
		if n < 1 {
			return nil, 0, errors.New("maxPoints must be at least 1")
		}
		maxPoints = n
	}
	if maxPoints > maxSeriesPoints {
		maxPoints = maxSeriesPoints
	}
	return types, maxPoints, nil
}

func isHexN(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for i := 0; i < n; i++ {
		c := s[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

func isUUID(s string) bool {
	if len(s) != 36 || s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		return false
	}
	return isHexN(s[0:8], 8) && isHexN(s[9:13], 4) && isHexN(s[14:18], 4) &&
		isHexN(s[19:23], 4) && isHexN(s[24:36], 12)
}

func (s *Server) cachedCatalogTypes() ([]CatalogType, bool) {
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()

	if time.Now().Before(s.catalogExpires) {
		return cloneCatalogTypes(s.catalogTypes), true
	}
	return nil, false
}

func (s *Server) storeCatalogTypes(types []CatalogType) {
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()

	s.catalogTypes = cloneCatalogTypes(types)
	s.catalogExpires = time.Now().Add(catalogTTL)
}

func cloneCatalogTypes(types []CatalogType) []CatalogType {
	if len(types) == 0 {
		return []CatalogType{}
	}
	out := make([]CatalogType, len(types))
	copy(out, types)
	return out
}
