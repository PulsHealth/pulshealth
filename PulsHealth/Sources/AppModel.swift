import Foundation
import Observation
import PulsHealthSync

@MainActor
@Observable
final class AppModel {
    let engine: HealthSyncEngine
    let scheduler: BackgroundSyncScheduler

    private(set) var statuses: [TypeSyncStatus] = []
    /// Per-aggregate-config sync progress, keyed by config ID.
    private(set) var aggregateStates: [UUID: AggregateSyncState] = [:]
    private(set) var events: [SyncEvent] = []
    /// The `start()` task, so callers that need a loaded `config` (the first
    /// foreground `syncNow`) can await it instead of racing the launch.
    @ObservationIgnored private var startTask: Task<Void, Never>?
    /// Durable per-wake telemetry for the Background Activity screen. Refreshed
    /// from the engine's WakeLog whenever a wake finishes (engine `changes()`).
    private(set) var wakeRecords: [WakeRecord] = []
    /// Durable evidence that a BGProcessing request was submitted/pending versus
    /// the separate fact of whether iOS ever launched it.
    private(set) var backgroundScheduleStatus = BackgroundTaskScheduleStatus()
    private(set) var isSyncingAll = false
    /// Server-side aggregates from GET /v1/stats, keyed by type identifier.
    private(set) var serverStats: [String: TypeServerStats] = [:]
    private(set) var serverStatsError: String?
    private(set) var reconciling: Set<String> = []
    /// What the configured server advertised on its last successful
    /// `GET /v1/capabilities` — in memory only, refreshed after a successful
    /// connection test and on every foreground while a server is configured.
    /// Nil means unknown (never fetched, or the server has no such endpoint),
    /// and unknown hides the feature-gated UI: reconciliation needs `digest`
    /// + `uuids`, the per-type server rows need `stats`.
    private(set) var serverCapabilities: ServerCapabilities?
    /// The live editing draft bound by the Data Types and Settings screens.
    var config = SyncConfiguration()
    /// Snapshot of what's actually been pushed to the engine. The Data Types
    /// tab edits `config` freely; changes only reach the engine (and start
    /// backfilling) when `applyChanges()` advances this to match.
    private(set) var appliedConfig = SyncConfiguration()
    var authorizationRequested = false
    /// True while some catalog type's read authorization is still undetermined —
    /// queries against those types fail until the user grants access.
    var needsAuthorization = false
    /// Set when iOS refused to show the permission sheet for some enabled types
    /// (e.g. the iOS 26.5 blood-pressure regression, FB22735935): the request
    /// "succeeds" but the types never appear in the sheet and stay undetermined.
    /// Cleared when a later request actually determines them.
    var authorizationHint: String?
    var lastErrorMessage: String?
    /// A Save & Apply that would point the sync at a different server or user
    /// ID. Held here — nothing applied yet — until the user chooses between
    /// starting fresh and keeping progress (`confirmServerChange`); RootView
    /// presents the prompt wherever the apply came from.
    private(set) var pendingServerChange: ServerIdentityChange?
    /// Whether the deferred apply asked to backfill newly enabled types.
    @ObservationIgnored private var pendingServerChangeWantsNewTypeSync = false

    /// Types a permission request failed to determine this session. Re-requesting
    /// them just makes the sheet flash and auto-dismiss, so the proactive tab-exit
    /// prompt skips them until something else becomes pending. Session-only on
    /// purpose: after an iOS update fixes the bug, a fresh launch retries once.
    @ObservationIgnored private var undeterminableTypes: Set<String> = []

    private var started = false

    init() {
        let engine = HealthSyncEngine()
        self.engine = engine
        self.scheduler = BackgroundSyncScheduler(engine: engine)
    }

    // MARK: - Lifecycle

    func start() async {
        if let startTask {
            await startTask.value
            return
        }
        let task = Task { await self.startBody() }
        startTask = task
        await task.value
    }

