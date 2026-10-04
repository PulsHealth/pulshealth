package main

import (
	"fmt"
	"strings"
	"time"
)

// Calendar zone.
//
// PULS_TIME_ZONE decides where every server-side day starts and ends, and it
// must be the same everywhere: the database's puls_time_zone() (stored by
// db/migrations/013_time_zone.sh, read by metric_daily and Grafana), the
// product API's day ranges, and the MCP server's YYYY-MM-DD arguments.
// Identical in the API and the MCP server; see scripts/check-go-copies.sh.

// loadTimeZone resolves PULS_TIME_ZONE (an IANA name; empty means UTC).
func loadTimeZone(name string) (*time.Location, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("PULS_TIME_ZONE %q is not a valid IANA time zone: %w", name, err)
	}
	return loc, nil
}

// sameTimeZone reports whether two zone names cut the same calendar days.
// Names are compared exactly (IANA names are case-sensitive, and
// 013_time_zone.sh accepts only exact pg_timezone_names entries), except that
// the spellings of UTC — empty among them, which every service reads as UTC
// — count as one, so "UTC" and "Etc/UTC" are not a mismatch.
func sameTimeZone(a, b string) bool {
	return canonicalZoneName(a) == canonicalZoneName(b)
}

func canonicalZoneName(name string) string {
	name = strings.TrimSpace(name)
	switch name {
	case "", "UTC", "UCT", "Universal", "Zulu", "GMT", "GMT0", "Greenwich",
		"Etc/UTC", "Etc/UCT", "Etc/Universal", "Etc/Zulu",
		"Etc/GMT", "Etc/GMT0", "Etc/GMT+0", "Etc/GMT-0", "Etc/Greenwich":
		return "UTC"
	}
	return name
}
