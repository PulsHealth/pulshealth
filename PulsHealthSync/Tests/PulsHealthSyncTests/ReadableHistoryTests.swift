import Foundation
import HealthKit
import Testing
@testable import PulsHealthSync

// iOS 27 limited history access (`ReadableHistory`): the decisions that keep
// unreadable history from reaching the server as empty. HealthKit is not mockable, so everything here is the pure half —
// the engine calls these with what HealthKit reported.

private let day: TimeInterval = 86_400

/// Pacific time: the zone the iOS 27 simulator measurements were taken in,
/// and one with both DST transitions.
private let pacific: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    return calendar
}()

private func local(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0, _ s: Int = 0) -> Date {
    pacific.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min, second: s))!
}

@Suite struct ReadableHistoryChangeTests {
    let limit = Date(timeIntervalSince1970: 1_788_223_011.807) // what the simulator reported

    @Test func noLimitOnEitherSideIsUnchanged() {
        #expect(ReadableHistory.change(from: nil, to: nil) == .unchanged)
    }

    @Test func theSameDateIsUnchangedSoNothingLoops() {
        #expect(ReadableHistory.change(from: limit, to: limit) == .unchanged)
        // Jitter either way is not a new grant.
        #expect(ReadableHistory.change(from: limit, to: limit.addingTimeInterval(-59 * 60)) == .unchanged)
        #expect(ReadableHistory.change(from: limit, to: limit.addingTimeInterval(59 * 60)) == .unchanged)
    }

    @Test func aLimitGoingAwayWidens() {
        #expect(ReadableHistory.change(from: limit, to: nil) == .widened)
    }

    @Test func anEarlierDateWidens() {
        #expect(ReadableHistory.change(from: limit, to: limit.addingTimeInterval(-2 * day)) == .widened)
    }

    @Test func aNewLimitOrALaterDateNarrows() {
        #expect(ReadableHistory.change(from: nil, to: limit) == .narrowed)
        #expect(ReadableHistory.change(from: limit, to: limit.addingTimeInterval(3 * day)) == .narrowed)
    }

    @Test func aLimitBeforeWherePassesStartBitesNothing() {
        let start = limit.addingTimeInterval(10 * day)
        #expect(ReadableHistory.effectiveLimit(limit, readingFrom: start) == nil)
        #expect(ReadableHistory.effectiveLimit(limit, readingFrom: limit) == nil)
        #expect(ReadableHistory.effectiveLimit(limit, readingFrom: limit.addingTimeInterval(-1)) == limit)
        #expect(ReadableHistory.effectiveLimit(nil, readingFrom: start) == nil)
    }
}

@Suite struct ReadableHistoryClampTests {
    private func days(anchor: Date = local(2025, 10, 1), unit: AggregateIntervalUnit = .day, value: Int = 1) -> AggregateBucketing {
        AggregateBucketing(anchor: anchor, intervalValue: value, intervalUnit: unit, calendar: pacific)
    }

    /// The case measured on the simulator: "Past 30 Days" granted at
    /// 17:36:51 PDT on Sep 30 left 17:36:51 PDT on Aug 31 readable. The day
    /// bucket of Aug 31 holds only part of that day's data, so the first
    /// bucket uploaded is Sep 1.
    @Test func theBucketThatStraddlesTheDateIsNotUploaded() {
        let limit = local(2026, 8, 31, 17, 36, 51)
        let bucketing = days()
        #expect(ReadableHistory.firstWholeBucket(atOrAfter: limit, bucketing: bucketing) == local(2026, 9, 1))
        let window = ReadableHistory.clampAggregateWindow(
            (local(2025, 10, 1), local(2026, 9, 30)), readableSince: limit, bucketing: bucketing)
        #expect(window?.from == local(2026, 9, 1))
        #expect(window?.to == local(2026, 9, 30))
        let chunks = bucketing.chunks(from: window!.from, to: window!.to)
        #expect(chunks.first?.start == local(2026, 9, 1))
    }

    @Test func aBucketStartingExactlyOnTheDateIsUploaded() {
        let limit = local(2026, 9, 1)
        #expect(ReadableHistory.firstWholeBucket(atOrAfter: limit, bucketing: days()) == limit)
        let window = ReadableHistory.clampAggregateWindow(
            (local(2026, 8, 1), local(2026, 9, 10)), readableSince: limit, bucketing: days())
        #expect(window?.from == limit)
    }

    @Test func aMillisecondPastABoundaryLosesThatBucket() {
        let limit = local(2026, 9, 1).addingTimeInterval(0.001)
        #expect(ReadableHistory.firstWholeBucket(atOrAfter: limit, bucketing: days()) == local(2026, 9, 2))
    }

