import Foundation
import HealthKit
import Testing
@testable import PulsHealthSync

// Phased workout backfill: basic data + basic workout rows go first, then routes
// (phase 4), then streams (phase 5), each chunked by a point budget. These tests
// cover the parts that don't need a live HealthKit store: the point-budget
// chunker (incl. splitting one oversized workout), the watermarks'
// anchor-after-ack / per-workout-resumable semantics, and the route-/series-only
// batch shape the phases upload.

// MARK: - Test transports

/// Records every uploaded batch so tests can assert what a phase sent.
actor RecordingTransport: SyncTransport {
    private(set) var batches: [SyncBatch] = []
    func upload(_ batch: SyncBatch) async throws -> UploadResult {
        batches.append(batch)
        return UploadResult(bytesSent: 1, duration: 0)
    }
}

/// Fails (like a request timeout) once it has accepted `failAfter` batches —
/// models the "context canceled" mid-run failure the addendum guards against.
actor FlakyTransport: SyncTransport {
    struct Timeout: Error {}
    let failAfter: Int
    private(set) var accepted = 0
    init(failAfter: Int) { self.failAfter = failAfter }
    func upload(_ batch: SyncBatch) async throws -> UploadResult {
        if accepted >= failAfter { throw Timeout() }
        accepted += 1
        return UploadResult(bytesSent: 1, duration: 0)
    }
}

// MARK: - Point-budget chunker

@Suite struct EnrichmentChunkerTests {
    private func seriesPayload(uuid: UUID = UUID(), points: Int) -> WorkoutSeriesPayload {
        WorkoutSeriesPayload(
            workoutUUID: uuid, type: "HKQuantityTypeIdentifierHeartRate", unit: "count/min",
            points: (0..<points).map { SeriesPoint(t: Date(timeIntervalSince1970: Double($0)), value: Double($0)) })
    }

    private func routePayload(uuid: UUID = UUID(), points: Int) -> RoutePayload {
        RoutePayload(
            workoutUUID: uuid,
            points: (0..<points).map { RoutePoint(t: Date(timeIntervalSince1970: Double($0)), lat: 1, lon: 2) })
    }

    /// The core addendum requirement: ONE workout whose series exceeds the budget
    /// is split into multiple batches, each within budget, losing no points and
    /// keeping the workout UUID.
    @Test func singleOversizedWorkoutSplitsAcrossBatches() {
        let uuid = UUID()
        let payloads = [seriesPayload(uuid: uuid, points: 9_500)]
        let budget = 2_000
        let batches = HealthSyncEngine.packByPointBudget(payloads, budget: budget)

        #expect(batches.count == 5) // 2000+2000+2000+2000+1500
        for batch in batches {
            let count = batch.reduce(0) { $0 + $1.pointCount }
            #expect(count <= budget)
            #expect(batch.allSatisfy { $0.workoutUUID == uuid })
        }
        // No points lost.
        let total = batches.flatMap { $0 }.reduce(0) { $0 + $1.pointCount }
        #expect(total == 9_500)
    }

    @Test func multipleSmallPayloadsPackUpToBudget() {
        let payloads = [seriesPayload(points: 500), seriesPayload(points: 500), seriesPayload(points: 500)]
        let batches = HealthSyncEngine.packByPointBudget(payloads, budget: 1_000)
        // 500+500 fills the first batch; the last 500 spills to a second.
        #expect(batches.count == 2)
        #expect(batches[0].reduce(0) { $0 + $1.pointCount } == 1_000)
        #expect(batches[1].reduce(0) { $0 + $1.pointCount } == 500)
    }

    @Test func routesChunkWithTheSameHelper() {
        let batches = HealthSyncEngine.packByPointBudget([routePayload(points: 4_500)], budget: 2_000)
        #expect(batches.count == 3)
        #expect(batches.allSatisfy { $0.reduce(0) { $0 + $1.pointCount } <= 2_000 })
    }

