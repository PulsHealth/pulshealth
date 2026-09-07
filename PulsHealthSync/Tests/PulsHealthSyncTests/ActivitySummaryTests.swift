import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct ActivitySummaryCatalogTests {
    @Test func ringTypeIsInCatalogAndHasNoSampleType() {
        let descriptor = HealthTypeCatalog.descriptor(for: HealthTypeCatalog.activitySummaryIdentifier)
        #expect(descriptor != nil)
        #expect(descriptor?.kind == .activitySummary)
        #expect(descriptor?.group == .activity)
        // No HKSampleType: it must stay out of bulk auth / observer.
        #expect(descriptor?.sampleType == nil)
        #expect(HealthTypeCatalog.isActivitySummary(HealthTypeCatalog.activitySummaryIdentifier))
    }

    @Test func ringTypeExcludedFromBulkReadAuthorization() {
        let types = HealthTypeCatalog.bulkReadAuthorizationSampleTypes(
            for: [HealthTypeCatalog.activitySummaryIdentifier])
        #expect(types.isEmpty)
    }
}

@Suite struct ActivitySummaryWireTests {
    private func makeRow(moveMode: Int = 0) -> ActivitySummaryRow {
        ActivitySummaryRow(
            date: Date(timeIntervalSince1970: 1_700_000_000),
            localDate: "2023-11-14",
            temporalContext: TemporalContext(
                timeZoneID: "America/Los_Angeles",
                utcOffsetSeconds: -28_800,
                source: "device_current",
                confidence: "inferred"
            ),
            moveKcal: 420.5, moveGoalKcal: 600,
            exerciseMin: 25, exerciseGoalMin: 30,
            standHours: 9, standGoalHours: 12,
            moveMode: moveMode,
            moveTimeMin: moveMode == 1 ? 18 : nil,
            moveTimeGoalMin: moveMode == 1 ? 30 : nil
        )
    }

    @Test func ndjsonAppendsActivitySummaryLinesAfterAggregatesAndCountsThem() throws {
        let agg = AggregateSampleRow(
            type: "HKQuantityTypeIdentifierHeartRate", function: .average,
            intervalValue: 1, intervalUnit: .hour, deviceFilter: .watch,
            bucketStart: Date(timeIntervalSince1970: 1_700_000_000),
            bucketEnd: Date(timeIntervalSince1970: 1_700_003_600),
            value: 62.4, unit: "count/min")
        let batch = SyncBatch(
            deviceID: "d", type: HealthTypeCatalog.activitySummaryIdentifier, reason: .incremental,
            samples: [], deletions: [],
            aggregates: [agg],
            activitySummaries: [makeRow(), makeRow(moveMode: 1)]
        )
        let data = try BatchSerializer.ndjson(for: batch)
        let lines = String(decoding: data, as: UTF8.self)
            .split(separator: "\n", omittingEmptySubsequences: true)
        // header + 1 aggregate + 2 activity summaries
        #expect(lines.count == 1 + 1 + 2)

        let header = try JSONDecoder.puls.decode(
            BatchSerializer.Header.self, from: Data(lines[0].utf8))
        #expect(header.aggregateCount == 1)
        #expect(header.activitySummaryCount == 2)

        // Activity summaries come after aggregates (declared parse order).
        #expect(lines[1].contains("\"aggregate\""))
        let first = try JSONSerialization.jsonObject(with: Data(lines[2].utf8)) as! [String: Any]
        let payload = first["activitySummary"] as! [String: Any]
        #expect(payload["date"] as! Double == 1_700_000_000_000) // epoch-ms
        #expect(payload["localDate"] as! String == "2023-11-14")
        let context = payload["temporalContext"] as! [String: Any]
        #expect(context["timeZoneID"] as! String == "America/Los_Angeles")
        #expect(context["utcOffsetSeconds"] as! Int == -28_800)
        #expect(context["source"] as! String == "device_current")
        #expect(context["confidence"] as! String == "inferred")
        #expect(payload["moveKcal"] as! Double == 420.5)
        #expect(payload["standGoalHours"] as! Double == 12)
        #expect(payload["moveMode"] as! Int == 0)
    }

