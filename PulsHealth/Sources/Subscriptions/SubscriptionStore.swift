import Foundation
import Observation
import StoreKit
import PulsHealthSync

/// Apple is the source of truth. No account, receipt server, third-party SDK,
/// or persisted "isPro" flag. Current entitlements include billing grace.
@MainActor @Observable
final class SubscriptionStore {
    nonisolated static let monthlyID = "com.pulsHealth.PulsHealth.pro.monthly"
    nonisolated static let annualID = "com.pulsHealth.PulsHealth.pro.annual"
    nonisolated static let productIDs: Set<String> = [monthlyID, annualID]

    private(set) var hasPro = false
    private(set) var isLoaded = false
    private(set) var products: [Product] = []
    private(set) var isBusy = false
    private(set) var message: String?
    @ObservationIgnored private var updates: Task<Void, Never>?
    @ObservationIgnored private var statusUpdates: Task<Void, Never>?
    @ObservationIgnored private var refreshGeneration = 0
    typealias PurchaseAction = @MainActor (Product) async throws -> Product.PurchaseResult
    typealias RestoreAction = @MainActor () async throws -> Void
    @ObservationIgnored private let purchaseAction: PurchaseAction
    @ObservationIgnored private let restoreAction: RestoreAction
    @ObservationIgnored private let observesTransactions: Bool
    @ObservationIgnored private let entitlementReader: @Sendable () async -> Bool

    init(
        entitlementReader: (@Sendable () async -> Bool)? = nil,
        purchaseAction: @escaping PurchaseAction = { try await $0.purchase() },
        restoreAction: @escaping RestoreAction = { try await AppStore.sync() }
    ) {
        self.purchaseAction = purchaseAction
        self.restoreAction = restoreAction
        self.entitlementReader = entitlementReader ?? Self.readEntitlement
        self.observesTransactions = entitlementReader == nil
    }

    nonisolated static func readEntitlement() async -> Bool {
        var currentEntitlement = false
        var groups: Set<String> = []
        let now = Date()
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  productIDs.contains(transaction.productID) else { continue }
            if let group = transaction.subscriptionGroupID { groups.insert(group) }
            if transaction.revocationDate == nil, !transaction.isUpgraded {
                // Apple's current-entitlements sequence includes active and
                // billing-grace subscriptions. Preserve that verified grant
                // offline if renewal status cannot be looked up, even when
                // the paid transaction's expiration predates its grace end.
                currentEntitlement = true
            }
        }
        // Status changes (expiry, grace and billing retry) can precede a
        // refreshed current-entitlements sequence. Prefer verified renewal
        // status and its explicit deadline, including Apple's grace deadline.
        for id in productIDs {
            if case .verified(let transaction)? = await Transaction.latest(for: id),
               let group = transaction.subscriptionGroupID { groups.insert(group) }
        }
        var hasVerifiedStatus = false
        var statusEntitled = false
        for group in groups {
            guard let statuses = try? await Product.SubscriptionInfo.status(for: group) else { continue }
            for status in statuses {
                guard case .verified(let transaction) = status.transaction,
                      case .verified(let renewal) = status.renewalInfo,
                      productIDs.contains(transaction.productID) else { continue }
                hasVerifiedStatus = true
                guard transaction.revocationDate == nil, !transaction.isUpgraded else { continue }
                let deadline: Date?
                switch status.state {
                case .subscribed: deadline = transaction.expirationDate
                case .inGracePeriod: deadline = renewal.gracePeriodExpirationDate
                default: deadline = nil
                }
                if let deadline, deadline > now { statusEntitled = true }
            }
        }
        return hasVerifiedStatus ? statusEntitled : currentEntitlement
    }

    func start() async {
        guard observesTransactions else { await refreshEntitlements(); return }
        if updates == nil {
            updates = Task { [weak self] in
                for await result in Transaction.updates {
                    guard let self else { return }
                    if case .verified(let transaction) = result,
                       Self.productIDs.contains(transaction.productID) {
                        await self.refreshEntitlements()
                        await transaction.finish()
                    }
                }
            }
        }
        if statusUpdates == nil {
            statusUpdates = Task { [weak self] in
                for await status in Product.SubscriptionInfo.Status.updates {
                    guard let self else { return }
                    if case .verified(let transaction) = status.transaction,
                       Self.productIDs.contains(transaction.productID) {
                        await self.refreshEntitlements()
                    }
                }
            }
        }
        await refreshEntitlements()
    }

    @discardableResult
    func refreshEntitlements() async -> Bool {
        refreshGeneration += 1
        let generation = refreshGeneration
        let entitled = await entitlementReader()
        if generation == refreshGeneration {
            hasPro = entitled
            isLoaded = true
        }
        return entitled
    }

    /// Checked by background/observer paths too, even without a foreground
    /// scene. Expiration and revocation never rely on a stale UI snapshot.
    func currentPolicy() async -> SyncAccessPolicy {
        let entitled = await refreshEntitlements()
        return entitled ? .unrestricted : .free
    }

    func loadProducts() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        message = nil
        do {
            products = try await Product.products(for: Self.productIDs)
                .sorted { $0.price < $1.price }
            if products.count != Self.productIDs.count {
                message = "Subscriptions are currently unavailable. You can keep using PulsHealth Free and try again later."
            }
        } catch {
            message = "Subscriptions could not be loaded. Check your connection and try again."
        }
    }

    func purchase(_ product: Product) async {
        guard !isBusy, Self.productIDs.contains(product.id) else { return }
        isBusy = true
        defer { isBusy = false }
        message = nil
        do {
            switch try await purchaseAction(product) {
            case .success(.verified(let transaction)):
                await refreshEntitlements()
                await transaction.finish()
                message = hasPro ? "PulsHealth Pro is active." : "Purchase received. Restore purchases if access has not appeared yet."
            case .success(.unverified):
                message = "Apple could not verify this purchase. Pro has not been unlocked. Try restoring purchases."
            case .pending:
                message = "Purchase pending approval. Pro will unlock when Apple confirms it."
            case .userCancelled:
                break
            @unknown default:
                message = "The purchase could not be completed. Please try again."
            }
        } catch {
            message = "The purchase could not be completed. Please try again."
        }
    }

    func restore() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await restoreAction()
            await refreshEntitlements()
            message = hasPro ? "PulsHealth Pro has been restored." : "No active Pro subscription was found for this Apple Account."
        } catch {
            message = "Purchases could not be restored. Please try again."
        }
    }

    func stop() {
        updates?.cancel(); updates = nil
        statusUpdates?.cancel(); statusUpdates = nil
    }
    deinit { updates?.cancel(); statusUpdates?.cancel() }
}
