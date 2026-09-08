package main

import (
	"testing"
	"time"
)

// la is the zone the sleep fixtures are written in: a night that crosses
// midnight Pacific time crosses no UTC midnight at all, which is exactly
// the case wake-up-day attribution has to get right.
func la(t *testing.T) *time.Location {
	t.Helper()
	loc, err := losAngelesLocation()
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func at(loc *time.Location, day, hhmm string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", day+" "+hhmm, loc)
	if err != nil {
		panic(err)
	}
	return t
}

func stageSample(loc *time.Location, source int, stage sleepStage, day, from, to string) sleepSample {
	start := at(loc, day, from)
	end := at(loc, day, to)
	if end.Before(start) {
		end = end.AddDate(0, 0, 1)
	}
	return sleepSample{Start: start, End: end, Stage: stage, SourceID: source}
}

func TestSleepStageFromEnumCoversTheSeededLabels(t *testing.T) {
	t.Parallel()
	want := map[string]sleepStage{
		"HKCategoryValueSleepAnalysisInBed":             sleepStageInBed,
		"HKCategoryValueSleepAnalysisAsleepUnspecified": sleepStageAsleepUnspecified,
		"HKCategoryValueSleepAnalysisAwake":             sleepStageAwake,
		"HKCategoryValueSleepAnalysisAsleepCore":        sleepStageCore,
		"HKCategoryValueSleepAnalysisAsleepDeep":        sleepStageDeep,
		"HKCategoryValueSleepAnalysisAsleepREM":         sleepStageREM,
		"HKCategoryValueSleepAnalysisSomethingNew":      sleepStageUnknown,
		"": sleepStageUnknown,
	}
	for name, stage := range want {
		if got := sleepStageFromEnum(name); got != stage {
			t.Errorf("sleepStageFromEnum(%q) = %v, want %v", name, got, stage)
		}
	}
}

// A Watch (source 1) records stages while the iPhone (source 2) records the
// scheduled in-bed window and a stage-less asleep interval for the same
// night. The night must be one row on the wake-up day, in-bed time from the
// phone, asleep time and stages from the Watch, and nothing summed twice.
func TestSegmentNightsMergesSourcesWithoutDoubleCounting(t *testing.T) {
	t.Parallel()
	loc := la(t)
	samples := []sleepSample{
		// iPhone: in bed 22:30–06:30, "asleep" 22:45–06:15.
		stageSample(loc, 2, sleepStageInBed, "2026-09-20", "22:30", "06:30"),
		stageSample(loc, 2, sleepStageAsleepUnspecified, "2026-09-20", "22:45", "06:15"),
		// Watch: stages, out of order on purpose.
		stageSample(loc, 1, sleepStageCore, "2026-09-21", "03:10", "06:30"),
		stageSample(loc, 1, sleepStageCore, "2026-09-20", "22:40", "01:00"),
		stageSample(loc, 1, sleepStageDeep, "2026-09-21", "01:00", "02:00"),
		stageSample(loc, 1, sleepStageREM, "2026-09-21", "02:00", "03:00"),
		stageSample(loc, 1, sleepStageAwake, "2026-09-21", "03:00", "03:10"),
	}

	nights := segmentNights(samples, loc)
	if len(nights) != 1 {
		t.Fatalf("nights = %+v, want one", nights)
	}
	n := nights[0]
	if n.Date != "2026-09-21" {
		t.Errorf("date = %s, want the wake-up day 2026-09-21", n.Date)
	}
	if n.Start != at(loc, "2026-09-20", "22:30").UnixMilli() || n.End != at(loc, "2026-09-21", "06:30").UnixMilli() {
		t.Errorf("start/end = %d/%d", n.Start, n.End)
	}
	if n.InBedMinutes != 480 {
		t.Errorf("inBedMinutes = %v, want 480 (the phone's in-bed window)", n.InBedMinutes)
	}
	// Watch: 140 + 60 + 60 + 200 = 460 asleep, beats the phone's 450.
	if n.AsleepMinutes != 460 {
		t.Errorf("asleepMinutes = %v, want 460 (the Watch's total, not 460+450)", n.AsleepMinutes)
	}
	if n.Stages != (SleepStages{Core: 340, Deep: 60, REM: 60, Unspecified: 0, Awake: 10}) {
		t.Errorf("stages = %+v", n.Stages)
	}
	if n.Sources != 2 {
		t.Errorf("sources = %d, want 2", n.Sources)
	}
}

func TestSegmentNightsSplitsOnGapsAndKeepsNapsSeparate(t *testing.T) {
	t.Parallel()
	loc := la(t)
	samples := []sleepSample{
		stageSample(loc, 1, sleepStageCore, "2026-09-20", "23:00", "06:00"),
		// A nap 8 h after waking: its own row, same wake-up date.
		stageSample(loc, 1, sleepStageCore, "2026-09-21", "14:00", "15:00"),
		// A wake-up within the gap does not end the night.
		stageSample(loc, 1, sleepStageCore, "2026-09-21", "22:00", "01:00"),
		stageSample(loc, 1, sleepStageAwake, "2026-09-22", "01:00", "01:20"),
		stageSample(loc, 1, sleepStageREM, "2026-09-22", "03:00", "07:00"),
	}
	nights := segmentNights(samples, loc)
	if len(nights) != 3 {
		t.Fatalf("nights = %+v, want three", nights)
	}
	if nights[0].Date != "2026-09-21" || nights[0].AsleepMinutes != 420 {
		t.Errorf("night 0 = %+v", nights[0])
	}
	if nights[1].Date != "2026-09-21" || nights[1].AsleepMinutes != 60 {
		t.Errorf("nap = %+v", nights[1])
	}
	if nights[2].Date != "2026-09-22" || nights[2].AsleepMinutes != 420 || nights[2].Stages.Awake != 20 {
		t.Errorf("night 2 = %+v", nights[2])
	}
	if nights[2].Start != at(loc, "2026-09-21", "22:00").UnixMilli() || nights[2].End != at(loc, "2026-09-22", "07:00").UnixMilli() {
		t.Errorf("night 2 bounds = %d..%d", nights[2].Start, nights[2].End)
	}
}

func TestSegmentNightsPrefersStageDetailOnTies(t *testing.T) {
	t.Parallel()
	loc := la(t)
	samples := []sleepSample{
		// Both sources report 420 asleep minutes; the staged one wins.
		stageSample(loc, 9, sleepStageAsleepUnspecified, "2026-09-20", "23:00", "06:00"),
		stageSample(loc, 4, sleepStageDeep, "2026-09-20", "23:00", "02:00"),
		stageSample(loc, 4, sleepStageCore, "2026-09-21", "02:00", "06:00"),
	}
	n := segmentNights(samples, loc)[0]
	if n.Stages.Deep != 180 || n.Stages.Core != 240 || n.Stages.Unspecified != 0 {
		t.Errorf("stages = %+v, want the staged source", n.Stages)
	}
	// An empty night list and unknown stages are harmless.
	if got := segmentNights(nil, loc); len(got) != 0 {
		t.Errorf("segmentNights(nil) = %+v", got)
	}
	unknown := segmentNights([]sleepSample{stageSample(loc, 1, sleepStageUnknown, "2026-09-20", "23:00", "06:00")}, loc)
	if len(unknown) != 1 || unknown[0].AsleepMinutes != 0 || unknown[0].InBedMinutes != 0 {
		t.Errorf("unknown stage = %+v", unknown)
	}
}

func TestLocalDayBoundsAndCalendarDays(t *testing.T) {
	t.Parallel()
	loc := la(t)
	// One minute either side of local midnight touches two days.
	start := at(loc, "2026-09-20", "23:59")
	end := at(loc, "2026-09-21", "00:01")
	first, afterLast, err := localDayBounds(start, end, loc)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Equal(at(loc, "2026-09-20", "00:00")) || !afterLast.Equal(at(loc, "2026-09-22", "00:00")) {
		t.Errorf("bounds = %s .. %s", first, afterLast)
	}
	if got := calendarDays(first, afterLast); got != 2 {
		t.Errorf("calendarDays = %d, want 2", got)
	}
	// Across the November fall-back the day count is still calendar days.
	first, afterLast, _ = localDayBounds(at(loc, "2026-10-31", "12:00"), at(loc, "2026-11-02", "12:00"), loc)
	if got := calendarDays(first, afterLast); got != 3 {
		t.Errorf("calendarDays across DST = %d, want 3", got)
	}
	if _, _, err := localDayBounds(end, start, loc); err == nil {
		t.Error("reversed range accepted")
	}
}
