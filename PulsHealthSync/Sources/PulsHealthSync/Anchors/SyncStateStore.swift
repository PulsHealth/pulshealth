import Foundation
import os

/// Everything we persist about one type's sync progress. This is what powers the
/// app's per-type debug dashboard.
public struct TypeSyncState: Codable, Sendable, Equatable {
    public var identifier: String
    /// Opaque archived `HKQueryAnchor`. Nil = never synced.
    public var anchorData: Data?
    /// Set once the initial backfill (history before "now" at enable time) has drained.
    public var backfillComplete: Bool
    /// Wall-clock window of exported sample start dates.
    public var earliestExported: Date?
    public var latestExported: Date?
    public var totalSamplesExported: Int
    public var totalDeletionsExported: Int
    public var totalBytesUploaded: Int
    public var totalBatchesUploaded: Int
    public var lastSyncAt: Date?
    public var lastSyncDuration: TimeInterval?
    /// Time from a sample's endDate to its upload, for the most recent incremental batch.
    public var lastObservedLatency: TimeInterval?
    public var lastError: String?
    public var lastErrorAt: Date?
    /// Most recent server reconciliation pass (nil = never reconciled).
    public var lastReconcileAt: Date?
    public var lastReconcileSummary: String?

    public init(identifier: String) {
        self.identifier = identifier
        self.anchorData = nil
        self.backfillComplete = false
        self.earliestExported = nil
        self.latestExported = nil
        self.totalSamplesExported = 0
        self.totalDeletionsExported = 0
        self.totalBytesUploaded = 0
        self.totalBatchesUploaded = 0
        self.lastSyncAt = nil
        self.lastSyncDuration = nil
        self.lastObservedLatency = nil
        self.lastError = nil
        self.lastErrorAt = nil
    }
}

/// Everything we persist about one aggregate config's sync progress. Aggregates
/// have no `HKQueryAnchor`: progress is a `computedThrough` watermark (a bucket
/// boundary) advanced only after the server acked the upload, mirroring
/// anchor-after-ack for raw samples.
public struct AggregateSyncState: Codable, Sendable, Equatable {
    public var configID: UUID
    /// Buckets ending at or before this are uploaded & acked. Nil = never computed.
    public var computedThrough: Date?
    public var lastComputedAt: Date?
    /// Last time the whole range (from start date) was recomputed; drives the
    /// monthly full pass that repairs edits/deletes older than the lookback.
    public var lastFullRecomputeAt: Date?
    /// Non-nil while an initial or scheduled full pass is in progress. Its
    /// separate cursor is required because `computedThrough` remains the normal
    /// high-water mark during a monthly pass that restarts from the beginning.
    public var fullRecomputeStartedAt: Date?
    public var fullRecomputeThrough: Date?
    public var totalBucketsUploaded: Int
    public var totalBatchesUploaded: Int
    public var totalBytesUploaded: Int
    public var lastError: String?
    public var lastErrorAt: Date?

    public init(configID: UUID) {
        self.configID = configID
        self.computedThrough = nil
        self.lastComputedAt = nil
        self.lastFullRecomputeAt = nil
        self.fullRecomputeStartedAt = nil
        self.fullRecomputeThrough = nil
        self.totalBucketsUploaded = 0
        self.totalBatchesUploaded = 0
        self.totalBytesUploaded = 0
        self.lastError = nil
        self.lastErrorAt = nil
    }
}

/// Everything we persist about activity-summary (activity rings) sync progress.
/// There is exactly one activity-summary stream per device (unlike aggregates,
/// which are per-config), so this is a singleton. Like aggregates it has no
/// `HKQueryAnchor`: progress is a `computedThrough` day watermark advanced only
/// after the server acked the upload.
public struct ActivitySummaryState: Codable, Sendable, Equatable {
    /// Days at or before this are uploaded & acked. Nil = never computed.
    public var computedThrough: Date?
    public var lastComputedAt: Date?
    /// Last time the whole range was recomputed; drives the monthly full pass.
    public var lastFullRecomputeAt: Date?
    public var totalDaysUploaded: Int
    public var totalBatchesUploaded: Int
    public var totalBytesUploaded: Int
    public var lastError: String?
    public var lastErrorAt: Date?

