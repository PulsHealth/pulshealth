package main

import (
	"cmp"
	"context"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

// Deleting quantity samples
//
// quantity_samples is a hypertable whose chunks are compressed into the
// columnstore after 30 days (segmentby type_id, orderby start_ts). A DELETE
// touching a compressed chunk first decompresses every columnstore batch its
// WHERE clause cannot rule out, and TimescaleDB (2.29) rules batches out only
// with scalar comparisons: equality on the segmentby column and range
// comparisons on the orderby column. Neither `uuid = ANY(...)` (the bloom
// filter is not consulted for DML) nor `start_ts = ANY(...)` prunes a single
// batch; a join prunes nothing at all. Against production's 7M rows that is
// the difference between a few batches and the whole table.
//
// The path used to resolve each tombstone's (uuid, start_ts) and issue one
// DELETE per row through pgx's statement cache: prunable, but ~10 ms a row on
// production, so a 1000-deletion batch took ~10 s inside an observer wake of
// 20–30 s. Part of that is the cache itself: from a statement's sixth use on
// a connection PostgreSQL may switch to a generic plan, which cannot exclude
// chunks at plan time, and the SELECT below then checks no bloom filter (a
// forced generic plan took 20 s for 1000 uuids on production, against 1.5 s
// planned for the values). Both statements now run as unnamed statements
// (QueryExecModeExec), planned per call, and the targets are grouped into a
// few statements, each a scalar start_ts range plus `uuid = ANY(...)`:
//
//   - targets in uncompressed chunks go in one statement per stretch of time
//     that contains no compressed chunk, so the range excludes every
//     compressed chunk at plan time and nothing is decompressed;
//   - targets in compressed chunks go one statement per type and cluster of
//     nearby timestamps (type_id = $t, start_ts BETWEEN lo AND hi), which
//     decompresses only that type's batches overlapping the cluster.
//
// The uuid predicate keeps the semantics exact: every row deleted has a
// tombstoned uuid and belongs to the issuing user, and every such row was
// resolved by the SELECT and lies inside its group's range.

// compressedClusterGap is the widest gap between two compressed targets of one
// type that still share a statement. A shared statement also decompresses the
// batches lying between them; a separate one costs one more round trip and
// plan (~1 ms). On production a 1000-row batch spans 5 h to two weeks at the
// median per type and 17 min at the very densest (cycling distance during a
// ride), so an hour rarely reaches past the batches that hold targets anyway.
const compressedClusterGap = time.Hour

// quantityTarget is one stored quantity sample to delete.
type quantityTarget struct {
	uuid   string
	start  time.Time
	typeID int16
}

// timeRange is a half-open [start, end) chunk range.
type timeRange struct{ start, end time.Time }

// quantityDeleteGroup is one DELETE statement: the uuids lie in [lo, hi], and
// a compressed group is restricted to one type (the columnstore segmentby).
type quantityDeleteGroup struct {
	uuids      []string
	lo, hi     time.Time
	typeID     int16
	compressed bool
}

// deleteQuantitySamples deletes the issuing user's quantity samples whose uuid
// is in uuids, in a handful of statements that never decompress columnstore
// batches beyond those holding (or lying between clustered) targets.
func deleteQuantitySamples(ctx context.Context, tx pgx.Tx, uuids []string, userID string) (int64, error) {
	// The read path skips columnstore batches by their uuid bloom filters, so
	// resolving start_ts and type_id here is cheap next to a DML scan, but
	// only in a plan made for these values (see above).
	rows, err := tx.Query(ctx, `
		SELECT uuid::text, start_ts, type_id FROM quantity_samples
		WHERE uuid = ANY($1::uuid[]) AND user_id = $2`,
		pgx.QueryExecModeExec, uuids, userID)
	if err != nil {
		return 0, err
	}
	targets, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (quantityTarget, error) {
		var t quantityTarget
		err := r.Scan(&t.uuid, &t.start, &t.typeID)
		return t, err
	})
	if err != nil || len(targets) == 0 {
		return 0, err
	}

	rows, err = tx.Query(ctx, `
		SELECT range_start, range_end FROM timescaledb_information.chunks
		WHERE hypertable_schema = 'public' AND hypertable_name = 'quantity_samples'
		  AND is_compressed`)
	if err != nil {
		return 0, err
	}
	compressed, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (timeRange, error) {
		var c timeRange
		err := r.Scan(&c.start, &c.end)
		return c, err
	})
	if err != nil {
		return 0, err
	}

	var deleted int64
	for _, g := range planQuantityDeletes(targets, compressed, compressedClusterGap) {
		// Planned per call, so the range excludes chunks at plan time.
		var sql string
		args := []any{pgx.QueryExecModeExec, g.uuids, g.lo, g.hi, userID}
		if g.compressed {
			sql = `DELETE FROM quantity_samples
				WHERE type_id = $5 AND start_ts >= $2 AND start_ts <= $3
				  AND uuid = ANY($1::uuid[]) AND user_id = $4`
			args = append(args, g.typeID)
		} else {
			sql = `DELETE FROM quantity_samples
				WHERE start_ts >= $2 AND start_ts <= $3
				  AND uuid = ANY($1::uuid[]) AND user_id = $4`
		}
		tag, err := tx.Exec(ctx, sql, args...)
		if err != nil {
			return deleted, err
		}
		deleted += tag.RowsAffected()
	}
	return deleted, nil
}

// planQuantityDeletes groups targets into DELETE statements. compressed lists
// the compressed chunks' ranges; maxGap bounds the gap inside a compressed
// group (see compressedClusterGap). It sorts targets in place.
func planQuantityDeletes(targets []quantityTarget, compressed []timeRange, maxGap time.Duration) []quantityDeleteGroup {
	inCompressed := func(ts time.Time) bool {
		for _, c := range compressed {
			if !ts.Before(c.start) && ts.Before(c.end) {
				return true
			}
		}
		return false
	}
	// A compressed chunk overlapping [a, b] (a <= b) would be scanned, and
	// decompressed, by a statement covering that range.
	compressedBetween := func(a, b time.Time) bool {
		for _, c := range compressed {
			if c.start.Before(b) && c.end.After(a) {
				return true
			}
		}
		return false
	}

	var hot, cold []quantityTarget
	for _, t := range targets {
		if inCompressed(t.start) {
			cold = append(cold, t)
		} else {
			hot = append(hot, t)
		}
	}

	var groups []quantityDeleteGroup
	add := func(t quantityTarget, compressed bool) {
		groups = append(groups, quantityDeleteGroup{
			uuids: []string{t.uuid}, lo: t.start, hi: t.start, typeID: t.typeID, compressed: compressed})
	}

	slices.SortFunc(hot, func(a, b quantityTarget) int { return a.start.Compare(b.start) })
	for i, t := range hot {
		if i == 0 || compressedBetween(hot[i-1].start, t.start) {
			add(t, false)
			continue
		}
		g := &groups[len(groups)-1]
		g.uuids = append(g.uuids, t.uuid)
		g.hi = t.start
	}

	slices.SortFunc(cold, func(a, b quantityTarget) int {
		return cmp.Or(cmp.Compare(a.typeID, b.typeID), a.start.Compare(b.start))
	})
	for i, t := range cold {
		if i == 0 || t.typeID != cold[i-1].typeID || t.start.Sub(cold[i-1].start) > maxGap {
			add(t, true)
			continue
		}
		g := &groups[len(groups)-1]
		g.uuids = append(g.uuids, t.uuid)
		g.hi = t.start
	}
	return groups
}
