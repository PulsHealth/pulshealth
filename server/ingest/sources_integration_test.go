package main

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Source registration must not need nextval while sources_source_id_seq has
// ids below it that no row holds: production's sequence stood at 29521 of
// smallint's 32767 with 536 rows (2026-10-06), the rest burned by the
// pre-fix ON CONFLICT leak. These run as DATABASE_URL (the ingest role in CI)
// and use the admin pool only to make and remove fixture rows.

func sourceTestPools(t *testing.T) (context.Context, *pgxpool.Pool, *pgxpool.Pool) {
	t.Helper()
	url := integrationDatabaseURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	admin := adminPool(t, ctx)
	return ctx, pool, admin
}

// cleanupSources removes the fixture sources named prefix*; none is
// referenced, since these tests register sources without samples.
func cleanupSources(t *testing.T, ctx context.Context, admin *pgxpool.Pool, prefix string) {
	t.Cleanup(func() {
		if _, err := admin.Exec(context.Background(),
			`DELETE FROM sources WHERE name LIKE $1`, prefix+"%"); err != nil {
			t.Errorf("cleanup sources: %v", err)
		}
	})
}

func sourceSeqLastValue(t *testing.T, ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) int64 {
	t.Helper()
	var v int64
	if err := q.QueryRow(ctx, `SELECT COALESCE(pg_sequence_last_value(
		pg_get_serial_sequence('public.sources', 'source_id')::regclass), 0)`).Scan(&v); err != nil {
		t.Fatalf("read sources sequence: %v", err)
	}
	return v
}

func registerInTx(t *testing.T, ctx context.Context, pool *pgxpool.Pool, samples []Sample) map[sourceKey]int16 {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)
	ids, err := ensureSources(ctx, tx, samples)
	if err != nil {
		t.Fatalf("ensureSources: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return ids
}

func sourceSample(name, bundle, version string) Sample {
	return Sample{SourceName: &name, SourceBundleID: &bundle, SourceVersion: &version}
}

// A new triple takes a free id below the sequence, and the sequence does not
// move.
func TestIntegration_SourcesReuseFreeIDs(t *testing.T) {
	ctx, pool, admin := sourceTestPools(t)
	prefix := fmt.Sprintf("ITestSrcGap%x-", time.Now().UnixNano())
	cleanupSources(t, ctx, admin, prefix)

	// Make a hole: three rows from the sequence, the middle one removed.
	var gap int16
	for i := range 3 {
		var id int16
		if err := admin.QueryRow(ctx,
			`INSERT INTO sources (name) VALUES ($1) RETURNING source_id`,
			fmt.Sprintf("%sfixture-%d", prefix, i)).Scan(&id); err != nil {
			t.Fatalf("fixture source: %v", err)
		}
		if i == 1 {
			gap = id
		}
	}
	if _, err := admin.Exec(ctx, `DELETE FROM sources WHERE source_id = $1`, gap); err != nil {
		t.Fatalf("delete fixture: %v", err)
	}

	seqBefore := sourceSeqLastValue(t, ctx, pool)
	k := sourceKey{name: prefix + "new", bundle: "com.example.itest", version: "1"}
	ids := registerInTx(t, ctx, pool, []Sample{sourceSample(k.name, k.bundle, k.version)})

	id, ok := ids[k]
	if !ok {
		t.Fatalf("new source not returned: %v", ids)
	}
	if int64(id) > int64(gap) {
		t.Errorf("new source got id %d; want the lowest free id, at most the hole at %d", id, gap)
	}
	if after := sourceSeqLastValue(t, ctx, pool); after != seqBefore {
		t.Errorf("sources sequence moved %d -> %d although a free id existed", seqBefore, after)
	}

	// Registering it again changes nothing.
	again := registerInTx(t, ctx, pool, []Sample{sourceSample(k.name, k.bundle, k.version)})
	if again[k] != id {
		t.Errorf("re-registration returned %d, want %d", again[k], id)
	}
}

// With more new triples than free ids, the free ones are used up and the rest
// come from the sequence; every triple is registered, each with its own id.
func TestIntegration_SourcesFallBackToSequence(t *testing.T) {
	ctx, pool, _ := sourceTestPools(t)
	prefix := fmt.Sprintf("ITestSrcSeq%x-", time.Now().UnixNano())

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	// Rolled back: the gaps stay for other tests (the sequence keeps the two
	// values drawn, which is harmless).
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(`+sourceRegistrationLock+`)`); err != nil {
		t.Fatalf("lock: %v", err)
	}
	seqBefore := sourceSeqLastValue(t, ctx, tx)
	var rows int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM sources WHERE source_id <= $1`, seqBefore).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	free := seqBefore - rows

	n := int(free) + 2
	samples := make([]Sample, 0, n)
	for i := range n {
		samples = append(samples, sourceSample(fmt.Sprintf("%s%06d", prefix, i), "com.example.itest", "1"))
	}
	ids, err := ensureSources(ctx, tx, samples)
	if err != nil {
		t.Fatalf("ensureSources: %v", err)
	}
	if len(ids) != n {
		t.Fatalf("registered %d of %d sources", len(ids), n)
	}
	seen := map[int16]bool{}
	fromSeq := 0
	for _, id := range ids {
		if seen[id] {
			t.Fatalf("id %d handed out twice", id)
		}
		seen[id] = true
		if int64(id) > seqBefore {
			fromSeq++
		}
	}
	if fromSeq != 2 {
		t.Errorf("%d ids came from the sequence, want 2 (free below it: %d)", fromSeq, free)
	}
}

// Concurrent batches registering overlapping new triples all succeed and agree
// on one id per triple.
func TestIntegration_SourcesConcurrentRegistration(t *testing.T) {
	ctx, pool, admin := sourceTestPools(t)
	prefix := fmt.Sprintf("ITestSrcConc%x-", time.Now().UnixNano())
	cleanupSources(t, ctx, admin, prefix)

	const workers = 8
	results := make([]map[sourceKey]int16, workers)
	errs := make([]error, workers)
	var wg sync.WaitGroup
	for w := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Each worker shares "shared" and has one of its own.
			samples := []Sample{
				sourceSample(prefix+"shared", "com.example.itest", "1"),
				sourceSample(fmt.Sprintf("%sown-%d", prefix, w), "com.example.itest", "1"),
			}
			tx, err := pool.Begin(ctx)
			if err != nil {
				errs[w] = err
				return
			}
			defer tx.Rollback(ctx)
			ids, err := ensureSources(ctx, tx, samples)
			if err != nil {
				errs[w] = err
				return
			}
			results[w] = ids
			errs[w] = tx.Commit(ctx)
		}()
	}
	wg.Wait()

	all := map[sourceKey]int16{}
	for w := range workers {
		if errs[w] != nil {
			t.Fatalf("worker %d: %v", w, errs[w])
		}
		for k, id := range results[w] {
			if prev, ok := all[k]; ok && prev != id {
				t.Errorf("%v got ids %d and %d", k, prev, id)
			}
			all[k] = id
		}
	}
	if len(all) != workers+1 {
		t.Errorf("registered %d triples, want %d", len(all), workers+1)
	}
	ids := map[int16]sourceKey{}
	for k, id := range all {
		if other, ok := ids[id]; ok {
			t.Errorf("id %d given to both %v and %v", id, k, other)
		}
		ids[id] = k
	}
}
