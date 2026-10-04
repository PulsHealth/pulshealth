import Foundation
import HealthKit
import Testing
@testable import PulsHealthSync

// The October 2026 review's library fixes: per-kind page sizes (R7), the
// cooldown after a terminal refusal (R8), unreadable anchors (R9), the retry
// loop (R11), the token API (R13) and unreadable diagnostics files (F4).

private func tempDir() -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private let steps = "HKQuantityTypeIdentifierStepCount"

// MARK: - R7: page size per kind

@Suite struct PageSizeTests {
    private func descriptor(_ identifier: String) throws -> HealthTypeDescriptor {
        try #require(HealthTypeCatalog.definitions.first { $0.identifier == identifier })
    }

    /// An ECG page is enriched with ≈15,000 voltages per sample before upload,
    /// a heartbeat page with every beat; at the global 1,000 that was ~120 MB.
    @Test func seriesKindsPageSmall() throws {
        let ecg = try descriptor(HealthTypeCatalog.electrocardiogramIdentifier)
        let beats = try descriptor(HealthTypeCatalog.heartbeatSeriesIdentifier)
        #expect(ecg.pageSize(batchSize: 1_000) == 20)
        #expect(beats.pageSize(batchSize: 1_000) == 200)
        #expect(try descriptor(steps).pageSize(batchSize: 1_000) == 1_000)
        #expect(try descriptor(HealthTypeCatalog.workoutIdentifier).maxPageSize == nil)
    }

    /// A smaller configured batch still wins, and nothing pages at zero.
    @Test func neverAboveTheBatchSizeNorBelowOne() throws {
        let ecg = try descriptor(HealthTypeCatalog.electrocardiogramIdentifier)
        #expect(ecg.pageSize(batchSize: 10) == 10)
        #expect(ecg.pageSize(batchSize: 0) == 1)
        #expect(try descriptor(steps).pageSize(batchSize: 0) == 1)
    }

    /// The no-split rule: the merged pack budget is clamped up to `batchSize`,
    /// so every page — capped or not — fits a pack of its own.
    @Test func everyPageFitsThePackBudget() {
        var config = SyncConfiguration()
        config.batchSize = 500
        config.maxMergedBatchSamples = 10
        let budget = max(config.maxMergedBatchSamples, config.batchSize)
        for descriptor in HealthTypeCatalog.definitions {
            let size = descriptor.pageSize(batchSize: config.batchSize)
            #expect(size <= config.batchSize, "\(descriptor.identifier)")
            #expect(size <= budget, "\(descriptor.identifier)")
        }
    }
}

// MARK: - R8: isolation of a type back from a cooldown

@Suite struct IsolatedPackingTests {
    private func page(_ identifier: String, samples: Int) -> MergedPage {
        MergedPage(
            identifier: identifier,
            samples: (0..<samples).map { i in
                SyncSample(
                    uuid: UUID(), type: identifier, kind: .quantity,
                    start: Date(timeIntervalSince1970: TimeInterval(i)),
                    end: Date(timeIntervalSince1970: TimeInterval(i) + 1),
                    value: Double(i), unit: "count")
            },
            deletions: [],
            newAnchor: HKQueryAnchor(fromValue: samples),
            newAnchorData: Data(),
            enrichment: HealthSyncEngine.WorkoutEnrichment(),
            queryDuration: 0,
            drained: true,
            rawCount: samples,
            dropped: 0)
    }

    @Test func anIsolatedTypeTravelsAlone() {
        let buffer = [page("a", samples: 5), page("bad", samples: 7), page("c", samples: 9)]
        let planned = HealthSyncEngine.packsToSend(
            buffer, budget: 1_000, keepPartial: false, isolating: ["bad"])
        let ids = planned.send.map { $0.map(\.identifier).sorted() }
        #expect(ids.contains(["bad"]))
        #expect(ids.contains(["a", "c"]))
        #expect(planned.send.count == 2)
        #expect(planned.leftover.isEmpty)
    }

