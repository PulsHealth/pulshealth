import XCTest
import StoreKit
import StoreKitTest
import PulsHealthSync
@testable import PulsHealth

private actor OverlappingEntitlements {
    var calls = 0
    var pending: [Int: CheckedContinuation<Bool, Never>] = [:]
    func read() async -> Bool {
        calls += 1
        let call = calls
        if call == 1 { return true }
        return await withCheckedContinuation { pending[call] = $0 }
    }
    func resume(_ call: Int, value: Bool) { pending.removeValue(forKey: call)?.resume(returning: value) }
}

@MainActor
final class SubscriptionStoreTests: XCTestCase {
    private func session() throws -> SKTestSession {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        if os.majorVersion == 26 && os.minorVersion == 5 {
            // FB22237318: this runtime cannot save StoreKitTest configuration,
            // including in an ad-hoc signed host. Lifecycle coverage is
            // required on iOS 27; do not turn other fixture errors into skips.
            // https://developer.apple.com/forums/thread/826971
            throw XCTSkip("iOS 26.5 StoreKitTest regression FB22237318; lifecycle tests run on iOS 27")
        }
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Pro", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: url)
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
        return session
    }

    private func makeStore(session: SKTestSession, gift: EarlyUserProGift? = nil) -> SubscriptionStore {
        SubscriptionStore(earlyUserGift: gift, purchaseAction: { product in
            _ = try await session.buyProduct(identifier: product.id)
            guard let verified = await Transaction.latest(for: product.id) else {
                throw NSError(domain: "StoreKitFixture", code: 1)
            }
            if case .verified(let transaction) = verified {
                XCTAssertEqual(transaction.environment, .xcode)
            }
            return .success(verified)
        })
    }