    @Test func emptyAndZeroPointInputsProduceNoBatches() {
        #expect(HealthSyncEngine.packByPointBudget([] as [WorkoutSeriesPayload], budget: 1_000).isEmpty)
        #expect(HealthSyncEngine.packByPointBudget([seriesPayload(points: 0)], budget: 1_000).isEmpty)
    }

    @Test func budgetFloorsAtOne() {
        // A nonsensical zero/negative budget must not divide-by-zero or loop forever.
        let batches = HealthSyncEngine.packByPointBudget([seriesPayload(points: 3)], budget: 0)
        #expect(batches.count == 3)
        #expect(batches.allSatisfy { $0.reduce(0) { $0 + $1.pointCount } == 1 })
    }

    /// A state file written before the point-budget knob existed loads with the
    /// default (the file is decoded with `try?`, so a missing key must not fault).
    @Test func configWithoutPointBudgetDecodesToDefault() throws {
        let legacy = #"{"enabledTypes":[],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000}"#
        let config = try JSONDecoder.puls.decode(SyncConfiguration.self, from: Data(legacy.utf8))
        #expect(config.maxEnrichmentPointsPerBatch == 4_000)

        var tuned = config
        tuned.maxEnrichmentPointsPerBatch = 2_500
        let reencoded = try JSONDecoder.puls.decode(
            SyncConfiguration.self, from: JSONEncoder.puls.encode(tuned))
        #expect(reencoded.maxEnrichmentPointsPerBatch == 2_500)
    }
}

// MARK: - Route activity-type pre-filter

@Suite struct WorkoutRoutePrefilterTests {
    @Test func outdoorTypesAreQueried() {
        for type: HKWorkoutActivityType in [.walking, .running, .cycling, .hiking, .swimming] {
            #expect(HealthSyncEngine.mayHaveWorkoutRoute(type), "\(type.rawValue) should be route-queried")
        }
    }

    @Test func indoorTypesAreSkipped() {
        for type: HKWorkoutActivityType in [
            .traditionalStrengthTraining, .functionalStrengthTraining, .coreTraining,
            .yoga, .elliptical, .jumpRope, .stairClimbing,
        ] {
            #expect(!HealthSyncEngine.mayHaveWorkoutRoute(type), "\(type.rawValue) can't have a GPS route")
        }
    }

    @Test func ambiguousOrUnknownTypesAreQueriedConservatively() {
        // Neither clearly outdoor nor clearly indoor → still queried so a real
        // route is never dropped for an unanticipated type.
        #expect(HealthSyncEngine.mayHaveWorkoutRoute(.other))
        #expect(HealthSyncEngine.mayHaveWorkoutRoute(.highIntensityIntervalTraining))
        #expect(HealthSyncEngine.mayHaveWorkoutRoute(.play))
    }
}

// MARK: - Watermark semantics