    /// A held-back partial pack is topped up by the next wave; an isolated
    /// page must never end up in it, or it would ride with others again.
    @Test func keepPartialNeverHoldsAnIsolatedPage() {
        let buffer = [page("a", samples: 5), page("bad", samples: 7)]
        let planned = HealthSyncEngine.packsToSend(
            buffer, budget: 1_000, keepPartial: true, isolating: ["bad"])
        #expect(planned.leftover.map(\.identifier) == ["a"])
        #expect(planned.send.map { $0.map(\.identifier) } == [["bad"]])
    }

    @Test func withNothingIsolatedItIsThePlainPack() {
        let buffer = [page("a", samples: 600), page("b", samples: 600), page("c", samples: 10)]
        let planned = HealthSyncEngine.packsToSend(
            buffer, budget: 1_000, keepPartial: false, isolating: [])
        let plain = HealthSyncEngine.pack(buffer, budget: 1_000)
        #expect(planned.send.map { $0.map(\.identifier) } == plain.map { $0.map(\.identifier) })
        // Every page exactly once.
        #expect(planned.send.flatMap { $0 }.map(\.identifier).sorted() == ["a", "b", "c"])
    }
}

// MARK: - R8: cooldown after a terminal refusal

@Suite struct CooldownTests {
    @Test func scheduleDoublesUpToSixHours() {
        #expect(TypeSyncState.cooldown(afterFailures: 0) == 0)
        #expect(TypeSyncState.cooldown(afterFailures: 1) == 15 * 60)
        #expect(TypeSyncState.cooldown(afterFailures: 2) == 30 * 60)
        #expect(TypeSyncState.cooldown(afterFailures: 3) == 60 * 60)
        #expect(TypeSyncState.cooldown(afterFailures: 5) == 4 * 60 * 60)
        #expect(TypeSyncState.cooldown(afterFailures: 6) == 6 * 60 * 60)
        #expect(TypeSyncState.cooldown(afterFailures: 50) == 6 * 60 * 60)
    }

    @Test func onlyRefusalsThatWillRepeatStartACooldown() {
        #expect(TransportError.serverError(status: 400, body: "").startsCooldown)
        #expect(TransportError.serverError(status: 401, body: "").startsCooldown)
        #expect(TransportError.serverError(status: 403, body: "").startsCooldown)
        #expect(TransportError.serverError(status: 413, body: "").startsCooldown)
        #expect(TransportError.unsupportedProtocol(supportedVersions: [2]).startsCooldown)
        #expect(TransportError.network(URLError(.serverCertificateUntrusted)).startsCooldown)
        #expect(!TransportError.serverError(status: 408, body: "").startsCooldown)
        #expect(!TransportError.serverError(status: 429, body: "").startsCooldown)
        #expect(!TransportError.serverError(status: 500, body: "").startsCooldown)
        #expect(!TransportError.serverError(status: 503, body: "").startsCooldown)
        #expect(!TransportError.network(URLError(.timedOut)).startsCooldown)
        #expect(!TransportError.network(URLError(.notConnectedToInternet)).startsCooldown)
        #expect(!TransportError.notConfigured.startsCooldown)
    }

    @Test func aTerminalErrorCoolsTheTypeAndAnAckLiftsIt() async {
        let store = SyncStateStore(directory: tempDir(), tokenStore: InMemoryTokenStore())
        let now = Date()
        await store.recordError(
            identifier: steps, error: TransportError.serverError(status: 413, body: "too big"), at: now)
        var state = await store.state(for: steps)
        #expect(state.terminalFailures == 1)
        #expect(state.cooldownUntil == now.addingTimeInterval(15 * 60))
        #expect(state.isCoolingDown(at: now))
        #expect(!state.isCoolingDown(at: now.addingTimeInterval(15 * 60 + 1)))

        // Refused again after it expired: longer.
        let later = now.addingTimeInterval(20 * 60)
        await store.recordError(
            identifier: steps, error: TransportError.serverError(status: 413, body: ""), at: later)
        state = await store.state(for: steps)
        #expect(state.terminalFailures == 2)
        #expect(state.cooldownUntil == later.addingTimeInterval(30 * 60))

        // A transient failure records the error but leaves the cooldown alone.
        await store.recordError(
            identifier: steps, error: TransportError.serverError(status: 502, body: ""), at: later)
        #expect(await store.state(for: steps).terminalFailures == 2)

        await store.recordUploadedBatch(
            identifier: steps, newAnchorData: Data([1]), samples: 1, deletions: 0, bytes: 1,
            sampleDateRange: nil, duration: 0, latency: nil)
        state = await store.state(for: steps)
        #expect(state.terminalFailures == nil)
        #expect(state.cooldownUntil == nil)
        #expect(state.lastError == nil)
    }

