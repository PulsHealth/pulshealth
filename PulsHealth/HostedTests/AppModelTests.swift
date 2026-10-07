import Foundation
import XCTest
import PulsHealthSync
@testable import PulsHealth

/// `AppModel`'s state machine: whether the first-run flow shows, what its
/// Health page holds back, what reaches the engine and when (Apply), and
/// where an incoming pairing link waits. CLAUDE.md, "First run only, it
/// applies nothing until the last page, and its Health page cannot be
/// skipped".
///
/// Each model gets an engine over a temporary directory, a defaults suite
/// of its own, a scheduler whose identifiers iOS refuses, and
/// `FakeHealthAccess` for the permission sheets — so nothing here touches
/// the test host's own model, and no sheet ever comes up. Waits poll for a
/// condition and assert order, never elapsed time.
@MainActor
final class AppModelTests: XCTestCase {
    /// HealthKit's permission state for the types a test asks about: every
    /// type starts undetermined, and a request determines what it asked for —
    /// except the types the sheet leaves off (`unlisted`, iOS 26's blood
    /// pressure) or all of them when the answer is iOS 27's Don't Allow on the
    /// history page.
    actor FakeHealthAccess: HealthAccessRequesting {
        private(set) var determined: Set<String> = []
        private(set) var requests: [[String]] = []
        private(set) var medicationRequests = 0
        var answer: HealthAccessRequestOutcome = .answered
        var unlisted: Set<String> = []

        func set(answer: HealthAccessRequestOutcome) { self.answer = answer }
        func set(unlisted: Set<String>) { self.unlisted = unlisted }

        func authorizationNeeded(for identifiers: [String]) -> Bool {
            !Set(identifiers).isSubset(of: determined)
        }

        func requestAuthorization(for identifiers: [String]) -> HealthAccessRequestOutcome {
            requests.append(identifiers)
            if answer == .answered { determined.formUnion(Set(identifiers).subtracting(unlisted)) }
            return answer
        }

        func requestMedicationAuthorization() { medicationRequests += 1 }
    }

    private let user = "5ea4d000-0000-4000-8000-0000000000aa"
    private let mine = URL(string: "https://mine.example.test")!
    private let steps = "HKQuantityTypeIdentifierStepCount"
    private let heartRate = "HKQuantityTypeIdentifierHeartRate"

    private var cleanups: [() async -> Void] = []

    override func tearDown() async throws {
        for cleanup in cleanups.reversed() { await cleanup() }
        cleanups = []
        try await super.tearDown()
    }

    private struct Harness {
        let model: AppModel
        let engine: HealthSyncEngine
        let defaults: UserDefaults
        let access: FakeHealthAccess
    }

