package main

import (
	"bufio"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Bulk export: GET /v1/export streams one dataset as CSV or JSONL instead of
// a JSON document, so a whole range lands in a spreadsheet, a notebook, or a
// chat attachment in one request.
//
// Every row is written to the socket as it is produced — the response has no
// Content-Length, so net/http frames it with Transfer-Encoding: chunked and
// the file starts arriving before the query has finished. Nothing accumulates
// in a buffer beyond one flush window.
//
// The two unbounded datasets (raw samples, workouts) read through the store's
// streaming variants (StreamSamples, StreamWorkouts) and hold one row at a
// time. The four day-grained ones (daily metrics, activity rings, sleep,
// State of Mind) reuse the same store calls their JSON endpoints use: their
// row counts are already bounded by the 366-day cap, and reading them up
// front means a bad request is still answered with a clean 400 instead of a
// truncated download.

const (
	// Rows written between pushes to the client. Small enough that a slow
	// query still shows progress, large enough that a million-row export is
	// not a million syscalls.
	exportFlushRows = 256
	// The range caps, matching the endpoints the datasets come from: raw
	// samples stay at 31 days because a busy type runs to hundreds of
	// thousands of rows a month, everything else at 366.
	maxExportRange = 366 * 24 * time.Hour
)

// exportDatasets names every value of the dataset parameter, in the order
// the error message lists them.
var exportDatasets = []string{"daily_metrics", "samples", "workouts", "sleep", "activity", "state_of_mind"}

// exportDataset is a resolved GET /v1/export request: what the rows are
// called and how to produce them. Everything that can fail with a 400 has
// already happened by the time one exists, so the handler can commit to a
// 200 before it writes the first byte.
type exportDataset struct {
	Name string
	// The range the filename carries, in epoch milliseconds.
	StartMS, EndMS int64
	// Field names, in order. The CSV header row and the JSONL object keys
	// are both this list, so the two formats cannot drift apart.
	Columns []string
	// Rows calls emit once per row with values lined up with Columns.
	Rows func(ctx context.Context, emit func(values []any) error) error
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	format, err := exportFormatFor(r.URL.Query().Get("format"))
	if err != nil {
		s.writeStoreError(w, err, "export")
		return
	}
	dataset, err := s.exportDatasetFor(r)
	if err != nil {
		s.writeStoreError(w, err, "export")
		return
	}

	w.Header().Set("Content-Type", format.contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q",
		fmt.Sprintf("puls-%s-%d-%d.%s", dataset.Name, dataset.StartMS, dataset.EndMS, format.extension)))
	// A downloaded file is never a page to render.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// No Content-Length, so the response is chunked and the rows go out as
	// they are read.
	w.WriteHeader(http.StatusOK)

	encoder := format.newEncoder(w)
	control := http.NewResponseController(w)
	rows := 0
	err = encoder.Begin(dataset.Columns)
	if err == nil {
		err = dataset.Rows(r.Context(), func(values []any) error {
			if err := encoder.Row(values); err != nil {
				return err
			}
			rows++
			if rows%exportFlushRows == 0 {
				return flush(encoder, control)
			}
			return nil
		})
	}
	if err == nil {
		err = flush(encoder, control)
	}
	if err != nil {
		// The 200 and some rows are already on the wire, so the only honest
		// signal left is an incomplete transfer: abort the response rather
		// than close the chunked body cleanly on a short file.
		s.log.Error("export failed mid-stream", "dataset", dataset.Name, "rows", rows, "err", err.Error())
		panic(http.ErrAbortHandler)
	}
}

// flush empties the encoder's buffer into the ResponseWriter and pushes the
// chunk to the client. A ResponseWriter that cannot flush (a test recorder,
// a wrapper) is not an error: the bytes are written either way.
func flush(encoder exportEncoder, control *http.ResponseController) error {
	if err := encoder.Flush(); err != nil {
		return err
	}
	if err := control.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return err
	}
	return nil
}