    public init() {
        self.computedThrough = nil
        self.lastComputedAt = nil
        self.lastFullRecomputeAt = nil
        self.totalDaysUploaded = 0
        self.totalBatchesUploaded = 0
        self.totalBytesUploaded = 0
        self.lastError = nil
        self.lastErrorAt = nil
    }
}

/// Selects which workout-enrichment phase a watermark belongs to. Routes and
/// streams are uploaded in their own late phases (see `WorkoutEnrichmentSync`),
/// each tracking its own singleton `computedThrough` watermark.
public enum WorkoutEnrichmentKind: String, Codable, Sendable, CaseIterable, Hashable {
    case routes
    case streams
}

/// Everything we persist about one workout-enrichment phase's progress (GPS
/// routes or intra-workout streams). Enrichment rides separate NDJSON lines
/// (`{"route":...}` / `{"series":...}`) keyed on the workout UUID, so the basic
/// workout row can land in phase 1 and its enrichment in a later phase — fully
/// idempotent server-side (`ON CONFLICT DO NOTHING`). Like activity summaries
/// these have no `HKQueryAnchor`: progress is a singleton `computedThrough`
/// watermark (the workout `endDate` covered so far) advanced only after the
/// server acked every chunk of the phase (anchor-after-ack).
public struct WorkoutEnrichmentState: Codable, Sendable, Equatable {
    /// Workouts ending at or before this have had their enrichment uploaded &
    /// acked. Nil = never run.
    public var computedThrough: Date?
    public var lastComputedAt: Date?
    /// Last time the whole range was recomputed; drives the monthly full pass.
    public var lastFullRecomputeAt: Date?
    /// Durable state for an interrupted initial/monthly/forced full pass. This
    /// cursor is independent of the incremental high-water mark above.
    public var fullRecomputeStartedAt: Date?
    public var fullRecomputeThrough: Date?
    /// A reconciliation-requested restart that has not yet reached a guarded
    /// phase boundary. Optional so state files from before this field decode as
    /// no pending request.
    public var forcedRestartPending: Bool?
    public var totalWorkoutsUploaded: Int
    public var totalPayloadsUploaded: Int
    public var totalBatchesUploaded: Int
    public var totalBytesUploaded: Int
    public var lastError: String?
    public var lastErrorAt: Date?

    public init() {
        self.computedThrough = nil
        self.lastComputedAt = nil
        self.lastFullRecomputeAt = nil
        self.fullRecomputeStartedAt = nil
        self.fullRecomputeThrough = nil
        self.forcedRestartPending = nil
        self.totalWorkoutsUploaded = 0
        self.totalPayloadsUploaded = 0
        self.totalBatchesUploaded = 0
        self.totalBytesUploaded = 0
        self.lastError = nil
        self.lastErrorAt = nil
    }
}