@Suite struct WorkoutEnrichmentStateStoreTests {
    private func makeDir() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
    }

    @Test func recordBatchAdvancesCountersButNotWatermark() async {
        for kind in WorkoutEnrichmentKind.allCases {
            let store = SyncStateStore(directory: makeDir())
            // A batch upload records bytes/payloads/batches but must NOT advance the
            // watermark — that only moves once a whole workout's chunks are acked.
            await store.recordWorkoutEnrichmentBatch(kind, payloads: 5, bytes: 512)
            var state = await store.workoutEnrichmentState(kind)
            #expect(state.computedThrough == nil, "watermark must not advance on a per-chunk batch")
            #expect(state.totalPayloadsUploaded == 5)
            #expect(state.totalBatchesUploaded == 1)
            #expect(state.totalBytesUploaded == 512)
            #expect(state.totalWorkoutsUploaded == 0)
            #expect(state.lastError == nil)

            // The watermark advances only via the explicit per-workout call.
            let mark = Date(timeIntervalSince1970: 2_000_000)
            await store.advanceWorkoutEnrichmentWatermark(kind, to: mark, workouts: 1)
            state = await store.workoutEnrichmentState(kind)
            #expect(state.computedThrough == mark)
            #expect(state.totalWorkoutsUploaded == 1)
        }
    }

    @Test func watermarkAdvancesOnlyForward() async {
        let store = SyncStateStore(directory: makeDir())
        let mark = Date(timeIntervalSince1970: 2_000_000)
        await store.advanceWorkoutEnrichmentWatermark(.routes, to: mark)
        #expect(await store.workoutEnrichmentState(.routes).computedThrough == mark)

        // A trailing-lookback re-run ends before the watermark — never regress.
        await store.advanceWorkoutEnrichmentWatermark(.routes, to: mark.addingTimeInterval(-86_400))
        #expect(await store.workoutEnrichmentState(.routes).computedThrough == mark)
    }

    @Test func routesAndStreamsWatermarksAreIndependent() async {
        let store = SyncStateStore(directory: makeDir())
        let routeMark = Date(timeIntervalSince1970: 1_000_000)
        await store.advanceWorkoutEnrichmentWatermark(.routes, to: routeMark)
        #expect(await store.workoutEnrichmentState(.routes).computedThrough == routeMark)
        // Streams untouched: the phases track separate progress.
        #expect(await store.workoutEnrichmentState(.streams).computedThrough == nil)
    }

    @Test func errorsRecordedAndClearedOnNextSuccess() async {
        let store = SyncStateStore(directory: makeDir())
        struct Boom: Error {}
        await store.recordWorkoutEnrichmentError(.streams, error: Boom())
        #expect(await store.workoutEnrichmentState(.streams).lastError != nil)
        await store.recordWorkoutEnrichmentBatch(.streams, payloads: 1, bytes: 1)
        #expect(await store.workoutEnrichmentState(.streams).lastError == nil)
    }

    @Test func resetClearsWatermarkAndCounters() async {
        let store = SyncStateStore(directory: makeDir())
        await store.recordWorkoutEnrichmentBatch(.routes, payloads: 3, bytes: 100)
        await store.advanceWorkoutEnrichmentWatermark(.routes, to: Date(), workouts: 1)
        await store.markWorkoutEnrichmentFullRecompute(.routes)
        await store.resetWorkoutEnrichment(.routes)
        let state = await store.workoutEnrichmentState(.routes)
        #expect(state.computedThrough == nil)
        #expect(state.lastFullRecomputeAt == nil)
        #expect(state.totalWorkoutsUploaded == 0)
        #expect(state.totalPayloadsUploaded == 0)
    }

    @Test func resetAllClearsEnrichmentWatermarks() async {
        let store = SyncStateStore(directory: makeDir())
        await store.advanceWorkoutEnrichmentWatermark(.routes, to: Date())
        await store.advanceWorkoutEnrichmentWatermark(.streams, to: Date())
        await store.resetAll()
        #expect(await store.workoutEnrichmentState(.routes).computedThrough == nil)
        #expect(await store.workoutEnrichmentState(.streams).computedThrough == nil)
    }

    @Test func persistsAcrossInstances() async {
        let dir = makeDir()
        let store = SyncStateStore(directory: dir)
        let mark = Date(timeIntervalSince1970: 3_000_000)
        await store.recordWorkoutEnrichmentBatch(.streams, payloads: 9, bytes: 70)
        await store.advanceWorkoutEnrichmentWatermark(.streams, to: mark, workouts: 7)
        await store.persistNow()

        let reloaded = SyncStateStore(directory: dir)
        let state = await reloaded.workoutEnrichmentState(.streams)
        #expect(state.computedThrough == mark)
        #expect(state.totalWorkoutsUploaded == 7)
        #expect(state.totalPayloadsUploaded == 9)
    }

    @Test func fullPassCursorPersistsCanRestartAndCompletionClearsIt() async throws {
        let dir = makeDir()
        let started = Date(timeIntervalSince1970: 1_700_000_000)
        let cursor = started.addingTimeInterval(30 * 86_400)
        let store = SyncStateStore(directory: dir)

        // Beginning is an immediate durable write, before any query or upload.
        await store.beginWorkoutEnrichmentFullRecompute(.routes, at: started)
        try await Task.sleep(for: .milliseconds(300))
        var reloaded = SyncStateStore(directory: dir)
        var state = await reloaded.workoutEnrichmentState(.routes)
        #expect(state.fullRecomputeStartedAt == started)
        #expect(state.fullRecomputeThrough == nil)

        await reloaded.advanceWorkoutEnrichmentWatermark(.routes, to: cursor, workouts: 1)
        await reloaded.persistNow()
        try await Task.sleep(for: .milliseconds(300))
        reloaded = SyncStateStore(directory: dir)
        state = await reloaded.workoutEnrichmentState(.routes)
        #expect(state.fullRecomputeStartedAt == started)
        #expect(state.fullRecomputeThrough == cursor)

        // Reconciliation forces a fresh pass from the beginning even when an
        // older full pass was already in progress.
        let restarted = cursor.addingTimeInterval(1)
        await reloaded.requestForcedWorkoutEnrichmentFullRecompute([.routes])
        let consumed = await reloaded.consumeForcedWorkoutEnrichmentFullRecompute(
            .routes, at: restarted)
        #expect(consumed)
        state = await reloaded.workoutEnrichmentState(.routes)
        #expect(state.fullRecomputeStartedAt == restarted)
        #expect(state.fullRecomputeThrough == nil)

        let completed = restarted.addingTimeInterval(1)
        await reloaded.markWorkoutEnrichmentFullRecompute(.routes, at: completed)
        state = await reloaded.workoutEnrichmentState(.routes)
        #expect(state.lastFullRecomputeAt == completed)
        #expect(state.fullRecomputeStartedAt == nil)
        #expect(state.fullRecomputeThrough == nil)
    }

    @Test func stateWithoutFullPassFieldsStillDecodes() throws {
        let old = #"{"totalWorkoutsUploaded":2,"totalPayloadsUploaded":3,"totalBatchesUploaded":1,"totalBytesUploaded":64}"#
        let state = try JSONDecoder.puls.decode(
            WorkoutEnrichmentState.self, from: Data(old.utf8))
        #expect(state.totalWorkoutsUploaded == 2)
        #expect(state.fullRecomputeStartedAt == nil)
        #expect(state.fullRecomputeThrough == nil)
        #expect(state.forcedRestartPending == nil)
    }

    @Test func forcedRequestsPersistBeforeBoundaryAndPrequeueBothKinds() async {
        let dir = makeDir()
        let store = SyncStateStore(directory: dir)
        await store.requestForcedWorkoutEnrichmentFullRecompute([.routes, .streams])

        // Simulate termination before either guarded phase reaches a boundary.
        var reloaded = SyncStateStore(directory: dir)
        var routes = await reloaded.workoutEnrichmentState(.routes)
        var streams = await reloaded.workoutEnrichmentState(.streams)
        #expect(routes.forcedRestartPending == true)
        #expect(streams.forcedRestartPending == true)
        #expect(routes.fullRecomputeStartedAt == nil)
        #expect(streams.fullRecomputeStartedAt == nil)

        // Routes starts first. Its boundary atomically consumes only its own
        // request; a reload during routes still has streams durably queued.
        let routeBoundary = Date(timeIntervalSince1970: 1_700_000_000)
        let routeConsumed = await reloaded.consumeForcedWorkoutEnrichmentFullRecompute(
            .routes, at: routeBoundary)
        #expect(routeConsumed)

        reloaded = SyncStateStore(directory: dir)
        routes = await reloaded.workoutEnrichmentState(.routes)
        streams = await reloaded.workoutEnrichmentState(.streams)
        #expect(routes.forcedRestartPending != true)
        #expect(routes.fullRecomputeStartedAt == routeBoundary)
        #expect(routes.fullRecomputeThrough == nil)
        #expect(streams.forcedRestartPending == true)
        #expect(streams.fullRecomputeStartedAt == nil)
    }

    @Test func forcedRequestDuringActivePassCoalescesAndRestartsAtNextBoundary() async {
        let store = SyncStateStore(directory: makeDir())
        let firstStart = Date(timeIntervalSince1970: 1_700_000_000)
        let cursor = firstStart.addingTimeInterval(10 * 86_400)
        await store.beginWorkoutEnrichmentFullRecompute(.routes, at: firstStart)
        await store.advanceWorkoutEnrichmentWatermark(.routes, to: cursor)

        // Duplicate requests while the pass is active collapse to one durable
        // bool and do not disturb the in-flight cursor before the boundary.
        await store.requestForcedWorkoutEnrichmentFullRecompute([.routes])
        await store.requestForcedWorkoutEnrichmentFullRecompute([.routes])
        var state = await store.workoutEnrichmentState(.routes)
        #expect(state.forcedRestartPending == true)
        #expect(state.fullRecomputeStartedAt == firstStart)
        #expect(state.fullRecomputeThrough == cursor)

        // The active pass finishing clears only its marker; it must not erase a
        // forced request that arrived while that pass was running.
        let firstCompleted = cursor.addingTimeInterval(1)
        await store.markWorkoutEnrichmentFullRecompute(.routes, at: firstCompleted)
        state = await store.workoutEnrichmentState(.routes)
        #expect(state.forcedRestartPending == true)
        #expect(state.fullRecomputeStartedAt == nil)

        let nextBoundary = firstCompleted.addingTimeInterval(1)
        let consumed = await store.consumeForcedWorkoutEnrichmentFullRecompute(
            .routes, at: nextBoundary)
        #expect(consumed)
        state = await store.workoutEnrichmentState(.routes)
        #expect(state.forcedRestartPending != true)
        #expect(state.fullRecomputeStartedAt == nextBoundary)
        #expect(state.fullRecomputeThrough == nil)

        let duplicateConsume = await store.consumeForcedWorkoutEnrichmentFullRecompute(.routes)
        #expect(!duplicateConsume)
    }

    /// A state file written before the enrichment phases existed must load intact
    /// (the file is decoded with `try?`, so a strict decoder would silently reset
    /// every anchor).
    @Test func legacyStateFileLoadsWithoutEnrichmentStates() async throws {
        let dir = makeDir()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let legacy = #"{"configuration":{"enabledTypes":[],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000},"typeStates":{},"deviceID":"dev-y","aggregateStates":{}}"#
        try Data(legacy.utf8).write(to: dir.appendingPathComponent("sync-state.json"))

        let store = SyncStateStore(directory: dir)
        #expect(await store.deviceID == "dev-y")
        #expect(await store.workoutEnrichmentState(.routes).computedThrough == nil)
        #expect(await store.workoutEnrichmentState(.streams).computedThrough == nil)
    }
}

