import Foundation
import Observation
import PulsHealthSync
import UIKit

/// State of the Export Data screen (`ExportView`): the two choices, the run in
/// flight, and the finished export waiting to be shared.
///
/// Owned by `AppModel` rather than by the view, for two reasons. A run takes
/// minutes on a phone with years of data, and leaving the screen must not end
/// it or lose its result. And the files it stages are health data at rest on
/// the device, which the privacy policy says is short-lived — so their lifetime
/// is managed in one place, here, instead of wherever a view happened to be
/// when it disappeared:
///
/// - `AppModel.init` clears the staging root at every launch, before an export
///   can exist, which also sweeps up whatever a crash or force-quit left;
/// - starting an export deletes the previous one first;
/// - the share sheet reporting `completed` deletes the files it just handed
///   over (`shareFinished`), and Delete Export does it on request.
///
/// None of those can run during an export (`removeAllExports()` must not): the
/// launch one precedes any run, and the rest are refused while `isRunning`.
///
/// The export itself never goes near the app's engine — `HealthExporter` builds
/// a throwaway one per run (CLAUDE.md, "Export never shares sync state"). The
/// real engine is used here for exactly two things: its `deviceID`, so a
/// replayed JSONL is attributed to this install, and — through the `authorize`
/// closure — the HealthKit permission request, which is per-app.
@MainActor
@Observable
final class ExportModel {
    /// A finished export. `result.files` exist on disk until `filesRemoved`.
    struct Finished {
        let result: ExportResult
        let range: ExportRange
        /// The app left the foreground at some point during the run. iOS locks
        /// HealthKit with the device, so this is the usual reason behind a list
        /// of failed types, and the screen says so instead of leaving a column
        /// of "database inaccessible" to be decoded.
        let wasBackgrounded: Bool
        /// True once the share sheet completed and the staged copy was deleted.
        /// The summary stays on screen; the Share button does not.
        var filesRemoved = false
    }

    enum State {
        case idle
        case running(ExportProgress)
        case finished(Finished)
    }

    /// Why the screen is back at its controls without a result, if it is.
    enum Notice: Equatable {
        case cancelled
        case failed(ExportFailureCopy)
    }

    var format: ExportFormat = .csv
    var range: ExportRange = .default
    private(set) var state: State = .idle
    private(set) var notice: Notice?

    @ObservationIgnored private var task: Task<Void, Never>?

    var isRunning: Bool {
        if case .running = state { return true }
        return false
    }

    /// Start an export of `configuration` with the current format and range.
    ///
    /// - Parameters:
    ///   - engine: the app's real engine — read for its device ID only.
    ///   - authorize: asks HealthKit for read access to the selection. Awaited,
    ///     because the exporter never prompts and an un-requested type comes
    ///     back as a failure; see `AppModel.requestHealthAccessForExport`.
    func start(
        configuration: SyncConfiguration, engine: HealthSyncEngine,
        authorize: @escaping @MainActor () async -> Void
    ) {
        guard !isRunning else { return }
        // One staged export at a time: the previous one's files go before the
        // new run writes anything. Safe here and nowhere later — nothing is
        // running, and `removeAllExports()` would pull the directory out from
        // under a run that was.
        HealthExporter.removeAllExports()
        notice = nil
        state = .running(ExportProgress(phase: .preparing))
        let format = format
        let range = range
        task = Task { [weak self] in
            await self?.run(
                configuration: configuration, format: format, range: range,
                engine: engine, authorize: authorize)
        }
    }

    /// Cooperative: the sweep stops at its next page, `HealthExporter` deletes
    /// what it wrote and throws `CancellationError`, and `run` lands on idle.
    func cancel() {
        task?.cancel()
    }

    /// Delete Export, and New Export after a share.
    func discard() {
        guard case .finished(let finished) = state else { return }
        if !finished.filesRemoved { HealthExporter.remove(finished.result) }
        state = .idle
    }

    /// The share sheet closed. Only `completed` deletes: a sheet the user
    /// swiped away handed the files to nobody, and they may open it again.
    func shareFinished(completed: Bool) {
        guard completed, case .finished(var finished) = state, !finished.filesRemoved else { return }
        HealthExporter.remove(finished.result)
        finished.filesRemoved = true
        state = .finished(finished)
    }

