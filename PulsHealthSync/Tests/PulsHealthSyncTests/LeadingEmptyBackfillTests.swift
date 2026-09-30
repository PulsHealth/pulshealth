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
