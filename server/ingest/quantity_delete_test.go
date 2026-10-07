package main

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPlanQuantityDeletes(t *testing.T) {
	day := func(d int) time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, d) }
	at := func(d int, minutes int) time.Time { return day(d).Add(time.Duration(minutes) * time.Minute) }
	// Compressed: days 0–30 and 60–90. Uncompressed: 30–60 (a backfilled
	// chunk the policy has not reached yet) and 90 onward.
	compressed := []timeRange{{day(0), day(30)}, {day(60), day(90)}}

	targets := []quantityTarget{
		{"r1", at(95, 0), 1},
		{"r2", at(91, 0), 2}, // another type, same uncompressed stretch
		{"r3", at(120, 0), 1},
		{"b1", at(40, 0), 1}, // uncompressed, but a compressed chunk lies before day 90
		{"c1", at(5, 0), 1},
		{"c2", at(5, 30), 1}, // within the gap: same statement as c1
		{"c3", at(5, 120), 1},
		{"c4", at(5, 10), 2}, // other type: its own statement
		{"c5", at(70, 0), 1},
		{"e1", day(90), 1},                       // a chunk's end is exclusive: uncompressed
		{"e2", day(60).Add(-time.Nanosecond), 1}, // last instant of the backfilled chunk
	}
	groups := planQuantityDeletes(slices.Clone(targets), compressed, time.Hour)

	type got struct {
		uuids      string
		lo, hi     time.Time
		typeID     int16
		compressed bool
	}
	var have []got
	for _, g := range groups {
		have = append(have, got{strings.Join(g.uuids, ","), g.lo, g.hi, g.typeID, g.compressed})
	}
	want := []got{
		{"b1,e2", at(40, 0), day(60).Add(-time.Nanosecond), 1, false},
		{"e1,r2,r1,r3", day(90), at(120, 0), 1, false},
		{"c1,c2", at(5, 0), at(5, 30), 1, true},
		{"c3", at(5, 120), at(5, 120), 1, true},
		{"c5", at(70, 0), at(70, 0), 1, true},
		{"c4", at(5, 10), at(5, 10), 2, true},
	}
	// typeID is only meaningful for compressed groups.
	for i := range have {
		if !have[i].compressed {
			have[i].typeID = 1
		}
	}
	if !slices.Equal(have, want) {
		t.Errorf("groups:\n got %+v\nwant %+v", have, want)
	}

	// Every target lands in exactly one group whose range contains it.
	seen := map[string]bool{}
	for _, g := range groups {
		for _, u := range g.uuids {
			if seen[u] {
				t.Errorf("%s planned twice", u)
			}
			seen[u] = true
		}
	}
	if len(seen) != len(targets) {
		t.Errorf("planned %d targets, want %d", len(seen), len(targets))
	}

	// No uncompressed statement's range may overlap a compressed chunk: that
	// chunk would be decompressed wholesale.
	for _, g := range groups {
		if g.compressed {
			continue
		}
		for _, c := range compressed {
			if c.start.Before(g.hi) && c.end.After(g.lo) {
				t.Errorf("uncompressed group %v..%v overlaps compressed chunk %v..%v", g.lo, g.hi, c.start, c.end)
			}
		}
	}

	if g := planQuantityDeletes(nil, compressed, time.Hour); len(g) != 0 {
		t.Errorf("no targets planned %d statements", len(g))
	}
}

