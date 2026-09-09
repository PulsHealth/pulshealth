package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// countingPinger records how many probes reached the database.
type countingPinger struct {
	calls atomic.Int64
	err   error
	// block, when non-nil, holds every probe until it is closed.
	block chan struct{}
}

func (p *countingPinger) Ping(ctx context.Context) error {
	p.calls.Add(1)
	if p.block != nil {
		select {
		case <-p.block:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return p.err
}

func TestHealthCacheProbesAtMostOncePerTTL(t *testing.T) {
	t.Parallel()
	var h healthCache
	p := &countingPinger{}
	now := time.Unix(1_700_000_000, 0)

	for range 100 {
		if !h.status(context.Background(), p, now) {
			t.Fatal("status = false, want true from a healthy database")
		}
	}
	if n := p.calls.Load(); n != 1 {
		t.Fatalf("100 calls within the TTL made %d probes, want 1", n)
	}

	// Just inside the TTL: still cached.
	h.status(context.Background(), p, now.Add(healthTTL-time.Millisecond))
	if n := p.calls.Load(); n != 1 {
		t.Fatalf("a call inside the TTL made %d probes, want 1", n)
	}
	// Past it: one more.
	h.status(context.Background(), p, now.Add(healthTTL))
	if n := p.calls.Load(); n != 2 {
		t.Fatalf("a call past the TTL made %d probes, want 2", n)
	}
}

// This is the property that matters: the endpoint is unauthenticated, so a
// flood of concurrent requests must not become a flood of pool acquisitions.
func TestHealthCacheCollapsesConcurrentProbes(t *testing.T) {
	t.Parallel()
	var h healthCache
	p := &countingPinger{block: make(chan struct{})}
	now := time.Unix(1_700_000_000, 0)

	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.status(context.Background(), p, now)
		}()
	}
	// Let them pile up, then release the single in-flight probe.
	time.Sleep(50 * time.Millisecond)
	inFlight := p.calls.Load()
	close(p.block)
	wg.Wait()

	if inFlight != 1 {
		t.Fatalf("%d concurrent probes were in flight, want 1", inFlight)
	}
	if n := p.calls.Load(); n != 1 {
		t.Fatalf("50 concurrent callers made %d probes, want 1", n)
	}
}

func TestHealthCacheReportsFailureAndRecovers(t *testing.T) {
	t.Parallel()
	var h healthCache
	p := &countingPinger{err: errors.New("database is down")}
	now := time.Unix(1_700_000_000, 0)

	if h.status(context.Background(), p, now) {
		t.Fatal("status = true, want false while the database is down")
	}
	p.err = nil
	// Still cached as down inside the TTL...
	if h.status(context.Background(), p, now.Add(healthTTL/2)) {
		t.Fatal("status changed inside the TTL")
	}
	// ...and recovers on the next probe, so a health check notices within
	// one interval.
	if !h.status(context.Background(), p, now.Add(healthTTL)) {
		t.Fatal("status = false after the database recovered")
	}
}

// End to end through the real route table: /healthz stays unauthenticated and
// answers, but hammering it does not hammer the database.
func TestHealthzIsCachedEndToEnd(t *testing.T) {
	srv := newTestServer(&fakeStore{})

	for range 50 {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		rec := httptest.NewRecorder()
		srv.routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
	}
	if n := srv.store.(*fakeStore).pings.Load(); n > 1 {
		t.Fatalf("50 /healthz requests made %d database pings, want at most 1", n)
	}
}
