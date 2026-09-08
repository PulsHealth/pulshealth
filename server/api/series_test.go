package main

import (
	"encoding/json"
	"testing"
)

func linearSeries(n int) []SeriesPoint {
	points := make([]SeriesPoint, n)
	for i := range points {
		points[i] = SeriesPoint{T: 1_751_562_000_000 + int64(i)*1000, V: float64(i)}
	}
	return points
}

func TestDownsampleKeepsShortSeriesAndEndpoints(t *testing.T) {
	t.Parallel()

	ten := linearSeries(10)
	if got := downsample(ten, 10); len(got) != 10 || got[9] != ten[9] {
		t.Errorf("a series at the cap should be untouched: %+v", got)
	}
	if got := downsample(ten, 500); len(got) != 10 {
		t.Errorf("a series under the cap should be untouched: %d points", len(got))
	}
	if got := downsample(nil, 5); len(got) != 0 {
		t.Errorf("downsample(nil) = %+v", got)
	}

	// 1,000 points to 100: first and last verbatim, 98 bucket means between.
	thousand := linearSeries(1000)
	got := downsample(thousand, 100)
	if len(got) != 100 {
		t.Fatalf("len = %d, want 100", len(got))
	}
	if got[0] != thousand[0] || got[99] != thousand[999] {
		t.Errorf("endpoints not kept: %+v .. %+v", got[0], got[99])
	}
	// The inner 998 points split into 98 buckets of ~10.2; the first bucket
	// is points 1..10 (indices 1–10), mean value 5.5, mean time base+5500.
	if got[1].V != 5.5 || got[1].T != thousand[0].T+5500 {
		t.Errorf("bucket 0 = %+v, want mean of points 1..10", got[1])
	}
	for i := 1; i < len(got); i++ {
		if got[i].T <= got[i-1].T || got[i].V <= got[i-1].V {
			t.Fatalf("downsampled series is not monotonic at %d: %+v -> %+v", i, got[i-1], got[i])
		}
	}

	// Degenerate caps.
	if got := downsample(ten, 2); len(got) != 2 || got[0] != ten[0] || got[1] != ten[9] {
		t.Errorf("max=2 = %+v, want first and last", got)
	}
	if got := downsample(ten, 1); len(got) != 1 || got[0] != ten[0] {
		t.Errorf("max=1 = %+v, want the first point", got)
	}
}

func TestSeriesPointJSONIsAPair(t *testing.T) {
	t.Parallel()

	b, err := json.Marshal([]SeriesPoint{{T: 1751562000000, V: 68.5}, {T: 1751562001000, V: 70}})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `[[1751562000000,68.5],[1751562001000,70]]` {
		t.Errorf("json = %s", b)
	}
	var back []SeriesPoint
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if len(back) != 2 || back[0].T != 1751562000000 || back[0].V != 68.5 || back[1].V != 70 {
		t.Errorf("round trip = %+v", back)
	}
	var bad SeriesPoint
	if err := json.Unmarshal([]byte(`[1,2,3]`), &bad); err == nil {
		t.Error("a three-element point was accepted")
	}
}