// MARK: - Full-pass resume scheduling

@Suite struct WorkoutEnrichmentScheduleTests {
    @Test func interruptedInitialFullPassResumesFromAckedWorkout() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let cursor = start.addingTimeInterval(30 * 86_400)
        let now = cursor.addingTimeInterval(86_400)
        let schedule = WorkoutEnrichmentSchedule.window(
            startDate: start,
            computedThrough: cursor,
            lastFullRecomputeAt: nil,
            fullRecomputeStartedAt: now.addingTimeInterval(-60),
            fullRecomputeThrough: cursor,
            now: now
        )
        #expect(schedule.fullPass)
        #expect(schedule.from == cursor.addingTimeInterval(-1))
    }

    @Test func scheduledFullRecomputeStillStartsAtBeginning() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let cursor = start.addingTimeInterval(100 * 86_400)
        let now = cursor.addingTimeInterval(31 * 86_400)
        let schedule = WorkoutEnrichmentSchedule.window(
            startDate: start,
            computedThrough: cursor,
            lastFullRecomputeAt: now.addingTimeInterval(-31 * 86_400),
            fullRecomputeStartedAt: nil,
            fullRecomputeThrough: nil,
            now: now
        )
        #expect(schedule.fullPass)
        #expect(schedule.from == start)
    }

    @Test func interruptedScheduledFullPassResumesItsOwnCursor() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let highWater = start.addingTimeInterval(200 * 86_400)
        let fullCursor = start.addingTimeInterval(40 * 86_400)
        let now = highWater.addingTimeInterval(86_400)
        let schedule = WorkoutEnrichmentSchedule.window(
            startDate: start,
            computedThrough: highWater,
            lastFullRecomputeAt: now.addingTimeInterval(-31 * 86_400),
            fullRecomputeStartedAt: now.addingTimeInterval(-3_600),
            fullRecomputeThrough: fullCursor,
            now: now
        )
        #expect(schedule.fullPass)
        #expect(schedule.from == fullCursor.addingTimeInterval(-1))
    }
}