    @Test func hourBucketsClampToTheNextHour() {
        let bucketing = days(anchor: local(2026, 1, 1), unit: .hour)
        #expect(ReadableHistory.firstWholeBucket(atOrAfter: local(2026, 9, 1, 10, 30), bucketing: bucketing)
            == local(2026, 9, 1, 11))
    }

    @Test func weekAndMonthBucketsClampToTheirNextBoundary() {
        // Weeks counted from a Thursday anchor.
        let weeks = days(anchor: local(2026, 1, 1), unit: .week)
        #expect(ReadableHistory.firstWholeBucket(atOrAfter: local(2026, 9, 1, 12), bucketing: weeks)
            == local(2026, 9, 3))
        let months = days(anchor: local(2026, 1, 1), unit: .month)
        #expect(ReadableHistory.firstWholeBucket(atOrAfter: local(2026, 8, 31, 17, 36), bucketing: months)
            == local(2026, 9, 1))
    }

    /// 1 Nov 2026 is 25 hours long in Pacific time: the boundary after it is
    /// the next local midnight, not 24 hours on.
    @Test func dayBucketsFollowTheCalendarAcrossTheEndOfDaylightTime() {
        let bucketing = days()
        let limit = local(2026, 11, 1, 12)
        let first = ReadableHistory.firstWholeBucket(atOrAfter: limit, bucketing: bucketing)
        #expect(first == local(2026, 11, 2))
        #expect(first.timeIntervalSince(local(2026, 11, 1)) == 25 * 3_600)
    }

    /// 8 Mar 2026 is 23 hours long.
    @Test func dayBucketsFollowTheCalendarAcrossTheStartOfDaylightTime() {
        let bucketing = days()
        let first = ReadableHistory.firstWholeBucket(atOrAfter: local(2026, 3, 8, 1), bucketing: bucketing)
        #expect(first == local(2026, 3, 9))
        #expect(first.timeIntervalSince(local(2026, 3, 8)) == 23 * 3_600)
    }

    @Test func noLimitLeavesTheWindowAlone() {
        let window = ReadableHistory.clampAggregateWindow(
            (local(2025, 10, 1, 7, 15), local(2026, 9, 30)), readableSince: nil, bucketing: days())
        #expect(window?.from == local(2025, 10, 1, 7, 15))
        #expect(window?.to == local(2026, 9, 30))
    }

    @Test func aWindowAlreadyPastTheDateIsUnchanged() {
        // A trailing lookback that starts after the limit.
        let window = ReadableHistory.clampAggregateWindow(
            (local(2026, 9, 20, 9), local(2026, 9, 30)), readableSince: local(2026, 8, 31, 17), bucketing: days())
        #expect(window?.from == local(2026, 9, 20, 9))
    }

    @Test func aWindowWhollyBeforeTheDateComputesNothing() {
        let limit = local(2026, 8, 31, 17)
        #expect(ReadableHistory.clampAggregateWindow(
            (local(2025, 10, 1), local(2026, 8, 31)), readableSince: limit, bucketing: days()) == nil)
        // Ending on the straddling bucket's start: still nothing whole.
        #expect(ReadableHistory.clampAggregateWindow(
            (local(2025, 10, 1), local(2026, 9, 1)), readableSince: limit, bucketing: days()) == nil)
    }

    @Test func ringsStartAtTheFirstWholeReadableDay() {
        #expect(ReadableHistory.firstWholeDay(atOrAfter: local(2026, 8, 31, 17, 36), calendar: pacific)
            == local(2026, 9, 1))
        #expect(ReadableHistory.firstWholeDay(atOrAfter: local(2026, 9, 1), calendar: pacific)
            == local(2026, 9, 1))
        #expect(ReadableHistory.firstWholeDay(atOrAfter: local(2026, 11, 1, 0, 0, 1), calendar: pacific)
            == local(2026, 11, 2))
    }

    @Test func reconciliationNeverComparesMonthsTheDeviceCannotRead() {
        let start = local(2025, 10, 1)
        let limit = Date(timeIntervalSince1970: 1_788_223_011.807) // 2026-09-01T00:36:51Z
        #expect(ReadableHistory.reconcileStart(syncStart: start, readableSince: nil) == start)
        #expect(ReadableHistory.reconcileStart(syncStart: start, readableSince: limit) == limit)
        #expect(ReadableHistory.reconcileStart(syncStart: limit.addingTimeInterval(day), readableSince: limit)
            == limit.addingTimeInterval(day))

        let now = Date(timeIntervalSince1970: 1_790_814_000) // 2026-10-01
        let windows = ReconcileDigest.monthWindows(
            from: ReadableHistory.reconcileStart(syncStart: start, readableSince: limit), to: now)
        // September from the limit on, then the start of October — nothing
        // from the eleven months before, whose server rows would otherwise
        // all have looked like orphans.
        #expect(windows.first?.start == limit)
        #expect(windows.allSatisfy { $0.start >= limit })
        #expect(windows.count == 2)
    }

    @Test func theReconciliationSummarySaysWhereItStarted() {
        var report = ReconciliationReport(type: "HKQuantityTypeIdentifierStepCount")
        report.windowsChecked = 2
        #expect(report.summary == "2 windows in sync")
        report.readableSince = local(2026, 9, 1)
        #expect(report.summary.hasPrefix("2 windows in sync (from "))
        #expect(report.summary.contains("Health access is limited to recent history"))
    }
}