    @Test func nonTransportErrorsNeverCool() async {
        let store = SyncStateStore(directory: tempDir(), tokenStore: InMemoryTokenStore())
        await store.recordError(identifier: steps, error: SyncError.authorizationNotDetermined)
        let state = await store.state(for: steps)
        #expect(state.lastError != nil)
        #expect(state.cooldownUntil == nil)
    }

    /// The change may be the fix (a smaller batch size, a new token), so any
    /// applied change lifts every cooldown; re-applying the same one does not.
    @Test func aConfigurationChangeLiftsEveryCooldown() async {
        let store = SyncStateStore(directory: tempDir(), tokenStore: InMemoryTokenStore())
        var config = SyncConfiguration(
            enabledTypes: [steps], serverURL: URL(string: "https://example.test"), authToken: "t")
        await store.setConfiguration(config)
        await store.recordError(identifier: steps, error: TransportError.serverError(status: 403, body: ""))

        await store.setConfiguration(config)
        #expect(await store.state(for: steps).isCoolingDown())

        config.batchSize = 200
        await store.setConfiguration(config)
        #expect(await store.state(for: steps).cooldownUntil == nil)
        #expect(await store.state(for: steps).terminalFailures == nil)
    }

    /// 1.6 state files have neither field.
    @Test func stateWithoutTheNewKeysDecodes() throws {
        let json = #"{"identifier":"t","backfillComplete":true,"totalSamplesExported":5,"totalDeletionsExported":0,"totalBytesUploaded":1,"totalBatchesUploaded":1}"#
        let state = try JSONDecoder.puls.decode(TypeSyncState.self, from: Data(json.utf8))
        #expect(state.terminalFailures == nil)
        #expect(state.cooldownUntil == nil)
        #expect(!state.isCoolingDown())
    }

    @Test func statusShowsOnlyACurrentCooldown() throws {
        let descriptor = try #require(HealthTypeCatalog.definitions.first { $0.identifier == steps })
        var state = TypeSyncState(identifier: steps)
        state.cooldownUntil = Date().addingTimeInterval(600)
        #expect(TypeSyncStatus(descriptor: descriptor, state: state, activity: .failed).cooldownUntil != nil)
        state.cooldownUntil = Date().addingTimeInterval(-1)
        #expect(TypeSyncStatus(descriptor: descriptor, state: state, activity: .failed).cooldownUntil == nil)
    }

    /// Sync Now runs `.incremental` under a manual wake; a single type's Sync
    /// runs `.manual`. Both try a cooling type; nothing automatic does.
    @Test func onlyManualRunsBypassTheCooldown() async {
        #expect(HealthSyncEngine.bypassesCooldown(.manual))
        #expect(!HealthSyncEngine.bypassesCooldown(.incremental))
        #expect(!HealthSyncEngine.bypassesCooldown(.backfill))
        let manual = await WakeScope.$current.withValue(WakeContext(trigger: .manual)) {
            HealthSyncEngine.bypassesCooldown(.incremental)
        }
        let observer = await WakeScope.$current.withValue(WakeContext(trigger: .observer)) {
            HealthSyncEngine.bypassesCooldown(.incremental)
        }
        let foreground = await WakeScope.$current.withValue(WakeContext(trigger: .foreground)) {
            HealthSyncEngine.bypassesCooldown(.backfill)
        }
        #expect(manual)
        #expect(!observer)
        #expect(!foreground)
    }
}

// MARK: - R9: an anchor that will not decode

