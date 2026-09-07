#if canImport(BackgroundTasks) && !os(macOS)
import BackgroundTasks
import Foundation
import os

/// Synchronous claim gate shared by a background task's work and expiration
/// paths. Expiration handlers cannot `await`, so a small lock is the simplest
/// way to select exactly one owner. The expiration owner must complete the
/// system task synchronously; the normal owner claims only in its final
/// non-suspending completion tail. Cleanup/telemetry continues best-effort.
final class BackgroundTaskCompletionGate: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed = false

    /// Claim completion ownership and perform the winner's entire synchronous
    /// completion tail before releasing the lock. A competing path can never
    /// observe `claimed` while the winner is still pre-completion.
    func claim(performing completion: () -> Void) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !claimed else { return false }
        claimed = true
        completion()
        return true
    }

    /// Serialize non-completion mutations (continued-task progress) with the
    /// final claim. If this body runs, a later claim cannot complete the system
    /// task until the mutation has finished; after a claim, it never runs.
    func performIfUnclaimed(_ body: () -> Void) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !claimed else { return false }
        body()
        return true
    }
}

/// Durable diagnostic state for the periodic catch-up request. A submitted task
/// is only a request to iOS, not evidence that execution was granted; keeping
/// these timestamps separate makes that distinction visible in the app.
public struct BackgroundTaskScheduleStatus: Codable, Sendable, Equatable {
    public var lastPendingCheckAt: Date?
    public var isPending = false
    public var pendingEarliestBeginDate: Date?
    public var lastSubmittedAt: Date?
    public var lastSubmissionError: String?
    public var lastLaunchedAt: Date?
    public var lastCompletedAt: Date?
    public var lastOutcome: String?

    public init() {}
}

/// Schedules a periodic BGProcessingTask as a safety net behind HealthKit's
/// background delivery: if observer wake-ups are missed (force-quit, Low Power
/// Mode, delivery throttling), the processing task catches the backlog up.
///
/// Requires in the app target:
///  - "Background Modes" capability with "Background processing"
///  - Info.plist `BGTaskSchedulerPermittedIdentifiers` containing `taskIdentifier`
///  - `register()` called before app launch finishes.
public final class BackgroundSyncScheduler: Sendable {
    public static let taskIdentifier = "com.puls.healthsync.catchup"
    /// iOS 26 continued-processing identifiers must be `<bundle id>.<context>.*`;
    /// the wildcard goes in `BGTaskSchedulerPermittedIdentifiers`.
    public static var backfillWildcardIdentifier: String {
        continuedBackfillPermittedIdentifier(bundleIdentifier: Bundle.main.bundleIdentifier ?? "app")
    }
    public static var backfillTaskIdentifier: String {
        continuedBackfillRegistrationIdentifier(bundleIdentifier: Bundle.main.bundleIdentifier ?? "app")
    }

    public static func continuedBackfillPermittedIdentifier(bundleIdentifier: String) -> String {
        "\(bundleIdentifier).backfill.*"
    }

    public static func continuedBackfillRegistrationIdentifier(bundleIdentifier: String) -> String {
        "\(bundleIdentifier).backfill.run"
    }

    private let engine: HealthSyncEngine
    private let logger = Logger(subsystem: PulsLog.subsystem, category: "background")
    private let statusLock = NSLock()
    private static let statusDefaultsKey = "PulsHealthSync.backgroundTaskScheduleStatus"

    public init(engine: HealthSyncEngine) {
        self.engine = engine
    }

