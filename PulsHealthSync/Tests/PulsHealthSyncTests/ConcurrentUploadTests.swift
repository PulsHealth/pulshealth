import Foundation
import HealthKit
import Testing
@testable import PulsHealthSync

/// A merged flush now has several packs in flight at once. Anchor-after-ack
/// has to survive that unchanged: a pack's types advance only on that pack's
/// own ack, a failed pack leaves its types exactly where they were, and no
/// more requests are in flight than `maxConcurrentTypes` allows.
@Suite struct ConcurrentUploadTests {
    /// Records how many uploads overlap, and fails any batch carrying `failing`.
    actor RecordingTransport: SyncTransport {
        let failing: String?
        private(set) var inFlight = 0
        private(set) var peak = 0
        private(set) var uploaded: [String] = []

        init(failing: String? = nil) { self.failing = failing }

        func upload(_ batch: SyncBatch) async throws -> UploadResult {
            inFlight += 1
            peak = max(peak, inFlight)
            defer { inFlight -= 1 }
            try await Task.sleep(for: .milliseconds(40))
            let types = Set(batch.samples.map(\.type))
            if let failing, types.contains(failing) {
                throw TransportError.serverError(status: 500, body: "boom")
            }
            uploaded.append(contentsOf: types)
            return UploadResult(bytesSent: 100, duration: 0.04)
        }
    }

    func makeEngine() -> HealthSyncEngine {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
        return HealthSyncEngine(
            store: SyncStateStore(directory: dir),
            eventLog: SyncEventLog(directory: dir),
            wakeLog: WakeLog(directory: dir))
    }

    func page(_ identifier: String, samples: Int = 1_000) -> MergedPage {
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
            newAnchorData: Data([1]),
            enrichment: HealthSyncEngine.WorkoutEnrichment(),
            queryDuration: 0,
            drained: false,
            rawCount: samples,
            dropped: 0)
    }

    @Test func packsGoUpTogetherButNeverMoreThanTheConcurrencyLimit() async {
        let engine = makeEngine()
        let transport = RecordingTransport()
        let config = await engine.store.configuration
        let packs = (0..<10).map { [page("t\($0)")] }

        let acked = await engine.uploadPacks(
            packs, reason: .backfill, transport: transport, config: config)

        #expect(acked == Array(repeating: true, count: 10))
        let peak = await transport.peak
        #expect(peak > 1)
        #expect(peak <= max(1, config.maxConcurrentTypes))
        #expect(Set(await transport.uploaded) == Set((0..<10).map { "t\($0)" }))
    }

    @Test func aFailedPackMovesNoAnchorAndTheOthersStillLand() async {
        let engine = makeEngine()
        let transport = RecordingTransport(failing: "bad")
        let config = await engine.store.configuration
        let packs = [[page("a")], [page("bad"), page("bad-too", samples: 10)], [page("c")]]

        let acked = await engine.uploadPacks(
            packs, reason: .backfill, transport: transport, config: config)

        #expect(acked == [true, false, true])
        for id in ["a", "c"] {
            let state = await engine.store.state(for: id)
            #expect(state.anchorData == Data([1]))
            #expect(state.totalBatchesUploaded == 1)
        }
        // Both types that rode in the failed pack stay where they were, the
        // one that did not trip the failure included.
        for id in ["bad", "bad-too"] {
            let state = await engine.store.state(for: id)
            #expect(state.anchorData == nil)
            #expect(state.totalSamplesExported == 0)
            #expect(state.lastError != nil)
        }
    }
}

/// An observer wake stays while another run holds its types, so iOS does not
/// suspend the app with that run half done — but only for so long.
@Suite struct ObserverWaitTests {
    func makeEngine() -> HealthSyncEngine {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
        return HealthSyncEngine(
            store: SyncStateStore(directory: dir),
            eventLog: SyncEventLog(directory: dir),
            wakeLog: WakeLog(directory: dir))
    }

    @Test func returnsAtOnceWhenNothingIsHeld() async {
        let engine = makeEngine()
        let start = ContinuousClock.now
        await engine.waitForRelease(of: ["a"], upTo: .seconds(5))
        #expect(ContinuousClock.now - start < .seconds(1))
    }

    @Test func returnsSoonAfterTheHolderLetsGo() async {
        let engine = makeEngine()
        _ = await engine.claimTypes(["a"])
        let holder = Task {
            try? await Task.sleep(for: .milliseconds(300))
            await engine.releaseForTesting("a")
        }
        let start = ContinuousClock.now
        await engine.waitForRelease(of: ["a"], upTo: .seconds(10))
        let waited = ContinuousClock.now - start
        await holder.value
        #expect(waited >= .milliseconds(250))
        #expect(waited < .seconds(3))
    }

    @Test func givesUpAtTheLimit() async {
        let engine = makeEngine()
        _ = await engine.claimTypes(["a"])
        let start = ContinuousClock.now
        await engine.waitForRelease(of: ["a"], upTo: .milliseconds(600))
        let waited = ContinuousClock.now - start
        #expect(waited >= .milliseconds(600))
        #expect(waited < .seconds(3))
        #expect(await engine.isSyncing("a"))
    }

    @Test func stopsWaitingWhenCancelled() async {
        let engine = makeEngine()
        _ = await engine.claimTypes(["a"])
        let start = ContinuousClock.now
        let wait = Task { await engine.waitForRelease(of: ["a"], upTo: .seconds(30)) }
        try? await Task.sleep(for: .milliseconds(100))
        wait.cancel()
        await wait.value
        #expect(ContinuousClock.now - start < .seconds(3))
    }
}

extension HealthSyncEngine {
    func releaseForTesting(_ key: String) { activeSyncs.remove(key) }
}
