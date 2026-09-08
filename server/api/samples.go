package main

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Raw samples: GET /v1/samples serves the individual HealthKit records of
// one quantity or category type, exactly as synced — no deduplication
// across an iPhone and an Apple Watch that recorded the same minutes (that
// is what /v1/metrics/daily is for).

const (
	defaultSampleLimit = 1000
	maxSampleLimit     = 5000
	// Raw samples of a busy type (heart rate every few seconds) run to
	// hundreds of thousands a month; the range is bounded so one request
	// cannot ask for years of them.
	maxSampleRange = 31 * 24 * time.Hour
)

// SampleFilters are the query parameters of GET /v1/samples; the range is
// [Start, End) on the sample's start time.
type SampleFilters struct {
	Type   string
	Start  time.Time
	End    time.Time
	Limit  int
	Offset int
}

// Sample is one raw HealthKit sample. Value is the numeric value in the
// type's canonical unit for a quantity type and the integer enum value for a
// category type, where Label (from category_labels) names it.
type Sample struct {
	UUID   string   `json:"uuid"`
	Start  int64    `json:"start"`
	End    int64    `json:"end"`
	Value  *float64 `json:"value"`
	Label  *string  `json:"label,omitempty"`
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

// Samples returns one page of a type's raw samples ordered by start time.
// An identifier the database has never seen, or one that is not a quantity
// or category type, is a request error.
func (st *Store) Samples(ctx context.Context, f SampleFilters) (*SamplesPage, error) {
	var (
		typeID int16
		kind   *string
		unit   *string
	)
	err := st.pool.QueryRow(ctx, `
		SELECT type_id, kind, unit FROM sample_types WHERE identifier = $1`, f.Type).
		Scan(&typeID, &kind, &unit)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, badRequestf("unknown type %q: it has never been synced (see /v1/catalog/types)", f.Type)
	}
	if err != nil {
		return nil, err
	}
	if kind == nil {
		return nil, badRequestf("type %q has no kind recorded; only quantity and category types have samples", f.Type)
	}

	page := &SamplesPage{Type: f.Type, Kind: *kind, Unit: unit, Samples: make([]Sample, 0)}
	var rows pgx.Rows
	switch *kind {
	case "quantity":
		rows, err = st.pool.Query(ctx, `
			SELECT q.uuid::text, q.start_ts, q.end_ts, q.value::float8, s.name
			FROM quantity_samples q
			LEFT JOIN sources s ON s.source_id = q.source_id
			WHERE q.user_id = $1
			  AND q.type_id = $2
			  AND q.start_ts >= $3
			  AND q.start_ts < $4
			ORDER BY q.start_ts, q.uuid
			LIMIT $5 OFFSET $6`,
			st.userID, typeID, f.Start, f.End, f.Limit, f.Offset)
	case "category":
		// Category values are only meaningful with their type; the label
		// join is keyed on the identifier so the same integer decodes
		// differently for sleep and for a symptom.
		rows, err = st.pool.Query(ctx, `
			SELECT c.uuid::text, c.start_ts, c.end_ts, c.value::float8, s.name, cl.label
			FROM category_samples c
			LEFT JOIN sources s ON s.source_id = c.source_id
			LEFT JOIN category_labels cl ON cl.type_identifier = $7 AND cl.value = c.value
			WHERE c.user_id = $1
			  AND c.type_id = $2
			  AND c.start_ts >= $3
			  AND c.start_ts < $4
			ORDER BY c.start_ts, c.uuid
			LIMIT $5 OFFSET $6`,
			st.userID, typeID, f.Start, f.End, f.Limit, f.Offset, f.Type)
	default:
		return nil, badRequestf("type %q is a %s type; only quantity and category samples are served here (workouts have /v1/workouts)", f.Type, *kind)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			s          Sample
			start, end time.Time
		)
		dest := []any{&s.UUID, &start, &end, &s.Value, &s.Source}
		if *kind == "category" {
			dest = append(dest, &s.Label)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		s.Start = start.UTC().UnixMilli()
		s.End = end.UTC().UnixMilli()
		page.Samples = append(page.Samples, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	page.NextOffset = f.Offset + len(page.Samples)
	return page, nil
}