// MARK: - Per-workout upload + watermark (anchor-after-ack regression)

@Suite struct WorkoutEnrichmentUploadTests {
    private func makeDir() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
    }

    private func seriesBatch(points: Int) -> SyncBatch {
        SyncBatch(
            deviceID: "d", type: HealthTypeCatalog.workoutIdentifier, reason: .backfill,
            samples: [], deletions: [], routes: [],
            series: [WorkoutSeriesPayload(
                workoutUUID: UUID(), type: "HKQuantityTypeIdentifierHeartRate", unit: "count/min",
                points: (0..<points).map { SeriesPoint(t: Date(timeIntervalSince1970: Double($0)), value: 1) })])
    }

    /// All of a workout's chunks ack → the watermark advances exactly once, to the
    /// workout's endDate, and every chunk was recorded.
    @Test func watermarkAdvancesAfterAllChunksAck() async throws {
        let store = SyncStateStore(directory: makeDir())
        let engine = HealthSyncEngine(store: store)
        let transport = RecordingTransport()
        let end = Date(timeIntervalSince1970: 5_000_000)
        let batches = [seriesBatch(points: 2_000), seriesBatch(points: 2_000), seriesBatch(points: 1_000)]

        try await engine.uploadWorkoutEnrichment(.streams, batches: batches, workoutEnd: end, transport: transport)

        #expect(await transport.batches.count == 3)
        let state = await store.workoutEnrichmentState(.streams)
        #expect(state.computedThrough == end)
        #expect(state.totalWorkoutsUploaded == 1)
        #expect(state.totalBatchesUploaded == 3)
        #expect(state.totalPayloadsUploaded == 5_000)
    }

    /// The exact failure mode from the live device: a chunk times out mid-workout.
    /// The watermark must NOT advance (so the next run retries the SAME small
    /// chunks rather than wedging), and only the chunks that actually acked count.
    @Test func watermarkDoesNotAdvanceWhenAChunkFails() async {
        let store = SyncStateStore(directory: makeDir())
        let engine = HealthSyncEngine(store: store)
        let transport = FlakyTransport(failAfter: 2) // accepts 2, then times out
        let end = Date(timeIntervalSince1970: 5_000_000)
        let batches = [seriesBatch(points: 2_000), seriesBatch(points: 2_000), seriesBatch(points: 2_000)]

        await #expect(throws: FlakyTransport.Timeout.self) {
            try await engine.uploadWorkoutEnrichment(.streams, batches: batches, workoutEnd: end, transport: transport)
        }

        let state = await store.workoutEnrichmentState(.streams)
        #expect(state.computedThrough == nil, "must not advance the watermark when a chunk fails")
        #expect(state.totalWorkoutsUploaded == 0)
        #expect(state.totalBatchesUploaded == 2, "only the acked chunks were recorded")
    }
}

