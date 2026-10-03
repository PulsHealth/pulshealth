package main

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The server's calendar zone.
//
// Every YYYY-MM-DD a tool takes or returns is a day in the stack's
// PULS_TIME_ZONE, and the product API cuts its days in the same zone (it
// refuses to start when that disagrees with the database). The API reports it
// on GET /v1/users, so this server adopts it: PULS_TIME_ZONE need not be set
// here at all, and a laptop's stdio instance no longer silently answers in
// UTC. Set, it wins, and a disagreement with the API is logged loudly.
//
// The API is asked lazily, before the first tool call, resource read or
// prompt — not at startup — so a client that launches this binary before
// the network (or the server) is up still gets a working instance once it
// is. Until the zone is known no date is computed: the call fails with an
// error saying why, and the next one asks again. A learned zone is asked
// again after zoneRefreshEvery, so a long-lived instance follows the stack
// when its PULS_TIME_ZONE changes; a failed re-ask keeps the known zone.

const (
	zoneLookupTimeout = 10 * time.Second
	zoneRefreshEvery  = time.Hour
)

type serverZone struct {
	// mu serialises the lookup, so concurrent first calls ask once.
	mu sync.Mutex
	// settled: a zone is known (PULS_TIME_ZONE was set, or the API
	// answered at learnedAt).
	settled bool
	// learnedAt is when the API last answered; zero for PULS_TIME_ZONE,
	// which is never asked again.
	learnedAt time.Time
	// loc is read by every tool without the lock.
	loc atomic.Pointer[time.Location]
}

// zoneMiddleware makes sure the zone is known before any request that
// computes a date: tool calls, resource reads and prompts.
func (s *service) zoneMiddleware(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		switch method {
		case "tools/call", "resources/read", "prompts/get":
			if err := s.ensureZone(ctx); err != nil {
				return nil, err
			}
		}
		return next(ctx, method, req)
	}
}

// ensureZone learns the product API's zone once, unless PULS_TIME_ZONE
// settled it.
func (s *service) ensureZone(ctx context.Context) error {
	z := s.zone
	z.mu.Lock()
	defer z.mu.Unlock()
	refresh := z.settled && !z.learnedAt.IsZero() && s.now().Sub(z.learnedAt) >= zoneRefreshEvery
	if z.settled && !refresh {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, zoneLookupTimeout)
	defer cancel()
	resp, err := s.api.Users(ctx)
	if err != nil {
		if refresh {
			// Keep answering in the zone already known; ask again next call.
			return nil
		}
		return fmt.Errorf("could not learn the server's time zone from the product API, so no date can be computed yet: %w "+
			"(or set PULS_TIME_ZONE to the stack's value)", err)
	}
	name := strings.TrimSpace(resp.TimeZone)
	if name == "" {
		// An API from before /v1/users reported its zone: what this server
		// always assumed without PULS_TIME_ZONE.
		if !refresh {
			s.logger().Warn("the product API does not report its time zone (it predates the field); using UTC. " +
				"Set PULS_TIME_ZONE to the stack's value, or update the API")
		}
		z.settled, z.learnedAt = true, s.now()
		return nil
	}
	loc, err := loadTimeZone(name)
	if err != nil {
		return fmt.Errorf("the product API reports a time zone this server cannot load: %w", err)
	}
	if previous := z.loc.Load(); !z.settled || previous.String() != loc.String() {
		s.logger().Info("using the product API's time zone", "time_zone", loc.String())
	}
	z.loc.Store(loc)
	z.settled, z.learnedAt = true, s.now()
	return nil
}

// checkZoneAgainstAPI compares an explicit PULS_TIME_ZONE (loc) with the
// zone the API reports. It reports whether the API answered at all, so the
// caller can try again later; a disagreement is logged, never fatal: the
// operator chose this zone, but every date here is then a day off the
// server's somewhere.
func (s *service) checkZoneAgainstAPI(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, zoneLookupTimeout)
	defer cancel()
	resp, err := s.api.Users(ctx)
	if err != nil {
		return false
	}
	ours := s.location().String()
	if api := strings.TrimSpace(resp.TimeZone); api != "" && !sameTimeZone(api, ours) {
		s.logger().Warn("PULS_TIME_ZONE disagrees with the product API's time zone: dates here are cut on different days "+
			"than the API's daily answers. Unset PULS_TIME_ZONE to use the API's, or make the two equal",
			"time_zone", ours, "api_time_zone", api)
	}
	return true
}

// watchZone runs checkZoneAgainstAPI until the API answers once, every
// interval, for as long as ctx lives.
func (s *service) watchZone(ctx context.Context, interval time.Duration) {
	for !s.checkZoneAgainstAPI(ctx) {
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func (s *service) logger() *slog.Logger {
	if s.log == nil {
		return slog.Default()
	}
	return s.log
}
