import Foundation
import Observation
import PulsHealthSync
import UIKit

@MainActor @Observable
final class DataRequestModel {
    var pending: DataRequest?
    var presented = false
    var error: String?
    private(set) var isBusy = false
    private(set) var progress: ExportProgress?
    private(set) var result: ExportResult?
    private(set) var receipt: RequestUploader.Receipt?
    private(set) var sharing = false
    private(set) var handedOff = false
    private(set) var sending = false
    private(set) var submissionID = UUID()
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var directory: URL?
    static var root: URL { FileManager.default.temporaryDirectory.appendingPathComponent("PulsHealthRequests", isDirectory: true) }

    typealias Generator = @Sendable (ExportRequest, ExportProgressHandler?) async throws -> ExportResult
    typealias Sender = @Sendable (URL, DataRequest, UUID) async throws -> RequestUploader.Receipt
    @ObservationIgnored private let generate: Generator
    @ObservationIgnored private let upload: Sender

    init(clearStaging: Bool = true,
         generate: @escaping Generator = { request, progress in try await HealthExporter().run(request, progress: progress) },
         upload: @escaping Sender = { file, request, id in try await RequestUploader().upload(file: file, request: request, submissionID: id) }) {
        self.generate = generate; self.upload = upload
        if clearStaging { try? FileManager.default.removeItem(at: Self.root) }
    }

    /// First request wins until dismissed. Never replace a reviewed recipient during a run.
    func open(_ text: String) {
        guard pending == nil, !isBusy else { return }
        do { pending = try DataRequest.parse(text); error = nil }
        catch { self.error = error.localizedDescription }
    }

    func discard() {
        guard !isBusy else { return }
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil; result = nil; progress = nil; receipt = nil; sharing = false
    }

    func close() {
        guard !isBusy else { return }
        discard(); pending = nil; error = nil; handedOff = false; presented = false
    }
    func cancel() { task?.cancel() }
    func showShare() { sharing = result != nil }
    func shareFinished(_ completed: Bool) {
        sharing = false
        if completed { discard(); handedOff = true }
    }
    func hideShare() { sharing = false }

    func start(configuration: SyncConfiguration, authorize: @escaping @MainActor (ExportSelection) async -> Void) {
        guard let request = pending, !isBusy else { return }
        discard(); handedOff = false; error = nil; submissionID = UUID(); isBusy = true
        task = Task { [weak self] in
            guard let self else { return }
            let assertion = UIApplication.shared.beginBackgroundTask(withName: "One-time health request") { [weak self] in
                MainActor.assumeIsolated { self?.cancel() }
            }
            UIApplication.shared.isIdleTimerDisabled = true
            defer {
                UIApplication.shared.isIdleTimerDisabled = false
                if assertion != .invalid { UIApplication.shared.endBackgroundTask(assertion) }
                isBusy = false; sending = false; task = nil
            }
            do {
                try request.validate()
                await authorize(request.selection())
                try Task.checkCancellation()
                let range = try request.bounds()
                var isolated = configuration
                isolated.userID = UUID().uuidString.lowercased()
                isolated.startDate = range.start
                isolated.serverURL = nil; isolated.authToken = nil; isolated.signedInDatabaseURL = nil
                isolated.userName = nil; isolated.userEmail = nil
                isolated.userDateOfBirth = nil; isolated.userBiologicalSex = nil
                let output = Self.root.appendingPathComponent(submissionID.uuidString, isDirectory: true)
                directory = output
                var export = ExportRequest(selection: request.selection(), configuration: isolated,
                    startDate: range.start, endDate: range.end, format: request.format,
                    zipped: true, outputDirectory: output)
                export.dataRequest = request
                export.submissionID = submissionID
                let (updates, continuation) = AsyncStream.makeStream(of: ExportProgress.self, bufferingPolicy: .bufferingNewest(1))
                let display = Task { [weak self] in
                    for await update in updates { self?.progress = update }
                }
                let generated: ExportResult
                do { generated = try await generate(export, { continuation.yield($0) }) }
                catch { continuation.finish(); await display.value; throw error }
                continuation.finish(); await display.value
                result = generated
                try Task.checkCancellation()
                if request.destination != nil {
                    // The combined button authorizes automatic delivery of a complete extraction.
                    // A partial extraction requires a separate, explicit choice.
                    guard generated.isComplete, generated.notRepresented.isEmpty, generated.warnings.isEmpty else { return }
                    try await send(request, result: generated)
                } else { sharing = true }
            } catch is CancellationError {
                discardAfterFailure(); error = "Cancelled. No further data will be sent. An upload already received cannot be recalled."
            } catch {
                self.error = error.localizedDescription
                if result == nil { discardAfterFailure() }
            }
        }
    }

    func retrySend() {
        guard !isBusy, let request = pending, let result else { return }
        isBusy = true; error = nil
        task = Task { [weak self] in
            guard let self else { return }
            let assertion = UIApplication.shared.beginBackgroundTask(withName: "Send health request") { [weak self] in
                MainActor.assumeIsolated { self?.cancel() }
            }
            defer {
                if assertion != .invalid { UIApplication.shared.endBackgroundTask(assertion) }
                isBusy = false; sending = false; task = nil
            }
            do { try await send(request, result: result) }
            catch { self.error = "Receipt not confirmed. \(error.localizedDescription)" }
        }
    }

    private func send(_ request: DataRequest, result: ExportResult) async throws {
        guard let file = result.files.first else { return }
        sending = true
        receipt = try await upload(file, request, submissionID)
        HealthExporter.remove(result); self.result = nil
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
    }
    private func discardAfterFailure() {
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil; result = nil
    }
}
