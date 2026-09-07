// Command ingest is the PulsHealth HealthKit ingestion server.
//
// It accepts gzipped NDJSON batches from the iOS app over HTTP and stores
// them in PostgreSQL/TimescaleDB. See server/README.md for the wire protocol.
package main

import (
	"compress/gzip"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxWireBody     = 256 << 20 // compressed request body cap
	maxDecodedBody  = 128 << 20 // decompressed NDJSON cap
	shutdownTimeout = 15 * time.Second
	maxUUIDRange    = 35 * 24 * time.Hour // /v1/uuids response size guard
	// Upper bound on one batch's database work; see handleBatch.
	insertDeadline = 5 * time.Minute
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("fatal", "err", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	token := os.Getenv("PULS_TOKEN")
	if token == "" {
		return errors.New("PULS_TOKEN must be set")
	}
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL must be set")
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := connectWithRetry(ctx, dbURL, logger)
	if err != nil {
		return err
	}
	defer pool.Close()

	srv := &Server{store: NewStore(pool), token: token, log: logger}

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

// connectWithRetry waits for the database to come up (compose may start us
// alongside postgres) for up to ~60 seconds.
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

// ingester abstracts Store so handlers can be unit-tested without a database.
type ingester interface {
	InsertBatch(ctx context.Context, b *Batch, bodyBytes int64) (IngestResult, error)
	RecordRejection(ctx context.Context, rejection IngestRejection) error
	Stats(ctx context.Context, userID string) ([]TypeStats, error)
	Digest(ctx context.Context, userID, identifier string, from, to time.Time) ([]DigestWindow, error)
	UUIDs(ctx context.Context, userID, identifier string, from, to time.Time) ([]string, error)
	Routes(ctx context.Context, userID string, filters RouteFilters) ([]RouteSummary, error)
	Route(ctx context.Context, userID, uuid string) (*RouteDetail, error)
	RouteMetrics(ctx context.Context, userID, uuid string) ([]RouteMetricSeries, error)
	Ping(ctx context.Context) error
}

// Server holds handler dependencies.
type Server struct {
	store ingester
	token string
	log   *slog.Logger
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/batches", s.auth(s.handleBatch))
	mux.HandleFunc("GET /v1/stats", s.auth(s.handleStats))
	mux.HandleFunc("GET /v1/digest", s.auth(s.handleDigest))
	mux.HandleFunc("GET /v1/uuids", s.auth(s.handleUUIDs))
	mux.HandleFunc("GET /v1/routes", s.auth(s.handleRoutes))
	mux.HandleFunc("GET /v1/routes/{uuid}", s.auth(s.handleRoute))
	mux.HandleFunc("GET /v1/routes/{uuid}/metrics", s.auth(s.handleRouteMetrics))
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	return mux
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

// requestUserID applies the same identity contract to reads and writes: older
// clients with no header use the seeded default user; an explicit value must be
// a UUID. Authentication proves access to the service, while this header
// selects the user's isolated dataset.
func requestUserID(r *http.Request) (string, error) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		return defaultUserID, nil
	}
	if !isUUID(userID) {
		return "", errors.New("X-User-ID is not a UUID")
	}
	return userID, nil
}

func readUserID(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, err := requestUserID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return "", false
	}
	return userID, true
}

// countingReader tracks compressed bytes read off the wire.
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

