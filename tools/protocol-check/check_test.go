package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

const (
	schemaDir   = "../../docs/protocol/schema"
	fixturesDir = "../../docs/protocol/fixtures"
)

// resultKeys is the count body a reference server returns for an accepted
// batch; every .expected.json must carry exactly these under "response".
var resultKeys = []string{"accepted", "deleted", "duplicates", "routePoints", "seriesPoints", "aggregateSamples", "activitySummaries"}

func newValidator(t *testing.T) *Validator {
	t.Helper()
	v, err := NewValidator(schemaDir)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

type expected struct {
	Scenario string           `json:"scenario"`
	Notes    string           `json:"notes"`
	Status   int              `json:"status"`
	Response map[string]int64 `json:"response"`
}

func fixtures(t *testing.T) []string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(fixturesDir, "*.ndjson"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("no fixtures under %s (%v)", fixturesDir, err)
	}
	sort.Strings(paths)
	return paths
}

// Every fixture validates, and its expected response is internally consistent
// with the batch it describes (the smoke test in examples/receivers checks the
// same numbers against a live receiver).
func TestFixturesValidateAndMatchExpectations(t *testing.T) {
	v := newValidator(t)
	for _, path := range fixtures(t) {
		t.Run(filepath.Base(path), func(t *testing.T) {
			f, err := os.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			sum, errs := v.ValidateBatch(f)
			for _, e := range errs {
				t.Error(e)
			}
			if sum == nil {
				t.Fatal("no summary")
			}

			raw, err := os.ReadFile(strings.TrimSuffix(path, ".ndjson") + ".expected.json")
			if err != nil {
				t.Fatalf("missing expectation file: %v", err)
			}
			var exp expected
			if err := json.Unmarshal(raw, &exp); err != nil {
				t.Fatal(err)
			}
			if exp.Scenario == "" || exp.Notes == "" {
				t.Error("expected.json needs a scenario and notes")
			}
			if exp.Status != 200 {
				t.Errorf("status = %d, want 200 (every fixture is a valid batch)", exp.Status)
			}
			if len(exp.Response) != len(resultKeys) {
				t.Errorf("response has %d keys, want %d", len(exp.Response), len(resultKeys))
			}
			for _, k := range resultKeys {
				if _, ok := exp.Response[k]; !ok {
					t.Errorf("response missing %q", k)
				}
			}
			samples := int64(sum.Counts["sample"])
			if got := exp.Response["accepted"] + exp.Response["duplicates"]; got != samples {
				t.Errorf("accepted+duplicates = %d, want sampleCount %d", got, samples)
			}
			if exp.Response["routePoints"] != int64(sum.RoutePoints) {
				t.Errorf("routePoints = %d, fixture carries %d", exp.Response["routePoints"], sum.RoutePoints)
			}
			if exp.Response["seriesPoints"] != int64(sum.SeriesPoints) {
				t.Errorf("seriesPoints = %d, fixture carries %d", exp.Response["seriesPoints"], sum.SeriesPoints)
			}
			if exp.Response["aggregateSamples"] != int64(sum.Counts["aggregate"]) {
				t.Errorf("aggregateSamples = %d, fixture carries %d", exp.Response["aggregateSamples"], sum.Counts["aggregate"])
			}
			if exp.Response["activitySummaries"] != int64(sum.Counts["activity-summary"]) {
				t.Errorf("activitySummaries = %d, fixture carries %d", exp.Response["activitySummaries"], sum.Counts["activity-summary"])
			}
			if d := exp.Response["deleted"]; d > int64(sum.Counts["deletion"]) {
				t.Errorf("deleted = %d exceeds deletionCount %d", d, sum.Counts["deletion"])
			}
		})
	}
}

// The corpus as a whole exercises every sample kind, every line type, and both
// header generations, so a receiver that passes it has seen everything v1 can
// send.
func TestCorpusCoverage(t *testing.T) {
	v := newValidator(t)
	kinds := map[string]bool{}
	types := map[string]bool{}
	var legacy, versioned bool
	for _, path := range fixtures(t) {
		f, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		sum, errs := v.ValidateBatch(f)
		f.Close()
		if len(errs) > 0 || sum == nil {
			t.Fatalf("%s: %v", path, errs)
		}
		for k := range sum.Kinds {
			kinds[k] = true
		}
		for lt := range sum.Counts {
			types[lt] = true
		}
		if sum.Versioned {
			versioned = true
		} else {
			legacy = true
		}
	}
	for _, k := range []string{"quantity", "category", "workout", "heartbeatSeries", "ecg", "stateOfMind", "medicationDose"} {
		if !kinds[k] {
			t.Errorf("no fixture carries a %s sample", k)
		}
	}
	for _, lt := range LineTypes {
		if !types[lt.Name] {
			t.Errorf("no fixture carries a %s line", lt.Name)
		}
	}
	if !legacy || !versioned {
		t.Errorf("corpus needs both a legacy and a versioned header (legacy=%v versioned=%v)", legacy, versioned)
	}
}