    @Test func rowRoundTripsForBothMoveModes() throws {
        for mode in [0, 1] {
            let row = makeRow(moveMode: mode)
            let decoded = try JSONDecoder.puls.decode(
                ActivitySummaryRow.self, from: JSONEncoder.puls.encode(row))
            #expect(decoded == row)
        }
    }

    @Test func headerWithoutActivitySummaryCountDecodesAsZero() throws {
        let legacy = #"{"batchID":"\#(UUID().uuidString)","deviceID":"d","type":"t","reason":"backfill","exportedAt":0,"sampleCount":1,"deletionCount":0,"routeCount":0,"aggregateCount":0}"#
        let header = try JSONDecoder.puls.decode(
            BatchSerializer.Header.self, from: Data(legacy.utf8))
        #expect(header.activitySummaryCount == 0)
        #expect(header.sampleCount == 1)
    }
}

@Suite struct ActivitySummaryStateStoreTests {
    private func makeDir() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
    }

    @Test func recordAdvancesWatermarkOnlyForward() async {
        let store = SyncStateStore(directory: makeDir())
        let mark = Date(timeIntervalSince1970: 2_000_000)
        await store.recordActivitySummaryUpload(newComputedThrough: mark, days: 7, bytes: 256)
        var state = await store.activitySummaryState
        #expect(state.computedThrough == mark)
        #expect(state.totalDaysUploaded == 7)
        #expect(state.totalBatchesUploaded == 1)
        #expect(state.lastError == nil)

        // A trailing-lookback recompute ends before the watermark — never regress.
        await store.recordActivitySummaryUpload(
            newComputedThrough: mark.addingTimeInterval(-86_400), days: 1, bytes: 64)
        state = await store.activitySummaryState
        #expect(state.computedThrough == mark)
        #expect(state.totalDaysUploaded == 8)
    }

    @Test func errorsRecordedAndClearedOnSuccess() async {
        let store = SyncStateStore(directory: makeDir())
        struct Boom: Error {}
        await store.recordActivitySummaryError(error: Boom())
        #expect(await store.activitySummaryState.lastError != nil)
        await store.recordActivitySummaryUpload(newComputedThrough: Date(), days: 1, bytes: 1)
        #expect(await store.activitySummaryState.lastError == nil)
    }

    @Test func resetClearsWatermarkAndCounters() async {
        let store = SyncStateStore(directory: makeDir())
        await store.recordActivitySummaryUpload(newComputedThrough: Date(), days: 5, bytes: 100)
        await store.markActivitySummaryFullRecompute()
        await store.resetActivitySummary()
        let state = await store.activitySummaryState
        #expect(state.computedThrough == nil)
        #expect(state.lastFullRecomputeAt == nil)
        #expect(state.totalDaysUploaded == 0)
    }

    @Test func persistsAcrossInstances() async {
        let dir = makeDir()
        let store = SyncStateStore(directory: dir)
        let mark = Date(timeIntervalSince1970: 3_000_000)
        await store.recordActivitySummaryUpload(newComputedThrough: mark, days: 3, bytes: 99)
        await store.persistNow()

        let reloaded = SyncStateStore(directory: dir)
        let state = await reloaded.activitySummaryState
        #expect(state.computedThrough == mark)
        #expect(state.totalDaysUploaded == 3)
    }

    @Test func legacyStateFileLoadsWithoutActivitySummaryState() async throws {
        let dir = makeDir()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // A pre-activity-summary state file: no activitySummaryState key.
        let legacy = #"{"configuration":{"enabledTypes":[],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000},"typeStates":{},"deviceID":"dev-x","aggregateStates":{}}"#
        try Data(legacy.utf8).write(to: dir.appendingPathComponent("sync-state.json"))

        let store = SyncStateStore(directory: dir)
        let state = await store.activitySummaryState
        #expect(state.computedThrough == nil)
        #expect(state.totalDaysUploaded == 0)
        #expect(await store.deviceID == "dev-x")
    }
}