@Suite struct UnreadableAnchorTests {
    private func makeEngine() -> HealthSyncEngine {
        let dir = tempDir()
        return HealthSyncEngine(
            store: SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore()),
            eventLog: SyncEventLog(directory: dir),
            wakeLog: WakeLog(directory: dir))
    }

    @Test func aCorruptMainAnchorRestartsTheType() async {
        let engine = makeEngine()
        let garbage = Data([0xDE, 0xAD, 0xBE, 0xEF])
        await engine.store.update(steps) {
            $0.anchorData = garbage
            $0.recentAnchorData = Data([1])
            $0.recentWindowStart = Date(timeIntervalSince1970: 1_000)
            $0.backfillComplete = true
            $0.totalSamplesExported = 42
            $0.totalBytesUploaded = 7
        }
        let anchor = await engine.storedAnchor(garbage, of: steps, pass: .main)
        #expect(anchor == nil)
        let state = await engine.store.state(for: steps)
        #expect(state.anchorData == nil)
        #expect(state.recentAnchorData == nil)
        #expect(state.recentWindowStart == nil)
        #expect(state.backfillComplete == false)
        #expect(state.totalSamplesExported == 0)
        #expect(state.totalBytesUploaded == 7, "traffic is history and stays")
        let logged = await engine.eventLog.recent()
        #expect(logged.contains { $0.level == .warn && $0.type == steps })
    }

    @Test func aCorruptRecentAnchorDropsOnlyThatStream() async {
        let engine = makeEngine()
        let garbage = Data([0x00, 0x01])
        let windowStart = Date(timeIntervalSince1970: 1_000)
        await engine.store.update(steps) {
            $0.anchorData = Data([9, 9])
            $0.recentAnchorData = garbage
            $0.recentWindowStart = windowStart
        }
        #expect(await engine.storedAnchor(garbage, of: steps, pass: .recent) == nil)
        let state = await engine.store.state(for: steps)
        #expect(state.recentAnchorData == nil)
        #expect(state.recentWindowStart == windowStart)
        #expect(state.anchorData == Data([9, 9]))
    }

    @Test func aGoodAnchorIsReturnedAndNothingChanges() async throws {
        let engine = makeEngine()
        let data = try #require(try engine.encodeAnchor(HKQueryAnchor(fromValue: 5)))
        await engine.store.update(steps) {
            $0.anchorData = data
            $0.backfillComplete = true
        }
        #expect(await engine.storedAnchor(data, of: steps, pass: .main) != nil)
        #expect(await engine.storedAnchor(nil, of: steps, pass: .main) == nil)
        let state = await engine.store.state(for: steps)
        #expect(state.anchorData == data)
        #expect(state.backfillComplete)
    }
}

// MARK: - R11: the retry loop

/// Thread-safe record of the waits the transport asked for.
private final class SleepRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var waits: [TimeInterval] = []
    func append(_ wait: TimeInterval) { lock.withLock { waits.append(wait) } }
    var all: [TimeInterval] { lock.withLock { waits } }
}

@Suite struct RetryLoopTests {
    private var batch: SyncBatch {
        SyncBatch(deviceID: "d", type: "t", reason: .incremental, samples: [], deletions: [])
    }

    /// A transport against `replies` (one per request, the last repeating),
    /// that records its waits instead of sleeping and has no jitter.
    private func makeTransport(
        maxRetries: Int = 4, _ replies: [MockURLProtocol.Reply]
    ) -> (HTTPSyncTransport, RequestRecorder, SleepRecorder) {
        let host = "\(UUID().uuidString.lowercased()).test"
        let requests = RequestRecorder()
        MockURLProtocol.register(host: host) { recorded in
            requests.append(recorded)
            let index = min(requests.all.count - 1, replies.count - 1)
            return replies[index]
        }
        var transport = HTTPSyncTransport(
            baseURL: URL(string: "https://\(host)")!, authToken: "secret", userID: "user-1",
            maxRetries: maxRetries, session: MockURLProtocol.session())
        let sleeps = SleepRecorder()
        transport.sleeper = { sleeps.append($0) }
        transport.jitter = { 1.0 }
        return (transport, requests, sleeps)
    }