// exportDatasetFor parses and validates the dataset parameter and everything
// that dataset needs, running the query for the bounded ones.
func (s *Server) exportDatasetFor(r *http.Request) (*exportDataset, error) {
	name := strings.TrimSpace(r.URL.Query().Get("dataset"))
	switch name {
	case "":
		return nil, badRequestf("missing dataset: use one of %s", strings.Join(exportDatasets, ", "))
	case "daily_metrics":
		return s.exportDailyMetrics(r)
	case "samples":
		return s.exportSamples(r)
	case "workouts":
		return s.exportWorkouts(r)
	case "sleep":
		return s.exportSleep(r)
	case "activity":
		return s.exportActivity(r)
	case "state_of_mind":
		return s.exportStateOfMind(r)
	}
	return nil, badRequestf("invalid dataset %q: use one of %s", name, strings.Join(exportDatasets, ", "))
}

func (s *Server) exportDailyMetrics(r *http.Request) (*exportDataset, error) {
	types, start, end, err := dailyMetricsRequest(r)
	if err != nil {
		return nil, asBadRequest(err)
	}
	if err := capExportRange(start, end, maxExportRange); err != nil {
		return nil, err
	}
	metrics, err := s.store.DailyMetrics(r.Context(), types, start, end)
	if err != nil {
		return nil, err
	}
	return &exportDataset{
		Name:    "daily_metrics",
		StartMS: start.UnixMilli(),
		EndMS:   end.UnixMilli(),
		// The JSON endpoint nests days under their metric; a flat file
		// repeats the identifier and unit on every row instead.
		Columns: []string{"identifier", "unit", "date", "value"},
		Rows: func(_ context.Context, emit func([]any) error) error {
			for _, metric := range metrics {
				for _, day := range metric.Days {
					if err := emit([]any{metric.Identifier, metric.Unit, day.Date, day.Value}); err != nil {
						return err
					}
				}
			}
			return nil
		},
	}, nil
}

func (s *Server) exportSamples(r *http.Request) (*exportDataset, error) {
	filters, err := sampleFiltersFromRequest(r)
	if err != nil {
		return nil, asBadRequest(err)
	}
	// The export streams the whole range; limit and offset are the JSON
	// endpoint's paging and mean nothing here.
	filters.Limit, filters.Offset = 0, 0
	// Resolve the type before the response starts, so an identifier the
	// database has never seen is a 400 and not a one-line file.
	meta, err := s.store.SampleType(r.Context(), filters.Type)
	if err != nil {
		return nil, err
	}
	return &exportDataset{
		Name:    "samples",
		StartMS: filters.Start.UnixMilli(),
		EndMS:   filters.End.UnixMilli(),
		// type and unit live in the page envelope of the JSON endpoint; a
		// flat file has to carry them per row to stay self-describing.
		Columns: []string{"type", "unit", "uuid", "start", "end", "value", "label", "source"},
		Rows: func(ctx context.Context, emit func([]any) error) error {
			return s.store.StreamSamples(ctx, meta, filters, func(sample Sample) error {
				return emit([]any{
					meta.Type, meta.Unit, sample.UUID, sample.Start, sample.End,
					sample.Value, sample.Label, sample.Source,
				})
			})
		},
	}, nil
}

func (s *Server) exportWorkouts(r *http.Request) (*exportDataset, error) {
	start, end, err := parseRange(r)
	if err != nil {
		return nil, asBadRequest(err)
	}
	if err := capExportRange(start, end, maxExportRange); err != nil {
		return nil, err
	}
	// Unlike GET /v1/workouts the range is required and the whole of it is
	// returned: an export is bounded by its range, not by a page size.
	filters := WorkoutFilters{Start: &start, End: &end, ActivityType: r.URL.Query().Get("activityType")}
	return &exportDataset{
		Name:    "workouts",
		StartMS: start.UnixMilli(),
		EndMS:   end.UnixMilli(),
		Columns: []string{
			"uuid", "activityType", "start", "end",
			"durationS", "distanceM", "energyKcal", "hasRoute", "availableMetrics",
		},
		Rows: func(ctx context.Context, emit func([]any) error) error {
			return s.store.StreamWorkouts(ctx, filters, func(workout WorkoutSummary) error {
				return emit([]any{
					workout.UUID, workout.ActivityType, workout.Start, workout.End,
					workout.DurationS, workout.DistanceM, workout.EnergyKcal,
					workout.HasRoute, workout.AvailableMetrics,
				})
			})
		},
	}, nil
}

