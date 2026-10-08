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

    func testSyncNeedsThreeActiveDaysTwoUploadDaysAndLaunchDelay() {
        let policy = makePolicy()
        let now = threeVisits(policy)
        XCTAssertTrue(policy.isEligible(.explore, now: now))
        XCTAssertFalse(policy.isEligible(.sync, now: now))
        policy.recordSuccessfulSyncs(at: [start, start.addingTimeInterval(60), start])
        XCTAssertFalse(policy.isEligible(.sync, now: now))
        policy.recordSuccessfulSyncs(at: [start.addingTimeInterval(86_400)])
        XCTAssertTrue(policy.isEligible(.sync, now: now))
        XCTAssertFalse(policy.isEligible(.sync, now: now.addingTimeInterval(-45)))
        XCTAssertNil(policy.pending, "Background success history must not offer a prompt")
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