// Every line after the header must match exactly one branch of batch-line.
func TestBatchLineDiscriminates(t *testing.T) {
	v := newValidator(t)
	for _, path := range fixtures(t) {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
		for i, line := range lines[1:] {
			doc, err := decode([]byte(line))
			if err != nil {
				t.Fatalf("%s line %d: %v", path, i+2, err)
			}
			if err := v.Validate("batch-line", doc); err != nil {
				t.Errorf("%s line %d: %v", path, i+2, err)
			}
		}
	}
}

func mustDecode(t *testing.T, s string) any {
	t.Helper()
	doc, err := decode([]byte(s))
	if err != nil {
		t.Fatalf("%s: %v", s, err)
	}
	return doc
}

// Lines the reference server accepts must pass: unknown fields, explicit
// nulls for absent optionals, absent end, minimal legacy headers, an empty
// profile object, an empty heartbeat series.
func TestSchemasAccept(t *testing.T) {
	v := newValidator(t)
	cases := []struct{ schema, line string }{
		{"header", `{"batchID":"6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f","deviceID":"d","type":"x","reason":"backfill","exportedAt":1718000000000,"sampleCount":0,"deletionCount":0}`},
		{"header", `{"schemaVersion":1,"clientVersion":"PulsHealth/1.0","batchID":"6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f","deviceID":"d","type":"x","reason":"manual","exportedAt":1718000000000,"sampleCount":0,"deletionCount":0,"routeCount":0,"seriesCount":0,"aggregateCount":0,"activitySummaryCount":0,"profileCount":0,"futureField":true}`},
		{"sample", `{"uuid":"11111111-1111-4111-8111-111111111111","type":"HKQuantityTypeIdentifierHeartRate","kind":"quantity","start":1718000000000,"value":62.5,"unit":"count/min","category":null,"workout":null,"ecg":null,"somethingNew":{"a":1}}`},
		{"sample", `{"uuid":"22222222-2222-4222-8222-222222222222","type":"HKCategoryTypeIdentifierSleepAnalysis","kind":"category","start":1718000000000,"end":1718003600000,"category":3}`},
		{"sample", `{"uuid":"55555555-5555-4555-8555-555555555555","type":"HKDataTypeIdentifierHeartbeatSeries","kind":"heartbeatSeries","start":1718000000000,"end":1718000060000,"heartbeats":[]}`},
		{"sample", `{"uuid":"33333333-3333-4333-8333-333333333333","type":"HKWorkoutTypeIdentifier","kind":"workout","start":1718000000000,"end":1718003600500,"workout":{"activityType":"running","duration":3600.5}}`},
		{"profile", `{"profile":{}}`},
		{"profile", `{"profile":{"name":null,"email":null,"dateOfBirth":null,"biologicalSex":null}}`},
		{"activity-summary", `{"activitySummary":{"date":1718086400000,"moveKcal":null,"moveMode":null}}`},
		{"aggregate", `{"aggregate":{"type":"HKQuantityTypeIdentifierStepCount","func":"sum","intervalValue":1,"intervalUnit":"day","deviceFilter":"all","bucketStart":1718000000000,"bucketEnd":1718086400000,"value":null}}`},
		{"route", `{"route":{"workoutUUID":"33333333-3333-4333-8333-333333333333","points":[]}}`},
	}
	for _, tc := range cases {
		if err := v.Validate(tc.schema, mustDecode(t, tc.line)); err != nil {
			t.Errorf("%s should accept %s: %v", tc.schema, tc.line, err)
		}
	}
}

