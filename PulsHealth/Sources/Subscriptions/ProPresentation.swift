import Foundation

/// The task stays in its draft. Upgrading never exports or applies settings.
enum ProContext: Equatable {
    case plan, exportHistory, syncTypes(Int), syncHistory, dataRequestHistory

    var title: String {
        switch self {
        case .plan: "More history. More sync."
        case .exportHistory: "Export your full history."
        case .syncTypes(let count): "Sync all \(count) selected types."
        case .syncHistory: "Keep your history in sync."
        case .dataRequestHistory: "Share older history."
        }
    }

    var explanation: String {
        switch self {
        case .plan: "Go beyond the most recent 30 days, with unlimited health data types for automatic sync."
        case .exportHistory: "Your export selection is saved. Pro lets you include older Apple Health data."
        case .syncTypes: "Free automatic sync includes 5 distinct types. Pro keeps your full selection available. Raw readings and aggregates of the same type count once."
        case .syncHistory: "Pro removes the app’s 30-day history limit for automatic sync."
        case .dataRequestHistory: "Pro includes older Apple Health data in one-time exports and Data Requests."
        }
    }

    var returnTitle: String? {
        switch self {
        case .plan: nil
        case .exportHistory: "Return to your export"
        case .syncTypes, .syncHistory: "Return to your sync settings"
        case .dataRequestHistory: "Return to your Data Request"
        }
    }
}

/// Presentation facts from verified StoreKit data. Never grants access.
struct ProPlanDetails: Sendable, Equatable {
    enum Renewal: Sendable, Equatable { case unknown, renews, ends, grace }
    let productID: String
    let date: Date?
    let renewal: Renewal
    let isFreeOfferCode: Bool

    var isLifetime: Bool { productID == SubscriptionStore.lifetimeID }
    var name: String {
        if isLifetime { return "Lifetime" }
        return productID == SubscriptionStore.annualID ? "Yearly" : "Monthly"
    }

    var isComplimentary: Bool { isFreeOfferCode && renewal == .ends }

    var status: String {
        if isLifetime { return "Lifetime Pro" }
        if isComplimentary { return "Complimentary Pro" }
        switch renewal {
        case .unknown, .renews: return "Pro is active"
        case .ends: return "Pro · Renewal off"
        case .grace: return "Pro · Billing grace"
        }
    }

    var dateLabel: String {
        switch renewal {
        case .renews: "Renews"
        case .ends: "Access ends"
        case .grace: "Grace period ends"
        case .unknown: "Current period through"
        }
    }

    var explanation: String {
        if isLifetime { return "One-time purchase. All current and future PulsHealth app features are included. PulsHealth server, hosting and other services are separate. If you previously subscribed, manage that subscription in your Apple Account to stop its renewal." }
        if isComplimentary { return "Your complimentary access ends automatically. There is no automatic charge afterward." }
        switch renewal {
        case .unknown: return "Renewal details are currently unavailable. Check your Apple Account to manage this subscription."
        case .renews: return "Manage or cancel your subscription through your Apple Account."
        case .ends: return "Automatic renewal is off. You keep Pro through the end of your current period."
        case .grace: return "Pro remains available during Apple’s billing grace period. Review your payment details in the App Store."
        }
    }
}

struct ProAccessSnapshot: Sendable {
    let hasPro: Bool
    var plan: ProPlanDetails?
}
