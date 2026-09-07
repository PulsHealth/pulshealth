import Foundation
import HealthKit

/// Aggregation function for an aggregate series. Maps 1:1 to an
/// `HKStatisticsOptions` member. Which functions are legal for a quantity type
/// depends on its `HKQuantityAggregationStyle` — asking HealthKit for an
/// incompatible one raises an ObjC exception (crash), so the legal set comes
/// from `HealthTypeCatalog.allowedAggregateFunctions(for:)` and is enforced
/// both in the UI and again before query construction.
public enum AggregateFunction: String, Codable, Sendable, CaseIterable, Identifiable {
    case sum
    case average
    case min
    case max
    case mostRecent
    case duration

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .sum: return "Sum"
        case .average: return "Average"
        case .min: return "Minimum"
        case .max: return "Maximum"
        case .mostRecent: return "Most Recent"
        case .duration: return "Duration"
        }
    }

    var statisticsOption: HKStatisticsOptions {
        switch self {
        case .sum: return .cumulativeSum
        case .average: return .discreteAverage
        case .min: return .discreteMin
        case .max: return .discreteMax
        case .mostRecent: return .mostRecent
        case .duration: return .duration
        }
    }
}

/// Calendar unit for aggregate bucket intervals. Buckets are always computed
/// with `DateComponents` (never fixed seconds) so day/week/month buckets stay
/// aligned across DST transitions and month-length changes.
public enum AggregateIntervalUnit: String, Codable, Sendable, CaseIterable, Identifiable {
    case minute
    case hour
    case day
    case week
    case month

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .minute: return "Minute"
        case .hour: return "Hour"
        case .day: return "Day"
        case .week: return "Week"
        case .month: return "Month"
        }
    }

    /// Approximate length — used only for bucket-index estimation and lookback
    /// sizing. Boundaries themselves are always calendar-computed.
    var approximateSeconds: TimeInterval {
        switch self {
        case .minute: return 60
        case .hour: return 3_600
        case .day: return 86_400
        case .week: return 604_800
        case .month: return 2_629_800 // 30.44 days
        }
    }

    /// Components for `value × count` intervals. Weeks use day-based components
    /// so the anchor alone defines the phase (weekOfYear depends on the
    /// calendar's first-weekday configuration).
    func dateComponents(value: Int, times count: Int = 1) -> DateComponents {
        let n = value * count
        switch self {
        case .minute: return DateComponents(minute: n)
        case .hour: return DateComponents(hour: n)
        case .day: return DateComponents(day: n)
        case .week: return DateComponents(day: 7 * n)
        case .month: return DateComponents(month: n)
        }
    }
}

/// Restrict an aggregate to samples written by one device class. Filtering
/// deliberately bypasses HealthKit's cross-source dedup (you're choosing one
/// device's view of the data).
public enum AggregateDeviceFilter: String, Codable, Sendable, CaseIterable, Identifiable {
    case all
    case watch
    case iphone

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .all: return "All Devices"
        case .watch: return "Apple Watch"
        case .iphone: return "iPhone"
        }
    }

    /// `HKDevicePropertyKeyModel` value (`HKDevice.model`), nil = no predicate.
    var deviceModelString: String? {
        switch self {
        case .all: return nil
        case .watch: return "Watch"
        case .iphone: return "iPhone"
        }
    }
}

/// One configured aggregate series: a quantity type computed on-device with
/// `HKStatisticsCollectionQuery` into fixed calendar buckets and synced to the
/// server. Multiple configs per type are allowed, and configs are independent
/// of whether raw-sample sync is enabled for the type.
public struct AggregateConfig: Codable, Sendable, Equatable, Hashable, Identifiable {
    public var id: UUID
    /// Quantity-type identifier (statistics queries exist only for quantity types).
    public var typeIdentifier: String
    public var function: AggregateFunction
    /// Interval = `intervalValue` × `intervalUnit`, e.g. 5 × minute.
    public var intervalValue: Int
    public var intervalUnit: AggregateIntervalUnit
    public var deviceFilter: AggregateDeviceFilter
    /// Earliest bucket start. Nil = use the global `SyncConfiguration.startDate`.
    public var startDate: Date?
    /// Buckets whose end is within this of "now" are not uploaded yet, giving
    /// late-arriving Watch data time to land before the bucket is computed.
    public var settleDelay: TimeInterval
    public var enabled: Bool