    private func startBody() async {
        guard !started else { return }
        started = true

        config = await engine.store.configuration
        appliedConfig = config
        authorizationRequested = UserDefaults.standard.bool(forKey: "authorizationRequested")
        // Don't trust the one-shot flag alone: types added to the catalog after
        // the first grant (or an interrupted permission sheet) stay notDetermined
        // and make their syncs fail until access is requested again.
        await refreshNeedsAuthorization()
        // Heal installs where the flag was never written because access was
        // already determined when Apply ran (older builds only set it after an
        // actual prompt): a configured setup with nothing left to ask for is
        // exactly the state the observer and BG schedule should run in.
        if !config.observedTypeIdentifiers.isEmpty, !needsAuthorization {
            markAuthorizationRequested()
        }
        // A server/user change that was applied but never confirmed (the app
        // died between the two) leaves the stored progress pointing at the
        // wrong server. Ask again rather than quietly syncing on.
        if let change = await engine.pendingServerIdentityChange() {
            pendingServerChange = change
        }

        // Observe engine changes -> refresh dashboard.
        let changeTask = Task { [weak self] in
            guard let self else { return }
            for await _ in await engine.changes() {
                await refresh()
            }
        }
        // Observe event log -> live log view.
        let logTask = Task { [weak self] in
            guard let self else { return }
            for await event in await engine.eventLog.stream() {
                events.append(event)
                if events.count > 1_000 { events.removeFirst(events.count - 1_000) }
            }
        }
        _ = (changeTask, logTask)

        events = await engine.eventLog.recent(limit: 500)
        await ensureBackgroundCatchupScheduled()
        await refresh()

        if authorizationRequested {
            await engine.startObserving()
        }
    }

    func refresh() async {
        statuses = await engine.snapshot()
        let rawStates = await engine.store.aggregateStates
        aggregateStates = Dictionary(uniqueKeysWithValues: rawStates.compactMap { key, value in
            UUID(uuidString: key).map { ($0, value) }
        })
        wakeRecords = await engine.wakeLog.recent(limit: 1_000)
        backgroundScheduleStatus = scheduler.scheduleStatus()
    }

    func ensureBackgroundCatchupScheduled() async {
        guard authorizationRequested else { return }
        await scheduler.ensureScheduled()
        backgroundScheduleStatus = scheduler.scheduleStatus()
    }

    // MARK: - Diagnostics export

    /// Write the wake records (CSV + JSON) and the event log (JSON) to temp files
    /// for the share sheet. Returns the files in a stable order so the Background
    /// Activity screen can offer them via `ShareLink`.
    func writeDiagnosticsBundle() async -> [URL] {
        let stamp = Self.exportStampFormatter.string(from: Date())
        let dir = FileManager.default.temporaryDirectory
        let wakeCSV = await engine.wakeLog.exportCSV()
        let wakeJSON = await engine.wakeLog.exportJSON()
        let eventsJSON = await engine.eventLog.exportJSON()
        let scheduleEncoder = JSONEncoder()
        scheduleEncoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        scheduleEncoder.dateEncodingStrategy = .iso8601
        let scheduleJSON = (try? scheduleEncoder.encode(backgroundScheduleStatus)) ?? Data()
        let files: [(String, Data)] = [
            ("puls-wakes-\(stamp).csv", Data(wakeCSV.utf8)),
            ("puls-wakes-\(stamp).json", wakeJSON),
            ("puls-events-\(stamp).json", eventsJSON),
            ("puls-background-schedule-\(stamp).json", scheduleJSON),
        ]
        var urls: [URL] = []
        for (name, data) in files {
            let url = dir.appendingPathComponent(name)
            if (try? data.write(to: url, options: .atomic)) != nil { urls.append(url) }
        }
        return urls
    }