func (s *Server) exportSleep(r *http.Request) (*exportDataset, error) {
	start, end, err := parseRange(r)
	if err != nil {
		return nil, asBadRequest(err)
	}
	if err := capExportRange(start, end, maxExportRange); err != nil {
		return nil, err
	}
	nights, err := s.store.SleepDaily(r.Context(), start, end)
	if err != nil {
		return nil, err
	}
	return &exportDataset{
		Name:    "sleep",
		StartMS: start.UnixMilli(),
		EndMS:   end.UnixMilli(),
		// The endpoint nests the stage minutes; a flat file names them with
		// the path they have in the JSON.
		Columns: []string{
			"date", "start", "end", "inBedMinutes", "asleepMinutes",
			"stages.core", "stages.deep", "stages.rem", "stages.unspecified", "stages.awake",
			"sources",
		},
		Rows: func(_ context.Context, emit func([]any) error) error {
			for _, night := range nights {
				if err := emit([]any{
					night.Date, night.Start, night.End, night.InBedMinutes, night.AsleepMinutes,
					night.Stages.Core, night.Stages.Deep, night.Stages.REM,
					night.Stages.Unspecified, night.Stages.Awake, night.Sources,
				}); err != nil {
					return err
				}
			}
			return nil
		},
	}, nil
}

func (s *Server) exportActivity(r *http.Request) (*exportDataset, error) {
	start, end, err := parseRange(r)
	if err != nil {
		return nil, asBadRequest(err)
	}
	if err := capExportRange(start, end, maxExportRange); err != nil {
		return nil, err
	}
	days, err := s.store.ActivitySummary(r.Context(), start, end)
	if err != nil {
		return nil, err
	}
	return &exportDataset{
		Name:    "activity",
		StartMS: start.UnixMilli(),
		EndMS:   end.UnixMilli(),
		Columns: []string{
			"date", "moveKcal", "moveGoalKcal", "exerciseMin", "exerciseGoalMin",
			"standHours", "standGoalHours", "moveMode", "moveTimeMin", "moveTimeGoalMin",
		},
		Rows: func(_ context.Context, emit func([]any) error) error {
			for _, day := range days {
				if err := emit([]any{
					day.Date, day.MoveKcal, day.MoveGoalKcal, day.ExerciseMin, day.ExerciseGoalMin,
					day.StandHours, day.StandGoalHours, day.MoveMode, day.MoveTimeMin, day.MoveTimeGoalMin,
				}); err != nil {
					return err
				}
			}
			return nil
		},
	}, nil
}

func (s *Server) exportStateOfMind(r *http.Request) (*exportDataset, error) {
	start, end, err := parseRange(r)
	if err != nil {
		return nil, asBadRequest(err)
	}
	if err := capExportRange(start, end, maxExportRange); err != nil {
		return nil, err
	}
	entries, err := s.store.StateOfMind(r.Context(), start, end)
	if err != nil {
		return nil, err
	}
	return &exportDataset{
		Name:    "state_of_mind",
		StartMS: start.UnixMilli(),
		EndMS:   end.UnixMilli(),
		Columns: []string{
			"uuid", "date", "timestamp", "kind", "valence", "valenceClassification",
			"labels", "associations",
		},
		Rows: func(_ context.Context, emit func([]any) error) error {
			for _, entry := range entries {
				if err := emit([]any{
					entry.UUID, entry.Date, entry.Timestamp, entry.Kind,
					entry.Valence, entry.ValenceClassification, entry.Labels, entry.Associations,
				}); err != nil {
					return err
				}
			}
			return nil
		},
	}, nil
}

// capExportRange rejects a range longer than max. The instant span is what
// is measured, the same test GET /v1/samples applies, so the answer does not
// depend on where the calendar days fall.
func capExportRange(start, end time.Time, max time.Duration) error {
	if end.Sub(start) > max {
		return badRequestf("range must not exceed %d days", int(max.Hours()/24))
	}
	return nil
}