/// Persists sync configuration and per-type state (anchors, counters) as an
/// atomically-written JSON file in Application Support. An actor so concurrent
/// per-type sync tasks can update state safely.
public actor SyncStateStore {
    public private(set) var configuration: SyncConfiguration
    public private(set) var typeStates: [String: TypeSyncState]
    /// Watermarks/counters per aggregate config, keyed by config UUID string.
    public private(set) var aggregateStates: [String: AggregateSyncState]
    /// Watermark/counters for the singleton activity-summary (rings) stream.
    public private(set) var activitySummaryState: ActivitySummaryState
    /// Watermark/counters for the late workout-route enrichment phase.
    public private(set) var workoutRoutesState: WorkoutEnrichmentState
    /// Watermark/counters for the late workout-stream enrichment phase.
    public private(set) var workoutStreamsState: WorkoutEnrichmentState
    /// Stable per-install ID sent with every batch.
    public let deviceID: String

    private let fileURL: URL
    private let logger = Logger(subsystem: PulsLog.subsystem, category: "state")
    private var saveTask: Task<Void, Never>?

    private struct PersistedState: Codable {
        var configuration: SyncConfiguration
        var typeStates: [String: TypeSyncState]
        var deviceID: String
        var aggregateStates: [String: AggregateSyncState]
        var activitySummaryState: ActivitySummaryState
        var workoutRoutesState: WorkoutEnrichmentState
        var workoutStreamsState: WorkoutEnrichmentState

        init(
            configuration: SyncConfiguration,
            typeStates: [String: TypeSyncState],
            deviceID: String,
            aggregateStates: [String: AggregateSyncState],
            activitySummaryState: ActivitySummaryState,
            workoutRoutesState: WorkoutEnrichmentState,
            workoutStreamsState: WorkoutEnrichmentState
        ) {
            self.configuration = configuration
            self.typeStates = typeStates
            self.deviceID = deviceID
            self.aggregateStates = aggregateStates
            self.activitySummaryState = activitySummaryState
            self.workoutRoutesState = workoutRoutesState
            self.workoutStreamsState = workoutStreamsState
        }

        // The whole file is loaded with `try?` — a synthesized decoder would
        // throw keyNotFound on pre-aggregates state files and silently reset
        // every anchor. Same pattern as SyncConfiguration.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            configuration = try c.decode(SyncConfiguration.self, forKey: .configuration)
            typeStates = try c.decode([String: TypeSyncState].self, forKey: .typeStates)
            deviceID = try c.decode(String.self, forKey: .deviceID)
            aggregateStates = try c.decodeIfPresent(
                [String: AggregateSyncState].self, forKey: .aggregateStates) ?? [:]
            activitySummaryState = try c.decodeIfPresent(
                ActivitySummaryState.self, forKey: .activitySummaryState) ?? ActivitySummaryState()
            workoutRoutesState = try c.decodeIfPresent(
                WorkoutEnrichmentState.self, forKey: .workoutRoutesState) ?? WorkoutEnrichmentState()
            workoutStreamsState = try c.decodeIfPresent(
                WorkoutEnrichmentState.self, forKey: .workoutStreamsState) ?? WorkoutEnrichmentState()
        }
    }

    public init(directory: URL? = nil) {
        let dir = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PulsHealthSync", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("sync-state.json")

        var loaded: PersistedState?
        if let data = try? Data(contentsOf: fileURL) {
            do {
                loaded = try JSONDecoder.puls.decode(PersistedState.self, from: data)
            } catch {
                // Starting fresh here would then persist an empty state over the
                // only copy of every anchor and watermark (there are no backups).
                // Move the undecodable file aside so it can be inspected or
                // restored by hand, and only then start clean.
                let quarantine = fileURL.appendingPathExtension(
                    "corrupt-\(Int(Date().timeIntervalSince1970))")
                try? FileManager.default.moveItem(at: fileURL, to: quarantine)
                Logger(subsystem: PulsLog.subsystem, category: "state").error(
                    "Sync state file undecodable (\(error)); moved aside as \(quarantine.lastPathComponent) and starting fresh")
            }
        }
        if let decoded = loaded {
            self.configuration = decoded.configuration
            self.typeStates = decoded.typeStates
            self.aggregateStates = decoded.aggregateStates
            self.activitySummaryState = decoded.activitySummaryState
            self.workoutRoutesState = decoded.workoutRoutesState
            self.workoutStreamsState = decoded.workoutStreamsState
            self.deviceID = decoded.deviceID
        } else {
            self.configuration = SyncConfiguration()
            self.typeStates = [:]
            self.aggregateStates = [:]
            self.activitySummaryState = ActivitySummaryState()
            self.workoutRoutesState = WorkoutEnrichmentState()
            self.workoutStreamsState = WorkoutEnrichmentState()
            self.deviceID = UUID().uuidString
        }
    }

    // MARK: - Reads

    public func state(for identifier: String) -> TypeSyncState {
        typeStates[identifier] ?? TypeSyncState(identifier: identifier)
    }

    public func allStates() -> [TypeSyncState] {
        configuration.enabledTypes.sorted().map { state(for: $0) }
    }

    // MARK: - Writes

    public func setConfiguration(_ config: SyncConfiguration) {
        configuration = config
        persist()
    }

    public func update(_ identifier: String, _ mutate: @Sendable (inout TypeSyncState) -> Void) {
        var s = state(for: identifier)
        mutate(&s)
        typeStates[identifier] = s
        persist()
    }

    /// Record a successfully uploaded batch and advance the anchor — one atomic step.
    /// The anchor is only persisted *after* the upload succeeded, so a crash or
    /// failure between query and upload re-exports the page instead of dropping it.
    public func recordUploadedBatch(
        identifier: String,
        newAnchorData: Data?,
        samples: Int,
        deletions: Int,
        bytes: Int,
        sampleDateRange: ClosedRange<Date>?,
        duration: TimeInterval,
        latency: TimeInterval?
    ) {
        update(identifier) { s in
            s.anchorData = newAnchorData
            s.totalSamplesExported += samples
            s.totalDeletionsExported += deletions
            s.totalBytesUploaded += bytes
            s.totalBatchesUploaded += 1
            s.lastSyncAt = Date()
            s.lastSyncDuration = duration
            s.lastError = nil
            if let latency { s.lastObservedLatency = latency }
            if let range = sampleDateRange {
                s.earliestExported = s.earliestExported.map { min($0, range.lowerBound) } ?? range.lowerBound
                s.latestExported = s.latestExported.map { max($0, range.upperBound) } ?? range.upperBound
            }
        }
    }

    public func recordError(identifier: String, error: Error) {
        update(identifier) { s in
            s.lastError = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            s.lastErrorAt = Date()
        }
    }

    public func markBackfillComplete(_ identifier: String) {
        update(identifier) { s in s.backfillComplete = true }
    }

    public func recordReconciliation(identifier: String, summary: String) {
        update(identifier) { s in
            s.lastReconcileAt = Date()
            s.lastReconcileSummary = summary
        }
    }

    /// Reset a type back to "never synced" (drops the anchor; next sync re-exports everything).
    public func resetType(_ identifier: String) {
        typeStates[identifier] = TypeSyncState(identifier: identifier)
        persist()
    }

    public func resetAll() {
        typeStates = [:]
        aggregateStates = [:]
        activitySummaryState = ActivitySummaryState()
        workoutRoutesState = WorkoutEnrichmentState()
        workoutStreamsState = WorkoutEnrichmentState()
        persist()
    }

    // MARK: - Aggregate state

    public func aggregateState(for configID: UUID) -> AggregateSyncState {
        aggregateStates[configID.uuidString] ?? AggregateSyncState(configID: configID)
    }

    public func updateAggregate(
        _ configID: UUID, _ mutate: @Sendable (inout AggregateSyncState) -> Void
    ) {
        var s = aggregateState(for: configID)
        mutate(&s)
        aggregateStates[configID.uuidString] = s
        persist()
    }

    /// Record an acked aggregate upload and advance the watermark — one atomic
    /// step, like `recordUploadedBatch` for raw samples. The watermark moves
    /// only *after* the server confirmed the chunk; recomputed buckets are
    /// upserts server-side, so re-sending after a crash is harmless.
    public func recordAggregateUpload(
        configID: UUID,
        newComputedThrough: Date,
        buckets: Int,
        bytes: Int
    ) {
        updateAggregate(configID) { s in
            // A trailing-lookback recompute can end before the stored watermark.
            s.computedThrough = max(s.computedThrough ?? .distantPast, newComputedThrough)
            if s.fullRecomputeStartedAt != nil {
                s.fullRecomputeThrough = max(
                    s.fullRecomputeThrough ?? .distantPast, newComputedThrough)
            }
            s.lastComputedAt = Date()
            s.totalBucketsUploaded += buckets
            s.totalBatchesUploaded += 1
            s.totalBytesUploaded += bytes
            s.lastError = nil
        }
    }

    public func recordAggregateError(configID: UUID, error: Error) {
        updateAggregate(configID) { s in
            s.lastError = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            s.lastErrorAt = Date()
        }
    }

    /// Persist the start of a full pass before its first query/upload. A pass that
    /// is already in progress keeps its cursor.
    public func beginAggregateFullRecompute(
        configID: UUID, at date: Date = Date(), resumeThrough: Date? = nil
    ) {
        updateAggregate(configID) { s in
            if s.fullRecomputeStartedAt == nil {
                s.fullRecomputeStartedAt = date
                s.fullRecomputeThrough = resumeThrough
            }
        }
        // This marker must survive termination between the first query and the
        // first ack. Full passes are rare, so bypass the normal write debounce.
        persistNow()
    }

    public func markAggregateFullRecompute(configID: UUID, at date: Date = Date()) {
        updateAggregate(configID) { s in
            s.lastFullRecomputeAt = date
            s.fullRecomputeStartedAt = nil
            s.fullRecomputeThrough = nil
        }
        persistNow()
    }

    /// Drop the watermark so the next sync recomputes the whole series ("Recompute
    /// All", or an identity edit that makes this a different server series).
    public func resetAggregate(configID: UUID) {
        aggregateStates[configID.uuidString] = AggregateSyncState(configID: configID)
        persist()
    }

    /// Drop state for deleted configs so it doesn't accumulate forever.
    public func pruneAggregateStates(keeping ids: Set<UUID>) {
        let keep = Set(ids.map(\.uuidString))
        let before = aggregateStates.count
        aggregateStates = aggregateStates.filter { keep.contains($0.key) }
        if aggregateStates.count != before { persist() }
    }

    // MARK: - Activity-summary state

    public func updateActivitySummary(
        _ mutate: @Sendable (inout ActivitySummaryState) -> Void
    ) {
        var s = activitySummaryState
        mutate(&s)
        activitySummaryState = s
        persist()
    }

    /// Record an acked activity-summary upload and advance the day watermark —
    /// one atomic step, like `recordAggregateUpload`. The watermark moves only
    /// *after* the server confirmed the upload; summaries are upserts
    /// server-side, so re-sending after a crash is harmless.
    public func recordActivitySummaryUpload(
        newComputedThrough: Date, days: Int, bytes: Int
    ) {
        updateActivitySummary { s in
            // A trailing-lookback recompute can end before the stored watermark.
            s.computedThrough = max(s.computedThrough ?? .distantPast, newComputedThrough)
            s.lastComputedAt = Date()
            s.totalDaysUploaded += days
            s.totalBatchesUploaded += 1
            s.totalBytesUploaded += bytes
            s.lastError = nil
        }
    }

    public func recordActivitySummaryError(error: Error) {
        updateActivitySummary { s in
            s.lastError = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            s.lastErrorAt = Date()
        }
    }

    public func markActivitySummaryFullRecompute(at date: Date = Date()) {
        updateActivitySummary { s in s.lastFullRecomputeAt = date }
    }

    /// Drop the watermark so the next sync recomputes every day from the start date.
    public func resetActivitySummary() {
        activitySummaryState = ActivitySummaryState()
        persist()
    }

    // MARK: - Workout-enrichment state (routes / streams)

    public func workoutEnrichmentState(_ kind: WorkoutEnrichmentKind) -> WorkoutEnrichmentState {
        switch kind {
        case .routes: return workoutRoutesState
        case .streams: return workoutStreamsState
        }
    }

    private func setWorkoutEnrichmentState(_ kind: WorkoutEnrichmentKind, _ s: WorkoutEnrichmentState) {
        switch kind {
        case .routes: workoutRoutesState = s
        case .streams: workoutStreamsState = s
        }
    }

    public func updateWorkoutEnrichment(
        _ kind: WorkoutEnrichmentKind, _ mutate: @Sendable (inout WorkoutEnrichmentState) -> Void
    ) {
        var s = workoutEnrichmentState(kind)
        mutate(&s)
        setWorkoutEnrichmentState(kind, s)
        persist()
    }

    /// Record one acked enrichment batch (counters + bytes). The watermark is
    /// *not* advanced here: a single workout's points can span several batches and
    /// the watermark must only move once *every* chunk of that workout is acked
    /// (anchor-after-ack) — see `advanceWorkoutEnrichmentWatermark`. Re-sending a
    /// chunk after a crash is harmless: routes/series are UUID-keyed
    /// `ON CONFLICT DO NOTHING`.
    public func recordWorkoutEnrichmentBatch(
        _ kind: WorkoutEnrichmentKind, payloads: Int, bytes: Int
    ) {
        updateWorkoutEnrichment(kind) { s in
            s.lastComputedAt = Date()
            s.totalPayloadsUploaded += payloads
            s.totalBatchesUploaded += 1
            s.totalBytesUploaded += bytes
            s.lastError = nil
        }
    }

    /// Advance the enrichment watermark to a fully-acked workout's `endDate`
    /// (workouts are processed in ascending end-date order, so this only ever
    /// moves forward — `max` also guards the trailing-lookback re-run case).
    /// Advancing *per workout* (not just at end of phase) means a mid-phase
    /// failure loses at most the in-flight workout, not the whole backfill.
    public func advanceWorkoutEnrichmentWatermark(
        _ kind: WorkoutEnrichmentKind, to newComputedThrough: Date, workouts: Int = 0
    ) {
        updateWorkoutEnrichment(kind) { s in
            s.computedThrough = max(s.computedThrough ?? .distantPast, newComputedThrough)
            if s.fullRecomputeStartedAt != nil {
                s.fullRecomputeThrough = max(
                    s.fullRecomputeThrough ?? .distantPast, newComputedThrough)
            }
            s.lastComputedAt = Date()
            s.totalWorkoutsUploaded += workouts
            s.lastError = nil
        }
    }

    public func recordWorkoutEnrichmentError(_ kind: WorkoutEnrichmentKind, error: Error) {
        updateWorkoutEnrichment(kind) { s in
            s.lastError = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            s.lastErrorAt = Date()
        }
    }

    /// Durably queue every requested phase in one actor mutation + atomic file
    /// write. Reconciliation uses this to queue routes and streams before either
    /// phase starts, so termination during routes cannot lose the streams work.
    public func requestForcedWorkoutEnrichmentFullRecompute(
        _ kinds: Set<WorkoutEnrichmentKind>
    ) {
        guard !kinds.isEmpty else { return }
        for kind in kinds {
            var state = workoutEnrichmentState(kind)
            state.forcedRestartPending = true
            setWorkoutEnrichmentState(kind, state)
        }
        persistNow()
    }

    /// At a guarded run boundary, atomically turn pending intent into a durable
    /// fresh full-pass marker. If the process dies after this returns, the marker
    /// resumes from the beginning on the next ordinary phase run.
    public func consumeForcedWorkoutEnrichmentFullRecompute(
        _ kind: WorkoutEnrichmentKind, at date: Date = Date()
    ) -> Bool {
        var state = workoutEnrichmentState(kind)
        guard state.forcedRestartPending == true else { return false }
        state.forcedRestartPending = nil
        state.fullRecomputeStartedAt = date
        state.fullRecomputeThrough = nil
        setWorkoutEnrichmentState(kind, state)
        persistNow()
        return true
    }

    public func hasForcedWorkoutEnrichmentFullRecompute(
        _ kind: WorkoutEnrichmentKind
    ) -> Bool {
        workoutEnrichmentState(kind).forcedRestartPending == true
    }

    /// Persist a full-pass marker before querying, preserving an in-progress
    /// marker and cursor. Forced restarts exclusively use the durable
    /// request/consume operations above.
    public func beginWorkoutEnrichmentFullRecompute(
        _ kind: WorkoutEnrichmentKind, at date: Date = Date(), resumeThrough: Date? = nil
    ) {
        updateWorkoutEnrichment(kind) { s in
            if s.fullRecomputeStartedAt == nil {
                s.fullRecomputeStartedAt = date
                s.fullRecomputeThrough = resumeThrough
            }
        }
        persistNow()
    }

    public func markWorkoutEnrichmentFullRecompute(_ kind: WorkoutEnrichmentKind, at date: Date = Date()) {
        updateWorkoutEnrichment(kind) { s in
            s.lastFullRecomputeAt = date
            s.fullRecomputeStartedAt = nil
            s.fullRecomputeThrough = nil
        }
        persistNow()
    }

    /// Drop the watermark so the next run re-enriches every workout from the start date.
    public func resetWorkoutEnrichment(_ kind: WorkoutEnrichmentKind) {
        setWorkoutEnrichmentState(kind, WorkoutEnrichmentState())
        persist()
    }

    // MARK: - Persistence

    /// Debounced atomic write. State changes arrive at high frequency during backfill;
    /// coalescing keeps disk I/O off the critical path while staying crash-safe
    /// (worst case we re-upload one already-uploaded page, which the server dedupes by UUID).
    private func persist() {
        guard saveTask == nil else { return }
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            saveTask = nil
            persistNow()
        }
    }

    public func persistNow() {
        let snapshot = PersistedState(
            configuration: configuration, typeStates: typeStates, deviceID: deviceID,
            aggregateStates: aggregateStates, activitySummaryState: activitySummaryState,
            workoutRoutesState: workoutRoutesState, workoutStreamsState: workoutStreamsState
        )
        do {
            let data = try JSONEncoder.puls.encode(snapshot)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            logger.error("Failed to persist sync state: \(error)")
        }
    }
}

extension JSONEncoder {
    /// Shared wire/persistence encoder: epoch-milliseconds dates (fast + compact).
    static var puls: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        return e
    }
}

extension JSONDecoder {
    static var puls: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }
}
