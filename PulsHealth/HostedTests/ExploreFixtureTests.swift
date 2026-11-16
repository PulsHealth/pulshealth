#if DEBUG
import XCTest
import PulsHealthSync
@testable import PulsHealth

final class ExploreFixtureTests: XCTestCase {
    func testAverageGapUsesStartTimesAndPreservesSimultaneousReadings() {
        var profile = ExploreFixtures.heartRate
        let first = Date(timeIntervalSince1970: 1_700_000_000)
        profile.sampleCount = 3
        profile.earliestStart = first
        profile.latestStart = first.addingTimeInterval(120)
        profile.latestEnd = first.addingTimeInterval(900)
        profile.cadence?.gapCount = 2
        profile.cadence?.zeroGapCount = 1
        XCTAssertEqual(RecordingInsights(profile: profile).averageGap, 60)
        profile.cadence?.gapCount = 1
        XCTAssertNil(RecordingInsights(profile: profile).averageGap)
        profile.sampleCount = 1
        XCTAssertNil(RecordingInsights(profile: profile).averageGap)
    }

    func testBusiestDaysAndWeekdaysUseRecordingCalendar() {
        var profile = ExploreFixtures.heartRate
        profile.timeZoneID = "America/Los_Angeles"
        let monday = ISO8601DateFormatter().date(from: "2026-11-17T02:00:00Z")!
        let tuesday = monday.addingTimeInterval(86_400)
        profile.dailyCounts = [.init(day: monday, count: 20), .init(day: tuesday, count: 40)]
        let insights = RecordingInsights(profile: profile)
        XCTAssertEqual(insights.busiestDays.first?.day, tuesday)
        XCTAssertEqual(insights.recordsPerRecordedDay, 30)
        XCTAssertEqual(insights.weekdays.first(where: { $0.id == 2 })?.average, 20)
        XCTAssertEqual(insights.weekdays.first(where: { $0.id == 3 })?.average, 40)
        XCTAssertNil(insights.weekdays.first(where: { $0.id == 4 })?.average)
    }

    func testTrendBreaksAtMissingDataAndRetainsZero() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let values: [Double?] = [2, 0, nil, 4, nil, 7]
        let buckets = values.enumerated().map { index, value in
            HealthExplorer.AggregateBucket(
                start: start.addingTimeInterval(Double(index) * 3_600),
                end: start.addingTimeInterval(Double(index + 1) * 3_600), value: value, unit: "count")
        }
        let points = AggregateChartPoint.make(buckets)
        XCTAssertEqual(points.map(\.value), [2, 0, 4, 7])
        XCTAssertEqual(points.map(\.segment), [0, 0, 1, 2])
        XCTAssertEqual(points.map(\.id), [0, 1, 3, 5])
    }

    func testTrendDoesNotBridgeOmittedIntervalsOrInventAnEmptyValue() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let first = HealthExplorer.AggregateBucket(start: start, end: start.addingTimeInterval(60), value: 1, unit: nil)
        let later = HealthExplorer.AggregateBucket(start: start.addingTimeInterval(120), end: start.addingTimeInterval(180), value: 3, unit: nil)
        XCTAssertEqual(AggregateChartPoint.make([first, later]).map(\.segment), [0, 1])
        XCTAssertTrue(AggregateChartPoint.make([]).isEmpty)
        var empty = first
        empty.value = nil
        XCTAssertTrue(AggregateChartPoint.make([empty]).isEmpty)
    }

    func testCatalogFactsMatchTheFiveSyntheticProfiles() {
        let profiles = ExploreFixtures.profiles
        XCTAssertEqual(profiles.count, 5)
        let facts = ExploreFixtures.quickFacts(for: HealthTypeCatalog.all.map(\.identifier))
        XCTAssertEqual(facts.count, HealthTypeCatalog.all.count)
        let populated = Set(facts.values.filter { $0.latestStart != nil }.map(\.typeIdentifier))
        XCTAssertEqual(populated, Set(profiles.map(\.typeIdentifier)))
        for profile in profiles {
            XCTAssertEqual(facts[profile.typeIdentifier]?.earliestStart, profile.earliestStart)
            XCTAssertEqual(facts[profile.typeIdentifier]?.latestStart, profile.latestStart)
            XCTAssertEqual(facts[profile.typeIdentifier]?.sourceNames, profile.sources.map(\.name))
        }
    }
}
#endif