// Lines the reference server refuses with 400 must fail.
func TestSchemasReject(t *testing.T) {
	v := newValidator(t)
	longRoute := `{"route":{"workoutUUID":"33333333-3333-4333-8333-333333333333","points":[` +
		strings.Repeat(`{"t":1718000001000,"lat":1,"lon":1},`, 4000) + `{"t":1718000001000,"lat":1,"lon":1}]}}`
	cases := []struct{ name, schema, line string }{
		{"header future version", "header", `{"schemaVersion":2,"batchID":"6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f","deviceID":"d","type":"x","reason":"backfill","exportedAt":1,"sampleCount":0,"deletionCount":0}`},
		{"header bad reason", "header", `{"batchID":"6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f","deviceID":"d","type":"x","reason":"weird","exportedAt":1,"sampleCount":0,"deletionCount":0}`},
		{"header bad batchID", "header", `{"batchID":"zzzz","deviceID":"d","type":"x","reason":"backfill","exportedAt":1,"sampleCount":0,"deletionCount":0}`},
		{"header negative count", "header", `{"batchID":"6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f","deviceID":"d","type":"x","reason":"backfill","exportedAt":1,"sampleCount":-1,"deletionCount":0}`},
		{"header two profiles", "header", `{"batchID":"6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f","deviceID":"d","type":"x","reason":"backfill","exportedAt":1,"sampleCount":0,"deletionCount":0,"profileCount":2}`},
		{"header empty type", "header", `{"batchID":"6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f","deviceID":"d","type":"","reason":"backfill","exportedAt":1,"sampleCount":0,"deletionCount":0}`},
		{"sample unknown kind", "sample", `{"uuid":"11111111-1111-4111-8111-111111111111","type":"x","kind":"mystery","start":1718000000000}`},
		{"sample bad uuid", "sample", `{"uuid":"nothexno-1111-4111-8111-111111111111","type":"x","kind":"quantity","start":1718000000000}`},
		{"sample zero start", "sample", `{"uuid":"11111111-1111-4111-8111-111111111111","type":"x","kind":"quantity","start":0}`},
		{"sample start beyond year 9999", "sample", `{"uuid":"11111111-1111-4111-8111-111111111111","type":"x","kind":"quantity","start":253402300800000}`},
		{"category without value", "sample", `{"uuid":"22222222-2222-4222-8222-222222222222","type":"x","kind":"category","start":1718000000000}`},
		{"category null value", "sample", `{"uuid":"22222222-2222-4222-8222-222222222222","type":"x","kind":"category","start":1718000000000,"category":null}`},
		{"workout without payload", "sample", `{"uuid":"33333333-3333-4333-8333-333333333333","type":"x","kind":"workout","start":1718000000000}`},
		{"heartbeat not a pair", "sample", `{"uuid":"55555555-5555-4555-8555-555555555555","type":"x","kind":"heartbeatSeries","start":1718000000000,"heartbeats":[[1.2,true,9]]}`},
		{"ecg without payload", "sample", `{"uuid":"66666666-6666-4666-8666-666666666666","type":"x","kind":"ecg","start":1718000000000}`},
		{"stateOfMind without payload", "sample", `{"uuid":"77777777-7777-4777-8777-777777777777","type":"x","kind":"stateOfMind","start":1718000000000}`},
		{"medicationDose without payload", "sample", `{"uuid":"88888888-8888-4888-8888-888888888888","type":"x","kind":"medicationDose","start":1718000000000}`},
		{"temporal context missing zone", "sample", `{"uuid":"11111111-1111-4111-8111-111111111111","type":"x","kind":"quantity","start":1718000000000,"startContext":{"utcOffsetSeconds":0,"source":"s","confidence":"c"}}`},
		{"deletion bad uuid", "deletion", `{"deleted":{"uuid":"xxxxxxxx-4444-4444-8444-444444444444","type":"x"}}`},
		{"deletion missing type", "deletion", `{"deleted":{"uuid":"44444444-4444-4444-8444-444444444444"}}`},
		{"route too many points", "route", longRoute},
		{"route point zero t", "route", `{"route":{"workoutUUID":"33333333-3333-4333-8333-333333333333","points":[{"t":0,"lat":1,"lon":1}]}}`},
		{"series missing type", "series", `{"series":{"workoutUUID":"33333333-3333-4333-8333-333333333333","points":[]}}`},
		{"aggregate unknown func", "aggregate", `{"aggregate":{"type":"x","func":"median","intervalValue":1,"intervalUnit":"hour","deviceFilter":"all","bucketStart":1718000000000,"bucketEnd":1718003600000,"value":1}}`},
		{"aggregate unknown intervalUnit", "aggregate", `{"aggregate":{"type":"x","func":"sum","intervalValue":1,"intervalUnit":"fortnight","deviceFilter":"all","bucketStart":1718000000000,"bucketEnd":1718003600000,"value":1}}`},
		{"aggregate unknown deviceFilter", "aggregate", `{"aggregate":{"type":"x","func":"sum","intervalValue":1,"intervalUnit":"hour","deviceFilter":"ipad","bucketStart":1718000000000,"bucketEnd":1718003600000,"value":1}}`},
		{"aggregate intervalValue zero", "aggregate", `{"aggregate":{"type":"x","func":"sum","intervalValue":0,"intervalUnit":"hour","deviceFilter":"all","bucketStart":1718000000000,"bucketEnd":1718003600000,"value":1}}`},
		{"aggregate value omitted", "aggregate", `{"aggregate":{"type":"x","func":"sum","intervalValue":1,"intervalUnit":"hour","deviceFilter":"all","bucketStart":1718000000000,"bucketEnd":1718003600000}}`},
		{"activity summary missing date", "activity-summary", `{"activitySummary":{"moveKcal":1}}`},
		{"activity summary bad moveMode", "activity-summary", `{"activitySummary":{"date":1718000000000,"moveMode":7}}`},
		{"activity summary bad localDate", "activity-summary", `{"activitySummary":{"date":1718000000000,"localDate":"June 10"}}`},
		{"profile null wrapper", "profile", `{"profile":null}`},
		{"profile missing wrapper", "profile", `{}`},
		{"profile bad sex", "profile", `{"profile":{"biologicalSex":"unknown"}}`},
		{"batch-line unknown wrapper", "batch-line", `{"mystery":{"uuid":"11111111-1111-4111-8111-111111111111"}}`},
		{"batch-line two wrappers", "batch-line", `{"deleted":{"uuid":"44444444-4444-4444-8444-444444444444","type":"x"},"route":{"workoutUUID":"33333333-3333-4333-8333-333333333333","points":[]}}`},
	}
	for _, tc := range cases {
		if err := v.Validate(tc.schema, mustDecode(t, tc.line)); err == nil {
			t.Errorf("%s: %s should reject %s", tc.name, tc.schema, tc.line)
		}
	}
}

