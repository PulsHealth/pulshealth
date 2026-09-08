package main

import (
	"strings"
	"testing"
	"time"
)

func TestNewDayWindow_MapsInclusiveDaysToHalfOpenInstants(t *testing.T) {
	berlin := mustZone(t, "Europe/Berlin")
	newYork := mustZone(t, "America/New_York")

	tests := []struct {
		name       string
		loc        *time.Location
		start, end string
		wantStart  time.Time
		wantEnd    time.Time
		wantDays   int
	}{
		{
			name: "single day, UTC",
			loc:  time.UTC, start: "2026-09-07", end: "2026-09-07",
			wantStart: time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC),
			wantDays:  1,
		},
		{
			// EU clocks spring forward on 2026-03-29: the two days span 47 h.
			name: "across the spring DST change, Berlin",
			loc:  berlin, start: "2026-03-28", end: "2026-03-29",
			wantStart: time.Date(2026, 3, 27, 23, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 3, 29, 22, 0, 0, 0, time.UTC),
			wantDays:  2,
		},
		{
			// Clocks fall back on 2026-10-25: a 25-hour day.
			name: "the autumn DST day itself, Berlin",
			loc:  berlin, start: "2026-10-25", end: "2026-10-25",
			wantStart: time.Date(2026, 10, 24, 22, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 10, 25, 23, 0, 0, 0, time.UTC),
			wantDays:  1,
		},
		{
			name: "a week west of Greenwich",
			loc:  newYork, start: "2026-09-01", end: "2026-09-07",
			wantStart: time.Date(2026, 9, 1, 4, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 9, 8, 4, 0, 0, 0, time.UTC),
			wantDays:  7,
		},
		{
			name: "year boundary",
			loc:  time.UTC, start: "2025-12-31", end: "2026-01-01",
			wantStart: time.Date(2025, 12, 31, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
			wantDays:  2,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			win, err := newDayWindow(tt.start, tt.end, tt.loc, 0)
			if err != nil {
				t.Fatal(err)
			}
			if win.StartMS != tt.wantStart.UnixMilli() {
				t.Errorf("StartMS = %s, want %s", time.UnixMilli(win.StartMS).UTC(), tt.wantStart)
			}
			if win.EndMS != tt.wantEnd.UnixMilli() {
				t.Errorf("EndMS = %s, want %s", time.UnixMilli(win.EndMS).UTC(), tt.wantEnd)
			}
			if win.Days != tt.wantDays {
				t.Errorf("Days = %d, want %d", win.Days, tt.wantDays)
			}
			if win.StartDate != tt.start || win.EndDate != tt.end {
				t.Errorf("dates = %s..%s, want %s..%s", win.StartDate, win.EndDate, tt.start, tt.end)
			}
		})
	}
}

func TestNewDayWindow_Rejects(t *testing.T) {
	tests := []struct {
		name       string
		start, end string
		maxDays    int
		wantErr    string
	}{
		{"empty start", "", "2026-09-07", 0, "start_date"},
		{"month out of range", "2026-13-01", "2026-13-01", 0, "start_date"},
		{"day out of range", "2026-02-30", "2026-03-01", 0, "start_date"},
		{"unpadded", "2026-9-7", "2026-09-07", 0, "YYYY-MM-DD"},
		{"US order", "09/07/2026", "09/07/2026", 0, "YYYY-MM-DD"},
		{"a timestamp, not a date", "2026-09-07T00:00:00Z", "2026-09-07", 0, "start_date"},
		{"bad end", "2026-09-07", "yesterday", 0, "end_date"},
		{"reversed", "2026-09-08", "2026-09-07", 0, "before start_date"},
		{"before the epoch", "1969-12-31", "2026-09-07", 0, "1970-01-01"},
		{"span over the cap", "2025-01-01", "2026-01-02", 366, "367 days"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := newDayWindow(tt.start, tt.end, time.UTC, tt.maxDays)
			if err == nil {
				t.Fatal("no error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("err = %q, want it to mention %q", err, tt.wantErr)
			}
		})
	}
	// Exactly at the cap is fine: 2026 is not a leap year, so a full year
	// is 365 days and 366 allows one more.
	if _, err := newDayWindow("2025-01-01", "2026-01-01", time.UTC, 366); err != nil {
		t.Errorf("366-day range rejected: %v", err)
	}
}

func TestFormatInstant_UsesZoneOffset(t *testing.T) {
	berlin := mustZone(t, "Europe/Berlin")
	ms := time.Date(2026, 9, 6, 22, 30, 0, 0, time.UTC).UnixMilli()
	if got := formatInstant(ms, berlin); got != "2026-09-07T00:30:00+02:00" {
		t.Errorf("formatInstant = %q", got)
	}
	if got := formatInstant(ms, time.UTC); got != "2026-09-06T22:30:00Z" {
		t.Errorf("formatInstant UTC = %q", got)
	}
}

func TestAgeYears(t *testing.T) {
	dob := time.Date(1990, 9, 8, 0, 0, 0, 0, time.UTC)
	if got := ageYears(dob, time.Date(2026, 9, 7, 23, 0, 0, 0, time.UTC)); got != 35 {
		t.Errorf("day before birthday: %d, want 35", got)
	}
	if got := ageYears(dob, time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)); got != 36 {
		t.Errorf("on the birthday: %d, want 36", got)
	}
}

func TestRound4(t *testing.T) {
	if got := round4(0.9700000000000001); got != 0.97 {
		t.Errorf("round4 = %v", got)
	}
	if got := round4(151.333333); got != 151.3333 {
		t.Errorf("round4 = %v", got)
	}
}

func TestIsUUID(t *testing.T) {
	if !isUUID(workoutUUID) || !isUUID(strings.ToUpper(workoutUUID)) {
		t.Error("valid uuid rejected")
	}
	for _, bad := range []string{"", "not-a-uuid", workoutUUID[:35], workoutUUID + "0", "0a1b2c3d4e5f4a6b8c7d9e8f7a6b5c4d"} {
		if isUUID(bad) {
			t.Errorf("isUUID(%q) = true", bad)
		}
	}
}