// asBadRequest marks a parameter error as the caller's fault, so
// writeStoreError answers 400 rather than logging a 500.
func asBadRequest(err error) error {
	if err == nil {
		return nil
	}
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		return err
	}
	return &requestError{msg: err.Error()}
}

// exportFormat is one output format of GET /v1/export.
type exportFormat struct {
	name        string
	extension   string
	contentType string
	newEncoder  func(io.Writer) exportEncoder
}

func exportFormatFor(name string) (exportFormat, error) {
	switch strings.TrimSpace(name) {
	case "":
		return exportFormat{}, badRequestf("missing format: use csv or jsonl")
	case "csv":
		return exportFormat{
			name:        "csv",
			extension:   "csv",
			contentType: "text/csv; charset=utf-8",
			newEncoder:  func(w io.Writer) exportEncoder { return &csvEncoder{w: csv.NewWriter(w)} },
		}, nil
	case "jsonl":
		return exportFormat{
			name:      "jsonl",
			extension: "jsonl",
			// The same media type the sync protocol uses for NDJSON.
			contentType: "application/x-ndjson",
			newEncoder:  func(w io.Writer) exportEncoder { return &jsonlEncoder{w: bufio.NewWriter(w)} },
		}, nil
	}
	return exportFormat{}, badRequestf("invalid format %q: use csv or jsonl", name)
}

// exportEncoder writes rows in one format. Begin runs once before any row,
// Flush pushes the encoder's own buffer into the ResponseWriter.
type exportEncoder interface {
	Begin(columns []string) error
	Row(values []any) error
	Flush() error
}

// csvEncoder writes the column names as the header row and then one record
// per row.
type csvEncoder struct {
	w     *csv.Writer
	cells []string
}

func (e *csvEncoder) Begin(columns []string) error {
	e.cells = make([]string, 0, len(columns))
	return e.w.Write(columns)
}

func (e *csvEncoder) Row(values []any) error {
	e.cells = e.cells[:0]
	for _, value := range values {
		e.cells = append(e.cells, csvCell(value))
	}
	return e.w.Write(e.cells)
}

func (e *csvEncoder) Flush() error {
	e.w.Flush()
	return e.w.Error()
}

// csvCell renders one value as a CSV cell: a null as the empty cell, a float
// without an exponent or trailing zeros, a list comma-joined inside the
// (then quoted) cell.
func csvCell(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case *string:
		if v == nil {
			return ""
		}
		return *v
	case bool:
		return strconv.FormatBool(v)
	case int:
		return strconv.Itoa(v)
	case *int:
		if v == nil {
			return ""
		}
		return strconv.Itoa(*v)
	case int64:
		return strconv.FormatInt(v, 10)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case *float64:
		if v == nil {
			return ""
		}
		return strconv.FormatFloat(*v, 'f', -1, 64)
	case []string:
		return strings.Join(v, ",")
	}
	return fmt.Sprint(value)
}

// jsonlEncoder writes one JSON object per line, keys in column order, so a
// line reads like the object the JSON endpoint would have returned.
type jsonlEncoder struct {
	w       *bufio.Writer
	columns []string
	line    []byte
}

func (e *jsonlEncoder) Begin(columns []string) error {
	e.columns = columns
	return nil
}

func (e *jsonlEncoder) Row(values []any) error {
	if len(values) != len(e.columns) {
		return fmt.Errorf("export row has %d values for %d columns", len(values), len(e.columns))
	}
	e.line = append(e.line[:0], '{')
	for i, value := range values {
		if i > 0 {
			e.line = append(e.line, ',')
		}
		key, err := json.Marshal(e.columns[i])
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(jsonValue(value))
		if err != nil {
			return err
		}
		e.line = append(e.line, key...)
		e.line = append(e.line, ':')
		e.line = append(e.line, encoded...)
	}
	e.line = append(e.line, '}', '\n')
	_, err := e.w.Write(e.line)
	return err
}

func (e *jsonlEncoder) Flush() error { return e.w.Flush() }

// jsonValue keeps an absent list an empty array rather than null, so every
// line of a dataset has the same shape.
func jsonValue(value any) any {
	if list, ok := value.([]string); ok && list == nil {
		return []string{}
	}
	return value
}
