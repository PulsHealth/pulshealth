import Foundation
import XCTest
import SwiftUI
import Security
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
        private(set) var syncedTypes: [String] = []
        var answer: HealthAccessRequestOutcome = .answered
        var unlisted: Set<String> = []
        private var pauseNext = false
        private var pausedRequest: CheckedContinuation<Void, Never>?
        var hasPausedRequest: Bool { pausedRequest != nil }

        func pauseNextRequest() { pauseNext = true }
        func resumeRequest() {
            pausedRequest?.resume()
            pausedRequest = nil
        }

        func set(answer: HealthAccessRequestOutcome) { self.answer = answer }
        func set(unlisted: Set<String>) { self.unlisted = unlisted }

        func authorizationNeeded(for identifiers: [String]) -> Bool {
            !Set(identifiers).isSubset(of: determined)
        }

        func requestAuthorization(for identifiers: [String]) async -> HealthAccessRequestOutcome {
            requests.append(identifiers)
            if pauseNext {
                pauseNext = false
                await withCheckedContinuation { pausedRequest = $0 }
            }
            if answer == .answered { determined.formUnion(Set(identifiers).subtracting(unlisted)) }
            return answer
        }

        func requestMedicationAuthorization() { medicationRequests += 1 }
        func startObserving() {}
        func refreshReadableHistory(force: Bool) -> [String: Date] { [:] }
        func syncTypes(_ identifiers: [String], reason: SyncReason) { syncedTypes += identifiers }
        func syncAggregate(configID: UUID, reason: SyncReason) {}
        func syncActivitySummary(reason: SyncReason) {}
    }

    /// Configuration tests never make a real capability request or acquire an
    /// engine request lease just because Apply refreshes its feature gates.
    private struct NoCapabilities: ServerCapabilitiesReading {
        func serverCapabilities() async throws -> ServerCapabilities {
            throw TransportError.notConfigured
        }
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
        access: FakeHealthAccess = FakeHealthAccess(),
        pro: Bool = true,
        subscriptions: SubscriptionStore? = nil
    ) async throws -> Harness {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-appmodel-\(UUID())", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let tokens = InMemoryTokenStore(token: stored?.authToken)
        if unreadable {
            // A directory where the file should be: exists, cannot be read.
            try FileManager.default.createDirectory(
                at: dir.appendingPathComponent("sync-state.json"), withIntermediateDirectories: true)
        } else if stored != nil || progress {
            let previous = SyncStateStore(directory: dir, tokenStore: tokens)
            if let stored { await previous.setConfiguration(stored) }
            if progress {
                await previous.update(steps) { $0.totalSamplesExported = 10 }
            }
            await previous.persistNow()
        }
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
            healthAccess: access,
            capabilitiesReader: NoCapabilities(),
            subscriptions: subscriptions ?? SubscriptionStore(entitlementReader: { pro }))
        cleanups.append {
            await engine.stopObserving()
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: dir)
        }
        return Harness(model: model, engine: engine, defaults: defaults, access: access)
    }

    func testComplimentaryPlanRendersOnPhoneAndAtLargeText() async throws {
        let gift = EarlyUserProGift(storage: InMemoryTokenStore(), eligibilityReader: { true })
        let subscriptions = SubscriptionStore(entitlementReader: { false }, earlyUserGift: gift)
        await subscriptions.beginForegroundVisit()
        defer { subscriptions.stop() }
        let h = try await makeModel(subscriptions: subscriptions)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        for textSize in [DynamicTypeSize.large, .accessibility3] {
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
            let controller = UIHostingController(rootView:
                NavigationStack { ProView() }.environment(h.model).dynamicTypeSize(textSize))
            window.rootViewController = controller
            window.makeKeyAndVisible()
            controller.view.frame = window.bounds
            window.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(200))
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { context in
                controller.view.layer.render(in: context.cgContext)
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "Complimentary Pro \(textSize)"
            attachment.lifetime = .keepAlways
            add(attachment)
            XCTAssertTrue(subscriptions.hasPro)
            XCTAssertNotNil(subscriptions.complimentaryExpiresAt)
            XCTAssertNil(subscriptions.plan, "A gift must not invent a subscription")
            window.isHidden = true
        }
    }

    func testGiftWelcomeScreenshots() async throws {
        let gift = EarlyUserProGift(storage: InMemoryTokenStore(), eligibilityReader: { true })
        let subscriptions = SubscriptionStore(entitlementReader: { false }, earlyUserGift: gift)
        await subscriptions.beginForegroundVisit()
        defer { subscriptions.stop() }
        let h = try await makeModel(flags: ["onboardingCompleted": true], subscriptions: subscriptions)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        let controller = UIHostingController(rootView: RootView().environment(h.model))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        window.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(700))
        XCTAssertTrue(subscriptions.showsGiftWelcome)
        XCTAssertFalse(h.model.showsOnboarding)
        func capture(_ name: String) {
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        capture("gift_welcome_first_open")
        subscriptions.dismissGiftWelcome()
        h.model.showPro()
        try await Task.sleep(for: .milliseconds(700))
        XCTAssertTrue(h.model.showsPro)
        XCTAssertFalse(subscriptions.showsGiftWelcome)
        capture("gift_plan_after_view_gift")
        window.isHidden = true
    }

    func testFreeHistoricalExportPromptsBeforeHealthAccess() async throws {
        let harness = try await makeModel(pro: false)
        await harness.model.start()
        harness.model.export.draft.range = .allTime
        harness.model.startExport()
        let prompted = await eventually { harness.model.showsPro }
        XCTAssertTrue(prompted)
        XCTAssertEqual(harness.model.proContext, .exportHistory)
        XCTAssertEqual(harness.model.export.draft.range, .allTime, "Upgrade prompt must preserve the export draft")
        XCTAssertFalse(harness.model.export.isRunning)
        let requests = await harness.access.requests
        XCTAssertTrue(requests.isEmpty)
    }

    func testHistoricalSyncDateIsKeptAsUnappliedUpgradeDraft() async throws {
        let harness = try await makeModel(pro: false)
        await harness.model.start()
        let appliedStart = harness.model.appliedConfig.startDate
        let requested = Date().addingTimeInterval(-180 * 86_400)
        harness.model.setSyncStartDate(requested)
        XCTAssertEqual(harness.model.proContext, .syncHistory)
        XCTAssertTrue(harness.model.showsPro)
        XCTAssertEqual(harness.model.config.startDate, requested)
        XCTAssertEqual(harness.model.appliedConfig.startDate, appliedStart)
        XCTAssertTrue(harness.model.hasPendingSettingsChanges)
        let requests = await harness.access.requests
        XCTAssertTrue(requests.isEmpty)
    }

    func testFreeSixTypeSelectionDoesNotApplyOrRequestHealthAccess() async throws {
        let harness = try await makeModel(pro: false)
        await harness.model.start()
        harness.model.config.serverURL = mine
        harness.model.config.enabledTypes = Set(HealthTypeCatalog.all.prefix(6).map(\.identifier))
        XCTAssertEqual(harness.model.config.enabledTypes.count, 6)
        let applied = await harness.model.applyConfiguration()
        XCTAssertFalse(applied)
        XCTAssertTrue(harness.model.showsPro)
        XCTAssertEqual(harness.model.proContext, .syncTypes(6))
        XCTAssertEqual(harness.model.config.enabledTypes.count, 6, "Upgrade prompt must preserve the sync draft")
        XCTAssertNil(harness.model.appliedConfig.serverURL)
        let requests = await harness.access.requests
        XCTAssertTrue(requests.isEmpty)
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

    func testHealthIsLastAfterExportAndSyncContext() {
        let expected: [OnboardingView.Page] = [.welcome, .export, .sync, .health]
        XCTAssertEqual(OnboardingView.pages(healthSettled: false), expected)
        XCTAssertEqual(OnboardingView.pages(healthSettled: true), expected)
    }

    func testFreeTypeSelectionCountsOverlapAndRejectsOnlyNewTypes() async throws {
        let h = try await makeModel(pro: false)
        await h.model.subscriptions.refreshEntitlements()
        let types = Set(HealthTypeCatalog.all.prefix(5).map(\.identifier))
        h.model.config.enabledTypes = types
        let extra = try XCTUnwrap(HealthTypeCatalog.all.first { !types.contains($0.identifier) }?.identifier)
        h.model.setSyncRawTypes(types.union([extra]))
        XCTAssertEqual(h.model.config.enabledTypes, types)
        XCTAssertTrue(h.model.showsPro)
        XCTAssertTrue(h.model.syncTypeRequiresPro(extra))

        let shared = try XCTUnwrap(AggregateList.measurementTypes.first { types.contains($0.identifier) }?.identifier)
        h.model.editAggregates(.sync) { $0.addType(shared) }
        XCTAssertEqual(h.model.config.observedTypeIdentifiers, types)
        XCTAssertFalse(h.model.syncTypeRequiresPro(shared))
        h.model.setSyncRawTypes([shared])
        XCTAssertEqual(h.model.config.enabledTypes, [shared])
        XCTAssertFalse(h.model.syncTypeRequiresPro(extra))
    }

    func testExistingOverLimitFreeSelectionIsPausedAndExplained() async throws {
        var saved = SyncConfiguration()
        saved.serverURL = mine
        saved.enabledTypes = Set(HealthTypeCatalog.all.prefix(80).map(\.identifier))
        let h = try await makeModel(stored: saved, pro: false)
        await h.model.start()
        XCTAssertTrue(h.model.syncPausedByPlan)
        XCTAssertTrue(h.model.syncPlanNotice?.contains("80 health data types") == true)
        await h.model.syncNow(trigger: "manual")
        XCTAssertTrue(h.model.showsPro)
        XCTAssertFalse(h.model.isSyncingAll)
        XCTAssertEqual(h.model.appliedConfig.enabledTypes, saved.enabledTypes)
        let synced = await h.access.syncedTypes
        XCTAssertTrue(synced.isEmpty)
    }

    func testFreeExportRangePromptsWithoutChangingSelection() async throws {
        let h = try await makeModel(pro: false)
        await h.model.subscriptions.refreshEntitlements()
        h.model.export.draft.range = .last30Days
        h.model.checkExportRangeAccess()
        XCTAssertFalse(h.model.showsPro)
        h.model.export.draft.range = .last90Days
        h.model.checkExportRangeAccess()
        XCTAssertTrue(h.model.showsPro)
        XCTAssertEqual(h.model.export.draft.range, .last90Days)
        h.model.showsPro = false
        h.model.export.draft.customRange = true
        h.model.export.draft.customStart = Calendar.current.date(byAdding: .day, value: -31, to: Date())!
        h.model.checkExportRangeAccess()
        XCTAssertTrue(h.model.showsPro)
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
        // The fake records the backfill request without querying HealthKit or
        // connecting to a receiver; starting the correct work is the contract.
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
        let synced = await h.access.syncedTypes
        XCTAssertTrue(synced.contains(steps))
        let wakes = await h.engine.wakeLog.recent(limit: 50)
        XCTAssertTrue(
            h.model.continuedBackfillPending
                || wakes.contains { $0.detail == "apply: backfill newly enabled types" })
    }

    func testFirstDatabaseApplyStartsBackfillAfterOnboarding() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.config.serverURL = URL(string: "http://127.0.0.1:9")!
        h.model.config.authToken = "token"
        h.model.config.enabledTypes = [steps]
        let applied = await h.model.applyDatabaseConfiguration()
        XCTAssertTrue(applied)
        XCTAssertTrue(h.model.backfillActive)
        let settled = await eventually { !h.model.isSyncingAll }
        XCTAssertTrue(settled)
    }

    func testDatabaseApplyClearsAnEmptiedTokenBeforeStartingObservers() async throws {
        let stored = SyncConfiguration(serverURL: mine, authToken: "old-token")
        let h = try await makeModel(flags: ["onboardingCompleted": true], stored: stored)
        await h.model.start()
        h.model.config.authToken = nil
        let applied = await h.model.applyDatabaseConfiguration()
        XCTAssertTrue(applied)
        let token = await h.engine.store.configuration.authToken
        XCTAssertNil(token)
        XCTAssertNil(h.model.appliedConfig.authToken)
    }

    func testTestingAnUnappliedDatabaseDoesNotChangeFeatureGates() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CapabilityTestProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let result = await h.model.testConnection(url: mine, token: "draft-token", session: session)
        XCTAssertTrue(result.isSuccess)
        XCTAssertFalse(h.model.serverSupportsStats)
        XCTAssertFalse(h.model.serverSupportsReconciliation)
        XCTAssertNil(h.model.appliedConfig.serverURL)
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

    // MARK: - Saved databases

    func testScopedKeychainCredentialsSurviveReopenAndUnpairIndividually() throws {
        let service = "PulsHealthSavedDestinationTests.\(UUID())"
        let tokens = KeychainTokenStore(service: service)
        let a = UUID(), b = UUID()
        defer {
            try? tokens.setToken(nil, for: a)
            try? tokens.setToken(nil, for: b)
        }
        do { try tokens.setToken("fixture-alpha", for: a) }
        catch KeychainTokenStore.Failure.status(let status)
            where status == errSecMissingEntitlement || status == errSecInteractionNotAllowed {
            throw XCTSkip("This simulator host has no Keychain access; device acceptance remains required")
        }
        try tokens.setToken("fixture-beta", for: b)
        let reopened = KeychainTokenStore(service: service)
        XCTAssertEqual(try reopened.token(for: a), "fixture-alpha")
        XCTAssertEqual(try reopened.token(for: b), "fixture-beta")
        try reopened.setToken(nil, for: a)
        XCTAssertNil(try reopened.token(for: a))
        XCTAssertEqual(try reopened.token(for: b), "fixture-beta")
        XCTAssertNil(try reopened.token())
    }

    func testAccountProfileSavePreservesDifferentDestinationDraftWithoutHealthRequests() async throws {
        var stored = SyncConfiguration()
        stored.serverURL = URL(string: "https://sync.pulshealth.com")!
        stored.authToken = "fixture-sync-token"
        stored.userID = user
        stored.signedInDatabaseURL = stored.serverURL
        let h = try await makeModel(flags: ["onboardingCompleted": true], stored: stored)
        await h.model.start()
        h.model.config.serverURL = mine
        h.model.config.userName = "Different draft"
        let profile = AccountProfile(userID: user, name: "Account name", email: "person@example.test")
        let saved = await h.model.updateAppliedAccountProfile(profile)
        XCTAssertTrue(saved)
        XCTAssertEqual(h.model.config.serverURL, mine)
        XCTAssertEqual(h.model.config.userName, "Different draft")
        XCTAssertEqual(h.model.appliedConfig.userName, "Account name")
        let persisted = await h.engine.store.configuration
        XCTAssertEqual(persisted.userName, "Account name")
        let requests = await h.access.requests
        XCTAssertTrue(requests.isEmpty)
    }

    func testUserPageRendersOptionalLocalAndAccountProfiles() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        for signedIn in [false, true] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [AccountFixtureProtocol.self]
            let account = UserAccount(credentials: InMemoryTokenStore(token: signedIn ? "fixture-account-session" : nil),
                                      session: URLSession(configuration: configuration))
            await account.restore()
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 393, height: 1100)
            let controller = UIHostingController(rootView: NavigationStack { UserView(account: account) }.environment(h.model))
            window.rootViewController = controller
            window.makeKeyAndVisible()
            controller.view.frame = window.bounds
            window.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(250))
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { context in
                controller.view.layer.render(in: context.cgContext)
            }
            XCTAssertNotNil(image.cgImage)
            let attachment = XCTAttachment(image: image)
            attachment.name = signedIn ? "User settings signed in" : "User settings optional local profile"
            attachment.lifetime = .keepAlways
            add(attachment)
            XCTAssertEqual(account.hasSession, signedIn)
            XCTAssertNil(h.model.config.serverURL)
            window.isHidden = true
        }
    }

    func testSavedDatabaseScreenRendersOnPhoneAndPadAfterSwitchAndUnpair() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.config.serverURL = mine
        h.model.config.authToken = "fixture-alpha"
        let firstApplied = await h.model.applyConfiguration()
        XCTAssertTrue(firstApplied)
        let firstID = try XCTUnwrap(h.model.activeDestinationID)
        h.model.config.serverURL = URL(string: "https://second.example.test")!
        h.model.config.authToken = "fixture-beta"
        let secondApplied = await h.model.applyConfiguration(serverChangeConfirmed: true)
        XCTAssertTrue(secondApplied)

        // Render the real screen over isolated state; no health samples, sockets
        // or production credentials enter this layout smoke test.
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        for size in [CGSize(width: 393, height: 852), CGSize(width: 1024, height: 1366)] {
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(origin: .zero, size: size)
            let controller = UIHostingController(rootView:
                NavigationStack { ServerSettingsView(scanOnArrival: false) }.environment(h.model))
            window.rootViewController = controller
            window.makeKeyAndVisible()
            controller.view.frame = window.bounds
            window.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(150))
            let image = UIGraphicsImageRenderer(size: size).image { context in
                controller.view.layer.render(in: context.cgContext)
            }
            let pixels = try XCTUnwrap(image.cgImage?.dataProvider?.data)
            let data = pixels as Data
            let colors = Set(stride(from: 0, to: data.count - 4, by: 400).map {
                data.subdata(in: $0..<($0 + 4))
            })
            XCTAssertGreaterThan(colors.count, 4, "The screen must render content, not a blank attachment")
            let attachment = XCTAttachment(image: image)
            attachment.name = "Saved databases \(Int(size.width))"
            attachment.lifetime = .keepAlways
            add(attachment)
            XCTAssertEqual(h.model.savedDestinations.count, 2)
            window.isHidden = true
        }
        let switched = await h.model.switchDestination(id: firstID)
        XCTAssertTrue(switched)
        let unpaired = await h.model.unpairDestination(id: firstID)
        XCTAssertTrue(unpaired)
        XCTAssertNil(h.model.activeDestinationID)
        XCTAssertEqual(h.model.savedDestinations.count, 1)
    }

    func testSavedDatabaseSwitchRestoresItsProgressWithoutMigrationPrompt() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.config.serverURL = mine
        h.model.config.authToken = "first-test-token"
        h.model.config.userID = user
        let firstApplied = await h.model.applyConfiguration()
        XCTAssertTrue(firstApplied)
        let firstID = try XCTUnwrap(h.model.activeDestinationID)
        await h.engine.store.update(steps) { $0.totalSamplesExported = 11 }

        h.model.config.serverURL = URL(string: "https://other.example.test")!
        h.model.config.authToken = "second-test-token"
        let secondApplied = await h.model.applyConfiguration(serverChangeConfirmed: true)
        XCTAssertTrue(secondApplied)
        let secondID = try XCTUnwrap(h.model.activeDestinationID)
        XCTAssertNotEqual(firstID, secondID)
        XCTAssertEqual(h.model.savedDestinations.count, 2)
        let fresh = await h.engine.store.state(for: steps)
        XCTAssertEqual(fresh.totalSamplesExported, 0)
        await h.engine.store.update(steps) { $0.totalSamplesExported = 22 }

        // A staged edit never leaks into a saved destination's configuration.
        h.model.config.userID = "unapplied-user"
        let switched = await h.model.switchDestination(id: firstID)
        XCTAssertTrue(switched)
        XCTAssertEqual(h.model.activeDestinationID, firstID)
        XCTAssertEqual(h.model.appliedConfig.serverURL, mine)
        XCTAssertEqual(h.model.config.userID, user)
        XCTAssertEqual(h.model.appliedConfig.authToken, "first-test-token")
        XCTAssertNil(h.model.pendingServerChange)
        let restored = await h.engine.store.state(for: steps)
        XCTAssertEqual(restored.totalSamplesExported, 11)

        let switchedBack = await h.model.switchDestination(id: secondID)
        XCTAssertTrue(switchedBack)
        let secondProgress = await h.engine.store.state(for: steps)
        XCTAssertEqual(secondProgress.totalSamplesExported, 22)
    }

    func testSavedAccountsAtTheSameURLKeepDistinctCredentialsAndPairingProvenance() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.config.serverURL = mine
        h.model.config.signedInDatabaseURL = mine
        h.model.config.userID = user
        h.model.config.authToken = "first-account-token"
        let firstApplied = await h.model.applyConfiguration()
        XCTAssertTrue(firstApplied)
        let firstID = try XCTUnwrap(h.model.activeDestinationID)

        h.model.config.userID = "5ea4d000-0000-4000-8000-0000000000bb"
        h.model.config.authToken = "second-account-token"
        h.model.config.signedInDatabaseURL = nil
        let secondApplied = await h.model.applyConfiguration(serverChangeConfirmed: true)
        XCTAssertTrue(secondApplied)
        XCTAssertEqual(h.model.savedDestinations.count, 2)
        XCTAssertEqual(Set(h.model.savedDestinations.map(\.serverURL)), [mine])
        XCTAssertEqual(Set(h.model.savedDestinations.map(\.userID)).count, 2)
        XCTAssertFalse(h.model.appliedConfig.isSignedInDatabase)

        let switched = await h.model.switchDestination(id: firstID)
        XCTAssertTrue(switched)
        XCTAssertEqual(h.model.appliedConfig.userID, user)
        XCTAssertEqual(h.model.appliedConfig.authToken, "first-account-token")
        XCTAssertTrue(h.model.appliedConfig.isSignedInDatabase)
    }

    func testUnpairInactivePreservesActiveAndUnpairActiveDisconnects() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.config.serverURL = mine
        h.model.config.authToken = "first-test-token"
        let firstApplied = await h.model.applyConfiguration()
        XCTAssertTrue(firstApplied)
        let firstID = try XCTUnwrap(h.model.activeDestinationID)
        h.model.config.serverURL = URL(string: "https://other.example.test")!
        h.model.config.authToken = "second-test-token"
        let secondApplied = await h.model.applyConfiguration(serverChangeConfirmed: true)
        XCTAssertTrue(secondApplied)
        let secondID = try XCTUnwrap(h.model.activeDestinationID)
        let before = h.model.appliedConfig
        h.model.config.userName = "Unsaved draft"

        let removedInactive = await h.model.unpairDestination(id: firstID)
        XCTAssertTrue(removedInactive)
        XCTAssertEqual(h.model.activeDestinationID, secondID)
        XCTAssertEqual(h.model.appliedConfig, before)
        XCTAssertEqual(h.model.config.userName, "Unsaved draft")
        XCTAssertEqual(h.model.savedDestinations.map(\.id), [secondID])

        let removedActive = await h.model.unpairDestination(id: secondID)
        XCTAssertTrue(removedActive)
        XCTAssertNil(h.model.activeDestinationID)
        XCTAssertNil(h.model.appliedConfig.serverURL)
        XCTAssertNil(h.model.appliedConfig.authToken)
        XCTAssertTrue(h.model.savedDestinations.isEmpty)
    }

    func testRepeatedConnectionActionsAreBlockedWhileApplyAwaitsHealthAccess() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.config.serverURL = mine
        h.model.config.authToken = "test-token"
        let applied = await h.model.applyConfiguration()
        XCTAssertTrue(applied)
        let activeID = try XCTUnwrap(h.model.activeDestinationID)

        await h.access.pauseNextRequest()
        h.model.config.enabledTypes = [steps]
        let applying = Task { await h.model.applyConfiguration() }
        let paused = await eventually { await h.access.hasPausedRequest }
        XCTAssertTrue(paused)
        XCTAssertTrue(h.model.isUpdatingConnection)
        let repeatedApply = await h.model.applyConfiguration()
        let repeatedSwitch = await h.model.switchDestination(id: UUID())
        let repeatedUnpair = await h.model.unpairDestination(id: activeID)
        XCTAssertFalse(repeatedApply)
        XCTAssertFalse(repeatedSwitch)
        XCTAssertFalse(repeatedUnpair)
        let refusedTest = await h.model.testConnection(url: mine, token: "test-token")
        if case .unreachable = refusedTest {} else { XCTFail("tests cannot start during a connection change") }
        XCTAssertEqual(h.model.activeConnectionTests, 0)
        XCTAssertEqual(h.model.activeDestinationID, activeID)
        await h.access.resumeRequest()
        let finished = await applying.value
        XCTAssertTrue(finished)
        XCTAssertFalse(h.model.isUpdatingConnection)
    }

    func testConnectionProbeBlocksSwitchAndUnpairUntilTheWholeTestFinishes() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.config.serverURL = mine
        h.model.config.authToken = "first-token"
        let firstApplied = await h.model.applyConfiguration()
        XCTAssertTrue(firstApplied)
        let firstID = try XCTUnwrap(h.model.activeDestinationID)
        h.model.config.serverURL = URL(string: "https://other.example.test")!
        h.model.config.authToken = "second-token"
        let secondApplied = await h.model.applyConfiguration(serverChangeConfirmed: true)
        XCTAssertTrue(secondApplied)
        let secondID = try XCTUnwrap(h.model.activeDestinationID)

        await PausedConnectionTestProtocol.gate.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PausedConnectionTestProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let testing = Task {
            await h.model.testConnection(url: mine, token: "first-token", session: session)
        }
        let gotCapabilities = await eventually {
            await PausedConnectionTestProtocol.gate.hasSeen("GET")
        }
        XCTAssertTrue(gotCapabilities)
        XCTAssertEqual(h.model.activeConnectionTests, 1)
        let blockedSwitch = await h.model.switchDestination(id: firstID)
        let blockedUnpair = await h.model.unpairDestination(id: secondID)
        XCTAssertFalse(blockedSwitch)
        XCTAssertFalse(blockedUnpair)
        XCTAssertEqual(h.model.activeDestinationID, secondID)

        // A 404 starts the POST probe; the lease must cover that phase too.
        await PausedConnectionTestProtocol.gate.release("GET")
        let gotProbe = await eventually {
            await PausedConnectionTestProtocol.gate.hasSeen("POST")
        }
        XCTAssertTrue(gotProbe)
        let blockedDuringProbe = await h.model.switchDestination(id: firstID)
        XCTAssertFalse(blockedDuringProbe)
        XCTAssertEqual(h.model.activeConnectionTests, 1)
        await PausedConnectionTestProtocol.gate.release("POST")
        let result = await testing.value
        XCTAssertEqual(result, .okNoCapabilities)
        XCTAssertEqual(h.model.activeConnectionTests, 0)

        let switched = await h.model.switchDestination(id: firstID)
        XCTAssertTrue(switched)
        XCTAssertEqual(h.model.activeDestinationID, firstID)
        XCTAssertNil(h.model.lastConnectionTest, "the old test cannot repaint after switching")
    }

    func testMissingSavedDatabaseDoesNotChangeActiveConnection() async throws {
        let h = try await makeModel(flags: ["onboardingCompleted": true])
        await h.model.start()
        h.model.config.serverURL = mine
        h.model.config.authToken = "test-token"
        let applied = await h.model.applyConfiguration()
        XCTAssertTrue(applied)
        let before = h.model.appliedConfig
        let activeID = h.model.activeDestinationID
        let switched = await h.model.switchDestination(id: UUID())
        XCTAssertFalse(switched)
        XCTAssertEqual(h.model.appliedConfig, before)
        XCTAssertEqual(h.model.activeDestinationID, activeID)
        XCTAssertNotNil(h.model.lastErrorMessage)
        XCTAssertFalse(h.model.isUpdatingConnection)
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

private final class CapabilityTestProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"protocolVersions":[1],"features":["stats","digest","uuids"]}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// Pauses both phases independently without sleeps, real sockets or DNS.
private final class PausedConnectionTestProtocol: URLProtocol, @unchecked Sendable {
    actor Gate {
        private var seen: Set<String> = []
        private var released: Set<String> = []
        private var pending: [String: CheckedContinuation<Void, Never>] = [:]

        func reset() {
            seen = []
            released = []
        }
        func hasSeen(_ method: String) -> Bool { seen.contains(method) }
        func wait(_ method: String) async {
            seen.insert(method)
            guard !released.contains(method) else { return }
            await withCheckedContinuation { pending[method] = $0 }
        }
        func release(_ method: String) {
            released.insert(method)
            pending.removeValue(forKey: method)?.resume()
        }
    }
    static let gate = Gate()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let method = request.httpMethod ?? "GET"
        Task { @Sendable [self, method] in
            await Self.gate.wait(method)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: method == "GET" ? 404 : 204,
                httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}