    @Test func retriesOnTheLadderThenGivesUp() async {
        let (transport, requests, sleeps) = makeTransport([.http(500, Data())])
        await #expect(throws: TransportError.self) { try await transport.upload(batch) }
        #expect(requests.all.count == 5)
        #expect(sleeps.all == [2, 4, 8, 16])
    }

    @Test func aRetryThatSucceedsAcks() async throws {
        let (transport, requests, sleeps) = makeTransport([.http(503, Data()), .http(200, Data())])
        let result = try await transport.upload(batch)
        #expect(result.bytesSent > 0)
        #expect(requests.all.count == 2)
        #expect(sleeps.all == [2])
    }

    /// An observer wake holds HealthKit's completions: one retry, no more.
    @Test func anObserverWakeRetriesOnce() async {
        let (transport, requests, sleeps) = makeTransport([.failure(.notConnectedToInternet)])
        await WakeScope.$current.withValue(WakeContext(trigger: .observer)) {
            await #expect(throws: TransportError.self) { try await transport.upload(batch) }
        }
        #expect(requests.all.count == 2)
        #expect(sleeps.all == [2])
    }

    @Test func retryAfterIsHonouredOn429And503() async throws {
        let (transport, requests, sleeps) = makeTransport([
            .httpWithHeaders(429, ["Retry-After": "7"], Data()),
            .httpWithHeaders(503, ["Retry-After": "5"], Data()),
            .http(200, Data()),
        ])
        _ = try await transport.upload(batch)
        #expect(requests.all.count == 3)
        #expect(sleeps.all == [7, 5])
    }

    /// Longer than the run should sleep: stop, and let a later wake send it.
    @Test func aLongRetryAfterEndsTheRun() async {
        let (transport, requests, sleeps) = makeTransport([
            .httpWithHeaders(503, ["Retry-After": "120"], Data()),
        ])
        await #expect(throws: TransportError.self) { try await transport.upload(batch) }
        #expect(requests.all.count == 1)
        #expect(sleeps.all.isEmpty)
    }

    @Test func anObserverWakeWaitsOutOnlyAShortRetryAfter() async {
        let (transport, requests, sleeps) = makeTransport([
            .httpWithHeaders(429, ["Retry-After": "30"], Data()),
        ])
        await WakeScope.$current.withValue(WakeContext(trigger: .observer)) {
            await #expect(throws: TransportError.self) { try await transport.upload(batch) }
        }
        #expect(requests.all.count == 1)
        #expect(sleeps.all.isEmpty)
    }

    @Test func terminalFailuresAreNotRetried() async {
        for reply: MockURLProtocol.Reply in [
            .failure(.serverCertificateUntrusted), .failure(.appTransportSecurityRequiresSecureConnection),
            .http(400, Data()), .http(413, Data()),
        ] {
            let (transport, requests, sleeps) = makeTransport([reply])
            do {
                _ = try await transport.upload(batch)
                Issue.record("expected a failure for \(reply)")
            } catch let error as TransportError {
                #expect(error.startsCooldown, "\(reply)")
            } catch {
                Issue.record("unexpected \(error)")
            }
            #expect(requests.all.count == 1, "\(reply)")
            #expect(sleeps.all.isEmpty, "\(reply)")
        }
    }

    @Test func urlErrorClassification() {
        #expect(TransportError.isTerminal(URLError(.badURL)))
        #expect(TransportError.isTerminal(URLError(.serverCertificateHasBadDate)))
        #expect(TransportError.isTerminal(URLError(.clientCertificateRequired)))
        #expect(!TransportError.isTerminal(URLError(.timedOut)))
        #expect(!TransportError.isTerminal(URLError(.cannotFindHost)))
        #expect(!TransportError.isTerminal(URLError(.secureConnectionFailed)))
        #expect(!TransportError.network(URLError(.serverCertificateUntrusted)).isRetryable)
        #expect(TransportError.network(URLError(.networkConnectionLost)).isRetryable)
    }

