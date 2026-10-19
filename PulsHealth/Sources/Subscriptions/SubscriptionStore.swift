import Foundation
import Observation
import StoreKit
import PulsHealthSync

/// Verified Apple purchases take priority over the device-local early-user
/// gift. Current subscription entitlements include billing grace.
@MainActor @Observable
final class SubscriptionStore {
    nonisolated static let monthlyID = "com.pulsHealth.PulsHealth.pro.monthly"
    nonisolated static let annualID = "com.pulsHealth.PulsHealth.pro.annual"
    nonisolated static let lifetimeID = "com.pulsHealth.PulsHealth.pro.lifetime"
    nonisolated static let subscriptionIDs: Set<String> = [monthlyID, annualID]
    nonisolated static let productIDs: Set<String> = [monthlyID, annualID, lifetimeID]

    private(set) var complimentaryExpiresAt: Date?
    private(set) var showsGiftWelcome = false
    @ObservationIgnored private let earlyUserGift: EarlyUserProGift?
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private var giftExpiry: Task<Void, Never>?
    private(set) var hasPro = false
    private(set) var plan: ProPlanDetails?
    private(set) var isLoaded = false
    private(set) var products: [Product] = []
    private(set) var isBusy = false
    private(set) var message: String?
    struct EntitlementRevision: Sendable {
        var transactionID: UInt64
        var groupID: String?
        var purchaseDate: Date
        var expirationDate: Date?
    }

    /// StoreKit's two verified streams can catch up in either order. A
    /// status for the same or a newer transaction remains authoritative;
    /// an older status cannot suppress a new, still-paid purchase.
    nonisolated static func isNewerCurrentEntitlement(
        _ current: EntitlementRevision, than statuses: [EntitlementRevision], now: Date
    ) -> Bool {
        guard let expiration = current.expirationDate, expiration > now else { return false }
        return statuses.filter { $0.groupID == current.groupID }.allSatisfy {
            $0.transactionID != current.transactionID && $0.purchaseDate < current.purchaseDate
        }
    }
    @ObservationIgnored private var updates: Task<Void, Never>?
    @ObservationIgnored private var statusUpdates: Task<Void, Never>?
    @ObservationIgnored private var refreshGeneration = 0
    typealias ProductReader = @MainActor () async throws -> [Product]
    @ObservationIgnored private let productReader: ProductReader
    typealias PurchaseAction = @MainActor (Product) async throws -> Product.PurchaseResult
    typealias RestoreAction = @MainActor () async throws -> Void
    @ObservationIgnored private let purchaseAction: PurchaseAction
    @ObservationIgnored private let restoreAction: RestoreAction
    @ObservationIgnored private let observesTransactions: Bool
    @ObservationIgnored private let accessReader: @Sendable () async -> ProAccessSnapshot

    init(
        entitlementReader: (@Sendable () async -> Bool)? = nil,
        accessReader: (@Sendable () async -> ProAccessSnapshot)? = nil,
        earlyUserGift: EarlyUserProGift? = nil,
        now: @escaping @MainActor () -> Date = Date.init,
        productReader: @escaping ProductReader = { try await Product.products(for: SubscriptionStore.productIDs) },
        purchaseAction: @escaping PurchaseAction = { try await $0.purchase() },
        restoreAction: @escaping RestoreAction = { try await AppStore.sync() }
    ) {
        self.now = now
        self.earlyUserGift = earlyUserGift ?? (entitlementReader == nil && accessReader == nil ? EarlyUserProGift() : nil)
        self.productReader = productReader
        self.purchaseAction = purchaseAction
        self.restoreAction = restoreAction
        if let accessReader {
            self.accessReader = accessReader
        } else if let entitlementReader {
            self.accessReader = { ProAccessSnapshot(hasPro: await entitlementReader()) }
        } else {
            self.accessReader = Self.readAccess
        }
        self.observesTransactions = entitlementReader == nil && accessReader == nil
    }