// MARK: - Phase gating

@Suite struct WorkoutEnrichmentPhaseGateTests {
    private func makeDir() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
    }

    private func engine(routes: Bool, enhanced: Bool) async -> (HealthSyncEngine, SyncStateStore, RecordingTransport) {
        let store = SyncStateStore(directory: makeDir())
        await store.setConfiguration(SyncConfiguration(
            enabledTypes: [HealthTypeCatalog.workoutIdentifier],
            serverURL: URL(string: "https://example.test")!, authToken: "t",
            includeWorkoutRoutes: routes, includeWorkoutEnhancedData: enhanced))
        let engine = HealthSyncEngine(store: store)
        let transport = RecordingTransport()
        await engine.setTransport(transport)
        return (engine, store, transport)
    }

    @Test func routePhaseSkippedWhenRoutesDisabled() async {
        let (engine, store, transport) = await engine(routes: false, enhanced: true)
        await engine.syncWorkoutRoutes()
        // Disabled phase is a pure no-op: no upload, no watermark advance, no error.
        #expect(await transport.batches.isEmpty)
        #expect(await store.workoutEnrichmentState(.routes).computedThrough == nil)
        #expect(await store.workoutEnrichmentState(.routes).lastError == nil)
    }

    @Test func streamPhaseSkippedWhenEnhancedDisabled() async {
        let (engine, store, transport) = await engine(routes: true, enhanced: false)
        await engine.syncWorkoutStreams()
        #expect(await transport.batches.isEmpty)
        #expect(await store.workoutEnrichmentState(.streams).computedThrough == nil)
        #expect(await store.workoutEnrichmentState(.streams).lastError == nil)
    }
}