    @Test func retryAfterParsing() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        #expect(HTTPSyncTransport.retryAfter("5", now: now) == 5)
        #expect(HTTPSyncTransport.retryAfter(" 7 ", now: now) == 7)
        #expect(HTTPSyncTransport.retryAfter("0", now: now) == 0)
        #expect(HTTPSyncTransport.retryAfter("-3", now: now) == nil)
        #expect(HTTPSyncTransport.retryAfter("soon", now: now) == nil)
        #expect(HTTPSyncTransport.retryAfter(nil, now: now) == nil)
        // 2023-11-14T22:13:20Z is `now`; ten seconds later as an HTTP date.
        #expect(HTTPSyncTransport.retryAfter("Tue, 14 Nov 2023 22:13:30 GMT", now: now) == 10)
        #expect(HTTPSyncTransport.retryAfter("Tue, 14 Nov 2023 22:00:00 GMT", now: now) == 0)
    }

    @Test func retryDelaySchedule() {
        #expect(HTTPSyncTransport.retryDelay(attempt: 1, retryAfter: nil, limit: 60, jitter: 1) == 2)
        #expect(HTTPSyncTransport.retryDelay(attempt: 4, retryAfter: nil, limit: 60, jitter: 1) == 16)
        #expect(HTTPSyncTransport.retryDelay(attempt: 6, retryAfter: nil, limit: 60, jitter: 1) == 30)
        #expect(HTTPSyncTransport.retryDelay(attempt: 1, retryAfter: nil, limit: 60, jitter: 1.3) == 2.6)
        #expect(HTTPSyncTransport.retryDelay(attempt: 1, retryAfter: 45, limit: 60, jitter: 1) == 45)
        #expect(HTTPSyncTransport.retryDelay(attempt: 1, retryAfter: 61, limit: 60, jitter: 1) == nil)
    }
}

// MARK: - R13: nil keeps the token; deleting it is explicit

@Suite struct TokenAPITests {
    private let url = URL(string: "https://health.example.test")!

    private func configured(_ tokens: InMemoryTokenStore) async -> SyncStateStore {
        let store = SyncStateStore(directory: tempDir(), tokenStore: tokens)
        await store.setConfiguration(SyncConfiguration(serverURL: url, authToken: "t1"))
        return store
    }

    @Test func aConfigurationWithoutATokenKeepsIt() async throws {
        let tokens = InMemoryTokenStore()
        let store = await configured(tokens)
        var rebuilt = SyncConfiguration(enabledTypes: [steps], serverURL: url)
        rebuilt.authToken = nil
        await store.setConfiguration(rebuilt)
        #expect(try tokens.token() == "t1")
        #expect(await store.configuration.authToken == "t1")
        #expect(await store.configuration.enabledTypes == [steps])
    }

    /// A token is good only for the database that issued it.
    @Test func anotherDatabaseOrUserWithoutATokenDropsIt() async throws {
        let tokens = InMemoryTokenStore()
        let store = await configured(tokens)
        await store.setConfiguration(SyncConfiguration(serverURL: URL(string: "https://other.example.test")!))
        #expect(try tokens.token() == nil)
        #expect(await store.configuration.authToken == nil)

        let tokens2 = InMemoryTokenStore()
        let store2 = await configured(tokens2)
        await store2.setConfiguration(SyncConfiguration(serverURL: url, userID: UUID().uuidString))
        #expect(try tokens2.token() == nil)

        // Disconnect: no database at all.
        let tokens3 = InMemoryTokenStore()
        let store3 = await configured(tokens3)
        await store3.setConfiguration(SyncConfiguration())
        #expect(try tokens3.token() == nil)
    }

    @Test func setAndClearAreExplicit() async throws {
        let tokens = InMemoryTokenStore()
        let store = await configured(tokens)
        await store.setAuthToken("t2")
        #expect(try tokens.token() == "t2")
        #expect(await store.configuration.authToken == "t2")
        #expect(await store.configuration.serverURL == url)

        await store.clearAuthToken()
        #expect(try tokens.token() == nil)
        #expect(await store.configuration.authToken == nil)
        #expect(await store.configuration.serverURL == url)
    }