func (s *Server) handleBatch(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	headerBatchID := r.Header.Get("X-Batch-ID")

	cr := &countingReader{r: http.MaxBytesReader(w, r.Body, maxWireBody)}
	var body io.Reader = cr
	switch enc := r.Header.Get("Content-Encoding"); enc {
	case "gzip":
		gz, err := gzip.NewReader(cr)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid gzip body: " + err.Error()})
			s.recordBatchRejection(r, http.StatusBadRequest, "gzip", "invalid gzip body: "+err.Error(), cr.n)
			return
		}
		defer gz.Close()
		body = gz
	case "", "identity":
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported Content-Encoding: " + enc})
		s.recordBatchRejection(r, http.StatusBadRequest, "encoding", "unsupported Content-Encoding: "+enc, cr.n)
		return
	}
	decodedBody := http.MaxBytesReader(w, io.NopCloser(body), maxDecodedBody)
	defer decodedBody.Close()

	batch, err := ParseBatch(decodedBody)
	parseDur := time.Since(start)
	if err != nil {
		status := batchParseStatus(err)
		s.log.Warn("batch rejected",
			"batch_id", headerBatchID, "err", err.Error(), "bytes", cr.n)
		writeJSON(w, status, map[string]string{"error": err.Error()})
		s.recordBatchRejection(r, status, "parse", err.Error(), cr.n)
		return
	}
	if headerBatchID != "" && !strings.EqualFold(headerBatchID, batch.Header.BatchID) {
		s.log.Warn("X-Batch-ID header does not match body batchID",
			"header", headerBatchID, "body", batch.Header.BatchID)
	}

	// The client tags every batch with its user via X-User-ID; absent (older
	// clients / direct curl) defaults to the seeded default user. Every data
	// row is stored under this id and the {"profile":…} line upserts the
	// matching users row.
	userID, ok := readUserID(w, r)
	if !ok {
		s.recordBatchRejection(r, http.StatusBadRequest, "identity", "X-User-ID is not a UUID", cr.n)
		return
	}
	batch.Header.UserID = userID

	// Wake correlation: the iOS wake that produced this upload (HTTP headers, like
	// X-User-ID). Both optional; reject only a malformed wake id.
	if wakeID := r.Header.Get("X-Wake-ID"); wakeID != "" {
		if !isUUID(wakeID) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "X-Wake-ID is not a UUID"})
			s.recordBatchRejection(r, http.StatusBadRequest, "wake", "X-Wake-ID is not a UUID", cr.n)
			return
		}
		batch.Header.WakeID = wakeID
	}
	batch.Header.Trigger = r.Header.Get("X-Wake-Trigger")
	batch.ParseMs = parseDur.Milliseconds()

	// Bound the database work independently of the client connection. With
	// the bare request context the transaction lived exactly as long as the
	// TCP connection: a wedged Postgres (lock wait, long chunk decompression)
	// held this goroutine and its pool connection forever, and a phone that
	// gave up mid-insert rolled back a nearly-committed batch only to resend
	// it. The batch is idempotent end-to-end, so finishing the commit after a
	// disconnect is strictly better than redoing the work on retry.
	insertCtx, cancelInsert := context.WithTimeout(context.WithoutCancel(r.Context()), insertDeadline)
	defer cancelInsert()
	insertStart := time.Now()
	res, err := s.store.InsertBatch(insertCtx, batch, cr.n)
	insertDur := time.Since(insertStart)
	if err != nil {
		s.log.Error("batch insert failed",
			"batch_id", batch.Header.BatchID, "type", batch.Header.Type, "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "insert failed"})
		s.recordBatchRejection(r, http.StatusInternalServerError, "insert", err.Error(), cr.n)
		return
	}

	s.log.Info("batch ingested",
		"batch_id", batch.Header.BatchID,
		"device_id", batch.Header.DeviceID,
		"user_id", batch.Header.UserID,
		"wake_id", batch.Header.WakeID,
		"trigger", batch.Header.Trigger,
		"type", batch.Header.Type,
		"reason", batch.Header.Reason,
		"samples", len(batch.Samples),
		"deletions", len(batch.Deletions),
		"routes", len(batch.Routes),
		"series", len(batch.Series),
		"aggregates", len(batch.Aggregates),
		"activity_summaries", len(batch.ActivitySummaries),
		"accepted", res.Accepted,
		"deleted", res.Deleted,
		"duplicates", res.Duplicates,
		"route_points", res.RoutePoints,
		"series_points", res.SeriesPoints,
		"aggregate_samples", res.AggregateSamples,
		"activity_summaries_upserted", res.ActivitySummaries,
		"duplicate_batch", res.DuplicateBatch,
		"bytes", cr.n,
		"parse_ms", parseDur.Milliseconds(),
		"insert_ms", insertDur.Milliseconds(),
		"retries", res.Retries,
	)
	writeJSON(w, http.StatusOK, map[string]int64{
		"accepted":          res.Accepted,
		"deleted":           res.Deleted,
		"duplicates":        res.Duplicates,
		"routePoints":       res.RoutePoints,
		"seriesPoints":      res.SeriesPoints,
		"aggregateSamples":  res.AggregateSamples,
		"activitySummaries": res.ActivitySummaries,
	})
}

// recordBatchRejection is intentionally best-effort: observability must never
// replace or delay the original response. Use a short context independent of
// the request because truncated uploads commonly arrive with a canceled client.
func (s *Server) recordBatchRejection(r *http.Request, status int, stage, message string, bodyBytes int64) {
	const maxFieldLength = 2_000
	trim := func(value string) string {
		if len(value) > maxFieldLength {
			return value[:maxFieldLength]
		}
		return value
	}
	rejection := IngestRejection{
		BatchID:         trim(r.Header.Get("X-Batch-ID")),
		UserID:          trim(r.Header.Get("X-User-ID")),
		WakeID:          trim(r.Header.Get("X-Wake-ID")),
		Trigger:         trim(r.Header.Get("X-Wake-Trigger")),
		Status:          status,
		Stage:           trim(stage),
		ErrorMessage:    trim(message),
		Bytes:           bodyBytes,
		ContentEncoding: trim(r.Header.Get("Content-Encoding")),
	}
	// Called only after the response has been written: with the database
	// down this blocks on pool acquire for the full 2 s, and a retrying client
	// must not pay that on every attempt exactly when the server is already
	// struggling. Observability never delays the original response.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.store.RecordRejection(ctx, rejection); err != nil {
		s.log.Error("could not persist batch rejection", "err", err.Error(), "stage", stage)
	}
}

