import XCTest
@testable import PulsHealth

@MainActor
final class ReviewRequestsTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suite: String!
    private let start = Date(timeIntervalSince1970: 1_790_000_000)
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    override func setUp() async throws {
        suite = "puls-review-tests-\(UUID())"
        defaults = UserDefaults(suiteName: suite)!
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suite)
    }

    private func makePolicy(version: String = "1.7") -> ReviewRequests {
        ReviewRequests(defaults: defaults, version: version, calendar: calendar)
    }

    private func settleForegroundSync(_ policy: ReviewRequests) {
        policy.finishForegroundSync(policy.beginForegroundSync())
    }

    private func threeVisits(_ policy: ReviewRequests) -> Date {
        for offset in 0..<3 {
            policy.beginSession(now: start.addingTimeInterval(Double(offset) * 86_400))
            if offset < 2 { policy.endSession() }
        }
        return start.addingTimeInterval(2 * 86_400 + 60)
    }

    func testActiveDaysAndPreviousSessionAreDifferentRequirements() {
        let policy = makePolicy()
        policy.beginSession(now: start)
        XCTAssertFalse(policy.isEligible(.export, now: start))
        XCTAssertFalse(policy.isEligible(.explore, now: start))
        policy.beginSession(now: start.addingTimeInterval(10))
        XCTAssertFalse(policy.isEligible(.export, now: start.addingTimeInterval(10)), "Permission dismissal isn't another visit")
        policy.endSession()
        policy.beginSession(now: start.addingTimeInterval(60))
        XCTAssertTrue(policy.isEligible(.export, now: start.addingTimeInterval(60)))
        XCTAssertFalse(policy.isEligible(.explore, now: start.addingTimeInterval(60)))
        policy.endSession()
        XCTAssertFalse(policy.isEligible(.export, now: start.addingTimeInterval(60)))
    }

    func testSyncNeedsThreeUploadDaysAndALaterVisit() {
        let policy = makePolicy()
        policy.recordSuccessfulSyncs(at: [start, start.addingTimeInterval(60), start])
        policy.recordSuccessfulSyncs(at: [start.addingTimeInterval(86_400)])
        let now = start.addingTimeInterval(2 * 86_400)
        policy.beginSession(now: now)
        settleForegroundSync(policy)
        XCTAssertFalse(policy.isEligible(.sync, now: now), "Two successful days are insufficient")
        policy.recordSuccessfulSyncs(at: [now.addingTimeInterval(60)])
        XCTAssertFalse(policy.isEligible(.sync, now: now.addingTimeInterval(120)), "The third day completed during this visit")
        XCTAssertNil(policy.pending, "Background success history must not offer a prompt")
        policy.endSession()
        policy.beginSession(now: now.addingTimeInterval(180))
        settleForegroundSync(policy)
        XCTAssertTrue(policy.isEligible(.sync, now: now.addingTimeInterval(180)))
        XCTAssertFalse(policy.isEligible(.explore, now: now.addingTimeInterval(180)), "Sync does not require three foreground days")
    }

    func testBackgroundSyncHistorySurvivesRelaunchAndLoadsAfterSessionStarts() {
        let policy = makePolicy()
        let dates = (0..<3).map { start.addingTimeInterval(Double($0) * 86_400) }
        policy.recordSuccessfulSyncs(at: dates)
        policy.offerSyncOnReturn(now: dates.last!.addingTimeInterval(60))
        XCTAssertNil(policy.pending, "A background launch cannot offer a request")
        let relaunched = makePolicy()
        let now = start.addingTimeInterval(3 * 86_400)
        relaunched.beginSession(now: now)
        settleForegroundSync(relaunched)
        relaunched.offerSyncOnReturn(now: now)
        XCTAssertEqual(relaunched.pending?.source, .sync)

        defaults.removePersistentDomain(forName: suite)
        let delayedHistory = makePolicy()
        delayedHistory.beginSession(now: now)
        settleForegroundSync(delayedHistory)
        delayedHistory.recordSuccessfulSyncs(at: Array(dates.reversed()))
        delayedHistory.offerSyncOnReturn(now: now)
        XCTAssertEqual(delayedHistory.pending?.source, .sync, "Historical uploads can load after the return begins")
    }

    func testDuplicateUploadsDoNotCountAsThreeDays() {
        let policy = makePolicy()
        policy.recordSuccessfulSyncs(at: [start, start.addingTimeInterval(60), start.addingTimeInterval(120)])
        policy.recordSuccessfulSyncs(at: [start.addingTimeInterval(60), start.addingTimeInterval(180)])
        let now = start.addingTimeInterval(3 * 86_400)
        policy.beginSession(now: now)
        settleForegroundSync(policy)
        policy.offerSyncOnReturn(now: now)
        XCTAssertNil(policy.pending)
    }

    func testReturnCancellationWaitsForAnotherVisitWithoutConsumingCooldown() async throws {
        let policy = makePolicy()
        policy.recordSuccessfulSyncs(at: (0..<3).map { start.addingTimeInterval(Double($0) * 86_400) })
        let now = start.addingTimeInterval(3 * 86_400)
        policy.beginSession(now: now)
        settleForegroundSync(policy)
        policy.offerSyncOnReturn(now: now)
        let opportunity = try XCTUnwrap(policy.pending)
        var calls = 0
        await policy.requestAfterPause(opportunity, pause: { policy.cancelPending() }, now: { now },
                                       canPresent: { true }, request: { calls += 1 })
        policy.offerSyncOnReturn(now: now.addingTimeInterval(60))
        XCTAssertNil(policy.pending, "Do not repeatedly offer during the same visit")
        XCTAssertTrue(policy.isEligible(.sync, now: now))
        policy.endSession()
        policy.beginSession(now: now.addingTimeInterval(120))
        settleForegroundSync(policy)
        policy.offerSyncOnReturn(now: now.addingTimeInterval(120))
        let next = try XCTUnwrap(policy.pending)
        await policy.requestAfterPause(next, pause: {}, now: { now.addingTimeInterval(120) },
                                       canPresent: { true }, request: { calls += 1 })
        XCTAssertEqual(calls, 1)
        let updated = makePolicy(version: "1.8")
        updated.beginSession(now: now.addingTimeInterval(86_400))
        settleForegroundSync(updated)
        updated.offerSyncOnReturn(now: now.addingTimeInterval(86_400))
        XCTAssertNil(updated.pending, "Sync return attempts share the existing cooldown")
    }

    func testExistingTwoDayHistoryWaitsForANewSuccessfulDay() throws {
        let lastSync = start.addingTimeInterval(86_400)
        let day = calendar.dateComponents([.era, .year, .month, .day], from: lastSync)
        let legacy: [String: Any] = [
            "activeDays": 1, "sessions": 1, "successfulSyncDays": 2,
            "lastSuccessfulSyncDay": "\(day.era!)-\(day.year!)-\(day.month!)-\(day.day!)",
            "syncRecordedThrough": lastSync.timeIntervalSince1970 * 1_000,
            "attemptedVersions": [], "attemptCount": 0
        ]
        defaults.set(try JSONSerialization.data(withJSONObject: legacy), forKey: "reviewRequestHistory")
        let policy = makePolicy()
        let thirdDay = start.addingTimeInterval(2 * 86_400)
        policy.recordSuccessfulSyncs(at: [lastSync, thirdDay])
        policy.beginSession(now: thirdDay.addingTimeInterval(60))
        settleForegroundSync(policy)
        policy.offerSyncOnReturn(now: thirdDay.addingTimeInterval(60))
        XCTAssertEqual(policy.pending?.source, .sync)
    }

    func testReturnWaitsForForegroundCatchupWithoutConsumingTheOpportunity() {
        let policy = makePolicy()
        policy.recordSuccessfulSyncs(at: (0..<3).map { start.addingTimeInterval(Double($0) * 86_400) })
        let now = start.addingTimeInterval(3 * 86_400)
        policy.beginSession(now: now)
        policy.offerSyncOnReturn(now: now)
        XCTAssertNil(policy.pending, "Activation alone must not race the foreground sync task")
        let first = policy.beginForegroundSync()
        let second = policy.beginForegroundSync()
        policy.finishForegroundSync(second)
        policy.offerSyncOnReturn(now: now)
        XCTAssertNil(policy.pending, "An overlapping catch-up is still running")
        policy.finishForegroundSync(first)
        policy.offerSyncOnReturn(now: now)
        XCTAssertEqual(policy.pending?.source, .sync)
    }

    func testPreviousVisitsCatchupCannotMakeANewVisitReady() {
        let policy = makePolicy()
        policy.recordSuccessfulSyncs(at: (0..<3).map { start.addingTimeInterval(Double($0) * 86_400) })
        let now = start.addingTimeInterval(3 * 86_400)
        policy.beginSession(now: now)
        let previous = policy.beginForegroundSync()
        policy.endSession()
        policy.beginSession(now: now.addingTimeInterval(60))
        policy.finishForegroundSync(previous)
        policy.offerSyncOnReturn(now: now.addingTimeInterval(60))
        XCTAssertNil(policy.pending)
        settleForegroundSync(policy)
        policy.offerSyncOnReturn(now: now.addingTimeInterval(60))
        XCTAssertEqual(policy.pending?.source, .sync)
    }

    func testAttemptPersistsAndCooldownSurvivesUpdateAcrossAllSources() async throws {
        let policy = makePolicy()
        let now = threeVisits(policy)
        policy.offer(.explore, now: now)
        let opportunity = try XCTUnwrap(policy.pending)
        var calls = 0
        await policy.requestAfterPause(opportunity, pause: {}, now: { now }, canPresent: { true }, request: { calls += 1 })
        XCTAssertEqual(calls, 1)
        for source in [ReviewRequests.Source.export, .explore, .sync] {
            XCTAssertFalse(policy.isEligible(source, now: now.addingTimeInterval(1)))
        }
        let future = now.addingTimeInterval(ReviewRequests.cooldown)
        let sameVersion = makePolicy()
        sameVersion.beginSession(now: future)
        XCTAssertFalse(sameVersion.isEligible(.explore, now: future))
        let updated = makePolicy(version: "1.8")
        updated.beginSession(now: now.addingTimeInterval(86_400))
        XCTAssertFalse(updated.isEligible(.explore, now: now.addingTimeInterval(86_400)))
        XCTAssertTrue(updated.isEligible(.explore, now: future))
    }

    func testNavigationBackgroundAndModalCancellationConsumeNoAttempt() async throws {
        let policy = makePolicy()
        let now = threeVisits(policy)
        var calls = 0
        for cancel in [false, true] {
            policy.offer(.explore, now: now)
            let opportunity = try XCTUnwrap(policy.pending)
            await policy.requestAfterPause(opportunity, pause: {
                if cancel { policy.cancelPending() }
            }, now: { now }, canPresent: { false }, request: { calls += 1 })
            XCTAssertTrue(policy.isEligible(.explore, now: now))
        }
        policy.offer(.explore, now: now)
        let opportunity = try XCTUnwrap(policy.pending)
        await policy.requestAfterPause(opportunity, pause: {
            policy.endSession()
        }, now: { now }, canPresent: { true }, request: { calls += 1 })
        XCTAssertEqual(calls, 0)
        XCTAssertNil(policy.pending)
        policy.beginSession(now: now.addingTimeInterval(60))
        XCTAssertTrue(policy.isEligible(.explore, now: now.addingTimeInterval(60)))
    }

    func testCancelledDelayDoesNotCallStoreKit() async throws {
        let policy = makePolicy()
        let now = threeVisits(policy)
        policy.offer(.export, now: now)
        let opportunity = try XCTUnwrap(policy.pending)
        var called = false
        let task = Task { @MainActor in
            await policy.requestAfterPause(opportunity, pause: {
                try await Task.sleep(for: .seconds(60))
            }, now: { now }, canPresent: { true }, request: { called = true })
        }
        task.cancel()
        await task.value
        XCTAssertFalse(called)
        XCTAssertNil(policy.pending)
        XCTAssertTrue(policy.isEligible(.export, now: now))
    }
}
