import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct ExploreStatisticsTests {
    private func calendar(_ zone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone)!
        return calendar
    }

    private func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    // MARK: - Welford

    @Test func welfordMatchesTheTextbookFormulas() {
        var w = Welford()
        let values: [Double] = [2, 4, 4, 4, 5, 5, 7, 9]
        for v in values { w.add(v) }
        #expect(w.count == 8)
        #expect(w.mean == 5)
        #expect(w.min == 2)
        #expect(w.max == 9)
        // Sample stddev: sum of squares 32 / 7.
        #expect(abs(w.stddev! - (32.0 / 7).squareRoot()) < 1e-12)
    }

    @Test func welfordIgnoresNonFiniteValuesButCountsThem() {
        var w = Welford()
        w.add(.nan)
        w.add(.infinity)
        w.add(3)
        #expect(w.count == 1)
        #expect(w.nonFiniteCount == 2)
        #expect(w.mean == 3)
        #expect(w.stddev == 0)
        #expect(Welford().stddev == nil)
    }

    // MARK: - Reservoir

    @Test func reservoirIsExactWhileTheStreamFits() {
        var r = ReservoirQuantiles(capacity: 100, seed: 1)
        for v in stride(from: 0.0, through: 99, by: 1) { r.add(v) }
        #expect(!r.isEstimated)
        #expect(r.count == 100)
        #expect(r.quantile(0) == 0)
        #expect(r.quantile(1) == 99)
        #expect(r.quantile(0.5) == 49.5)
        #expect(r.quantile(0.25) == 24.75)
    }

    @Test func reservoirEstimatesWithinOnePercentOnALargeUniformStream() {
        var r = ReservoirQuantiles(capacity: 8_192, seed: 42)
        for i in 0..<200_000 { r.add(Double(i)) }
        #expect(r.isEstimated)
        #expect(r.count == 200_000)
        #expect(r.values.count == 8_192)
        let median = r.quantile(0.5)!
        let p95 = r.quantile(0.95)!
        #expect(abs(median - 100_000) < 2_000)
        #expect(abs(p95 - 190_000) < 2_000)
    }

    @Test func reservoirIsDeterministicForASeed() {
        func run() -> [Double] {
            var r = ReservoirQuantiles(capacity: 64, seed: 7)
            for i in 0..<10_000 { r.add(Double(i)) }
            return r.values
        }
        #expect(run() == run())
        var other = ReservoirQuantiles(capacity: 64, seed: 8)
        for i in 0..<10_000 { other.add(Double(i)) }
        #expect(other.values != run())
    }

    @Test func reservoirKeepsAUniformSample() {
        // Every kept value must come from the stream, and with a 200k stream
        // into 8k slots the kept set must not be dominated by the prefix that
        // filled the reservoir.
        var r = ReservoirQuantiles(capacity: 8_192, seed: 3)
        for i in 0..<200_000 { r.add(Double(i)) }
        let fromPrefix = r.values.filter { $0 < 8_192 }.count
        #expect(fromPrefix < 1_000)
        #expect(r.values.allSatisfy { $0 >= 0 && $0 < 200_000 })
    }

    // MARK: - Histogram

    @Test func histogramCountsSumAndMaxLandsInLastBin() {
        let values: [Double] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        let h = TypeProfile.Histogram.fixedBins(count: 5, lower: 0, upper: 10, values: values)
        #expect(h.counts.reduce(0, +) == values.count)
        #expect(h.counts == [2, 2, 2, 2, 3])
        #expect(h.binCount == 5)
        #expect(!h.isEstimated)
    }

    @Test func histogramScalesReservoirCountsBackToTheStream() {
        let h = TypeProfile.Histogram.fixedBins(count: 2, lower: 0, upper: 1, values: [0.1, 0.9], scale: 50)
        #expect(h.isEstimated)
        #expect(h.counts == [50, 50])
    }

    @Test func histogramWithNoRangeIsOneBin() {
        let h = TypeProfile.Histogram.fixedBins(count: 40, lower: 5, upper: 5, values: [5, 5, 5])
        #expect(h.binCount == 1)
        #expect(h.counts == [3])
    }

    // MARK: - Gaps

    @Test func gapsAreExactAndDisorderIsSkipped() {
        var g = GapAccumulator(reservoirCapacity: 100, seed: 1)
        let base = date("2026-01-01T00:00:00Z")
        for seconds in [0.0, 10, 10, 40, 30, 100] {
            g.add(start: base.addingTimeInterval(seconds))
        }
        // Gaps: 10, 0, 30; 30 goes backwards (disorder); then 100 − 40 = 60.
        let cadence = g.cadence!
        #expect(cadence.gapCount == 4)
        #expect(cadence.zeroGapCount == 1)
        #expect(cadence.minGapSeconds == 0)
        #expect(cadence.maxGapSeconds == 60)
        #expect(g.disorderCount == 1)
        #expect(!cadence.isEstimated)
        #expect(GapAccumulator(reservoirCapacity: 10, seed: 1).cadence == nil)
    }

    // MARK: - Daily counts

    @Test func dailyCountsFollowTheLocalCalendarAcrossDST() {
        // 8 March 2026 is the spring-forward day in Los Angeles (23 hours).
        let cal = calendar("America/Los_Angeles")
        var d = DailyCountAccumulator(calendar: cal)
        // 7 Mar 23:30 PST = 08 Mar 07:30Z; 8 Mar 01:30 PST = 09:30Z;
        // 8 Mar 03:30 PDT = 10:30Z; 8 Mar 23:30 PDT = 09 Mar 06:30Z; 9 Mar 00:30 PDT = 07:30Z.
        for iso in [
            "2026-03-08T07:30:00Z", "2026-03-08T09:30:00Z", "2026-03-08T10:30:00Z",
            "2026-03-09T06:30:00Z", "2026-03-09T07:30:00Z",
        ] {
            d.add(date(iso))
        }
        let counts = d.dailyCounts
        #expect(counts.map(\.count) == [1, 3, 1])
        #expect(counts.map(\.day) == [
            date("2026-03-07T08:00:00Z"), date("2026-03-08T08:00:00Z"), date("2026-03-09T07:00:00Z"),
        ])
        let coverage = d.coverage!
        #expect(coverage.daysInSpan == 3)
        #expect(coverage.daysWithSamples == 3)
        #expect(coverage.fraction == 1)
    }

    @Test func coverageCountsTheWholeSpan() {
        let cal = calendar("UTC")
        var d = DailyCountAccumulator(calendar: cal)
        d.add(date("2026-01-01T12:00:00Z"))
        d.add(date("2026-01-10T12:00:00Z"))
        d.add(date("2026-01-10T13:00:00Z"))
        let coverage = d.coverage!
        #expect(coverage.daysInSpan == 10)
        #expect(coverage.daysWithSamples == 2)
        #expect(coverage.fraction == 0.2)
        #expect(DailyCountAccumulator(calendar: cal).coverage == nil)
    }

    @Test func breakdownOrdersByCountThenKey() {
        var b = BreakdownAccumulator<String>()
        let t0 = date("2026-01-01T00:00:00Z")
        b.add("b", start: t0)
        b.add("a", start: t0.addingTimeInterval(5))
        b.add("c", start: t0.addingTimeInterval(1))
        b.add("c", start: t0.addingTimeInterval(9))
        let sorted = b.sortedEntries(by: <)
        #expect(sorted.map(\.key) == ["c", "a", "b"])
        #expect(sorted[0].entry.earliestStart == t0.addingTimeInterval(1))
        #expect(sorted[0].entry.latestStart == t0.addingTimeInterval(9))
    }
}
