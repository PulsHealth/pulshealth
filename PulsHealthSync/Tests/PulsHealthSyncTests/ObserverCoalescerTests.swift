import Foundation
import Testing
@testable import PulsHealthSync

/// HealthKit fires an observer query's handler in bursts and stops waking the
/// app after three deliveries it never acknowledged. The coalescer
/// (`enqueueObserverUpdate` → `flushObserverUpdates`) turns a burst into one
/// wake, and every delivery it collected has to be acknowledged exactly once:
/// after the wake's work, from the expiration handler if background time runs
/// out first, or by `stopObserving` if the burst never flushes.
///
/// Every assertion here is about order — what has or has not happened by the
/// time something else has — never about elapsed time: the CI runners stretch
/// sleeps by tens of seconds under load. The waits are bounded only so a
/// broken build fails instead of hanging.
@Suite struct ObserverCoalescerTests {
    /// One HealthKit completion handler, counting how often it was called.
    final class Delivery: @unchecked Sendable {
        private let lock = NSLock()
        private var calls = 0
        var count: Int { lock.withLock { calls } }
        var completion: HealthSyncEngine.ObserverCompletion {
            HealthSyncEngine.ObserverCompletion { [self] in lock.withLock { calls += 1 } }
        }
    }

    /// `BackgroundExecution.run` without UIKit: the work runs in a task of its
    /// own, and `expire()` does what iOS's expiration handler does — the
    /// caller's `onExpiration`, then cancellation.
    final class FakeBackgroundTime: @unchecked Sendable {
        private let lock = NSLock()
        private var expiration: (@Sendable () -> Void)?
        private var work: Task<Void, Never>?
        private var expired = false
        private var runs = 0

        var started: Int { lock.withLock { runs } }

        var runner: BackgroundExecutionRunner {
            { [self] _, onExpiration, body in
                let task = Task { await body() }
                lock.withLock {
                    expiration = onExpiration
                    work = task
                    runs += 1
                }
                await task.value
                return lock.withLock { !expired }
            }
        }

        func expire() {
            let (handler, task) = lock.withLock { () -> ((@Sendable () -> Void)?, Task<Void, Never>?) in
                expired = true
                return (expiration, work)
            }
            handler?()
            task?.cancel()
        }
    }