    private static let exportStampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        return f
    }()

    // MARK: - Actions

    /// Recomputes the dashboard's "access incomplete" warning. Scoped to the
    /// types the user actually enabled (raw-sync ∪ aggregates): unselected
    /// catalog types staying undetermined is normal and must never raise a
    /// warning — only enabled types whose syncs would fail matter.
    private func refreshNeedsAuthorization() async {
        let enabled = config.observedTypeIdentifiers.sorted()
        needsAuthorization = enabled.isEmpty
            ? false
            : await engine.authorizationNeeded(for: enabled)
    }

    /// Observed types (raw-sync ∪ enabled aggregates) that iOS still reports as
    /// never-determined, one by one.
    private func pendingEnabledTypes() async -> [String] {
        var pending: [String] = []
        for id in config.observedTypeIdentifiers.sorted() {
            if await engine.authorizationNeeded(for: [id]) { pending.append(id) }
        }
        return pending
    }

    /// After a permission request ran, anything still pending is a type iOS
    /// refused to put in the sheet (iOS 26.5 omits blood pressure, FB22735935).
    /// Remember them so we stop re-prompting, and tell the user the manual path.
    private func noteUndeterminableTypes() async {
        let stillPending = await pendingEnabledTypes()
        undeterminableTypes.formUnion(stillPending)
        guard !stillPending.isEmpty else {
            authorizationHint = nil
            return
        }
        let names = stillPending
            .map { HealthTypeCatalog.descriptor(for: $0)?.displayName ?? $0 }
            .joined(separator: ", ")
        authorizationHint = """
        iOS didn't include some types in the permission sheet (a known iOS 26.5 \
        bug): \(names). Enable them manually in Settings → Privacy & Security → \
        Health → PulsHealth.
        """
    }

    /// The app's single HealthKit permission prompt. Called from Apply/Save when
    /// a configuration is pushed to the engine: any enabled type (raw-sync or
    /// aggregate-only) whose read access iOS still reports as undetermined is
    /// requested now, in one sheet, before we start reading. The Dashboard only
    /// *warns* about missing access — it never prompts. Idempotent: once a type
    /// is determined it isn't asked again, so re-applying never re-prompts.
    func requestAccessForEnabledTypesIfNeeded() async {
        let enabled = config.observedTypeIdentifiers.sorted()
        if !enabled.isEmpty, await engine.authorizationNeeded(for: enabled) {
            // If everything still pending is known-unpromptable (the iOS 26.5
            // blood-pressure regression), asking again just flashes the sheet —
            // keep the hint up and skip to the per-object step.
            let pending = await pendingEnabledTypes()
            if !Set(pending).isSubset(of: undeterminableTypes) {
                do {
                    try await engine.requestAuthorization(for: enabled)
                    markAuthorizationRequested()
                    await noteUndeterminableTypes()
                } catch {
                    lastErrorMessage = error.localizedDescription
                }
            }
        } else {
            authorizationHint = nil
            // Access for every enabled type is already determined (a reinstall
            // keeps HealthKit grants but not UserDefaults; or the user granted
            // access from Settings → Health before the first Apply). Without
            // the flag, every later launch skipped the observer registration
            // and the BGProcessing schedule, and the Dashboard kept showing the
            // welcome banner — background sync silently stopped after a
            // reinstall until the user tapped Apply again in each session.
            if !enabled.isEmpty { markAuthorizationRequested() }
        }
        // Medications use a separate per-object sheet (the user picks which
        // medications the app may read); show it after the bulk one so the main
        // grant always comes first.
        await requestMedicationAccessIfNeeded()
        await refreshNeedsAuthorization()
    }

    /// Durable "we have asked, or never need to ask, for Health access" — the
    /// gate for observer registration and background catch-up scheduling.
    private func markAuthorizationRequested() {
        guard !authorizationRequested else { return }
        authorizationRequested = true
        UserDefaults.standard.set(true, forKey: "authorizationRequested")
    }

    /// Push the draft to the engine. Returns false when nothing was applied
    /// because the draft points at a different server or user ID than the
    /// stored sync progress belongs to: the prompt is raised instead, and the
    /// apply resumes from `confirmServerChange` with the user's choice.
    @discardableResult
    func applyConfiguration(syncNewTypes: Bool = false, serverChangeConfirmed: Bool = false) async -> Bool {
        if !serverChangeConfirmed, let change = await engine.serverIdentityChange(applying: config) {
            pendingServerChange = change
            pendingServerChangeWantsNewTypeSync = syncNewTypes
            return false
        }
        await resetReidentifiedAggregates()
        await engine.configure(config, confirmServerIdentity: serverChangeConfirmed)
        appliedConfig = config
        // User identity is independent of workout availability. Send it as its
        // own tiny batch so Save & Apply updates the server immediately even when
        // there are no new workouts to carry a profile line.
        if config.serverURL != nil, config.authToken != nil {
            do {
                try await engine.syncProfile(reason: .manual)
            } catch {
                lastErrorMessage = error.localizedDescription
            }
        }
        // Apply/Save is the one place the app asks HealthKit for access. Request
        // it before reading so a newly enabled type doesn't fail its first sync.
        await requestAccessForEnabledTypesIfNeeded()
        await engine.startObserving()
        await refresh()

        guard syncNewTypes, configured, config.authToken != nil, !isSyncingAll else { return true }
        // Types enabled but never synced (no anchor) start backfilling right
        // away so they appear live on the dashboard instead of "not synced".
        let newTypes = statuses
            .filter {
                !HealthTypeCatalog.isActivitySummary($0.id)
                    && $0.state.anchorData == nil
                    && $0.activity == .idle
            }
            .map(\.id)
        // Enabled aggregate configs that have never computed a bucket start
        // backfilling right away too.
        let newAggregates = config.aggregates
            .filter { $0.enabled && aggregateStates[$0.id]?.computedThrough == nil }
            .map(\.id)
        let activitySummaryState = await engine.store.activitySummaryState
        let newRings = config.enabledTypes.contains(HealthTypeCatalog.activitySummaryIdentifier)
            && activitySummaryState.computedThrough == nil
        guard !newTypes.isEmpty || !newAggregates.isEmpty || newRings else { return true }

        // This is usually the largest data movement of an install, so it runs
        // inside a wake like every other entry point (X-Wake-ID on its batches,
        // a Background Activity record) and under the same isSyncingAll gate as
        // Start Initial Backfill, so the two cannot run 4-wide on top of each
        // other.
        isSyncingAll = true
        Task {
            defer { isSyncingAll = false }
            let wake = await engine.beginWake(.manual, detail: "apply: backfill newly enabled types")
            await WakeScope.$current.withValue(wake) {
                await withTaskGroup(of: Void.self) { group in
                    if !newTypes.isEmpty {
                        group.addTask { await self.engine.syncTypes(newTypes, reason: .backfill) }
                    }
                    if !newAggregates.isEmpty {
                        group.addTask {
                            for id in newAggregates {
                                await self.engine.syncAggregate(configID: id, reason: .backfill)
                            }
                        }
                    }
                    if newRings {
                        group.addTask { await self.engine.syncActivitySummary(reason: .backfill) }
                    }
                }
            }
            await engine.finishWake(wake)
        }
        return true
    }

    // MARK: - Server / user change

    /// Resolve a deferred apply. "Start fresh" runs the existing full reset —
    /// every anchor and watermark — so the new server receives all history
    /// from the start date; "keep progress" leaves them, so only data newer
    /// than the old high-water mark reaches it. Either way the identity is
    /// recorded only now, with the choice, never before it.
    ///
    /// Synchronous on purpose: the alert button's action and the dismissal of
    /// its `isPresented` binding land in the same turn, so the choice is
    /// captured here, before any await, and the work continues in a task.
    func confirmServerChange(startFresh: Bool) {
        guard let change = pendingServerChange else { return }
        pendingServerChange = nil
        let wantsNewTypeSync = pendingServerChangeWantsNewTypeSync
        pendingServerChangeWantsNewTypeSync = false
        Task {
            await resolveServerChange(change, startFresh: startFresh, wantsNewTypeSync: wantsNewTypeSync)
        }
    }

    private func resolveServerChange(
        _ change: ServerIdentityChange, startFresh: Bool, wantsNewTypeSync: Bool
    ) async {
        if startFresh {
            guard await engine.resetAll() else {
                lastErrorMessage = "A sync is in progress. Wait for it to finish, then save again."
                return
            }
            await engine.eventLog.log(
                .warn, "Sync target changed (\(change.summary)) — all anchors and watermarks reset; re-syncing history")
        } else {
            await engine.eventLog.log(
                .warn, "Sync target changed (\(change.summary)) — progress kept; only new data will reach it")
        }
        await applyConfiguration(
            syncNewTypes: startFresh || wantsNewTypeSync, serverChangeConfirmed: true)
    }

    /// Dismiss the prompt without applying. The draft keeps what was typed so
    /// the user can adjust it; nothing has reached the engine.
    func cancelServerChange() {
        pendingServerChange = nil
        pendingServerChangeWantsNewTypeSync = false
    }

    // MARK: - Staged Data Types changes

    /// True while the Data Types draft differs from what's applied to the
    /// engine. Scoped to the fields that tab edits (raw types, aggregates,
    /// workout routes) so Settings-only edits don't trip the Apply bar. Drives
    /// the pending-changes bar on the Data Types tab.
    var hasPendingChanges: Bool {
        config.enabledTypes != appliedConfig.enabledTypes
            || config.aggregates != appliedConfig.aggregates
            || config.includeWorkoutRoutes != appliedConfig.includeWorkoutRoutes
            || config.includeWorkoutEnhancedData != appliedConfig.includeWorkoutEnhancedData
    }

    /// Short description of what's staged, e.g. "2 data types · 1 aggregate".
    var pendingChangesSummary: String {
        var parts: [String] = []
        let typeDelta = config.enabledTypes.symmetricDifference(appliedConfig.enabledTypes).count
        if typeDelta > 0 {
            parts.append("\(typeDelta) data type\(typeDelta == 1 ? "" : "s")")
        }
        let applied = Dictionary(uniqueKeysWithValues: appliedConfig.aggregates.map { ($0.id, $0) })
        let draft = Dictionary(uniqueKeysWithValues: config.aggregates.map { ($0.id, $0) })
        let aggDelta = Set(applied.keys).union(draft.keys).count { applied[$0] != draft[$0] }
        if aggDelta > 0 {
            parts.append("\(aggDelta) aggregate\(aggDelta == 1 ? "" : "s")")
        }
        if config.includeWorkoutRoutes != appliedConfig.includeWorkoutRoutes {
            parts.append("workout routes")
        }
        if config.includeWorkoutEnhancedData != appliedConfig.includeWorkoutEnhancedData {
            parts.append("enhanced workout data")
        }
        return parts.isEmpty ? "configuration" : parts.joined(separator: " · ")
    }

    /// Commits the staged Data Types draft: pushes it to the engine and starts
    /// backfilling newly enabled types/aggregates. Mirrors Settings' Save & Apply.
    func applyChanges() async {
        await applyConfiguration(syncNewTypes: true)
    }

    /// Validates a user ID edit: a UUID in any case or nil. Normalized to
    /// lowercase to match `PulsDefaultUser.id`; the server treats the ID
    /// case-insensitively but the stored identity compares lowercased.
    nonisolated static func normalizedUserID(_ text: String) -> String? {
        UUID(uuidString: text.trimmingCharacters(in: .whitespacesAndNewlines))
            .map { $0.uuidString.lowercased() }
    }

    /// Before applying, reset the watermark of any aggregate whose server
    /// identity or start date changed in the draft: that describes a different
    /// series, so the next sync must recompute it from scratch (the server
    /// upserts, so re-sending is safe). New configs have no watermark yet, so
    /// they're skipped — `applyConfiguration` backfills them instead.
    private func resetReidentifiedAggregates() async {
        let applied = Dictionary(uniqueKeysWithValues: appliedConfig.aggregates.map { ($0.id, $0) })
        for agg in config.aggregates {
            guard let old = applied[agg.id] else { continue }
            if old.seriesIdentity != agg.seriesIdentity || old.startDate != agg.startDate {
                await engine.store.resetAggregate(configID: agg.id)
                await engine.eventLog.log(
                    .warn, type: agg.typeIdentifier,
                    "Aggregate \(agg.summaryLabel) reconfigured — next sync recomputes the whole series")
            }
        }
    }

    /// Reverts the staged draft back to what's currently applied.
    func discardChanges() {
        config = appliedConfig
    }

    func syncNow(trigger: String) async {
        // A cold launch's `.active` transition can land before `start()` has
        // loaded the persisted config, in which case the guard below would see
        // the empty default and skip the launch sync.
        await start()
        if trigger == "foreground" {
            // Off the sync's critical path: capabilities only gate UI.
            Task { await refreshServerCapabilities() }
        }
        // observedTypeIdentifiers: an aggregate-only setup (no raw types) still syncs.
        guard !isSyncingAll, config.serverURL != nil,
              !config.observedTypeIdentifiers.isEmpty else { return }
        isSyncingAll = true
        defer { isSyncingAll = false }
        // "foreground" = scenePhase became active; everything else (Sync Now,
        // pull-to-refresh) is user-driven.
        let wakeTrigger: WakeTrigger = trigger == "foreground" ? .foreground : .manual
        let wake = await engine.beginWake(wakeTrigger, detail: trigger)
        await WakeScope.$current.withValue(wake) {
            await engine.syncAllEnabled(reason: .incremental)
        }
        await engine.finishWake(wake)
    }

    func startBackfill() async {
        guard !isSyncingAll else { return }
        // iOS 26: run as a continued-processing task so the backfill keeps going
        // with system progress UI if the user backgrounds the app (that path
        // records its own wake).
        if #available(iOS 26.0, *), scheduler.startContinuedBackfill() {
            return
        }
        isSyncingAll = true
        defer { isSyncingAll = false }
        let wake = await engine.beginWake(.manual, detail: "foreground backfill")
        await WakeScope.$current.withValue(wake) {
            await engine.syncAllEnabled(reason: .backfill)
        }
        await engine.finishWake(wake)
    }

    func syncOne(_ identifier: String) async {
        if HealthTypeCatalog.isActivitySummary(identifier) {
            await engine.syncActivitySummary(reason: .manual)
        } else {
            await engine.sync(type: identifier, reason: .manual)
        }
    }

    /// Pull /v1/stats so type detail screens can confirm device and server agree.
    func refreshServerStats() async {
        do {
            let stats = try await engine.serverStats()
            serverStats = Dictionary(
                stats.map { ($0.type, $0) }, uniquingKeysWith: { a, _ in a })
            serverStatsError = nil
        } catch {
            serverStatsError = error.localizedDescription
        }
    }

    func reconcile(_ identifier: String) async {
        guard !reconciling.contains(identifier) else { return }
        reconciling.insert(identifier)
        defer { reconciling.remove(identifier) }
        do {
            _ = try await engine.reconcile(type: identifier)
            await refreshServerStats()
            await refresh()
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    /// Medications need HealthKit's per-object authorization sheet (the user picks
    /// which medications the app may read). One-shot per install, like the main grant.
    func requestMedicationAccessIfNeeded() async {
        guard #available(iOS 26.0, *),
              config.enabledTypes.contains(HealthTypeCatalog.medicationDoseIdentifier),
              !UserDefaults.standard.bool(forKey: "medicationAuthRequested") else { return }
        do {
            try await engine.requestMedicationAuthorization()
            UserDefaults.standard.set(true, forKey: "medicationAuthRequested")
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    /// Clears both the engine's persisted ring buffer and the on-screen list —
    /// the list is a separate array fed by the event stream, so clearing only
    /// the actor left the Log tab unchanged until the next launch.
    func clearEvents() async {
        await engine.eventLog.clear()
        events = []
    }

    /// True while any raw type, aggregate, or the rings are mid-run. Gates the
    /// reset buttons: a reset under a running sync is silently undone by that
    /// run's next state write (see `HealthSyncEngine.resetType`).
    var anySyncActive: Bool {
        statuses.contains { $0.activity != .idle }
    }

    /// True while a backfill is running by any path — the in-app one
    /// (`isSyncingAll`) or the iOS 26 continued-processing task, which runs
    /// outside this model and only shows up through the engine's activities.
    var backfillActive: Bool {
        isSyncingAll || typesBackfilling > 0
    }

    func resetType(_ identifier: String) async {
        let name = HealthTypeCatalog.descriptor(for: identifier)?.displayName ?? identifier
        guard await engine.resetType(identifier) else {
            lastErrorMessage = "\(name) is syncing right now. Wait for it to finish, then reset."
            return
        }
        await engine.eventLog.log(
            .warn, type: identifier,
            HealthTypeCatalog.isActivitySummary(identifier)
                ? "Activity rings reset — next sync recomputes from the start date"
                : "Anchor reset — next sync re-exports from start date")
        await refresh()
    }

    func resetAll() async {
        guard await engine.resetAll() else {
            lastErrorMessage = "A sync is in progress. Wait for it to finish, then reset."
            return
        }
        await engine.eventLog.log(.warn, "All anchors reset")
        await refresh()
    }

    // MARK: - Server capabilities

    /// Reconciliation compares `GET /v1/digest` and `GET /v1/uuids`; both must
    /// be advertised. Unknown capabilities hide the controls.
    var serverSupportsReconciliation: Bool {
        serverCapabilities?.supportsReconciliation ?? false
    }

    /// The per-type "Server" rows come from `GET /v1/stats`.
    var serverSupportsStats: Bool {
        serverCapabilities?.supportsStats ?? false
    }

    /// Re-reads the configured server's capabilities. A definitive "no such
    /// endpoint" (404/405, or a body that is not capabilities JSON) clears the
    /// last answer; a transient failure (offline, 5xx) keeps it, so a flaky
    /// network does not make the reconciliation controls flicker.
    func refreshServerCapabilities() async {
        guard config.serverURL != nil, config.authToken != nil else {
            serverCapabilities = nil
            return
        }
        do {
            serverCapabilities = try await engine.serverCapabilities()
        } catch TransportError.serverError(let status, _) where status == 404 || status == 405 {
            serverCapabilities = nil
        } catch is DecodingError {
            serverCapabilities = nil
        } catch {
            // Transient: keep the last known capabilities.
        }
    }

    /// Tests a server URL + token *without saving them* — the Settings screen
    /// calls this with the entered, not-yet-applied values. Nothing is
    /// persisted; a successful answer only refreshes the in-memory
    /// capabilities so the feature gates reflect the server just tested.
    func testConnection(url: URL, token: String) async -> ConnectionTestResult {
        let deviceID = await engine.store.deviceID
        let tester = ConnectionTester(
            baseURL: url, authToken: token, userID: config.userID, deviceID: deviceID)
        let result = await tester.run()
        if case .ok(let capabilities) = result {
            serverCapabilities = capabilities
        }
        return result
    }

    // MARK: - Aggregates

    func aggregates(for typeIdentifier: String) -> [AggregateConfig] {
        config.aggregates.filter { $0.typeIdentifier == typeIdentifier }
    }

    func addAggregate(_ aggregate: AggregateConfig) {
        config.aggregates.append(aggregate)
    }

    func updateAggregate(_ aggregate: AggregateConfig) {
        guard let index = config.aggregates.firstIndex(where: { $0.id == aggregate.id }) else { return }
        config.aggregates[index] = aggregate
    }

    func deleteAggregate(id: UUID) {
        config.aggregates.removeAll { $0.id == id }
    }

    /// Clears the watermark so the next sync recomputes the whole series.
    func resetAggregate(id: UUID) async {
        let aggregate = config.aggregates.first { $0.id == id }
        guard await engine.resetAggregate(configID: id) else {
            lastErrorMessage = "\(aggregate?.summaryLabel ?? "This aggregate") is computing right now. Wait for it to finish, then recompute."
            return
        }
        await engine.eventLog.log(
            .warn, type: aggregate?.typeIdentifier,
            "Aggregate \(aggregate?.summaryLabel ?? id.uuidString) reset — next sync recomputes the whole series")
        await refresh()
    }

    func syncAggregate(id: UUID) {
        Task { await engine.syncAggregate(configID: id, reason: .manual) }
    }

    // MARK: - Derived dashboard aggregates

    var totalSamples: Int { statuses.reduce(0) { $0 + $1.state.totalSamplesExported } }
    var totalBytes: Int { statuses.reduce(0) { $0 + $1.state.totalBytesUploaded } }
    var typesBackfilling: Int { statuses.filter { $0.activity == .backfilling }.count }
    var typesFailed: Int { statuses.filter { $0.state.lastError != nil }.count }
    var backfillRemaining: TimeInterval? {
        let remaining = statuses.compactMap(\.estimatedSecondsRemaining)
        return remaining.isEmpty ? nil : remaining.max()
    }
    var configured: Bool { config.serverURL != nil && !config.observedTypeIdentifiers.isEmpty }
}

// MARK: - Formatting helpers shared by views

extension Int {
    var byteString: String {
        ByteCountFormatter.string(fromByteCount: Int64(self), countStyle: .file)
    }

    var compactString: String {
        if self >= 1_000_000 { return String(format: "%.1fM", Double(self) / 1_000_000) }
        if self >= 10_000 { return String(format: "%.0fK", Double(self) / 1_000) }
        return formatted()
    }
}

extension TimeInterval {
    var shortDuration: String {
        if self < 1 { return String(format: "%.0f ms", self * 1000) }
        if self < 90 { return String(format: "%.1f s", self) }
        if self < 5_400 { return String(format: "%.0f min", self / 60) }
        return String(format: "%.1f h", self / 3600)
    }
}

extension Date {
    var relativeString: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: Date())
    }
}