// MARK: - Batch shape

@Suite struct WorkoutEnrichmentBatchShapeTests {
    /// Phase 4 uploads a route-only batch: no sample rows, no series — just the
    /// `{"route":...}` lines keyed on the workout UUID.
    @Test func routePhaseBatchCarriesOnlyRouteLines() throws {
        let workoutUUID = UUID()
        let batch = SyncBatch(
            deviceID: "d", type: HealthTypeCatalog.workoutIdentifier, reason: .backfill,
            samples: [], deletions: [],
            routes: [RoutePayload(
                workoutUUID: workoutUUID,
                points: [RoutePoint(t: Date(timeIntervalSince1970: 1_700_000_000), lat: 1, lon: 2)])],
            series: [])
        #expect(batch.samples.isEmpty)
        #expect(batch.series.isEmpty)
        #expect(batch.profile == nil)

        let lines = String(decoding: try BatchSerializer.ndjson(for: batch), as: UTF8.self)
            .split(separator: "\n", omittingEmptySubsequences: true)
        #expect(lines.count == 2) // header + one route line
        let header = try JSONDecoder.puls.decode(BatchSerializer.Header.self, from: Data(lines[0].utf8))
        #expect(header.sampleCount == 0)
        #expect(header.routeCount == 1)
        #expect(header.seriesCount == 0)
    }

    /// Phase 5 uploads a series-only batch: no sample rows, no routes — just the
    /// `{"series":...}` lines keyed on the workout UUID.
    @Test func streamPhaseBatchCarriesOnlySeriesLines() throws {
        let workoutUUID = UUID()
        let batch = SyncBatch(
            deviceID: "d", type: HealthTypeCatalog.workoutIdentifier, reason: .backfill,
            samples: [], deletions: [], routes: [],
            series: [WorkoutSeriesPayload(
                workoutUUID: workoutUUID, type: "HKQuantityTypeIdentifierHeartRate", unit: "count/min",
                points: [SeriesPoint(t: Date(timeIntervalSince1970: 1_700_000_000), value: 120)])])
        #expect(batch.samples.isEmpty)
        #expect(batch.routes.isEmpty)

        let lines = String(decoding: try BatchSerializer.ndjson(for: batch), as: UTF8.self)
            .split(separator: "\n", omittingEmptySubsequences: true)
        #expect(lines.count == 2) // header + one series line
        let header = try JSONDecoder.puls.decode(BatchSerializer.Header.self, from: Data(lines[0].utf8))
        #expect(header.sampleCount == 0)
        #expect(header.routeCount == 0)
        #expect(header.seriesCount == 1)
    }
}