    func makeEngine(
        window: TimeInterval, enabled: Set<String> = [], time: FakeBackgroundTime = FakeBackgroundTime()
    ) async -> HealthSyncEngine {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
        let engine = HealthSyncEngine(
            store: SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore()),
            eventLog: SyncEventLog(directory: dir),
            wakeLog: WakeLog(directory: dir))
        var config = SyncConfiguration(enabledTypes: enabled)
        config.observerCoalesceWindow = window
        await engine.configure(config)
        await engine.useObserverTestSeams(runner: time.runner)
        return engine
    }

    func observerWakes(_ engine: HealthSyncEngine) async -> [WakeRecord] {
        await engine.wakeLog.recent(limit: 100).filter { $0.trigger == .observer }
    }

    /// Polls until `condition` holds. Bounded by iterations, not by a clock
    /// assertion: running out is a failure of the condition, not of speed.
    func eventually(_ condition: () async -> Bool) async -> Bool {
        for _ in 0..<6_000 {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return await condition()
    }

    // MARK: - Coalescing

    @Test func aBurstRunsAsOneWakeOverTheUnionOfItsTypes() async {
        let engine = await makeEngine(window: 0.2)
        let deliveries = (0..<3).map { _ in Delivery() }

        await engine.enqueueObserverUpdate(types: ["b", "a"], completion: deliveries[0].completion)
        await engine.enqueueObserverUpdate(types: ["b"], completion: deliveries[1].completion)
        await engine.enqueueObserverUpdate(types: ["c"], completion: deliveries[2].completion)

        // Acknowledged once the wake is over, every delivery exactly once.
        #expect(await eventually { deliveries.allSatisfy { $0.count == 1 } })
        let wakes = await observerWakes(engine)
        #expect(wakes.count == 1)
        #expect(wakes.first?.outcome == .completed)
        #expect(wakes.first?.detail == "3 type(s): a, b, c — coalesced from 3 deliveries")
        for delivery in deliveries { #expect(delivery.count == 1) }
    }

    @Test func aDeliveryAfterTheFlushStartsTheNextBurst() async {
        let engine = await makeEngine(window: 0.05)
        let first = Delivery(), second = Delivery()

        await engine.enqueueObserverUpdate(types: ["a"], completion: first.completion)
        #expect(await eventually { first.count == 1 })
        await engine.enqueueObserverUpdate(types: ["b"], completion: second.completion)
        #expect(await eventually { second.count == 1 })

        let details = await observerWakes(engine).compactMap(\.detail).sorted()
        #expect(details == ["1 type(s): a", "1 type(s): b"])
        #expect(first.count == 1, "the first burst's handler is not called again")
    }

    @Test func aZeroWindowRunsEachDeliveryOnItsOwn() async {
        let engine = await makeEngine(window: 0)
        let deliveries = (0..<3).map { _ in Delivery() }
        for (index, delivery) in deliveries.enumerated() {
            await engine.enqueueObserverUpdate(types: ["t\(index)"], completion: delivery.completion)
            #expect(await eventually { delivery.count == 1 })
        }
        #expect(await observerWakes(engine).count == 3)
    }

    /// The deadline is the burst's *first* callback's. A timer each callback
    /// restarted would let an unbroken stream postpone the work for as long
    /// as the stream lasts; here the wake has to run while it still flows.
    @Test func anUnbrokenStreamOfCallbacksCannotPostponeTheFlush() async {
        let engine = await makeEngine(window: 0.2)
        var sent = 0
        var flushedMidStream = false
        while sent < 20_000 {
            await engine.enqueueObserverUpdate(types: ["a"], completion: Delivery().completion)
            sent += 1
            if await !observerWakes(engine).isEmpty {
                flushedMidStream = true
                break
            }
            try? await Task.sleep(for: .milliseconds(5))
        }
        #expect(flushedMidStream, "no wake ran while \(sent) callbacks kept arriving")
    }

    // MARK: - Acknowledgement

    /// Acknowledged after the wake's work, not before it: iOS may suspend the
    /// app as soon as HealthKit has its answer. And a wake whose types another
    /// run holds stays for that run (`waitForRelease`) instead of answering
    /// at once.
    @Test func aWakeOnAHeldTypeWaitsForItsReleaseBeforeAcknowledging() async {
        let engine = await makeEngine(window: 0, enabled: ["a"])
        #expect(await engine.claimTypes(["a"]) == ["a"])
        let delivery = Delivery()

        await engine.enqueueObserverUpdate(types: ["a"], completion: delivery.completion)

        // The wake has started, found "a" held and marked it for the holder
        // to repeat — and is still waiting, unacknowledged.
        #expect(await eventually {
            let running = await observerWakes(engine).first?.outcome == .running
            let marked = await engine.pendingResync.contains("a")
            return running && marked
        })
        #expect(delivery.count == 0)

        await engine.releaseForTesting("a")

        #expect(await eventually { delivery.count == 1 })
        #expect(await eventually { await observerWakes(engine).first?.outcome == .completed })
        #expect(delivery.count == 1)
    }

    /// Background time running out while the wake still waits: HealthKit is
    /// answered from the expiration handler itself — the cancelled wake may be
    /// suspended before it unwinds to its `defer` — and the late `defer` does
    /// not answer a second time.
    @Test func expiryAcknowledgesAtOnceAndOnlyOnce() async {
        let time = FakeBackgroundTime()
        let engine = await makeEngine(window: 0, enabled: ["a"], time: time)
        _ = await engine.claimTypes(["a"])
        let deliveries = [Delivery(), Delivery()]

        // Two deliveries in one burst.
        await engine.useObserverWindow(60)
        await engine.enqueueObserverUpdate(types: ["a"], completion: deliveries[0].completion)
        await engine.enqueueObserverUpdate(types: ["a"], completion: deliveries[1].completion)
        // Flushed by hand rather than by the armed 60 s timer, which then
        // finds nothing to run. Not awaited: the wake stays for "a".
        let flush = Task { await engine.flushObserverUpdatesForTesting() }

        #expect(await eventually {
            let marked = await engine.pendingResync.contains("a")
            return time.started == 1 && marked
        })
        #expect(deliveries.allSatisfy { $0.count == 0 })

        time.expire()

        // Synchronously, from the handler: the wake has not finished yet, and
        // the type is still held.
        #expect(deliveries.allSatisfy { $0.count == 1 })
        #expect(await engine.isSyncing("a"))

        await flush.value
        #expect(await observerWakes(engine).first?.outcome == .expired)
        #expect(deliveries.allSatisfy { $0.count == 1 })
    }

    /// `stopObserving` with a burst still gathering releases every handler
    /// itself, and the cancelled flush never runs a wake.
    @Test func stoppingObservationReleasesAPendingBurst() async {
        let time = FakeBackgroundTime()
        let engine = await makeEngine(window: 60, time: time)
        let deliveries = [Delivery(), Delivery()]
        await engine.enqueueObserverUpdate(types: ["a"], completion: deliveries[0].completion)
        await engine.enqueueObserverUpdate(types: ["b"], completion: deliveries[1].completion)
        #expect(deliveries.allSatisfy { $0.count == 0 })

        await engine.stopObserving()

        #expect(deliveries.allSatisfy { $0.count == 1 })
        // A later burst is unaffected by the cancelled one.
        await engine.useObserverWindow(0)
        let next = Delivery()
        await engine.enqueueObserverUpdate(types: ["c"], completion: next.completion)
        #expect(await eventually { next.count == 1 })
        #expect(time.started == 1, "only the later burst ran a wake")
        #expect(deliveries.allSatisfy { $0.count == 1 })
        #expect(await observerWakes(engine).compactMap(\.detail) == ["1 type(s): c"])
    }

    /// A delivery reporting no type still holds HealthKit's handler, and the
    /// flush answers it without running a wake.
    @Test func aBurstWithNoTypesIsStillAcknowledged() async {
        let time = FakeBackgroundTime()
        let engine = await makeEngine(window: 0, time: time)
        let delivery = Delivery()
        await engine.enqueueObserverUpdate(types: [], completion: delivery.completion)
        #expect(await eventually { delivery.count == 1 })
        #expect(time.started == 0)
        #expect(await observerWakes(engine).isEmpty)
    }

    @Test func aWakeWaitsForHeldTypesForTwentyFiveSecondsAtMost() {
        // Inside the half-minute iOS grants on request, with room to finish.
        #expect(HealthSyncEngine.observerWaitLimit == .seconds(25))
    }

    @Test func aLockedDeviceIsAcknowledgedAndRecordedAsSkipped() async {
        let engine = await makeEngine(window: 0)
        await engine.useProtectedData(false)
        let delivery = Delivery()
        await engine.enqueueObserverUpdate(types: ["a"], completion: delivery.completion)
        #expect(await eventually { delivery.count == 1 })
        #expect(await eventually { await observerWakes(engine).first?.outcome == .skippedLocked })
    }
}

extension HealthSyncEngine {
    /// No UIKit in the package's test runner: background time is the given
    /// stand-in, and protected data is available unless a test says not.
    func useObserverTestSeams(runner: @escaping BackgroundExecutionRunner) {
        backgroundExecution = runner
        protectedDataOverride = true
    }

    func useProtectedData(_ available: Bool) { protectedDataOverride = available }

    /// The window a running engine caches from its configuration.
    func useObserverWindow(_ seconds: TimeInterval) async {
        var config = await store.configuration
        config.observerCoalesceWindow = seconds
        await configure(config)
    }

    func flushObserverUpdatesForTesting() async { await flushObserverUpdates() }
}
