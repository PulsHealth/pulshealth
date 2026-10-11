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

extension ConfigurationIsolationTests {
    @Test func savedDestinationSwitchWaitsForCapturedUpload() async throws {
        let engine = makeEngine()
        let a = SyncConfiguration(serverURL: URL(string: "https://alpha.test"), authToken: "alpha-token")
        let b = SyncConfiguration(serverURL: URL(string: "https://beta.test"), authToken: "beta-token")
        #expect(await engine.configure(b))
        let bID = try #require(await engine.store.activeDestinationID)
        #expect(await engine.configure(a))
        let aID = try #require(await engine.store.activeDestinationID)
        let paused = PausedTransport()
        await engine.setTransport(paused)
        let upload = Task { try await engine.syncProfile() }
        await paused.waitUntilUploading()
        do { try await engine.switchDestination(id: bID); Issue.record("Expected busy") }
        catch SavedDestinationError.busy { }
        do { try await engine.unpairDestination(id: aID); Issue.record("Expected busy") }
        catch SavedDestinationError.busy { }
        #expect(await engine.store.activeDestinationID == aID)
        await paused.complete()
        try await upload.value
        try await engine.switchDestination(id: bID)
        let transport = try #require(await engine.transport as? HTTPSyncTransport)
        #expect(transport.baseURL == b.serverURL)
        #expect(transport.authToken == "beta-token")
        #expect(transport.userID == b.userID)
    }

    @Test func outerConfigurationScopeBlocksSwitchEvenBetweenUploadPhases() async throws {
        let engine = makeEngine()
        #expect(await engine.configure(SyncConfiguration(serverURL: URL(string: "https://alpha.test"), authToken: "alpha")))
        let id = try #require(await engine.store.activeDestinationID)
        // Foreground, observer and scheduled paths hold this scope across
        // their complete run, including gaps where no individual type is busy.
        let scope = try #require(await engine.beginConfigurationUse())
        do { try await engine.switchDestination(id: id); Issue.record("Expected busy") }
        catch SavedDestinationError.busy { }
        do { try await engine.unpairDestination(id: id); Issue.record("Expected busy") }
        catch SavedDestinationError.busy { }
        await engine.releaseTestConfigurationUse(scope)
        try await engine.unpairDestination(id: id)
        #expect(await engine.transport == nil)
    }
}

private extension HealthSyncEngine {
    func releaseTestConfigurationUse(_ key: String) { activeSyncs.remove(key) }
}

extension ConfigurationIsolationTests {
    @Test func retryBackoffRetainsOldDestinationUntilWholeUploadFinishes() async throws {
        let engine = makeEngine()
        let aHost = "\(UUID().uuidString.lowercased()).test"
        let bHost = "\(UUID().uuidString.lowercased()).test"
        let a = SyncConfiguration(serverURL: URL(string: "https://\(aHost)"), authToken: "alpha")
        let b = SyncConfiguration(serverURL: URL(string: "https://\(bHost)"), authToken: "beta")
        #expect(await engine.configure(b))
        let bID = try #require(await engine.store.activeDestinationID)
        #expect(await engine.configure(a))
        let aRequests = RequestRecorder()
        let bRequests = RequestRecorder()
        MockURLProtocol.register(host: aHost) { request in
            aRequests.append(request)
            return .http(aRequests.all.count == 1 ? 503 : 204, Data())
        }
        MockURLProtocol.register(host: bHost) { request in
            bRequests.append(request)
            return .http(204, Data())
        }
        let pause = PausedTransport()
        var aTransport = HTTPSyncTransport(baseURL: a.serverURL!, authToken: "alpha",
                                          maxRetries: 1, session: MockURLProtocol.session())
        aTransport.sleeper = { _ in
            _ = try await pause.upload(SyncBatch(deviceID: "test", type: "test", reason: .manual,
                                                samples: [], deletions: []))
        }
        await engine.setTransport(aTransport)
        let upload = Task { try await engine.syncProfile() }
        await pause.waitUntilUploading()
        do { try await engine.switchDestination(id: bID); Issue.record("Expected busy during retry backoff") }
        catch SavedDestinationError.busy { }
        #expect(aRequests.all.count == 1)
        #expect(bRequests.all.isEmpty)
        await pause.complete()
        try await upload.value
        #expect(aRequests.all.count == 2)
        try await engine.switchDestination(id: bID)
        let selected = try #require(await engine.transport as? HTTPSyncTransport)
        #expect(selected.baseURL == b.serverURL)
        #expect(selected.authToken == "beta")
        // Preserve the engine-selected destination and credentials, replacing
        // only URLSession with the in-process receiver used by protocol tests.
        await engine.setTransport(HTTPSyncTransport(baseURL: selected.baseURL, authToken: selected.authToken,
                                                   userID: selected.userID, session: MockURLProtocol.session()))
        try await engine.syncProfile()
        #expect(aRequests.all.count == 2)
        #expect(bRequests.all.count == 1)
        #expect(bRequests.all.first?.request.value(forHTTPHeaderField: "Authorization") == "Bearer beta")
    }
}