    /// A model over fresh state. `flags` seeds the durable launch flags;
    /// `stored` is what the state file holds before launch; `unreadable`
    /// makes the state file exist but fail to read (a prewarm before first
    /// unlock).
    private func makeModel(
        flags: [String: Bool] = [:],
        stored: SyncConfiguration? = nil,
        progress: Bool = false,
        unreadable: Bool = false,
        access: FakeHealthAccess = FakeHealthAccess()
    ) async throws -> Harness {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-appmodel-\(UUID())", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if unreadable {
            // A directory where the file should be: exists, cannot be read.
            try FileManager.default.createDirectory(
                at: dir.appendingPathComponent("sync-state.json"), withIntermediateDirectories: true)
        } else if stored != nil || progress {
            let previous = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
            if let stored { await previous.setConfiguration(stored) }
            if progress {
                await previous.update(steps) { $0.totalSamplesExported = 10 }
            }
            await previous.persistNow()
        }
        let tokens = InMemoryTokenStore(token: stored?.authToken)
        let engine = HealthSyncEngine(
            store: SyncStateStore(directory: dir, tokenStore: tokens),
            eventLog: SyncEventLog(directory: dir),
            wakeLog: WakeLog(directory: dir))
        let suite = "AppModelTests-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        for (key, value) in flags { defaults.set(value, forKey: key) }
        let model = AppModel(
            engine: engine,
            scheduler: BackgroundSyncScheduler(
                engine: engine,
                catchupTaskIdentifier: "org.example.appmodeltests.catchup",
                backfillTaskIdentifier: "org.example.appmodeltests.backfill"),
            defaults: defaults,
            healthAccess: access)
        cleanups.append {
            await engine.stopObserving()
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: dir)
        }
        return Harness(model: model, engine: engine, defaults: defaults, access: access)
    }

    /// Polls until `condition` holds; bounded by iterations so a broken build
    /// fails rather than hangs.
    private func eventually(_ condition: () async -> Bool) async -> Bool {
        for _ in 0..<6_000 {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return await condition()
    }

    private func pairingLink(host: String) -> URL {
        URL(string: "puls://pair?url=https://\(host)&token=t-\(host)&user=\(user)")!
    }

    private func payload(host: String) -> PairingPayload {
        PairingPayload(serverURL: URL(string: "https://\(host)")!, token: "t-\(host)", userID: user)
    }

    // MARK: - Whether the first-run flow shows

    /// Decided in `init`, before anything is read, from the two durable flags.
    func testInitDecidesFromTheDurableFlagsAlone() async throws {
        let fresh = try await makeModel()
        XCTAssertTrue(fresh.model.showsOnboarding, "a fresh install opens straight into the flow")

        let finished = try await makeModel(flags: ["onboardingCompleted": true])
        XCTAssertFalse(finished.model.showsOnboarding)

        // Any install that has been through Apply, the flow's own included.
        let applied = try await makeModel(flags: ["authorizationRequested": true])
        XCTAssertFalse(applied.model.showsOnboarding)
        await applied.model.start()
        XCTAssertFalse(applied.model.showsOnboarding, "a prior Apply never sees the flow")
    }

    /// `startBody` corrects `init`'s guess from the stored configuration: an
    /// install with a database or with types is configured, whatever its
    /// flags say (an upgrade from before the flow, a lost UserDefaults).
    func testStartCorrectsTheGuessForAConfiguredInstall() async throws {
        let withDatabase = try await makeModel(stored: SyncConfiguration(serverURL: mine, authToken: "own"))
        XCTAssertTrue(withDatabase.model.showsOnboarding, "init cannot know yet")
        await withDatabase.model.start()
        XCTAssertFalse(withDatabase.model.showsOnboarding)
        XCTAssertTrue(withDatabase.defaults.bool(forKey: "onboardingCompleted"), "and it stays down")

        let withTypes = try await makeModel(stored: SyncConfiguration(enabledTypes: [steps]))
        await withTypes.model.start()
        XCTAssertFalse(withTypes.model.showsOnboarding)
        XCTAssertTrue(withTypes.defaults.bool(forKey: "onboardingCompleted"))
    }

    /// A fresh install keeps the flow, with the starter set in the draft —
    /// the draft only: nothing reaches the engine before the last page.
    func testAFreshInstallKeepsTheFlowWithTheStarterSetStagedOnly() async throws {
        let h = try await makeModel()
        await h.model.start()

        XCTAssertTrue(h.model.showsOnboarding)
        XCTAssertEqual(h.model.config.enabledTypes, TypePresets.common)
        let applied = await h.engine.store.configuration
        XCTAssertTrue(applied.enabledTypes.isEmpty, "preselected, not applied")
        XCTAssertTrue(h.model.appliedConfig.enabledTypes.isEmpty)
        XCTAssertFalse(h.defaults.bool(forKey: "onboardingCompleted"))
    }

    /// A state file that exists but cannot be read hides a real setup behind
    /// an empty one: the flow stays down without recording that it ran, and
    /// Apply is refused rather than taking a setup that would vanish.
    func testAnUnreadableStateFileKeepsTheFlowDownAndRefusesApply() async throws {
        let h = try await makeModel(unreadable: true)
        XCTAssertTrue(h.model.showsOnboarding)
        await h.model.start()

        XCTAssertTrue(h.model.stateFileUnreadable)
        XCTAssertFalse(h.model.showsOnboarding)
        XCTAssertFalse(h.defaults.bool(forKey: "onboardingCompleted"), "this launch cannot know")

        h.model.config.enabledTypes = [steps]
        let applied = await h.model.applyConfiguration(syncNewTypes: true)
        XCTAssertFalse(applied)
        XCTAssertNotNil(h.model.lastErrorMessage)
        XCTAssertTrue(h.model.appliedConfig.enabledTypes.isEmpty)
        let requests = await h.access.requests
        XCTAssertTrue(requests.isEmpty, "a refused Apply asks iOS nothing")
    }

    // MARK: - The Health page (App Review 5.1.1(iv))

    /// Until iOS has been asked, the pager holds pages 1 and 2 only: there is
    /// no page past the pre-permission screen to swipe to.
    func testThePagerHoldsOnlyTheFirstTwoPagesUntilHealthIsSettled() {
        XCTAssertEqual(OnboardingView.pages(healthSettled: false), [.welcome, .health])
        XCTAssertEqual(OnboardingView.pages(healthSettled: true), OnboardingView.Page.allCases)
    }

    /// Asked before `start()` has run — the flow's `.task` can be first — the
    /// answer still waits for the stored state and the preselected starter
    /// set; an empty draft would read as nothing to ask and open pages 3–4.
    func testHealthAccessPendingWaitsForTheStarterSet() async throws {
        let h = try await makeModel()
        let pending = await h.model.onboardingHealthAccessPending()
        XCTAssertTrue(pending)
        XCTAssertEqual(h.model.config.enabledTypes, TypePresets.common)
    }

    /// Continue asks iOS for the draft's types, applies nothing, and once
    /// answered the page is settled.
    func testAnsweringTheSheetSettlesThePageWithoutApplying() async throws {
        let h = try await makeModel()
        await h.model.start()
        let before = await h.model.onboardingHealthAccessPending()
        XCTAssertTrue(before)

        await h.model.requestOnboardingHealthAccess()

        let requests = await h.access.requests
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(Set(requests.first ?? []), TypePresets.common)
        let after = await h.model.onboardingHealthAccessPending()
        XCTAssertFalse(after)
        XCTAssertTrue(h.model.showsOnboarding)
        let applied = await h.engine.store.configuration
        XCTAssertTrue(applied.enabledTypes.isEmpty, "the Health page applies nothing")
    }

    /// Any answer moves on: iOS 27's Don't Allow on the history page leaves
    /// the types undetermined, but the person has answered.
    func testDontAllowOnTheHistoryPageAlsoSettlesThePage() async throws {
        let access = FakeHealthAccess()
        await access.set(answer: .declined)
        let h = try await makeModel(access: access)
        await h.model.start()

        await h.model.requestOnboardingHealthAccess()

        let pending = await h.model.onboardingHealthAccessPending()
        XCTAssertFalse(pending)
        XCTAssertTrue(h.model.authorizationRequested)
    }

    /// A type iOS leaves off the sheet stays undetermined forever. It must
    /// not hold the flow on page 2: once asked, what is left is only those.
    func testTypesTheSheetLeavesOffDoNotHoldThePage() async throws {
        let access = FakeHealthAccess()
        await access.set(unlisted: [steps])
        let h = try await makeModel(access: access)
        await h.model.start()

        await h.model.requestOnboardingHealthAccess()

        let pending = await h.model.onboardingHealthAccessPending()
        XCTAssertFalse(pending)
        XCTAssertNotNil(h.model.authorizationHint, "and the person is told where to grant it")
    }

    // MARK: - Start Exploring

    /// The last page's button is the flow's only Apply: the starter set
    /// reaches the engine, the flag is durable and the cover comes down.
    func testFinishingAppliesTheDraft() async throws {
        let h = try await makeModel()
        await h.model.start()

        await h.model.finishOnboarding()

        let applied = await h.engine.store.configuration
        XCTAssertEqual(applied.enabledTypes, TypePresets.common)
        XCTAssertEqual(h.model.appliedConfig.enabledTypes, TypePresets.common)
        XCTAssertFalse(h.model.hasPendingChanges)
        XCTAssertFalse(h.model.showsOnboarding)
        XCTAssertTrue(h.defaults.bool(forKey: "onboardingCompleted"))
        XCTAssertTrue(h.defaults.bool(forKey: "authorizationRequested"))
    }

    /// Start Exploring applies with `syncNewTypes: true`: with a database in
    /// the draft (a replay on a paired install), the newly enabled types
    /// start backfilling at once. The same draft applied without it (as a
    /// Settings-only save does) starts nothing.
    func testFinishingStartsTheBackfillThatAPlainApplyDoesNot() async throws {
        // Nothing listens here: the backfill fails fast, which is fine — that
        // it starts is what is under test.
        let dead = URL(string: "http://127.0.0.1:9")!

        let plain = try await makeModel(flags: ["onboardingCompleted": true])
        await plain.model.start()
        plain.model.config.serverURL = dead
        plain.model.config.authToken = "token"
        plain.model.config.enabledTypes = [steps]
        let appliedPlainly = await plain.model.applyConfiguration()
        XCTAssertTrue(appliedPlainly)
        XCTAssertFalse(plain.model.backfillActive)

        let h = try await makeModel()
        await h.model.start()
        h.model.config.serverURL = dead
        h.model.config.authToken = "token"

        await h.model.finishOnboarding()

        XCTAssertTrue(h.model.backfillActive, "Start Exploring backfills what it enabled")
        // In the app (iOS refuses this scheduler's continued-processing
        // identifier, so not as that task). Let it end before the engine's
        // directory goes.
        let settled = await eventually { !h.model.isSyncingAll }
        XCTAssertTrue(settled)
        let wakes = await h.engine.wakeLog.recent(limit: 50)
        XCTAssertTrue(
            h.model.continuedBackfillPending
                || wakes.contains { $0.detail == "apply: backfill newly enabled types" })
    }

    // MARK: - Apply gating

    /// Edits on the Sync tab's pickers are staged in `config` and reach the engine only on
    /// Apply.
    func testStagedEditsReachTheEngineOnlyOnApply() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()

        h.model.config.enabledTypes.insert(steps)
        XCTAssertTrue(h.model.hasPendingChanges)
        var applied = await h.engine.store.configuration
        XCTAssertFalse(applied.enabledTypes.contains(steps), "staged, not applied")
        let requests = await h.access.requests
        XCTAssertTrue(requests.isEmpty, "and not asked about yet")

        await h.model.applyChanges()

        applied = await h.engine.store.configuration
        XCTAssertTrue(applied.enabledTypes.contains(steps))
        XCTAssertFalse(h.model.hasPendingChanges)
        let asked = await h.access.requests
        XCTAssertEqual(asked, [[steps]], "Apply is where Health access is asked for")

        h.model.config.enabledTypes = []
        h.model.discardChanges()
        XCTAssertEqual(h.model.config.enabledTypes, [steps])
    }

    /// Aggregates chosen in Sync's pickers wait for Apply like raw types, and
    /// the Apply bar counts types, not configs: Match Raw Samples gives each
    /// raw measurement its daily default and nothing else.
    func testAggregateEditsAreStagedAndCountedByType() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        let sleep = "HKCategoryTypeIdentifierSleepAnalysis"

        h.model.config.enabledTypes = [steps, heartRate, sleep]
        h.model.editAggregates(.sync) { $0.addDailyDefaults(for: h.model.rawTypes(.sync)) }
        XCTAssertEqual(h.model.pendingChangesSummary, "3 raw types · 2 aggregated types")
        let staged = h.model.config.aggregates
        XCTAssertEqual(Set(staged.map(\.typeIdentifier)), [steps, heartRate], "sleep cannot be aggregated")
        XCTAssertTrue(staged.allSatisfy(\.isDailyDefault))
        var applied = await h.engine.store.configuration
        XCTAssertTrue(applied.aggregates.isEmpty, "staged, not applied")

        await h.model.applyChanges()
        applied = await h.engine.store.configuration
        XCTAssertEqual(applied.aggregates, staged)
        XCTAssertFalse(h.model.hasPendingChanges)

        let daily = try XCTUnwrap(staged.first { $0.typeIdentifier == heartRate })
        h.model.editAggregates(.sync) {
            $0.add(AggregateConfig(typeIdentifier: heartRate, function: .max))
            $0.update(daily.with(interval: (1, .hour)))
        }
        XCTAssertEqual(h.model.pendingChangesSummary, "1 aggregated type")
        h.model.discardChanges()
        XCTAssertEqual(h.model.config.aggregates, staged)
    }

    /// Changing what an applied aggregate computes keeps its id, so Apply
    /// resets its watermark and the next sync computes it from the start;
    /// until then its status is "Waiting for Apply".
    func testChangingAnAggregateRecomputesItAfterApply() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.editAggregates(.sync) { $0.addType(steps) }
        await h.model.applyChanges()
        let daily = try XCTUnwrap(h.model.config.aggregates.first)
        await h.engine.store.recordAggregateUpload(
            configID: daily.id, newComputedThrough: Date(), buckets: 30, bytes: 1_000)
        await h.model.refresh()
        XCTAssertTrue(h.model.aggregateHasSentValues(daily))
        if case .waitingForApply = h.model.aggregateStatus(daily) { XCTFail("applied, not waiting") }

        let weekly = daily.with(interval: (1, .week))
        h.model.editAggregates(.sync) { $0.update(weekly) }
        XCTAssertEqual(h.model.aggregateStatus(weekly), .waitingForApply)
        XCTAssertFalse(h.model.aggregateHasSentValues(weekly), "the new one has sent nothing")

        await h.model.applyChanges()
        let state = await h.engine.store.aggregateState(for: daily.id)
        XCTAssertNil(state.computedThrough, "a different aggregate starts over")
    }

    /// The export's aggregates are its own: editing them stages nothing for
    /// Sync, and Sync's edits do not reach the export draft.
    func testExportAggregatesNeverTouchSync() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.editAggregates(.export) { $0.addType(steps) }
        XCTAssertEqual(h.model.export.draft.aggregates.map(\.typeIdentifier), [steps])
        XCTAssertTrue(h.model.config.aggregates.isEmpty)
        XCTAssertFalse(h.model.hasPendingChanges)

        h.model.editAggregates(.sync) { $0.addType(heartRate) }
        XCTAssertEqual(h.model.export.draft.aggregates.map(\.typeIdentifier), [steps])
    }

    /// A draft pointing at another database than the stored progress belongs
    /// to applies nothing until the person chooses; cancelling leaves the
    /// engine where it was.
    func testADifferentDatabaseWaitsForTheChoice() async throws {
        var stored = SyncConfiguration(enabledTypes: [steps], serverURL: mine, authToken: "own")
        stored.userID = user
        let h = try await makeModel(
            flags: ["onboardingCompleted": true, "authorizationRequested": true],
            stored: stored, progress: true)
        await h.model.start()
        XCTAssertNil(h.model.pendingServerChange)

        h.model.config.serverURL = URL(string: "https://other.example.test")!
        let applied = await h.model.applyConfiguration(syncNewTypes: true)

        XCTAssertFalse(applied)
        XCTAssertNotNil(h.model.pendingServerChange)
        var engineConfig = await h.engine.store.configuration
        XCTAssertEqual(engineConfig.serverURL, mine)
        XCTAssertEqual(h.model.appliedConfig.serverURL, mine)

        h.model.cancelServerChange()
        XCTAssertNil(h.model.pendingServerChange)
        engineConfig = await h.engine.store.configuration
        XCTAssertEqual(engineConfig.serverURL, mine)
    }

    // MARK: - Pairing links

    /// First one wins: a second link while the first awaits an answer is
    /// dropped, and Continue delivers only the payload the prompt named.
    /// Accepting fills nothing; during the flow the payload waits, and once
    /// the flow is done it is handed to Sync → Database exactly once.
    func testAPairingLinkDuringTheFlowWaitsForItAndTheFirstLinkWins() async throws {
        let h = try await makeModel()
        await h.model.start()
        XCTAssertTrue(h.model.showsOnboarding)
        let first = payload(host: "first.example.test")
        let second = payload(host: "second.example.test")

        h.model.handleIncomingURL(pairingLink(host: "first.example.test"))
        let prompted = await eventually { h.model.pairingLinkPrompt == .confirm(first) }
        XCTAssertTrue(prompted)

        h.model.handleIncomingURL(pairingLink(host: "second.example.test"))
        let ignored = await eventually {
            await h.engine.eventLog.recent(limit: 100)
                .contains { $0.message.hasPrefix("Pairing link ignored") }
        }
        XCTAssertTrue(ignored)
        XCTAssertEqual(h.model.pairingLinkPrompt, .confirm(first))

        h.model.confirmPairingLink(second)
        XCTAssertEqual(h.model.pairingLinkPrompt, .confirm(first), "not the payload on screen")
        XCTAssertNil(h.model.confirmedPairing)

        h.model.confirmPairingLink(first)
        XCTAssertNil(h.model.pairingLinkPrompt)
        XCTAssertEqual(h.model.confirmedPairing, first)
        XCTAssertFalse(h.model.pairingAwaitsSyncTab, "the flow is still up")
        XCTAssertNil(h.model.config.serverURL, "a link fills nothing by itself")
        let engineConfig = await h.engine.store.configuration
        XCTAssertNil(engineConfig.serverURL)

        await h.model.finishOnboarding()

        XCTAssertTrue(h.model.pairingAwaitsSyncTab)
        XCTAssertEqual(h.model.takeConfirmedPairing(), first)
        XCTAssertNil(h.model.takeConfirmedPairing())
        XCTAssertFalse(h.model.pairingAwaitsSyncTab)
    }

    /// A link can be what launches the app. Its prompt waits for `start()`,
    /// which may take the flow down — and then accepting leads straight to
    /// Sync → Database.
    func testALaunchLinkWaitsForStartBeforeDecidingWhereItGoes() async throws {
        let h = try await makeModel(stored: SyncConfiguration(serverURL: mine, authToken: "own"))
        XCTAssertTrue(h.model.showsOnboarding, "init's guess")
        let link = payload(host: "next.example.test")

        h.model.handleIncomingURL(pairingLink(host: "next.example.test"))
        let prompted = await eventually { h.model.pairingLinkPrompt == .confirm(link) }
        XCTAssertTrue(prompted)
        XCTAssertFalse(h.model.showsOnboarding, "corrected before the prompt came up")

        h.model.confirmPairingLink(link)
        XCTAssertTrue(h.model.pairingAwaitsSyncTab)
    }

    func testAnUnusableLinkIsRejectedAndOtherSchemesIgnored() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()

        h.model.handleIncomingURL(URL(string: "https://example.test/pair?token=t")!)
        h.model.handleIncomingURL(URL(string: "puls://pair?url=https://x.example.test&token=t&user=nope")!)

        let rejected = await eventually {
            if case .rejected = h.model.pairingLinkPrompt { return true }
            return false
        }
        XCTAssertTrue(rejected)
        h.model.dismissPairingLink()
        XCTAssertNil(h.model.pairingLinkPrompt)
        XCTAssertNil(h.model.confirmedPairing)
    }
}
