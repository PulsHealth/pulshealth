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
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Pro", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: url)
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
        return session
    }

    private func makeStore(session: SKTestSession) -> SubscriptionStore {
        SubscriptionStore(purchaseAction: { product in
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
        XCTAssertEqual(store.hasPro, expected, file: file, line: line)
        let policy = await store.currentPolicy()
        XCTAssertEqual(policy, expected ? .unrestricted : .free, file: file, line: line)
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
        XCTAssertEqual(store.products.count, 2)
        let monthly = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.monthlyID })
        let annual = try XCTUnwrap(store.products.first { $0.id == SubscriptionStore.annualID })
        XCTAssertEqual(monthly.price, Decimal(string: "1.99"))
        XCTAssertEqual(annual.price, Decimal(string: "9.99"))
        await store.purchase(monthly)
        await assertAccess(true, store: store)
        let transaction = try XCTUnwrap(session.allTransactions().first)
        try session.disableAutoRenewForTransaction(identifier: transaction.identifier)
        await assertAccess(true, store: store)
        let restored = makeStore(session: session)
        await restored.restore()
        await assertAccess(true, store: restored)
        try session.expireSubscription(productIdentifier: SubscriptionStore.monthlyID)
        await store.restore()
        await assertAccess(false, store: store)
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
    }
}
