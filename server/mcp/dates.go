package main

import (
	"fmt"
	"math"
	"time"
)

// Tool inputs and outputs speak calendar days (YYYY-MM-DD) and ISO 8601
// instants in the server's zone; the product API speaks epoch milliseconds
// and half-open [start, end) ranges. Everything that crosses that line goes
// through this file.

const dateLayout = "2006-01-02"

// The product API accepts epoch milliseconds from 1970-01-01 to 9999-12-31
// (server/api/main.go); rejecting other years here gives the model a clearer
// message than the API's 400.
const (
	minYear = 1970
	maxYear = 9999
)

// dayWindow is an inclusive range of calendar days in one zone, mapped to
// the half-open epoch-millisecond instant range the product API takes:
// [start of StartDate, start of the day after EndDate). The daily endpoints
// return every local day overlapping that range, so this yields exactly the
// requested days — no more, no fewer — including across DST changes.
type dayWindow struct {
	StartDate string // normalised YYYY-MM-DD
	EndDate   string
	StartMS   int64 // start of StartDate
	EndMS     int64 // start of the day after EndDate
	Days      int   // calendar days covered
}

// parseDate reads a YYYY-MM-DD calendar day as midnight in loc.
func parseDate(value, field string, loc *time.Location) (time.Time, error) {
	t, err := time.ParseInLocation(dateLayout, value, loc)
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must be a calendar date formatted YYYY-MM-DD, got %q", field, value)
	}
	if y := t.Year(); y < minYear || y > maxYear {
		return time.Time{}, fmt.Errorf("%s must fall between %d-01-01 and %d-12-31, got %q", field, minYear, maxYear, value)
	}
	return t, nil
}

// newDayWindow validates an inclusive start_date/end_date pair. maxDays
// bounds the span (0 means unbounded).
func newDayWindow(startDate, endDate string, loc *time.Location, maxDays int) (dayWindow, error) {
	start, err := parseDate(startDate, "start_date", loc)
	if err != nil {
		return dayWindow{}, err
	}
	end, err := parseDate(endDate, "end_date", loc)
	if err != nil {
		return dayWindow{}, err
	}
	if end.Before(start) {
		return dayWindow{}, fmt.Errorf("end_date %s is before start_date %s", end.Format(dateLayout), start.Format(dateLayout))
	}
	days := civilDays(start, end)
	if maxDays > 0 && days > maxDays {
		return dayWindow{}, fmt.Errorf("the range %s to %s covers %d days; at most %d days per call — split it into several calls",
			start.Format(dateLayout), end.Format(dateLayout), days, maxDays)
	}
	return dayWindow{
		StartDate: start.Format(dateLayout),
		EndDate:   end.Format(dateLayout),
		StartMS:   start.UnixMilli(),
		EndMS:     dayAfter(end).UnixMilli(),
		Days:      days,
	}, nil
}

// dayAfter is midnight of the next calendar day in t's zone (23 or 25 hours
// later across a DST change; AddDate normalises through time.Date).
func dayAfter(t time.Time) time.Time { return t.AddDate(0, 0, 1) }

// civilDays counts the calendar days from start to end inclusive. Both are
// local midnights; the arithmetic runs in UTC so DST cannot skew it.
func civilDays(start, end time.Time) int {
	s := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	e := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.UTC)
	return int(e.Sub(s).Hours()/24) + 1
}

// formatInstant renders an epoch-millisecond instant as ISO 8601 (RFC 3339,
// second precision) with the offset of loc.
func formatInstant(ms int64, loc *time.Location) string {
	return time.UnixMilli(ms).In(loc).Format(time.RFC3339)
}

func formatInstantPtr(ms *int64, loc *time.Location) *string {
	if ms == nil {
		return nil
	}
	s := formatInstant(*ms, loc)
	return &s
}

// round4 trims float noise (0.9700000000000001) to four decimals, enough for
// every canonical unit including the fractional "%" types.
func round4(v float64) float64 { return math.Round(v*1e4) / 1e4 }

func round4Ptr(v *float64) *float64 {
	if v == nil {
		return nil
	}
	r := round4(*v)
	return &r
}

// ageYears is the completed years between a birth date and now, comparing
// calendar fields only (dob is a date; now is a local time).
func ageYears(dob, now time.Time) int {
	years := now.Year() - dob.Year()
	if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
		years--
	}
	return years
}

func isHexN(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for i := 0; i < n; i++ {
		c := s[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

// isUUID matches the 8-4-4-4-12 hex form the product API accepts.
func isUUID(s string) bool {
	if len(s) != 36 || s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		return false
	}
	return isHexN(s[0:8], 8) && isHexN(s[9:13], 4) && isHexN(s[14:18], 4) &&
		isHexN(s[19:23], 4) && isHexN(s[24:36], 12)
}