    nonisolated static func readAccess() async -> ProAccessSnapshot {
        var lifetimePlan: ProPlanDetails?
        var currentEntitlement = false
        var fallbackPlan: ProPlanDetails?
        var currentRevisions: [(revision: EntitlementRevision, plan: ProPlanDetails)] = []
        var groups: Set<String> = []
        let now = Date()
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  productIDs.contains(transaction.productID) else { continue }
            if transaction.productID == lifetimeID {
                if transaction.productType == .nonConsumable, transaction.revocationDate == nil {
                    lifetimePlan = ProPlanDetails(productID: lifetimeID, date: nil,
                        renewal: .unknown, isFreeOfferCode: false)
                }
                continue
            }
            guard transaction.productType == .autoRenewable else { continue }
            if let group = transaction.subscriptionGroupID { groups.insert(group) }
            if transaction.revocationDate == nil, !transaction.isUpgraded {
                // Apple's current-entitlements sequence includes active and
                // billing-grace subscriptions. Preserve that verified grant
                // offline if renewal status cannot be looked up, even when
                // the paid transaction's expiration predates its grace end.
                currentEntitlement = true
                let candidate = ProPlanDetails(
                    productID: transaction.productID,
                    date: transaction.expirationDate.flatMap { $0 > now ? $0 : nil },
                    renewal: .unknown, isFreeOfferCode: false)
                currentRevisions.append((EntitlementRevision(transactionID: transaction.id,
                    groupID: transaction.subscriptionGroupID, purchaseDate: transaction.purchaseDate,
                    expirationDate: transaction.expirationDate), candidate))
                if fallbackPlan == nil || (candidate.date ?? .distantPast) > (fallbackPlan?.date ?? .distantPast) {
                    fallbackPlan = candidate
                }
            }
        }
        // A lifetime purchase is independent of subscription status. Expiry,
        // grace or revocation in that group must never suppress lifetime access.
        if let lifetimePlan { return ProAccessSnapshot(hasPro: true, plan: lifetimePlan) }
        // Status changes (expiry, grace and billing retry) can precede a
        // refreshed current-entitlements sequence. Prefer verified renewal
        // status and its explicit deadline, including Apple's grace deadline.
        for id in subscriptionIDs {
            if case .verified(let transaction)? = await Transaction.latest(for: id),
               let group = transaction.subscriptionGroupID { groups.insert(group) }
        }
        var hasVerifiedStatus = false
        var statusEntitled = false
        var verifiedPlan: ProPlanDetails?
        var statusRevisions: [EntitlementRevision] = []
        for group in groups {
            guard let statuses = try? await Product.SubscriptionInfo.status(for: group) else { continue }
            for status in statuses {
                guard case .verified(let transaction) = status.transaction,
                      case .verified(let renewal) = status.renewalInfo,
                      subscriptionIDs.contains(transaction.productID) else { continue }
                hasVerifiedStatus = true
                statusRevisions.append(EntitlementRevision(transactionID: transaction.id,
                    groupID: transaction.subscriptionGroupID, purchaseDate: transaction.purchaseDate,
                    expirationDate: transaction.expirationDate))
                guard transaction.revocationDate == nil, !transaction.isUpgraded else { continue }
                let deadline: Date?
                switch status.state {
                case .subscribed: deadline = transaction.expirationDate
                case .inGracePeriod: deadline = renewal.gracePeriodExpirationDate
                default: deadline = nil
                }
                if let deadline, deadline > now {
                    statusEntitled = true
                    let renewalState: ProPlanDetails.Renewal = status.state == .inGracePeriod
                        ? .grace : (renewal.willAutoRenew ? .renews : .ends)
                    var freeCode = false
                    if #available(iOS 17.2, *) {
                        freeCode = transaction.offer?.type == .code
                            && transaction.offer?.paymentMode == .freeTrial
                    }
                    let candidate = ProPlanDetails(productID: transaction.productID,
                        date: deadline, renewal: renewalState, isFreeOfferCode: freeCode)
                    if verifiedPlan == nil || deadline > (verifiedPlan?.date ?? .distantPast) {
                        verifiedPlan = candidate
                    }
                }
            }
        }
        if hasVerifiedStatus,
           let newer = currentRevisions.filter({
               Self.isNewerCurrentEntitlement($0.revision, than: statusRevisions, now: now)
           }).max(by: { $0.revision.purchaseDate < $1.revision.purchaseDate }) {
            // The new purchase is verified, but its renewal details have not
            // arrived. Do not borrow dates or renewal promises from old status.
            return ProAccessSnapshot(hasPro: true, plan: newer.plan)
        }
        return hasVerifiedStatus
            ? ProAccessSnapshot(hasPro: statusEntitled, plan: verifiedPlan)
            : ProAccessSnapshot(hasPro: currentEntitlement, plan: fallbackPlan)
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
        let access = await accessReader()
        let gift = earlyUserGift?.activeRecord(now: now())
        let giftEnd = !access.hasPro ? gift.map { Date(timeIntervalSince1970: $0.expiresAt) } : nil
        let entitled = access.hasPro || giftEnd != nil
        if generation == refreshGeneration {
            if entitled && !hasPro { message = nil }
            hasPro = entitled
            complimentaryExpiresAt = giftEnd
            showsGiftWelcome = giftEnd != nil && gift?.acknowledged == false
            scheduleGiftExpiry(giftEnd)
            plan = access.hasPro ? access.plan : nil
            isLoaded = true
        }
        return entitled
    }

    /// Only a foreground visit starts the clock. Background deliveries can
    /// use an existing gift, but cannot consume it before the person opens us.
    func beginForegroundVisit() async {
        await earlyUserGift?.activate(now: now())
        await refreshEntitlements()
    }

    func dismissGiftWelcome() {
        earlyUserGift?.acknowledge()
        showsGiftWelcome = false
    }

    private func scheduleGiftExpiry(_ date: Date?) {
        giftExpiry?.cancel()
        giftExpiry = nil
        guard let date else { return }
        let delay = max(0, date.timeIntervalSince(now()))
        giftExpiry = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            await self?.refreshEntitlements()
        }
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
            products = try await productReader()
                .sorted { $0.price < $1.price }
            if products.count != Self.productIDs.count {
                message = "Some Pro purchase options are currently unavailable. You can keep using PulsHealth Free and try again later."
            }
        } catch {
            message = "Pro purchase options could not be loaded. Check your connection and try again."
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
            if complimentaryExpiresAt != nil {
                message = "Your complimentary Pro gift is active. No active Pro purchase was found for this Apple Account."
            } else {
                message = hasPro ? "PulsHealth Pro has been restored." : "No active Pro purchase was found for this Apple Account."
            }
        } catch {
            message = "Purchases could not be restored. Please try again."
        }
    }

    func stop() {
        giftExpiry?.cancel(); giftExpiry = nil
        updates?.cancel(); updates = nil
        statusUpdates?.cancel(); statusUpdates = nil
    }
    deinit { updates?.cancel(); statusUpdates?.cancel(); giftExpiry?.cancel() }
}