/// Blocks only the mock URLProtocol's loading thread. The engine actor remains
/// free to receive switch/unpair requests while the server response is pending.
private final class DelayedReadGate: @unchecked Sendable {
    private let response = DispatchSemaphore(value: 0)
    func wait() { response.wait() }
    func release() { response.signal() }
}

extension ConfigurationIsolationTests {
    @Test(arguments: [false, true])
    func pendingServerGETBlocksSwitchUntilResponseFinishes(capabilities: Bool) async throws {
        let engine = makeEngine()
        let aHost = "\(UUID().uuidString.lowercased()).test"
        let b = SyncConfiguration(serverURL: URL(string: "https://beta.test"), authToken: "beta")
        #expect(await engine.configure(b))
        let bID = try #require(await engine.store.activeDestinationID)
        let a = SyncConfiguration(serverURL: URL(string: "https://\(aHost)"), authToken: "alpha")
        #expect(await engine.configure(a))
        let aID = try #require(await engine.store.activeDestinationID)
        let requests = RequestRecorder()
        let gate = DelayedReadGate()
        defer { gate.release() }
        MockURLProtocol.register(host: aHost) { request in
            requests.append(request)
            gate.wait()
            return .http(200, Data((capabilities ? #"{"protocolVersions":[1]}"# : "[]").utf8))
        }
        await engine.setTestReadClient(ServerAPIClient(baseURL: a.serverURL!, authToken: "alpha",
                                                       session: MockURLProtocol.session()))
        let read = Task {
            if capabilities { _ = try await engine.serverCapabilities() }
            else { _ = try await engine.serverStats() }
        }
        let deadline = ContinuousClock.now + .seconds(5)
        while requests.all.isEmpty, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(!requests.all.isEmpty, "The mock receiver must observe the GET")
        do { try await engine.switchDestination(id: bID); Issue.record("Expected busy while GET is pending") }
        catch SavedDestinationError.busy { }
        do { try await engine.unpairDestination(id: aID); Issue.record("Expected busy while GET is pending") }
        catch SavedDestinationError.busy { }
        #expect(await engine.store.activeDestinationID == aID)
        #expect(requests.all.first?.request.httpMethod == "GET")
        #expect(requests.all.first?.request.url?.path == (capabilities ? "/v1/capabilities" : "/v1/stats"))
        #expect(requests.all.first?.request.value(forHTTPHeaderField: "Authorization") == "Bearer alpha")
        gate.release()
        try await read.value
        try await engine.switchDestination(id: bID)
        #expect(await engine.store.activeDestinationID == bID)
        let transport = try #require(await engine.transport as? HTTPSyncTransport)
        #expect(transport.baseURL == b.serverURL)
        #expect(transport.authToken == "beta")
    }
}

private extension HealthSyncEngine {
    func setTestReadClient(_ client: ServerAPIClient) { apiClient = client }
}
