import Foundation

/// Optional app-level limits. The standalone sync package is unrestricted by
/// default; an embedding app can supply its current access at each sync entry.
public struct SyncAccessPolicy: Sendable, Equatable {
    public var maximumTypes: Int?
    public var historyDays: Int?

    public init(maximumTypes: Int? = nil, historyDays: Int? = nil) {
        self.maximumTypes = maximumTypes
        self.historyDays = historyDays
    }

    public static let unrestricted = SyncAccessPolicy()
    public static let free = SyncAccessPolicy(maximumTypes: 5, historyDays: 30)

    public func earliestDate(now: Date = Date(), calendar: Calendar = .current) -> Date? {
        historyDays.flatMap { calendar.date(byAdding: .day, value: -$0, to: calendar.startOfDay(for: now)) }
    }

    /// Keep an unknown HealthKit limit unknown. A known fallback must still
    /// respect today's app limit if Apple cannot refresh its history answer.
    func limitingRecordedDate(_ recorded: Date?, now: Date = Date(), calendar: Calendar = .current) -> Date? {
        guard let recorded else { return nil }
        return max(recorded, earliestDate(now: now, calendar: calendar) ?? recorded)
    }

    public func allows(_ configuration: SyncConfiguration) -> Bool {
        maximumTypes.map { configuration.observedTypeIdentifiers.count <= $0 } ?? true
    }

    public func allowsExport(start: Date?, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard let earliest = earliestDate(now: now, calendar: calendar) else { return true }
        return start.map { $0 >= earliest } ?? false
    }
}

extension HealthSyncEngine {
    /// Does not remove types or rewrite the person's saved configuration. A
    /// selection over the limit pauses in full until it is edited or upgraded.
    func allowsSync(types: Set<String> = []) async -> Bool {
        let policy = await accessPolicy()
        let config = await store.configuration
        let allowed = policy.allows(config)
            && (policy.maximumTypes == nil || types.isSubset(of: config.observedTypeIdentifiers))
        if !allowed {
            await eventLog.log(.info, "Sync paused: the selection exceeds the current plan. Choose up to 5 health data types or upgrade to PulsHealth Pro.")
        }
        return allowed
    }

    func limitedSyncStart(_ start: Date) async -> Date {
        let policy = await accessPolicy()
        return max(start, policy.earliestDate() ?? start)
    }

    /// Combine app access with HealthKit access only for sync. Explore still
    /// receives HealthKit's own dates, without the app's subscription limit.
    func syncReadableDates(_ healthDates: [String: Date], for identifiers: Set<String>) async -> [String: Date] {
        guard let earliest = await accessPolicy().earliestDate() else { return healthDates }
        var dates = healthDates
        for id in identifiers { dates[id] = max(dates[id] ?? earliest, earliest) }
        return dates
    }
}
