import Foundation
import Testing
@testable import PulsHealthSync

/// The leading-empty skip: which rows of a window a pass sends
/// (`LeadingEmptyBuckets`), and the state that decides whether it may
/// (`AggregateSyncState.leadingEmptyBackfill`) and records a skipped window
/// (`SyncStateStore.recordAggregateSkippedEmptyChunk`).
@Suite struct LeadingEmptyBackfillTests {
    private func makeDir() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
    }

    /// One hourly row per value, an hour apart.
    private func rows(_ values: [Double?]) -> [AggregateSampleRow] {
        values.enumerated().map { index, value in
            let start = Date(timeIntervalSince1970: 1_700_000_000 + Double(index) * 3_600)
            return AggregateSampleRow(
                type: "HKQuantityTypeIdentifierStepCount", function: .sum,
                intervalValue: 1, intervalUnit: .hour, deviceFilter: .all,
                bucketStart: start, bucketEnd: start.addingTimeInterval(3_600),
                value: value, unit: "count")
        }
    }

    // MARK: - The decision

    @Test func withoutTheSkipEveryRowIsSent() {
        let window = rows([nil, nil, 5, nil])
        #expect(LeadingEmptyBuckets.plan(window, skippingLeadingEmpty: false)
            == .upload(window, skipped: 0))
        // Including an all-empty window: its nulls clear stale server values.
        let empty = rows([nil, nil])
        #expect(LeadingEmptyBuckets.plan(empty, skippingLeadingEmpty: false)
            == .upload(empty, skipped: 0))
    }

    @Test func theSkipDropsOnlyWhatComesBeforeTheFirstValue() {
        let window = rows([nil, nil, 5, nil, 0, nil])
        // Empty buckets after the first value still go out as null, and a
        // zero is a value, not an empty bucket.
        #expect(LeadingEmptyBuckets.plan(window, skippingLeadingEmpty: true)
            == .upload(Array(window[2...]), skipped: 2))
        let startsWithValue = rows([0, nil])
        #expect(LeadingEmptyBuckets.plan(startsWithValue, skippingLeadingEmpty: true)
            == .upload(startsWithValue, skipped: 0))
    }

    @Test func anAllEmptyWindowIsSkippedWhole() {
        #expect(LeadingEmptyBuckets.plan(rows([nil, nil, nil]), skippingLeadingEmpty: true)
            == .skipWindow(skipped: 3))
        #expect(LeadingEmptyBuckets.plan([], skippingLeadingEmpty: true)
            == .skipWindow(skipped: 0))
    }

    @Test func onlyAScheduledPassOverANewSeriesSkips() {
        let id = UUID()
        let fresh = AggregateSyncState(configID: id)
        #expect(LeadingEmptyBuckets.applies(pass: .scheduled, state: fresh))
        // The priority pass moves no watermark, so a skipped window would
        // have nothing to be recorded against.
        #expect(!LeadingEmptyBuckets.applies(pass: .priority, state: fresh))
        var valued = fresh
        valued.leadingEmptyBackfill = false
        #expect(!LeadingEmptyBuckets.applies(pass: .scheduled, state: valued))
    }

    @Test func tallyAddsUp() {
        var sent = AggregateUploadTally()
        sent += AggregateUploadTally(skipped: 2_000)
        sent += AggregateUploadTally(uploaded: 10, skipped: 4, batches: 1)
        sent += AggregateUploadTally(uploaded: 2_000, batches: 1)
        #expect(sent == AggregateUploadTally(uploaded: 2_010, skipped: 2_004, batches: 2))
    }

    // MARK: - The state

    /// A 1.4 install's aggregate state has no `leadingEmptyBackfill` key. It
    /// must decode (a throw quarantines sync-state.json and resets every
    /// anchor), and it must not skip: 1.4 state cannot say whether the series
    /// is new or was just reset, and a reset needs its nulls.
    @Test func stateWrittenBeforeTheFlagDecodesAndDoesNotSkip() throws {
        let id = UUID()
        let computed = #"{"configID":"\#(id.uuidString)","computedThrough":1700000000000,"lastFullRecomputeAt":1700000000000,"totalBucketsUploaded":2,"totalBatchesUploaded":1,"totalBytesUploaded":64}"#
        let neverComputed = #"{"configID":"\#(id.uuidString)","totalBucketsUploaded":30,"totalBatchesUploaded":1,"totalBytesUploaded":900}"#
        for json in [computed, neverComputed] {
            let state = try JSONDecoder.puls.decode(AggregateSyncState.self, from: Data(json.utf8))
            #expect(state.configID == id)
            #expect(state.leadingEmptyBackfill == nil)
            #expect(!LeadingEmptyBuckets.applies(pass: .scheduled, state: state))
        }
        let a = try JSONDecoder.puls.decode(AggregateSyncState.self, from: Data(computed.utf8))
        #expect(a.computedThrough == Date(timeIntervalSince1970: 1_700_000_000))
        #expect(a.lastFullRecomputeAt == Date(timeIntervalSince1970: 1_700_000_000))
    }

    /// The flag round-trips, dates stay epoch ms, and a nil flag is omitted
    /// rather than written as null — what 1.4 (synthesized decoder, unknown
    /// keys ignored) reads back after a downgrade either way.
    @Test func theFlagRoundTrips() throws {
        var state = AggregateSyncState(configID: UUID())
        state.computedThrough = Date(timeIntervalSince1970: 1_700_000_000)
        for flag in [true, false, nil] as [Bool?] {
            state.leadingEmptyBackfill = flag
            let data = try JSONEncoder.puls.encode(state)
            let json = String(decoding: data, as: UTF8.self)
            #expect(json.contains(#""computedThrough":1700000000000"#))
            #expect(json.contains("leadingEmptyBackfill") == (flag != nil))
            #expect(try JSONDecoder.puls.decode(AggregateSyncState.self, from: data) == state)
        }
    }

    /// The whole state file of a 1.4 install loads through `SyncStateStore`
    /// without being quarantined, anchors and watermarks intact.
    @Test func a14StateFileLoadsIntact() async throws {
        let dir = makeDir()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let id = UUID()
        let file = #"""
        {"configuration":{"enabledTypes":["HKQuantityTypeIdentifierStepCount"],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000},
         "typeStates":{"HKQuantityTypeIdentifierStepCount":{"identifier":"HKQuantityTypeIdentifierStepCount","backfillComplete":true,"totalSamplesExported":42,"totalDeletionsExported":0,"totalBytesUploaded":0,"totalBatchesUploaded":1}},
         "deviceID":"device-14",
         "aggregateStates":{"\#(id.uuidString)":{"configID":"\#(id.uuidString)","computedThrough":1700000000000,"lastComputedAt":1700000100000,"lastFullRecomputeAt":1690000000000,"totalBucketsUploaded":2,"totalBatchesUploaded":1,"totalBytesUploaded":64}},
         "activitySummaryState":{"totalDaysUploaded":0,"totalBatchesUploaded":0,"totalBytesUploaded":0}}
        """#.replacingOccurrences(of: "\n", with: "")
        try Data(file.utf8).write(to: dir.appendingPathComponent("sync-state.json"))

        let store = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        #expect(await store.deviceID == "device-14")
        #expect(await store.state(for: "HKQuantityTypeIdentifierStepCount").totalSamplesExported == 42)
        let state = await store.aggregateState(for: id)
        #expect(state.computedThrough == Date(timeIntervalSince1970: 1_700_000_000))
        #expect(state.totalBucketsUploaded == 2)
        #expect(state.leadingEmptyBackfill == nil)
        let quarantined = try FileManager.default.contentsOfDirectory(atPath: dir.path)
            .filter { $0.contains("corrupt") }
        #expect(quarantined.isEmpty)
    }

    /// A skipped all-empty window moves both cursors like an ack would and
    /// counts nothing; the first real ack ends the leading phase for good.
    @Test func skippedWindowsAdvanceWatermarksAndTheFirstAckEndsTheLeadingPhase() async {
        let store = SyncStateStore(directory: makeDir(), tokenStore: InMemoryTokenStore())
        let id = UUID()
        let started = Date(timeIntervalSince1970: 1_700_000_000)
        let first = started.addingTimeInterval(86_400)
        #expect(LeadingEmptyBuckets.applies(pass: .scheduled, state: await store.aggregateState(for: id)))

        await store.beginAggregateFullRecompute(configID: id, at: started, resumeThrough: nil)
        await store.recordAggregateSkippedEmptyChunk(configID: id, newComputedThrough: first)
        var state = await store.aggregateState(for: id)
        #expect(state.computedThrough == first)
        #expect(state.fullRecomputeThrough == first)
        #expect(state.totalBucketsUploaded == 0)
        #expect(state.totalBatchesUploaded == 0)
        #expect(LeadingEmptyBuckets.applies(pass: .scheduled, state: state))

        // Never regresses, like recordAggregateUpload.
        await store.recordAggregateSkippedEmptyChunk(configID: id, newComputedThrough: started)
        #expect(await store.aggregateState(for: id).computedThrough == first)

        let second = first.addingTimeInterval(86_400)
        await store.recordAggregateUpload(configID: id, newComputedThrough: second, buckets: 3, bytes: 30)
        state = await store.aggregateState(for: id)
        #expect(!LeadingEmptyBuckets.applies(pass: .scheduled, state: state))
        #expect(state.computedThrough == second)

        // The priority pass's counters-only recorder never ends the phase.
        let other = UUID()
        await store.recordAggregateUploadWithoutWatermark(configID: other, buckets: 30, bytes: 300)
        #expect(LeadingEmptyBuckets.applies(pass: .scheduled, state: await store.aggregateState(for: other)))
    }
}