// Whole-batch structure: counts, order, trailing lines, blank lines.
func TestValidateBatchStructure(t *testing.T) {
	v := newValidator(t)
	const hdr = `{"batchID":"6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f","deviceID":"d","type":"x","reason":"incremental","exportedAt":1718000000000,"sampleCount":%d,"deletionCount":%d}`
	const sample = `{"uuid":"11111111-1111-4111-8111-111111111111","type":"x","kind":"quantity","start":1718000000000,"value":1,"unit":"count"}`
	const del = `{"deleted":{"uuid":"44444444-4444-4444-8444-444444444444","type":"x"}}`
	const agg = `{"aggregate":{"type":"x","func":"sum","intervalValue":1,"intervalUnit":"hour","deviceFilter":"all","bucketStart":1718000000000,"bucketEnd":1718000000000,"value":1}}`

	body := func(s, d int, lines ...string) string {
		return strings.Replace(strings.Replace(hdr, "%d", itoa(s), 1), "%d", itoa(d), 1) + "\n" + strings.Join(lines, "\n") + "\n"
	}
	ok := func(name, b string) {
		t.Helper()
		sum, errs := v.ValidateBatch(strings.NewReader(b))
		if len(errs) > 0 || sum == nil {
			t.Errorf("%s: unexpected errors %v", name, errs)
		}
	}
	bad := func(name, b, want string) {
		t.Helper()
		_, errs := v.ValidateBatch(strings.NewReader(b))
		if len(errs) == 0 {
			t.Errorf("%s: expected an error containing %q", name, want)
			return
		}
		if !strings.Contains(errors.Join(errs...).Error(), want) {
			t.Errorf("%s: errors %v do not mention %q", name, errs, want)
		}
	}

	ok("samples then deletions", body(1, 1, sample, del))
	ok("blank lines tolerated", body(1, 1, sample, "", "   ", del))
	ok("header only", body(0, 0))
	ok("gzip input", gzipString(t, body(1, 0, sample)))
	bad("empty body", "", "missing batch header")
	bad("header not json", "nope\n", "not valid JSON")
	bad("missing line", body(2, 0, sample), "unexpected end of body")
	bad("trailing line", body(1, 0, sample, sample), "trailing line")
	bad("wrong order", body(1, 1, del, sample), "call for a sample line here, found a deletion")
	bad("unknown wrapper", body(0, 1, `{"mystery":{}}`), "found a sample")
	bad("bucketEnd not after bucketStart", strings.Replace(body(0, 0, agg), `"deletionCount":0`, `"deletionCount":0,"aggregateCount":1`, 1), "bucketEnd must be after bucketStart")
	bad("header fails schema", strings.Replace(body(0, 0), `"reason":"incremental"`, `"reason":"weird"`, 1), "header")
}

func itoa(n int) string { return strconv.Itoa(n) }