    private func assertAccess(_ expected: Bool, store: SubscriptionStore, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<40 {
            await store.refreshEntitlements()
            if store.hasPro == expected { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        if store.hasPro != expected {
            // Failure-only fixture diagnostics distinguish propagation and
            // arbitration failures without changing the assertion or polling.
            for id in SubscriptionStore.productIDs {
                if case .verified(let transaction)? = await Transaction.latest(for: id) {
                    print("StoreKit fixture latest: product=\(id) id=\(transaction.id) purchase=\(transaction.purchaseDate) expiry=\(String(describing: transaction.expirationDate)) revoked=\(String(describing: transaction.revocationDate)) upgraded=\(transaction.isUpgraded)")
                    if let group = transaction.subscriptionGroupID,
                       let statuses = try? await Product.SubscriptionInfo.status(for: group) {
                        for status in statuses {
                            if case .verified(let value) = status.transaction {
                                print("StoreKit fixture status: state=\(status.state) product=\(value.productID) id=\(value.id) purchase=\(value.purchaseDate) expiry=\(String(describing: value.expirationDate)) revoked=\(String(describing: value.revocationDate)) upgraded=\(value.isUpgraded)")
                            }
                        }
                    }
                }
            }
            for await result in Transaction.currentEntitlements {
                if case .verified(let value) = result {
                    print("StoreKit fixture current: product=\(value.productID) id=\(value.id) purchase=\(value.purchaseDate) expiry=\(String(describing: value.expirationDate)) revoked=\(String(describing: value.revocationDate)) upgraded=\(value.isUpgraded)")
                }
            }
        }
        XCTAssertEqual(store.hasPro, expected, file: file, line: line)
        let policy = await store.currentPolicy()
        XCTAssertEqual(policy, expected ? .unrestricted : .free, file: file, line: line)
    }

    private func assertPlan(_ productID: String, store: SubscriptionStore,
                            file: StaticString = #filePath, line: UInt = #line) async throws {
        // Pro can remain active while StoreKit replaces its source (for
        // example, subscription to lifetime). Wait for that plan, not hasPro.
        for _ in 0..<40 {
            await store.refreshEntitlements()
            if store.plan?.productID == productID { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertEqual(store.plan?.productID, productID, file: file, line: line)
    }

    func testOverlappingRefreshNeverGrantsPolicyFromStaleUIState() async throws {
        let source = OverlappingEntitlements()
        let store = SubscriptionStore(entitlementReader: { await source.read() })
        await store.refreshEntitlements()
        XCTAssertTrue(store.hasPro)
        let policyRead = Task { await store.currentPolicy() }
        for _ in 0..<1_000 {
            if await source.calls >= 2 { break }
            await Task.yield()
        }
        let newerRefresh = Task { await store.refreshEntitlements() }
        for _ in 0..<1_000 {
            if await source.calls >= 3 { break }
            await Task.yield()
        }
        await source.resume(2, value: false)
        let policy = await policyRead.value
        XCTAssertEqual(policy, .free)
        await source.resume(3, value: false)
        _ = await newerRefresh.value
        XCTAssertFalse(store.hasPro)
    }

    func testPricesPurchaseCancelRenewalRestoreAndExpiry() async throws {
        let session = try session()
        defer { session.clearTransactions() }
        let store = makeStore(session: session)
        await store.start()
        defer { store.stop() }
        await assertAccess(false, store: store)
        await store.loadProducts()
        XCTAssertEqual(store.products.count, 3)
        let monthly = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.monthlyID })
        let annual = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.annualID })
        XCTAssertEqual(monthly.price, Decimal(string: "1.99"))
        XCTAssertEqual(annual.price, Decimal(string: "9.99"))
        await store.purchase(monthly)
        await assertAccess(true, store: store)
        XCTAssertEqual(store.plan?.productID, SubscriptionStore.monthlyID)
        XCTAssertEqual(store.plan?.renewal, .renews)
        XCTAssertNotNil(store.plan?.date)
        let transaction = try XCTUnwrap(session.allTransactions().first)
        try session.disableAutoRenewForTransaction(identifier: transaction.identifier)
        await assertAccess(true, store: store)
        for _ in 0..<40 {
            await store.refreshEntitlements()
            if store.plan?.renewal == .ends { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertEqual(store.plan?.renewal, .ends)
        XCTAssertFalse(store.plan?.isComplimentary ?? true)
        let restored = makeStore(session: session)
        await restored.restore()
        await assertAccess(true, store: restored)
        try session.expireSubscription(productIdentifier: SubscriptionStore.monthlyID)
        await store.restore()
        await assertAccess(false, store: store)
        XCTAssertNil(store.plan)
    }

    func testGiftAllowsProductLoadingAndPurchaseWithoutChangingItsDeadline() async throws {
        let session = try session()
        defer { session.clearTransactions() }
        let gift = EarlyUserProGift(storage: InMemoryTokenStore(), eligibilityReader: { true })
        let store = makeStore(session: session, gift: gift)
        await store.beginForegroundVisit()
        defer { store.stop() }
        let deadline = try XCTUnwrap(store.complimentaryExpiresAt)
        XCTAssertTrue(store.hasPro)
        XCTAssertNil(store.plan)
        await store.loadProducts()
        XCTAssertEqual(Set(store.products.map(\.id)), SubscriptionStore.productIDs)
        XCTAssertEqual(store.complimentaryExpiresAt, deadline)
        let annual = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.annualID })
        await store.purchase(annual)
        for _ in 0..<40 {
            await store.refreshEntitlements()
            if store.plan?.productID == SubscriptionStore.annualID { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertTrue(store.hasPro)
        XCTAssertEqual(store.plan?.productID, SubscriptionStore.annualID)
        XCTAssertNil(store.complimentaryExpiresAt, "Verified paid access takes priority over the gift")
        let transaction = try XCTUnwrap(session.allTransactions().first)
        try session.disableAutoRenewForTransaction(identifier: transaction.identifier)
        try session.expireSubscription(productIdentifier: SubscriptionStore.annualID)
        // StoreKit's status stream can lag the fixture's expiry operation.
        for _ in 0..<40 {
            await store.refreshEntitlements()
            if store.complimentaryExpiresAt != nil { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertTrue(store.hasPro, "The original gift remains available after paid access ends")
        XCTAssertEqual(store.complimentaryExpiresAt, deadline, "A purchase must not restart or extend the gift")
    }

    func testLifetimePurchaseRestoreCoexistsWithSubscriptionExpiryAndRefund() async throws {
        let session = try session()
        defer { session.clearTransactions() }
        let store = makeStore(session: session)
        await store.start()
        defer { store.stop() }
        await store.loadProducts()
        let lifetime = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.lifetimeID })
        XCTAssertEqual(lifetime.type, .nonConsumable)
        XCTAssertEqual(lifetime.price, Decimal(string: "20.00"))
        // An expired subscription must not mask a permanent purchase.
        _ = try await session.buyProduct(identifier: SubscriptionStore.monthlyID)
        await store.purchase(lifetime)
        await assertAccess(true, store: store)
        try await assertPlan(SubscriptionStore.lifetimeID, store: store)
        XCTAssertEqual(store.plan?.name, "Lifetime")
        XCTAssertEqual(store.plan?.status, "Lifetime Pro")
        XCTAssertNil(store.plan?.date)
        try session.expireSubscription(productIdentifier: SubscriptionStore.monthlyID)
        await assertAccess(true, store: store)
        try await assertPlan(SubscriptionStore.lifetimeID, store: store)
        XCTAssertEqual(store.plan?.isLifetime, true)

        let restored = makeStore(session: session)
        await restored.restore()
        await assertAccess(true, store: restored)
        XCTAssertEqual(restored.plan?.isLifetime, true)
        let purchase = try XCTUnwrap(session.allTransactions().first {
            $0.productIdentifier == SubscriptionStore.lifetimeID
        })
        try session.refundTransaction(identifier: purchase.identifier)
        await assertAccess(false, store: store)
        XCTAssertNil(store.plan)
    }

    func testLifetimeRefundFallsBackToActiveSubscription() async throws {
        let session = try session()
        defer { session.clearTransactions() }
        let store = makeStore(session: session)
        _ = try await session.buyProduct(identifier: SubscriptionStore.annualID)
        let lifetime = try await session.buyProduct(identifier: SubscriptionStore.lifetimeID)
        await assertAccess(true, store: store)
        try await assertPlan(SubscriptionStore.lifetimeID, store: store)
        XCTAssertEqual(store.plan?.isLifetime, true)
        try session.refundTransaction(identifier: UInt(lifetime.id))
        await assertAccess(true, store: store)
        try await assertPlan(SubscriptionStore.annualID, store: store)
    }

    func testPendingLifetimeDoesNotGrantAccess() async throws {
        let session = try session()
        defer { session.clearTransactions() }
        let store = SubscriptionStore(purchaseAction: { _ in .pending }, restoreAction: {})
        await store.loadProducts()
        let lifetime = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.lifetimeID })
        await store.purchase(lifetime)
        await assertAccess(false, store: store)
        XCTAssertTrue(store.message?.contains("pending") == true)
        _ = try await session.buyProduct(identifier: SubscriptionStore.lifetimeID)
        await assertAccess(true, store: store)
        try await assertPlan(SubscriptionStore.lifetimeID, store: store)
        XCTAssertEqual(store.plan?.isLifetime, true)
    }

