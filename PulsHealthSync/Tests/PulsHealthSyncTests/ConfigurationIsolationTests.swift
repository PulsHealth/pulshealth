import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct ConfigurationIsolationTests {
    actor PausedTransport: SyncTransport {
        private var started: CheckedContinuation<Void, Never>?
        private var finish: CheckedContinuation<Void, Never>?
        private var uploading = false

        func waitUntilUploading() async {
            if uploading { return }
            await withCheckedContinuation { started = $0 }
        }

        func upload(_ batch: SyncBatch) async throws -> UploadResult {
            uploading = true
            started?.resume()
            started = nil
            await withCheckedContinuation { finish = $0 }
            return UploadResult(bytesSent: 1, duration: 0)
        }

        func complete() { finish?.resume(); finish = nil }
    }

    func makeEngine() -> HealthSyncEngine {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("puls-tests-\(UUID())")
        return HealthSyncEngine(
            store: SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore()),
            eventLog: SyncEventLog(directory: dir), wakeLog: WakeLog(directory: dir))
    }

    @Test func destinationAndDisconnectWaitForCapturedTransportToFinish() async throws {
        let engine = makeEngine()
        let original = SyncConfiguration(serverURL: URL(string: "https://original.test"), authToken: "old-token")
        #expect(await engine.configure(original))
        let paused = PausedTransport()
        await engine.setTransport(paused)
        let upload = Task { try await engine.syncProfile() }
        await paused.waitUntilUploading()

        var replacement = original
        replacement.serverURL = URL(string: "https://replacement.test")
        replacement.authToken = "new-token"
        #expect(!(await engine.configure(replacement, confirmServerIdentity: true)))
        #expect(!(await engine.clearAuthToken()))
        #expect(!(await engine.setAuthToken("rotated-token")))
        #expect(!(await engine.resetAll()))
        #expect(await engine.store.configuration.serverURL == original.serverURL)
        #expect(await engine.store.configuration.authToken == "old-token")

        await paused.complete()
        try await upload.value
        #expect(await engine.configure(replacement, confirmServerIdentity: true))
        #expect(await engine.store.configuration.serverURL == replacement.serverURL)
        #expect(await engine.clearAuthToken())
        #expect(await engine.transport == nil)
    }

    @Test func clearingAnEmptyDraftTokenIsPartOfTheConfigurationCommit() async {
        let engine = makeEngine()
        var config = SyncConfiguration(serverURL: URL(string: "https://original.test"), authToken: "old-token")
        #expect(await engine.configure(config))
        config.authToken = nil
        #expect(await engine.configure(config, clearAuthToken: true))
        #expect(await engine.store.configuration.authToken == nil)
        #expect(await engine.transport == nil)
        // A cold rebuild must not resurrect the old token either.
        await engine.ensureTransport()
        #expect(await engine.transport == nil)
    }

    @Test func aClaimedRawSweepPreventsChangingAggregateStateOrDestination() async {
        let engine = makeEngine()
        let aggregate = AggregateConfig(typeIdentifier: "HKQuantityTypeIdentifierStepCount", function: .sum)
        var original = SyncConfiguration(serverURL: URL(string: "https://original.test"), authToken: "token")
        original.aggregates = [aggregate]
        #expect(await engine.configure(original))
        let watermark = Date(timeIntervalSince1970: 1_000)
        await engine.store.recordAggregateUpload(configID: aggregate.id, newComputedThrough: watermark, buckets: 1, bytes: 1)
        #expect(await engine.claimTypes(["test-type"]) == ["test-type"])

        var replacement = original
        replacement.aggregates[0].intervalUnit = .week
        #expect(!(await engine.configure(replacement)))
        #expect(await engine.store.aggregateState(for: aggregate.id).computedThrough == watermark)

        // The unknown test type exits without querying HealthKit, releasing
        // exactly the claim the real backfill path holds across its uploads.
        await engine.sweep(["test-type"], reason: .backfill)
        #expect(await engine.configure(replacement))
        #expect(await engine.store.aggregateState(for: aggregate.id).computedThrough == nil)
    }
}