    /// Must run before `application(_:didFinishLaunchingWithOptions:)` returns.
    public func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.taskIdentifier, using: nil
        ) { [self] task in
            guard let task = task as? BGProcessingTask else { return }
            handle(task)
        }
    }

    /// Ensure one catch-up request is pending without replacing an existing
    /// request and pushing its earliest begin date farther into the future.
    public func ensureScheduled(earliestIn interval: TimeInterval = 4 * 3600) async {
        let pendingDate: Date? = await withCheckedContinuation { continuation in
            BGTaskScheduler.shared.getPendingTaskRequests { requests in
                let date = requests.first(where: { $0.identifier == Self.taskIdentifier })?.earliestBeginDate
                continuation.resume(returning: date)
            }
        }
        updateScheduleStatus {
            $0.lastPendingCheckAt = Date()
            $0.isPending = pendingDate != nil
            $0.pendingEarliestBeginDate = pendingDate
            if pendingDate != nil { $0.lastSubmissionError = nil }
        }
        if pendingDate == nil {
            scheduleNext(earliestIn: interval)
        }
    }

    public func scheduleStatus() -> BackgroundTaskScheduleStatus {
        statusLock.withLock { loadScheduleStatus() }
    }

    public func scheduleNext(earliestIn interval: TimeInterval = 4 * 3600) {
        let request = BGProcessingTaskRequest(identifier: Self.taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: interval)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        do {
            try BGTaskScheduler.shared.submit(request)
            self.updateScheduleStatus {
                $0.lastSubmittedAt = Date()
                $0.lastSubmissionError = nil
                $0.isPending = true
                $0.pendingEarliestBeginDate = request.earliestBeginDate
            }
            logger.info("Scheduled catch-up task, earliest in \(Int(interval))s")
        } catch {
            updateScheduleStatus {
                $0.lastSubmittedAt = Date()
                $0.lastSubmissionError = String(describing: error)
                $0.isPending = false
                $0.pendingEarliestBeginDate = nil
            }
            // Common in Simulator / when Background App Refresh is off.
            logger.warning("Could not schedule catch-up task: \(error)")
        }
    }

    /// BGTask isn't Sendable, but `setTaskCompleted` is safe from any thread.
    private struct TaskBox: @unchecked Sendable {
        let task: BGProcessingTask
    }

    private func handle(_ task: BGProcessingTask) {
        updateScheduleStatus {
            $0.lastLaunchedAt = Date()
            $0.isPending = false
            $0.pendingEarliestBeginDate = nil
        }
        scheduleNext()
        let box = TaskBox(task: task)
        let completionGate = BackgroundTaskCompletionGate()
        // Built synchronously so the expiration handler can finish the same wake.
        let wake = WakeContext(trigger: .backgroundProcessing)
        let syncWork = Task { [engine] in
            // iOS schedules processing tasks when the device is idle, which in
            // practice means overnight while it is locked — and HealthKit is
            // unreadable then. Measured over two months on the production
            // device: 156 of these wakes produced 59 samples in total and 154
            // were completely empty. Check once instead of discovering it ~80
            // failed queries later.
            let accessible = await engine.isHealthDataAccessible()
            if accessible {
                await engine.registerWake(wake, detail: "catch-up sync")
                await WakeScope.$current.withValue(wake) {
                    await engine.syncAllEnabled(reason: .incremental)
                }
            } else {
                await engine.registerWake(wake, detail: "catch-up sync — device locked, skipped")
            }
            await engine.store.persistNow()
            let outcome: WakeRecord.Outcome = accessible ? .completed : .skippedLocked
            // Final arbitration happens after required persistence. Claim and
            // system completion share one locked, non-suspending operation.
            guard completionGate.claim(performing: {
                // A skipped-because-locked run is still a successful task as far
                // as iOS is concerned; reporting failure would cost us future
                // scheduling opportunities for something that was never our fault.
                box.task.setTaskCompleted(success: true)
            }) else { return }
            self.updateScheduleStatus {
                $0.lastCompletedAt = Date()
                $0.lastOutcome = outcome.rawValue
            }
            // Telemetry is best-effort after the system task is safely released.
            Task { await engine.finishWake(wake, outcome: outcome) }
        }
        task.expirationHandler = { [engine, self] in
            guard completionGate.claim(performing: {
                syncWork.cancel()
                // iOS expects expiration completion promptly. The sync may be
                // stuck in a cancellation-insensitive HealthKit/network await.
                box.task.setTaskCompleted(success: false)
            }) else { return }
            self.updateScheduleStatus {
                $0.lastCompletedAt = Date()
                $0.lastOutcome = WakeRecord.Outcome.expired.rawValue
            }
            Task {
                await engine.finishWake(wake, outcome: .expired)
                await engine.store.persistNow()
            }
        }
    }

    private func updateScheduleStatus(_ update: (inout BackgroundTaskScheduleStatus) -> Void) {
        statusLock.withLock {
            var status = loadScheduleStatus()
            update(&status)
            if let data = try? JSONEncoder.puls.encode(status) {
                UserDefaults.standard.set(data, forKey: Self.statusDefaultsKey)
            }
        }
    }

    private func loadScheduleStatus() -> BackgroundTaskScheduleStatus {
        guard let data = UserDefaults.standard.data(forKey: Self.statusDefaultsKey),
              let status = try? JSONDecoder.puls.decode(BackgroundTaskScheduleStatus.self, from: data)
        else { return BackgroundTaskScheduleStatus() }
        return status
    }

    // MARK: - Continued backfill (iOS 26)

    /// Register the continued-processing handler that runs a user-initiated
    /// backfill with system progress UI, so it survives backgrounding instead of
    /// pausing on suspend. Safe to call any time (continued-processing
    /// registration is exempt from the launch-time requirement).
    @available(iOS 26.0, *)
    public func registerContinuedBackfill() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backfillTaskIdentifier, using: nil
        ) { [self] task in
            guard let task = task as? BGContinuedProcessingTask else { return }
            handleContinuedBackfill(task)
        }
    }

    /// Submit the backfill as a continued-processing task. The registered handler
    /// performs the sync. Returns false when the system refuses (caller should run
    /// the backfill as a plain foreground task instead).
    @available(iOS 26.0, *)
    public func startContinuedBackfill() -> Bool {
        let request = BGContinuedProcessingTaskRequest(
            identifier: Self.backfillTaskIdentifier,
            title: "Syncing health history",
            subtitle: "Uploading to your server"
        )
        // .fail (not .queue): the user just tapped the button, so if the system
        // can't run it now we want to fall back to an in-app sync immediately.
        request.strategy = .fail
        do {
            try BGTaskScheduler.shared.submit(request)
            return true
        } catch {
            logger.warning("Continued-processing backfill unavailable: \(error)")
            return false
        }
    }

    @available(iOS 26.0, *)
    private struct ContinuedTaskBox: @unchecked Sendable {
        let task: BGContinuedProcessingTask
    }

    @available(iOS 26.0, *)
    private func handleContinuedBackfill(_ task: BGContinuedProcessingTask) {
        let box = ContinuedTaskBox(task: task)
        let completionGate = BackgroundTaskCompletionGate()
        // The scheduler force-expires tasks whose progress stalls, so report
        // per-type completion while the engine works through the backfill.
        task.progress.totalUnitCount = 1
        // Built synchronously so the expiration handler can finish the same wake.
        let wake = WakeContext(trigger: .backgroundContinued)

        // Keep the handle outside `syncWork`: expiration must be able to cancel
        // the ticker even when the sync is stuck in a cancellation-insensitive
        // HealthKit/network await.
        let progressTicker = Task { [engine] in
            while !Task.isCancelled {
                let statuses = await engine.snapshot()
                guard !Task.isCancelled else { break }
                let total = max(1, statuses.count)
                let done = statuses.filter {
                    $0.activity != .backfilling && $0.state.anchorData != nil
                }.count
                let updated = completionGate.performIfUnclaimed {
                    box.task.progress.totalUnitCount = Int64(total)
                    box.task.progress.completedUnitCount = Int64(min(done, total - 1))
                }
                guard updated else { break }
                try? await Task.sleep(for: .seconds(2))
            }
        }
        let syncWork = Task { [engine] in
            await engine.registerWake(wake, detail: "continued-processing backfill")
            await WakeScope.$current.withValue(wake) {
                await engine.syncAllEnabled(reason: .backfill)
            }
            await engine.store.persistNow()
            // Keep final progress, claim, and successful completion in one
            // locked, non-suspending tail after persistence.
            guard completionGate.claim(performing: {
                progressTicker.cancel()
                box.task.progress.completedUnitCount = box.task.progress.totalUnitCount
                box.task.setTaskCompleted(success: true)
            }) else { return }
            Task { await engine.finishWake(wake, outcome: .completed) }
        }
        task.expirationHandler = { [engine] in
            guard completionGate.claim(performing: {
                syncWork.cancel()
                progressTicker.cancel()
                // Complete synchronously for the same reason as
                // BGProcessingTask: sync cancellation may not be observed.
                box.task.setTaskCompleted(success: false)
            }) else { return }
            Task {
                await engine.eventLog.log(.warn, "Continued-processing backfill expired — persisting progress for app resume")
                await engine.finishWake(wake, outcome: .expired)
                await engine.store.persistNow()
            }
        }
    }
}
#endif