    /// The token's second home: a refused Keychain write parks it in the
    /// state file, and only there, until the store accepts it. The new entry
    /// points must keep that exactly — and a clear must not leave it behind.
    @Test func setAndClearKeepTheFallbackParking() async throws {
        struct Refusing: TokenStore {
            struct Nope: Error {}
            func token() throws -> String? { nil }
            func setToken(_ token: String?) throws { throw Nope() }
        }
        let dir = tempDir()
        let file = dir.appendingPathComponent("sync-state.json")
        let store = SyncStateStore(directory: dir, tokenStore: Refusing())
        await store.setConfiguration(SyncConfiguration(serverURL: url))
        await store.setAuthToken("parked-secret")
        await store.persistNow()
        #expect(try String(contentsOf: file, encoding: .utf8).contains("parked-secret"))
        #expect(await store.configuration.authToken == "parked-secret")

        // Still refused, and a later configuration without the token keeps it parked.
        await store.setConfiguration(SyncConfiguration(enabledTypes: [steps], serverURL: url))
        await store.persistNow()
        #expect(try String(contentsOf: file, encoding: .utf8).contains("parked-secret"))

        await store.clearAuthToken()
        await store.persistNow()
        #expect(try !String(contentsOf: file, encoding: .utf8).contains("parked-secret"))
    }

    @Test func theEngineSyncsWithTheKeptTokenAndStopsOnClear() async {
        let dir = tempDir()
        let engine = HealthSyncEngine(
            store: SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore()),
            eventLog: SyncEventLog(directory: dir), wakeLog: WakeLog(directory: dir))
        await engine.configure(SyncConfiguration(serverURL: url, authToken: "t1"))
        await engine.configure(SyncConfiguration(enabledTypes: [steps], serverURL: url))
        #expect((await engine.transport as? HTTPSyncTransport)?.authToken == "t1")

        await engine.clearAuthToken()
        #expect(await engine.transport == nil)
        #expect(await engine.store.configuration.authToken == nil)
    }
}

// MARK: - F4: unreadable diagnostics files

@Suite struct UnreadableDiagnosticsTests {
    /// A file that exists but cannot be read (simulated, as for the state
    /// file, by a directory at its path) opens the log read-only: it keeps
    /// recording in memory and never writes over the file, even once the
    /// file is readable again.
    @Test func wakeLogOpensReadOnly() async throws {
        let dir = tempDir()
        let file = dir.appendingPathComponent("wake-log.json")
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: true)
        let log = WakeLog(directory: dir)
        #expect(await log.isReadOnly)

        let original = Data("[]".utf8)
        try FileManager.default.removeItem(at: file)
        try original.write(to: file)

        let wake = WakeContext(trigger: .observer)
        await log.begin(wake, detail: nil)
        await log.record(wakeID: wake.id, type: steps, samples: 1, deletions: 0, bytes: 1)
        await log.finish(wakeID: wake.id, outcome: .completed)
        try await Task.sleep(for: .milliseconds(1_300))  // past the save debounce

        #expect(await log.recent().count == 1)
        #expect(try Data(contentsOf: file) == original)
        #expect(await WakeLog(directory: dir).isReadOnly == false)
    }

    @Test func eventLogOpensReadOnly() async throws {
        let dir = tempDir()
        let file = dir.appendingPathComponent("event-log.json")
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: true)
        let log = SyncEventLog(directory: dir)
        #expect(await log.isReadOnly)

        let original = Data("[]".utf8)
        try FileManager.default.removeItem(at: file)
        try original.write(to: file)

        await log.log(.info, "kept in memory")
        try await Task.sleep(for: .milliseconds(1_300))

        #expect(await log.recent().map(\.message) == ["kept in memory"])
        #expect(try Data(contentsOf: file) == original)
    }

    @Test func aMissingFileIsNotReadOnly() async {
        let dir = tempDir()
        #expect(await WakeLog(directory: dir).isReadOnly == false)
        #expect(await SyncEventLog(directory: dir).isReadOnly == false)
    }
}