// TestIntegration_ManyDeletionsAcrossCompressedAndRecentChunks deletes a
// thousand quantity samples in one batch, spread across a compressed chunk
// and the uncompressed current one, with tombstones for another user's rows
// and for samples never stored mixed in. Before it, a clustered deletion runs
// under a TimescaleDB decompression cap far below the compressed data's size,
// so a statement shape that cannot prune columnstore batches (uuid = ANY, a
// join, start_ts = ANY) fails it with SQLSTATE 53400.
func TestIntegration_ManyDeletionsAcrossCompressedAndRecentChunks(t *testing.T) {
	url := integrationDatabaseURL(t)

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	store := NewStore(pool)
	admin := adminPool(t, ctx)

	run := time.Now().UnixNano()
	typeIdent := fmt.Sprintf("ITestManyDeletions%d", run)
	userA := fmt.Sprintf("%08x-0a00-4000-8000-%012x", run>>32, run&0xffffffffffff)
	userB := fmt.Sprintf("%08x-0b00-4000-8000-%012x", run>>32, run&0xffffffffffff)
	for _, u := range []string{userA, userB} {
		if _, err := admin.Exec(ctx, `INSERT INTO users (id) VALUES ($1)`, u); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}
	if _, err := admin.Exec(ctx, `
		INSERT INTO sample_types (identifier, kind, unit) VALUES ($1, 'quantity', 'count')
		ON CONFLICT (identifier) DO NOTHING`, typeIdent); err != nil {
		t.Fatalf("seed type: %v", err)
	}

	// Old data: a unique month per run (as in the test above), one sample a
	// minute for 40k minutes (~28 days), half user A's and half user B's,
	// then compressed. Recent data: 800 of each user's samples over the last
	// two days, left in row storage.
	oldStart := time.Date(1990, time.Month(1+run%12), 1, 0, 0, 0, 0, time.UTC).
		AddDate(-int(run/12%40), 0, 0)
	const oldRows = 40000
	recentStart := time.Now().Add(-48 * time.Hour).Truncate(time.Minute)
	seed := func(start time.Time, n int, step string) {
		t.Helper()
		if _, err := admin.Exec(ctx, `
			INSERT INTO quantity_samples (uuid, type_id, start_ts, end_ts, value, user_id)
			SELECT gen_random_uuid(),
			       (SELECT type_id FROM sample_types WHERE identifier = $1),
			       $2::timestamptz + i * $4::interval,
			       $2::timestamptz + i * $4::interval,
			       i,
			       CASE WHEN i % 2 = 0 THEN $5::uuid ELSE $6::uuid END
			FROM generate_series(0, $3::int - 1) i`,
			typeIdent, start, n, step, userA, userB); err != nil {
			t.Fatalf("seed samples: %v", err)
		}
	}
	seed(oldStart, oldRows, "1 minute")
	seed(recentStart, 1600, "1 minute")
	oldEnd := oldStart.Add(oldRows * time.Minute)
	if _, err := admin.Exec(ctx, `
		SELECT compress_chunk(format('%I.%I', chunk_schema, chunk_name)::regclass,
		                      if_not_compressed => true)
		FROM timescaledb_information.chunks
		WHERE hypertable_schema = 'public' AND hypertable_name = 'quantity_samples'
		  AND range_end > $1::timestamptz AND range_start <= $2::timestamptz`,
		oldStart, oldEnd); err != nil {
		t.Fatalf("compress chunk: %v", err)
	}
	var uncompressed int
	if err := admin.QueryRow(ctx, `
		SELECT count(*) FROM timescaledb_information.chunks
		WHERE hypertable_schema = 'public' AND hypertable_name = 'quantity_samples'
		  AND range_end > $1::timestamptz AND range_start <= $2::timestamptz
		  AND NOT is_compressed`, oldStart, oldEnd).Scan(&uncompressed); err != nil {
		t.Fatalf("verify compression: %v", err)
	}
	if uncompressed != 0 {
		t.Fatalf("%d chunk(s) holding the old rows are still uncompressed", uncompressed)
	}

	pick := func(user string, from, to time.Time, every int, limit int) []string {
		t.Helper()
		rows, err := admin.Query(ctx, `
			SELECT uuid::text FROM (
				SELECT q.uuid, row_number() OVER (ORDER BY q.start_ts) AS rn
				FROM quantity_samples q JOIN sample_types st USING (type_id)
				WHERE st.identifier = $1 AND q.user_id = $2
				  AND q.start_ts >= $3 AND q.start_ts < $4) v
			WHERE rn % $5 = 0 ORDER BY rn LIMIT $6`, typeIdent, user, from, to, every, limit)
		if err != nil {
			t.Fatalf("pick victims: %v", err)
		}
		uuids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatalf("pick victims: %v", err)
		}
		if len(uuids) != limit {
			t.Fatalf("picked %d victims, want %d", len(uuids), limit)
		}
		return uuids
	}
	// 200 consecutive old samples of user A (~7 hours): one statement.
	clustered := pick(userA, oldStart, oldEnd, 1, 200)
	// 300 old samples of user A, one every 60 (two hours apart), and every
	// one of user A's 800 recent samples except the last 100.
	spread := pick(userA, oldStart.Add(24*time.Hour), oldEnd, 60, 300)
	recent := pick(userA, recentStart, time.Now().Add(time.Hour), 1, 700)
	// User B's rows in both regions, whose tombstones arrive in user A's batch.
	otherOld := pick(userB, oldStart, oldEnd, 97, 20)
	otherRecent := pick(userB, recentStart, time.Now().Add(time.Hour), 13, 20)

	count := func(user string, uuids []string) int {
		t.Helper()
		var n int
		if err := admin.QueryRow(ctx, `
			SELECT count(*) FROM quantity_samples q JOIN sample_types st USING (type_id)
			WHERE st.identifier = $1 AND q.user_id = $2
			  AND ($3::uuid[] IS NULL OR q.uuid = ANY($3::uuid[]))`,
			typeIdent, user, uuids).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		return n
	}
	beforeA, beforeB := count(userA, nil), count(userB, nil)

	// 1. The clustered deletion, under a cap of 5000 decompressed tuples.
	// The compressed chunk holds 40k rows of this type; this deletion's
	// rows lie in at most two 1000-row batches.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := tx.Exec(ctx, `SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 5000`); err != nil {
		t.Fatalf("set cap: %v", err)
	}
	n, err := deleteQuantitySamples(ctx, tx, clustered, userA)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("clustered deletion under a 5000-tuple decompression cap: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if n != int64(len(clustered)) {
		t.Errorf("clustered deletion removed %d rows, want %d", n, len(clustered))
	}

	// 2. One batch of 1000 deletions through the full ingest path, plus 40
	// tombstones for user B's rows and 10 for samples never stored.
	var victims []string
	victims = append(victims, spread...)
	victims = append(victims, recent...)
	tombstones := slices.Concat(victims, otherOld, otherRecent)
	for i := range 10 {
		tombstones = append(tombstones, fmt.Sprintf("%08x-0e00-4000-8000-%012x", run>>32, int64(i)))
	}
	batchID := fmt.Sprintf("%08x-00de-4000-8000-%012x", run>>32, run&0xffffffffffff)
	var sb strings.Builder
	fmt.Fprintf(&sb, `{"batchID":"%s","deviceID":"itest","type":"%s","reason":"incremental","exportedAt":1718000000000,"sampleCount":0,"deletionCount":%d}`+"\n",
		batchID, typeIdent, len(tombstones))
	for _, u := range tombstones {
		fmt.Fprintf(&sb, `{"deleted":{"uuid":"%s","type":"%s"}}`+"\n", u, typeIdent)
	}
	batch, err := ParseBatch(strings.NewReader(sb.String()))
	if err != nil {
		t.Fatalf("ParseBatch: %v", err)
	}
	batch.Header.UserID = userA
	start := time.Now()
	res, err := store.InsertBatch(ctx, batch, int64(sb.Len()))
	if err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}
	t.Logf("%d tombstones (%d stored rows) applied in %v", len(tombstones), len(victims), time.Since(start))
	if res.Deleted != int64(len(victims)) {
		t.Errorf("deleted = %d, want %d (user A's rows only)", res.Deleted, len(victims))
	}

	if left := count(userA, slices.Concat(clustered, victims)); left != 0 {
		t.Errorf("%d of user A's deleted samples are still stored", left)
	}
	if got, want := count(userA, nil), beforeA-len(clustered)-len(victims); got != want {
		t.Errorf("user A has %d samples left, want %d", got, want)
	}
	if got := count(userB, slices.Concat(otherOld, otherRecent)); got != len(otherOld)+len(otherRecent) {
		t.Errorf("user B's tombstoned samples: %d left, want all %d", got, len(otherOld)+len(otherRecent))
	}
	if got := count(userB, nil); got != beforeB {
		t.Errorf("user B has %d samples, want %d untouched", got, beforeB)
	}
}
