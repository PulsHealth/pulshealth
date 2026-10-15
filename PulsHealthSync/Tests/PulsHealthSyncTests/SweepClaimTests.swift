import Foundation
import Testing
@testable import PulsHealthSync

/// A type is synced by one run at a time, and the run that holds it is the
/// one that finishes it. What the first sync after pairing depends on is that
/// a backfill takes *all* of its types before anything else can, and that
/// every claim it takes is given back — a type left claimed is a type that
/// never syncs again until the app restarts.
///
/// No server is configured here, so each type's run ends at once ("No
/// transport configured"); the claims are what is under test.
@Suite struct SweepClaimTests {
    func makeEngine() -> HealthSyncEngine {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
        return HealthSyncEngine(
            store: SyncStateStore(directory: dir),
            eventLog: SyncEventLog(directory: dir),
            wakeLog: WakeLog(directory: dir))
    }

    @Test func aTypeAnotherRunHoldsIsLeftToItAndMarkedForAFollowUp() async {
        let engine = makeEngine()
        #expect(await engine.claimTypes(["b"]) == ["b"])

        let claimed = await engine.claimTypes(["a", "b", "c"])

        #expect(claimed == ["a", "c"])
        #expect(await engine.pendingResync == ["b"])
        for id in ["a", "b", "c"] { #expect(await engine.isSyncing(id)) }
    }

    @Test func aSweepGivesBackEveryClaimItTook() async {
        let engine = makeEngine()
        let ids = ["a", "b", "c", "d", "e", "f"]
        let claimed = await engine.claimTypes(ids)

        await engine.sweep(claimed, reason: .backfill)

        for id in ids { #expect(!(await engine.isSyncing(id))) }
    }

    @Test func aCancelledSweepStillGivesBackEveryClaim() async {
        let engine = makeEngine()
        let ids = (0..<20).map { "t\($0)" }
        let claimed = await engine.claimTypes(ids)

        let run = Task { await engine.sweep(claimed, reason: .backfill) }
        run.cancel()
        await run.value

        for id in ids { #expect(!(await engine.isSyncing(id))) }
    }

    @Test func syncingABusyTypeDefersToTheRunThatHoldsIt() async {
        let engine = makeEngine()
        _ = await engine.claimTypes(["a"])

        await engine.sync(type: "a", reason: .manual)

        // Still held by the first claim, and queued for it to repeat.
        #expect(await engine.isSyncing("a"))
        #expect(await engine.pendingResync == ["a"])
    }
}

@Suite struct ReconciliationClaimTests {
    private let identifier = "HKQuantityTypeIdentifierStepCount"

    private actor Gate {
        private var entered = false
        private var arrival: CheckedContinuation<Void, Never>?
        private var release: CheckedContinuation<Void, Never>?
        func pause() async {
            entered = true
            arrival?.resume(); arrival = nil
            await withCheckedContinuation { release = $0 }
        }
        func waitUntilEntered() async {
            if entered { return }
            await withCheckedContinuation { arrival = $0 }
        }
        func finish() { release?.resume(); release = nil }
    }

    private func makeEngine() -> HealthSyncEngine {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-reconciliation-claim-\(UUID())", isDirectory: true)
        return HealthSyncEngine(
            store: SyncStateStore(directory: directory, tokenStore: InMemoryTokenStore()),
            eventLog: SyncEventLog(directory: directory), wakeLog: WakeLog(directory: directory))
    }

    @Test func rawSyncClaimRejectsReconciliationBeforeAnyRead() async throws {
        let engine = makeEngine()
        #expect(await engine.claimTypes([identifier]) == [identifier])
        do {
            _ = try await engine.reconcile(type: identifier)
            Issue.record("Reconciliation must not read while a raw upload holds its type")
        } catch SyncError.typeBusy(let type) {
            #expect(type == identifier)
        }
        #expect(await engine.isSyncing(identifier))
        await engine.sweep([identifier], reason: .backfill)
        #expect(!(await engine.isSyncing(identifier)))
    }

    @Test func reconciliationExcludesUploadsAndDrainsTheirQueuedPass() async throws {
        let engine = makeEngine()
        let gate = Gate()
        let id = identifier
        let reconciliation = Task {
            try await engine.withReconciliationClaim(id) {
                await gate.pause()
                return 42
            }
        }
        await gate.waitUntilEntered()
        // This is the same entry point observer/foreground requests use.
        await engine.sync(type: id, reason: .incremental)
        #expect(await engine.isSyncing(id))
        #expect(await engine.pendingResync.contains(id))
        #expect(!(await engine.configure(SyncConfiguration())))
        do {
            _ = try await engine.reconcile(type: id)
            Issue.record("A second reconciliation must not enter the snapshot")
        } catch SyncError.typeBusy(let type) {
            #expect(type == id)
        }
        await gate.finish()
        #expect(try await reconciliation.value == 42)
        #expect(!(await engine.isSyncing(id)))
        #expect(!(await engine.pendingResync.contains(id)))
        #expect(await engine.configure(SyncConfiguration()))
    }

    @Test func failedReconciliationReleasesItsClaimAndDrainsPendingWork() async throws {
        enum Failure: Error { case expected }
        let engine = makeEngine()
        let id = identifier
        do {
            _ = try await engine.withReconciliationClaim(id) {
                // Model an observer arriving while a read/upload is suspended.
                await engine.sync(type: id)
                throw Failure.expected
            } as Int
            Issue.record("Expected the original failure")
        } catch Failure.expected {}
        #expect(!(await engine.isSyncing(id)))
        #expect(!(await engine.pendingResync.contains(id)))
    }

    @Test func cancelledReconciliationReleasesItsClaimForTheNextWake() async throws {
        let engine = makeEngine()
        let gate = Gate()
        let id = identifier
        let task = Task {
            try await engine.withReconciliationClaim(id) {
                await gate.pause()
                try Task.checkCancellation()
            }
        }
        await gate.waitUntilEntered()
        await engine.sync(type: id)
        task.cancel()
        await gate.finish()
        do { try await task.value; Issue.record("Expected cancellation") }
        catch is CancellationError {}
        #expect(!(await engine.isSyncing(id)))
        // Cancellation does not consume the pending update; a later wake drains it.
        #expect(await engine.pendingResync.contains(id))
        await engine.sync(type: id)
        #expect(!(await engine.isSyncing(id)))
        #expect(!(await engine.pendingResync.contains(id)))
    }
}