    // MARK: - The run

    private func run(
        configuration: SyncConfiguration, format: ExportFormat, range: ExportRange,
        engine: HealthSyncEngine, authorize: @MainActor () async -> Void
    ) async {
        // A device that locks mid-run turns every remaining type into a
        // failure, so for the length of the run: no auto-lock, and a
        // background-task assertion so a glance at another app does not
        // suspend the process mid-file. Neither survives the user locking the
        // phone on purpose — `wasBackgrounded` is for that. Both end on every
        // way out of this function.
        let application = UIApplication.shared
        application.isIdleTimerDisabled = true
        // A class, not a captured `var`: the expiration handler is an escaping
        // closure, and it and the `defer` both need to end the same assertion
        // exactly once.
        let assertion = BackgroundAssertion()
        assertion.begin(named: "Health data export")
        let backgrounded = BackgroundWatch()
        defer {
            application.isIdleTimerDisabled = false
            assertion.end()
            backgrounded.stop()
        }

        await authorize()
        // The Log tab is the app's account of what it did; an export belongs
        // in it. Counts and outcomes only, like every other line there.
        await engine.eventLog.log(.info, "Export to \(format.title) (\(range.title)) started")

        // Progress arrives on the exporter's executor, once per written batch
        // — hundreds of times over a large export, in bursts. Newest-only
        // buffering delivers them to the main actor in order and drops the
        // ones the screen would never have drawn, without a Task per batch.
        let (updates, continuation) = AsyncStream.makeStream(
            of: ExportProgress.self, bufferingPolicy: .bufferingNewest(1))
        let display = Task { [weak self] in
            for await progress in updates {
                guard let self, self.isRunning else { continue }
                self.state = .running(progress)
            }
        }

        let outcome: Result<ExportResult, Error>
        do {
            try Task.checkCancellation()
            let request = ExportRequest(
                configuration: configuration,
                startDate: range.startDate(),
                format: format,
                deviceID: await engine.store.deviceID)
            outcome = .success(try await HealthExporter().run(request) { continuation.yield($0) })
        } catch {
            outcome = .failure(error)
        }
        // Drain the display task before writing the final state, or a progress
        // update still in flight could put `.running` back over it.
        continuation.finish()
        await display.value

        switch outcome {
        case .success(let result):
            state = .finished(Finished(
                result: result, range: range, wasBackgrounded: backgrounded.didEnterBackground))
            let missing = result.failures.count + result.unmappableSamples.count
            await engine.eventLog.log(
                result.isComplete ? .info : .warn,
                "Export finished: \(result.writtenRows.formatted()) rows, \(Int(result.totalBytes).byteString), "
                    + "\(result.duration.shortDuration)"
                    + (result.isComplete ? "" : " — incomplete, \(missing) type\(missing == 1 ? "" : "s") not fully read"))
        case .failure(let error):
            // A throw always means no files (`HealthExporter.run`).
            state = .idle
            if let copy = ExportFailureCopy(error: error) {
                notice = .failed(copy)
                await engine.eventLog.log(.error, "Export failed: \(copy.title)")
            } else {
                notice = .cancelled
                await engine.eventLog.log(.info, "Export cancelled — nothing kept")
            }
        }
        task = nil
    }
}

/// One `beginBackgroundTask` assertion, ended exactly once whether the run
/// finishes first or iOS calls time on it.
@MainActor
private final class BackgroundAssertion {
    private var identifier = UIBackgroundTaskIdentifier.invalid

    func begin(named name: String) {
        identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            // Out of background time. Ending the assertion is mandatory — iOS
            // kills an app that does not — and it is all this does: the run is
            // left alone, to be suspended with the process and to carry on if
            // the user comes back. What it could not read meanwhile it reports.
            MainActor.assumeIsolated { self?.end() }
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}

/// Remembers whether the app entered the background while it was watching.
@MainActor
private final class BackgroundWatch {
    private(set) var didEnterBackground = false
    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.didEnterBackground = true }
        }
    }

    func stop() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
    }
}