    public init(
        id: UUID = UUID(),
        typeIdentifier: String,
        function: AggregateFunction,
        intervalValue: Int = 1,
        intervalUnit: AggregateIntervalUnit = .day,
        deviceFilter: AggregateDeviceFilter = .all,
        startDate: Date? = nil,
        settleDelay: TimeInterval = 3_600,
        enabled: Bool = true
    ) {
        self.id = id
        self.typeIdentifier = typeIdentifier
        self.function = function
        self.intervalValue = max(1, intervalValue)
        self.intervalUnit = intervalUnit
        self.deviceFilter = deviceFilter
        self.startDate = startDate
        self.settleDelay = settleDelay
        self.enabled = enabled
    }

    public var intervalComponents: DateComponents {
        intervalUnit.dateComponents(value: intervalValue)
    }

    public var approximateIntervalSeconds: TimeInterval {
        Double(intervalValue) * intervalUnit.approximateSeconds
    }

    /// The fields that identify the series on the server (its natural key).
    /// Changing any of them makes this a different series: the editor resets
    /// the local watermark so the new series backfills from scratch.
    public var seriesIdentity: String {
        "\(typeIdentifier)|\(function.rawValue)|\(intervalValue)|\(intervalUnit.rawValue)|\(deviceFilter.rawValue)"
    }

    /// Canonical wire unit: the catalog unit for the type, or seconds for duration.
    public var unitString: String? {
        function == .duration
            ? "s"
            : HealthTypeCatalog.descriptor(for: typeIdentifier)?.unitString
    }

    /// "1 hour", "5 min", "2 weeks" — for UI labels.
    public var intervalLabel: String {
        let unit = intervalUnit.displayName.lowercased()
        return intervalValue == 1 ? "1 \(unit)" : "\(intervalValue) \(unit)s"
    }

    /// "Average · 1 hour · Apple Watch" — for UI rows and log lines.
    public var summaryLabel: String {
        var parts = [function.displayName, intervalLabel]
        if deviceFilter != .all { parts.append(deviceFilter.displayName) }
        return parts.joined(separator: " · ")
    }
}

public extension HealthTypeCatalog {
    /// Legal aggregate functions for a catalog type, derived at runtime from
    /// `HKQuantityType.aggregationStyle` (not a hand-maintained table). Empty
    /// for non-quantity types and unknown future aggregation styles.
    ///
    /// Never construct a statistics query with a function outside this set —
    /// HealthKit raises NSInvalidArgumentException when the query *executes*
    /// (not at construction), which Swift cannot catch: it's a crash.
    ///
    /// The mapping is verified empirically against every catalog type by the
    /// app-hosted `AggregateMatrixTests` (it probes all type × function combos
    /// behind an ObjC exception catcher and fails on any mismatch in either
    /// direction). Verified on the iOS 26 simulator: sum is cumulative-only,
    /// average/min/max work for every discrete style (including temporally
    /// weighted, e.g. heart rate), and mostRecent/duration work everywhere.
    /// Re-run that test on new iOS releases before trusting changes here.
    static func allowedAggregateFunctions(for identifier: String) -> [AggregateFunction] {
        guard let descriptor = descriptor(for: identifier),
              descriptor.kind == .quantity else { return [] }
        let quantityType = HKQuantityType(HKQuantityTypeIdentifier(rawValue: identifier))
        switch quantityType.aggregationStyle {
        case .cumulative:
            return [.sum, .mostRecent, .duration]
        case .discreteArithmetic, .discreteTemporallyWeighted, .discreteEquivalentContinuousLevel:
            return [.average, .min, .max, .mostRecent, .duration]
        @unknown default:
            return []
        }
    }
}