func batchParseStatus(err error) int {
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		return http.StatusRequestEntityTooLarge
	}
	var pe *ParseError
	if errors.As(err, &pe) {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	userID, ok := readUserID(w, r)
	if !ok {
		return
	}
	stats, err := s.store.Stats(r.Context(), userID)
	if err != nil {
		s.log.Error("stats query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "stats failed"})
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// typeRangeParams parses the type/from/to query parameters shared by
// /v1/digest and /v1/uuids. from/to are epoch milliseconds; [from, to).
func typeRangeParams(r *http.Request) (string, time.Time, time.Time, error) {
	q := r.URL.Query()
	typ := q.Get("type")
	if typ == "" {
		return "", time.Time{}, time.Time{}, errors.New("missing type")
	}
	from, err := msParam(q.Get("from"), "from")
	if err != nil {
		return "", time.Time{}, time.Time{}, err
	}
	to, err := msParam(q.Get("to"), "to")
	if err != nil {
		return "", time.Time{}, time.Time{}, err
	}
	if !to.After(from) {
		return "", time.Time{}, time.Time{}, errors.New("to must be after from")
	}
	return typ, from, to, nil
}

func msParam(s, name string) (time.Time, error) {
	if s == "" {
		return time.Time{}, fmt.Errorf("missing %s", name)
	}
	ms, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid %s: must be epoch milliseconds", name)
	}
	return time.UnixMilli(ms).UTC(), nil
}

func (s *Server) handleDigest(w http.ResponseWriter, r *http.Request) {
	userID, ok := readUserID(w, r)
	if !ok {
		return
	}
	typ, from, to, err := typeRangeParams(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	windows, err := s.store.Digest(r.Context(), userID, typ, from, to)
	if err != nil {
		s.log.Error("digest query failed", "type", typ, "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "digest failed"})
		return
	}
	writeJSON(w, http.StatusOK, windows)
}

func (s *Server) handleUUIDs(w http.ResponseWriter, r *http.Request) {
	userID, ok := readUserID(w, r)
	if !ok {
		return
	}
	typ, from, to, err := typeRangeParams(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if to.Sub(from) > maxUUIDRange {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "range exceeds 35 days"})
		return
	}
	uuids, err := s.store.UUIDs(r.Context(), userID, typ, from, to)
	if err != nil {
		s.log.Error("uuids query failed", "type", typ, "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "uuids failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string][]string{"uuids": uuids})
}

func (s *Server) handleRoutes(w http.ResponseWriter, r *http.Request) {
	userID, ok := readUserID(w, r)
	if !ok {
		return
	}
	filters, err := routeFilters(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	routes, err := s.store.Routes(r.Context(), userID, filters)
	if err != nil {
		s.log.Error("routes query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "routes failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string][]RouteSummary{"routes": routes})
}

func (s *Server) handleRoute(w http.ResponseWriter, r *http.Request) {
	userID, ok := readUserID(w, r)
	if !ok {
		return
	}
	uuid := r.PathValue("uuid")
	if !isUUID(uuid) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid route uuid"})
		return
	}
	route, err := s.store.Route(r.Context(), userID, uuid)
	if err != nil {
		s.log.Error("route query failed", "uuid", uuid, "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "route failed"})
		return
	}
	if route == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "route not found"})
		return
	}
	writeJSON(w, http.StatusOK, route)
}

func (s *Server) handleRouteMetrics(w http.ResponseWriter, r *http.Request) {
	userID, ok := readUserID(w, r)
	if !ok {
		return
	}
	uuid := r.PathValue("uuid")
	if !isUUID(uuid) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid route uuid"})
		return
	}
	metrics, err := s.store.RouteMetrics(r.Context(), userID, uuid)
	if err != nil {
		s.log.Error("route metrics query failed", "uuid", uuid, "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "route metrics failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string][]RouteMetricSeries{"metrics": metrics})
}

func routeFilters(r *http.Request) (RouteFilters, error) {
	q := r.URL.Query()
	var filters RouteFilters

	if value := q.Get("start"); value != "" {
		t, err := routeTimeParam(value, "start")
		if err != nil {
			return filters, err
		}
		filters.Start = &t
	}
	if value := q.Get("end"); value != "" {
		t, err := routeTimeParam(value, "end")
		if err != nil {
			return filters, err
		}
		filters.End = &t
	}
	filters.ActivityType = q.Get("activityType")

	if value := q.Get("minDistanceM"); value != "" {
		n, err := floatParam(value, "minDistanceM")
		if err != nil {
			return filters, err
		}
		filters.MinDistanceM = &n
	}
	if value := q.Get("maxDistanceM"); value != "" {
		n, err := floatParam(value, "maxDistanceM")
		if err != nil {
			return filters, err
		}
		filters.MaxDistanceM = &n
	}
	if value := q.Get("limit"); value != "" {
		n, err := intParam(value, "limit")
		if err != nil {
			return filters, err
		}
		filters.Limit = n
	}
	if value := q.Get("offset"); value != "" {
		n, err := intParam(value, "offset")
		if err != nil {
			return filters, err
		}
		filters.Offset = n
	}
	return filters, nil
}

func routeTimeParam(value, name string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02", value); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("invalid %s: must be RFC3339 or YYYY-MM-DD", name)
}

func floatParam(value, name string) (float64, error) {
	n, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: must be a number", name)
	}
	return n, nil
}

func intParam(value, name string) (int, error) {
	n, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: must be an integer", name)
	}
	return n, nil
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
