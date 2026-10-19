import XCTest
import PulsHealthSync
@testable import PulsHealth

@MainActor
final class EarlyUserProGiftTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)

    func testEligibilityUsesOriginalBuildRatherThanMarketingVersion() {
        for build in ["1", "1.0", "19", "21", "22"] {
            XCTAssertTrue(EarlyUserProGift.isEligible(originalBuild: build), build)
        }
        for build in ["", "0", "unknown", "-1", "22beta", "22.", "23", "24", "100"] {
            XCTAssertFalse(EarlyUserProGift.isEligible(originalBuild: build), build)
        }
    }

    func testForegroundStartsOnceAndRelaunchKeepsExpiryAndAcknowledgement() async throws {
        let storage = InMemoryTokenStore()
        let gift = EarlyUserProGift(storage: storage, eligibilityReader: { true })
        let store = SubscriptionStore(entitlementReader: { false }, earlyUserGift: gift, now: { self.start })
        await store.start()
        XCTAssertFalse(store.hasPro, "A background launch must not start the gift")
        XCTAssertNil(try storage.token())
        await store.beginForegroundVisit()
        XCTAssertTrue(store.hasPro)
        XCTAssertTrue(store.showsGiftWelcome)
        let deadline = start.addingTimeInterval(EarlyUserProGift.duration)
        XCTAssertEqual(store.complimentaryExpiresAt, deadline)
        store.dismissGiftWelcome()
        XCTAssertFalse(store.showsGiftWelcome)
        let reopened = SubscriptionStore(entitlementReader: { false },
            earlyUserGift: EarlyUserProGift(storage: storage, eligibilityReader: { true }),
            now: { self.start.addingTimeInterval(86400) })
        await reopened.beginForegroundVisit()
        XCTAssertEqual(reopened.complimentaryExpiresAt, deadline)
        XCTAssertFalse(reopened.showsGiftWelcome)
        let policy = await reopened.currentPolicy()
        XCTAssertEqual(policy, .unrestricted)
        store.stop(); reopened.stop()
    }

    func testExpiryReturnsToFreeEvenWithoutAnotherForegroundAndNeverRestarts() async {
        let gift = EarlyUserProGift(storage: InMemoryTokenStore(), eligibilityReader: { true })
        var clock = start
        let store = SubscriptionStore(entitlementReader: { false }, earlyUserGift: gift, now: { clock })
        await store.beginForegroundVisit()
        clock = start.addingTimeInterval(EarlyUserProGift.duration - 1)
        var policy = await store.currentPolicy()
        XCTAssertEqual(policy, .unrestricted)
        clock = start.addingTimeInterval(EarlyUserProGift.duration)
        policy = await store.currentPolicy()
        XCTAssertEqual(policy, .free)
        XCTAssertFalse(store.hasPro)
        XCTAssertNil(store.complimentaryExpiresAt)
        XCTAssertFalse(store.showsGiftWelcome)
        await store.beginForegroundVisit()
        XCTAssertFalse(store.hasPro)
        store.stop()
    }

    func testVisibleGiftExpiresWithoutAnotherPolicyRead() async throws {
        let storage = InMemoryTokenStore()
        let gift = EarlyUserProGift(storage: storage, eligibilityReader: { true })
        await gift.activate(now: Date().addingTimeInterval(-EarlyUserProGift.duration + 0.3))
        let store = SubscriptionStore(entitlementReader: { false }, earlyUserGift: gift)
        await store.refreshEntitlements()
        XCTAssertTrue(store.hasPro)
        try await Task.sleep(for: .milliseconds(600))
        XCTAssertFalse(store.hasPro)
        XCTAssertNil(store.complimentaryExpiresAt)
        store.stop()
    }

    func testUnverifiedAndNewDownloadsReceiveNoGiftAndCanRetryVerification() async throws {
        let storage = InMemoryTokenStore()
        for eligibility: Bool? in [nil, false] {
            let gift = EarlyUserProGift(storage: storage, eligibilityReader: { eligibility })
            await gift.activate(now: start)
            XCTAssertNil(gift.activeRecord(now: start))
            XCTAssertNil(try storage.token())
        }
        let recovered = EarlyUserProGift(storage: storage, eligibilityReader: { true })
        await recovered.activate(now: start.addingTimeInterval(86400))
        XCTAssertEqual(recovered.activeRecord(now: start.addingTimeInterval(86400))?.startedAt,
                       start.addingTimeInterval(86400).timeIntervalSince1970)
    }

    func testPaidAccessTakesPriorityAndRemainsAfterGiftExpires() async {
        let gift = EarlyUserProGift(storage: InMemoryTokenStore(), eligibilityReader: { true })
        await gift.activate(now: start)
        let plan = ProPlanDetails(productID: SubscriptionStore.annualID, date: .distantFuture,
                                  renewal: .renews, isFreeOfferCode: false)
        let store = SubscriptionStore(accessReader: { ProAccessSnapshot(hasPro: true, plan: plan) },
            earlyUserGift: gift, now: { self.start.addingTimeInterval(EarlyUserProGift.duration) })
        await store.refreshEntitlements()
        XCTAssertTrue(store.hasPro)
        XCTAssertEqual(store.plan, plan)
        XCTAssertNil(store.complimentaryExpiresAt)
        XCTAssertFalse(store.showsGiftWelcome)
        store.stop()
    }

    func testCorruptAndUnavailableStorageNeverGrantsOrReplacesRecord() async throws {
        let storage = InMemoryTokenStore(token: "invalid")
        let gift = EarlyUserProGift(storage: storage, eligibilityReader: { true })
        await gift.activate(now: start)
        XCTAssertNil(gift.activeRecord(now: start))
        XCTAssertEqual(try storage.token(), "invalid")
        for storage in [UnavailableGiftStorage(failsRead: true), UnavailableGiftStorage(failsRead: false)] {
            let unavailable = EarlyUserProGift(storage: storage, eligibilityReader: { true })
            await unavailable.activate(now: start)
            XCTAssertNil(unavailable.activeRecord(now: start))
        }
    }
}

private struct UnavailableGiftStorage: TokenStore {
    let failsRead: Bool
    func token() throws -> String? {
        if failsRead { throw CocoaError(.fileReadNoPermission) }
        return nil
    }
    func setToken(_ token: String?) throws { throw CocoaError(.fileWriteNoPermission) }
}
