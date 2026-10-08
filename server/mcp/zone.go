package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Calendar zones are refreshed through the selected API client for each
// request. Request-local service copies keep simultaneous accounts independent.
// The legacy single-zone helpers below remain for startup compatibility checks.

const (
	zoneLookupTimeout = 10 * time.Second
	zoneRefreshEvery  = time.Hour
)

type serverZone struct {
	explicit bool
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

type requestZoneKey struct{}

// forContext copies the service, never mutating a zone used by another caller.
func (s *service) forContext(ctx context.Context) *service {
	if loc, ok := ctx.Value(requestZoneKey{}).(*time.Location); ok {
		local := *s
		local.zone = &serverZone{settled: true}
		local.zone.loc.Store(loc)
		return &local
	}
	return s
}

func (s *service) zoneMiddleware(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		var api *APIClient
		var err error
		switch r := req.(type) {
		case *mcp.CallToolRequest:
			var in userInput
			if r.Params != nil && len(r.Params.Arguments) > 0 {
				if err := json.Unmarshal(r.Params.Arguments, &in); err != nil {
					return next(ctx, method, req)
				}
			}
			api, _, err = s.scope(r, in.User)
		case *mcp.ReadResourceRequest:
			api, _, err = s.callerAPI(r.Extra)
		case *mcp.GetPromptRequest:
			api, _, err = s.callerAPI(r.Extra)
		default:
			return next(ctx, method, req)
		}
		if err != nil {
			if _, ok := req.(*mcp.CallToolRequest); ok {
				return next(ctx, method, req)
			}
			return nil, err
		}
		loc, err := s.selectedZone(ctx, api)
		if err != nil {
			return nil, err
		}
		return next(context.WithValue(ctx, requestZoneKey{}, loc), method, req)
	}
}

// Fetch fresh metadata for each request so account setting changes apply on
// the next call. Only the request context reuses this resolved zone. An account
// zone takes precedence over the legacy environment override.
func (s *service) selectedZone(ctx context.Context, api *APIClient) (*time.Location, error) {
	z := s.zone
	key := api.User()
	ctx, cancel := context.WithTimeout(ctx, zoneLookupTimeout)
	defer cancel()
	resp, err := api.Users(ctx)
	if err != nil {
		// Explicit zones remain usable against legacy APIs without /v1/users.
		var apiErr *APIError
		if z.explicit && errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
			return z.loc.Load(), nil
		}
		return nil, fmt.Errorf("could not learn the selected user's time zone: %w", err)
	}
	selected := key
	if selected == "" {
		selected = resp.Default
	}
	name := ""
	for _, user := range resp.Users {
		if strings.EqualFold(user.UserID, selected) {
			name = strings.TrimSpace(user.TimeZone)
			break
		}
	}
	if name == "" {
		if z.explicit {
			name = z.loc.Load().String()
		} else {
			name = strings.TrimSpace(resp.TimeZone)
		}
	}
	if name == "" {
		name = "UTC"
	}
	loc, err := loadTimeZone(name)
	if err != nil {
		return nil, fmt.Errorf("invalid selected user's time zone: %w", err)
	}
	return loc, nil
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