    func testPendingWaitsForVerifiedPurchaseAndRefundRemovesAccess() async throws {
        let session = try session()
        defer { session.clearTransactions() }
        let store = SubscriptionStore(purchaseAction: { _ in .pending }, restoreAction: {})
        await store.start()
        defer { store.stop() }
        await store.loadProducts()
        let product = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.annualID })
        await store.purchase(product)
        await assertAccess(false, store: store)
        XCTAssertTrue(store.message?.contains("pending") == true)
        // Simulate the later externally completed purchase. The pending
        // app result itself never grants access; verified StoreKit does.
        let confirmed = try await session.buyProduct(identifier: product.id)
        await assertAccess(true, store: store)
        XCTAssertNil(store.message, "Approval must clear the pending-purchase message")
        try session.refundTransaction(identifier: UInt(confirmed.id))
        await assertAccess(false, store: store)
    }

    func testCanceledPurchaseLeavesFreeAccess() async throws {
        let session = try session()
        defer { session.clearTransactions() }
        let store = SubscriptionStore(purchaseAction: { _ in .userCancelled }, restoreAction: {})
        await store.loadProducts()
        let product = try XCTUnwrap(store.products.first)
        await store.purchase(product)
        await assertAccess(false, store: store)
        XCTAssertNil(store.message)
    }

    func testBillingGraceKeepsProAccess() async throws {
        let session = try session()
        defer { session.clearTransactions() }
        session.shouldEnterBillingRetryOnRenewal = true
        session.billingGracePeriodIsEnabled = true
        let store = makeStore(session: session)
        _ = try await session.buyProduct(identifier: SubscriptionStore.monthlyID)
        try session.forceRenewalOfSubscription(productIdentifier: SubscriptionStore.monthlyID)
        await store.loadProducts()
        let product = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.monthlyID })
        var enteredGrace = false
        for _ in 0..<40 {
            enteredGrace = try await product.subscription?.status.contains { $0.state == .inGracePeriod } ?? false
            if enteredGrace { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertTrue(enteredGrace)
        await assertAccess(true, store: store)
        XCTAssertEqual(store.plan?.renewal, .grace)
        XCTAssertNotNil(store.plan?.date)
    }

    func testComplimentaryCopyRequiresFreeCodeAndRenewalOff() {
        let end = Date().addingTimeInterval(3600)
        let gift = ProPlanDetails(productID: SubscriptionStore.annualID, date: end,
            renewal: .ends, isFreeOfferCode: true)
        XCTAssertTrue(gift.isComplimentary)
        XCTAssertEqual(gift.dateLabel, "Access ends")
        XCTAssertTrue(gift.explanation.contains("no automatic charge"))
        for renewal in [ProPlanDetails.Renewal.unknown, .renews, .grace] {
            let uncertainOrRenewing = ProPlanDetails(productID: SubscriptionStore.annualID,
                date: end, renewal: renewal, isFreeOfferCode: true)
            XCTAssertFalse(uncertainOrRenewing.isComplimentary)
            XCTAssertFalse(uncertainOrRenewing.explanation.contains("no automatic charge"))
        }
        let canceledPaid = ProPlanDetails(productID: SubscriptionStore.annualID,
            date: end, renewal: .ends, isFreeOfferCode: false)
        XCTAssertFalse(canceledPaid.isComplimentary)
        XCTAssertEqual(canceledPaid.status, "Pro · Renewal off")
    }

    func testCurrentPurchaseOnlyOutranksOlderStatusInItsGroup() {
        let now = Date()
        let current = SubscriptionStore.EntitlementRevision(transactionID: 2, groupID: "pro",
            purchaseDate: now.addingTimeInterval(-10), expirationDate: now.addingTimeInterval(3600))
        let older = SubscriptionStore.EntitlementRevision(transactionID: 1, groupID: "pro",
            purchaseDate: now.addingTimeInterval(-100), expirationDate: now.addingTimeInterval(-20))
        XCTAssertTrue(SubscriptionStore.isNewerCurrentEntitlement(current, than: [older], now: now))
        // Matching status remains authoritative even for forced expiry or refund.
        var matching = current
        matching.expirationDate = now.addingTimeInterval(-1)
        XCTAssertFalse(SubscriptionStore.isNewerCurrentEntitlement(current, than: [matching], now: now))
        var newer = older
        newer.transactionID = 3
        newer.purchaseDate = now
        XCTAssertFalse(SubscriptionStore.isNewerCurrentEntitlement(current, than: [newer], now: now))
        var ambiguous = older
        ambiguous.purchaseDate = current.purchaseDate
        XCTAssertFalse(SubscriptionStore.isNewerCurrentEntitlement(current, than: [ambiguous], now: now))
        var expiredCurrent = current
        expiredCurrent.expirationDate = now.addingTimeInterval(-1)
        XCTAssertFalse(SubscriptionStore.isNewerCurrentEntitlement(expiredCurrent, than: [older], now: now))
        newer.groupID = "other"
        XCTAssertTrue(SubscriptionStore.isNewerCurrentEntitlement(current, than: [older, newer], now: now))
    }

    func testFreeAccessNeverKeepsStalePlanDetails() async {
        let stale = ProPlanDetails(productID: SubscriptionStore.annualID, date: .distantPast,
            renewal: .ends, isFreeOfferCode: true)
        let store = SubscriptionStore(accessReader: { ProAccessSnapshot(hasPro: false, plan: stale) })
        await store.refreshEntitlements()
        XCTAssertFalse(store.hasPro)
        XCTAssertNil(store.plan)
    }
}