@Suite struct ReadableHistoryStateTests {
    private func tempDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// `sync-state.json` exactly as a 1.5 build wrote it (an end-to-end run
    /// on 2026-09-28 against a local server, trimmed to two of its fourteen
    /// types). The file is loaded with a quarantine on any decode error,
    /// which would reset every anchor — so a field 1.6 adds must decode from
    /// its absence.
    static let stateFrom15 = #"""
        {"workoutRoutesState":{"totalBatchesUploaded":0,"totalPayloadsUploaded":0,"totalBytesUploade
        d":0,"totalWorkoutsUploaded":0},"typeStates":{"HKQuantityTypeIdentifierHeartRate":{"backfill
        Complete":true,"lastBatchDuplicates":91,"latestExported":1790629200000,"totalSamplesExported
        ":105091,"lastSyncDuration":0.278058292,"totalBytesUploaded":4873958,"lastBatchAccepted":0,"
        totalBatchesUploaded":115,"totalDeletionsExported":0,"lastSyncAt":1790638297249.127,"earlies
        tExported":1759102200000,"identifier":"HKQuantityTypeIdentifierHeartRate","anchorData":"YnBs
        aXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZl
        ctEICVRyb290gAGkCwwTFFUkbnVsbNMNDg8QERJVcm93aWRWJGNsYXNzW2NsaWVudFRva2VuEgAGvSiAA4ACXxCAZGYx
        NjczMzI4MGIxMmEzNjQyZjA3OTM2NGM0NjVmMzhkNzIyYjQwNzI4MDY4MmM3NDA5MTMzNmMxYmJkMTZiMmM3MGY0MTU4
        MDVmYjBiOWQwZjBhYzU3Nzk2ZTI3NzBkNTI0YWVlYWNlNjhmZDhmNTZkMTQyZTQyMGJhMjkyNjTSFRYXGFokY2xhc3Nu
        YW1lWCRjbGFzc2VzXUhLUXVlcnlBbmNob3KiGRpdSEtRdWVyeUFuY2hvclhOU09iamVjdAAIABEAGgAkACkAMgA3AEkA
        TABRAFMAWABeAGUAawByAH4AgwCFAIcBCgEPARoBIwExATQBQgAAAAAAAAIBAAAAAAAAABsAAAAAAAAAAAAAAAAAAAFL
        "},"HKQuantityTypeIdentifierStepCount":{"backfillComplete":true,"lastBatchDuplicates":717,"l
        atestExported":1790625600000,"totalSamplesExported":8757,"lastSyncDuration":0.299556,"totalB
        ytesUploaded":426353,"lastBatchAccepted":40,"totalBatchesUploaded":10,"lastSyncAt":179063825
        7026.849,"totalDeletionsExported":0,"earliestExported":1759104000000,"identifier":"HKQuantit
        yTypeIdentifierStepCount","anchorData":"YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0
        b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZlctEICVRyb290gAGkCwwTFFUkbnVsbNMNDg8QERJVcm93aWRW
        JGNsYXNzW2NsaWVudFRva2VuEgAG4qiAA4ACXxCAZGYxNjczMzI4MGIxMmEzNjQyZjA3OTM2NGM0NjVmMzhkNzIyYjQw
        NzI4MDY4MmM3NDA5MTMzNmMxYmJkMTZiMmM3MGY0MTU4MDVmYjBiOWQwZjBhYzU3Nzk2ZTI3NzBkNTI0YWVlYWNlNjhm
        ZDhmNTZkMTQyZTQyMGJhMjkyNjTSFRYXGFokY2xhc3NuYW1lWCRjbGFzc2VzXUhLUXVlcnlBbmNob3KiGRpdSEtRdWVy
        eUFuY2hvclhOU09iamVjdAAIABEAGgAkACkAMgA3AEkATABRAFMAWABeAGUAawByAH4AgwCFAIcBCgEPARoBIwExATQB
        QgAAAAAAAAIBAAAAAAAAABsAAAAAAAAAAAAAAAAAAAFL"}},"configuration":{"maxEnrichmentPointsPerBatc
        h":4000,"maxMergedBatchSamples":1000,"userName":null,"includeWorkoutEnhancedData":true,"obse
        rverCoalesceWindow":2,"startDate":1759102016552.0361,"enabledTypes":["HKQuantityTypeIdentifi
        erHeartRate","HKQuantityTypeIdentifierStepCount"],"userBiologicalSex":null,"maxConcurrentTyp
        es":4,"userID":"5ea4d000-0000-4000-8000-000000000001","batchSize":1000,"serverURL":"http://l
        ocalhost:8090","aggregates":[],"userDateOfBirth":null,"includeWorkoutRoutes":true,"userEmail
        ":null},"aggregateStates":{},"workoutStreamsState":{"totalBatchesUploaded":0,"totalPayloadsU
        ploaded":0,"totalBytesUploaded":0,"totalWorkoutsUploaded":0},"deviceID":"99E7D25C-A0EB-4C25-
        ADA4-A0D66764A462","activitySummaryState":{"totalBatchesUploaded":0,"totalBytesUploaded":0,"
        totalDaysUploaded":0},"serverIdentity":{"userID":"5ea4d000-0000-4000-8000-000000000001","pat
        h":"","host":"localhost","port":8090}}
        """#.replacingOccurrences(of: "\n", with: "")

    @Test func aStateFileFrom15LoadsWithItsAnchorsAndNoLimit() async throws {
        let dir = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data(Self.stateFrom15.utf8).write(to: dir.appendingPathComponent("sync-state.json"))

        let store = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        #expect(await store.deviceID == "99E7D25C-A0EB-4C25-ADA4-A0D66764A462")
        let heartRate = await store.state(for: "HKQuantityTypeIdentifierHeartRate")
        #expect(heartRate.anchorData != nil)
        #expect(heartRate.backfillComplete)
        #expect(heartRate.totalSamplesExported == 105_091)
        #expect(heartRate.readableSince == nil)
        #expect(await store.activitySummaryState.readableSince == nil)
        #expect(await store.workoutRoutesState.readableSince == nil)
        #expect(await store.workoutStreamsState.readableSince == nil)
        // Nothing was quarantined.
        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        #expect(!files.contains { $0.contains("corrupt") })
    }

    @Test func everyLimitPersistsAsEpochMillisecondsAndComesBack() async throws {
        let dir = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let since = Date(timeIntervalSince1970: 1_788_223_011) // whole ms survive the round trip exactly
        let configID = UUID()
        let store = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        await store.recordReadableSince("HKQuantityTypeIdentifierStepCount", since)
        await store.updateAggregate(configID) { $0.readableSince = since }
        await store.updateActivitySummary { $0.readableSince = since }
        await store.updateWorkoutEnrichment(.routes) { $0.readableSince = since }
        await store.persistNow()

        let json = try #require(JSONSerialization.jsonObject(
            with: Data(contentsOf: dir.appendingPathComponent("sync-state.json"))) as? [String: Any])
        let types = try #require(json["typeStates"] as? [String: [String: Any]])
        #expect(types["HKQuantityTypeIdentifierStepCount"]?["readableSince"] as? Double == 1_788_223_011_000)

        let reopened = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        #expect(await reopened.state(for: "HKQuantityTypeIdentifierStepCount").readableSince == since)
        #expect(await reopened.aggregateState(for: configID).readableSince == since)
        #expect(await reopened.activitySummaryState.readableSince == since)
        #expect(await reopened.workoutRoutesState.readableSince == since)
        #expect(await reopened.workoutStreamsState.readableSince == nil)
    }

    @Test func resetsKeepWhatIOSLetsTheAppRead() async throws {
        let dir = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let limit = Date(timeIntervalSince1970: 1_788_223_011.807)
        let store = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        for id in ["a", "b"] {
            await store.recordUploadedBatch(
                identifier: id, newAnchorData: Data([1]), samples: 1, deletions: 0, bytes: 1,
                sampleDateRange: nil, duration: 0, latency: nil)
        }
        await store.recordReadableSince("a", limit)

        await store.resetType("a")
        #expect(await store.state(for: "a").anchorData == nil)
        #expect(await store.state(for: "a").readableSince == limit)

        await store.recordUploadedBatch(
            identifier: "a", newAnchorData: Data([2]), samples: 1, deletions: 0, bytes: 1,
            sampleDateRange: nil, duration: 0, latency: nil)
        await store.resetAll()
        #expect(await store.state(for: "a").anchorData == nil)
        #expect(await store.state(for: "a").readableSince == limit)
        #expect(await store.state(for: "b").anchorData == nil)
        #expect(await store.hasSyncProgress == false)
    }
}