// MARK: - Profile-only sync

@Suite struct ProfileSyncTests {
    private func makeDir() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
    }

    @Test func profileUploadsWithoutSamplesOrWorkouts() async throws {
        let store = SyncStateStore(directory: makeDir())
        await store.setConfiguration(SyncConfiguration(
            serverURL: URL(string: "https://example.test")!,
            authToken: "token",
            userName: "Updated Name",
            userEmail: "updated@example.test",
            userDateOfBirth: nil,
            userBiologicalSex: "other"
        ))
        let engine = HealthSyncEngine(store: store)
        let transport = RecordingTransport()
        await engine.setTransport(transport)

        try await engine.syncProfile()

        let batches = await transport.batches
        #expect(batches.count == 1)
        #expect(batches[0].samples.isEmpty)
        #expect(batches[0].deletions.isEmpty)
        #expect(batches[0].routes.isEmpty)
        #expect(batches[0].series.isEmpty)
        #expect(batches[0].profile?.name == "Updated Name")
        #expect(batches[0].profile?.email == "updated@example.test")
        #expect(batches[0].profile?.biologicalSex == "other")
    }

    @Test func completelyEmptyProfileUploadsAReplacement() async throws {
        let store = SyncStateStore(directory: makeDir())
        await store.setConfiguration(SyncConfiguration(
            serverURL: URL(string: "https://example.test")!,
            authToken: "token",
            userName: nil,
            userEmail: nil,
            userDateOfBirth: nil,
            userBiologicalSex: nil
        ))
        let engine = HealthSyncEngine(store: store)
        let transport = RecordingTransport()
        await engine.setTransport(transport)

        try await engine.syncProfile()

        let batches = await transport.batches
        #expect(batches.count == 1)
        #expect(batches[0].profile == ProfilePayload())
        let lines = String(decoding: try BatchSerializer.ndjson(for: batches[0]), as: UTF8.self)
            .split(separator: "\n", omittingEmptySubsequences: true)
        #expect(lines.count == 2)
        let profileLine = try JSONSerialization.jsonObject(
            with: Data(lines[1].utf8)) as! [String: Any]
        let profile = profileLine["profile"] as! [String: Any]
        #expect(Set(profile.keys) == ["name", "email", "dateOfBirth", "biologicalSex"])
        #expect(profile.values.allSatisfy { $0 is NSNull })
    }
}

// MARK: - Phase-aborting error classification

/// Enrichment is best-effort per workout, but a handful of errors mean HealthKit
/// was never actually read. Those must abort the phase rather than be read as
/// "no routes / no streams" — otherwise the watermark advances past workouts
/// whose enrichment was silently skipped (until the ~monthly full pass, which
/// fails the same way if the device is locked again).
@Suite struct EnrichmentErrorClassificationTests {
    private func hkError(_ code: HKError.Code) -> Error {
        NSError(domain: HKErrorDomain, code: code.rawValue)
    }

    @Test func lockedDeviceUndeterminedAccessAndCancellationAbortThePhase() {
        #expect(SeriesEnricher.isPhaseAbortingError(hkError(.errorDatabaseInaccessible)))
        #expect(SeriesEnricher.isPhaseAbortingError(hkError(.errorAuthorizationNotDetermined)))
        #expect(SeriesEnricher.isPhaseAbortingError(CancellationError()))
    }

    @Test func perWorkoutDataErrorsStayBestEffort() {
        #expect(!SeriesEnricher.isPhaseAbortingError(hkError(.errorInvalidArgument)))
        #expect(!SeriesEnricher.isPhaseAbortingError(hkError(.errorAuthorizationDenied)))
        #expect(!SeriesEnricher.isPhaseAbortingError(URLError(.timedOut)))
        #expect(!SeriesEnricher.isPhaseAbortingError(NSError(domain: "x", code: 1)))
    }
}
