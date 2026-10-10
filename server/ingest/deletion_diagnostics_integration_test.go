package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestIntegration_DeletedUserCannotRegainDiagnostics(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, integrationDatabaseURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	admin := adminPool(t, ctx)
	store := NewStore(pool)
	run := time.Now().UnixNano()
	user := fmt.Sprintf("%08x-0350-4000-8000-%012x", run>>32, run&0xffffffffffff)
	if _, err := admin.Exec(ctx, "INSERT INTO users(id) VALUES ($1)", user); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DELETE FROM ingest_rejections WHERE user_id=$1", user)
		_, _ = admin.Exec(context.Background(), "DELETE FROM users WHERE id=$1", user)
	})
	rejection := IngestRejection{UserID: user, Status: 400, Stage: "parse", ErrorMessage: "synthetic rejection"}
	if err := store.RecordRejection(ctx, rejection); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := admin.QueryRow(ctx, "SELECT count(*) FROM ingest_rejections WHERE user_id=$1", user).Scan(&count); err != nil || count != 1 {
		t.Fatalf("existing owner diagnostics: count=%d err=%v", count, err)
	}
	// Hold the lock a real purge takes. A late diagnostic must wait, then
	// observe the missing owner after commit rather than recreate its record.
	tx, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", user); err != nil {
		t.Fatal(err)
	}
	blocked, stop := context.WithTimeout(ctx, 150*time.Millisecond)
	err = store.RecordRejection(blocked, rejection)
	stop()
	if err == nil {
		t.Fatal("diagnostic did not wait for deletion's user lock")
	}
	if _, err := tx.Exec(ctx, "DELETE FROM ingest_rejections WHERE user_id=$1", user); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM users WHERE id=$1", user); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordRejection(ctx, rejection); err != nil {
		t.Fatal(err)
	}
	if err := admin.QueryRow(ctx, "SELECT count(*) FROM ingest_rejections WHERE user_id=$1", user).Scan(&count); err != nil || count != 0 {
		t.Fatalf("deleted owner diagnostics: count=%d err=%v", count, err)
	}
	rejection.UserID = "invalid"
	if err := store.RecordRejection(ctx, rejection); err != nil {
		t.Fatal(err)
	}
}
