import Foundation

// What the app offers when someone sets up aggregates: each type's daily
// default, the plain words for a config ("Daily total"), the suggestions an
// Add Aggregate menu lists, and the edits the Sync and Export screens make to
// a list of configs. None of it changes what a config is or how it syncs:
// a daily default is an ordinary sum or average at one day, all devices.
//
// Every function offered here comes from
// `HealthTypeCatalog.allowedAggregateFunctions(for:)`. An illegal one is a
// HealthKit crash, not an error (CLAUDE.md, Gotchas).

public extension AggregateFunction {
    /// The value's plain name: Total, Average, Minimum, Maximum, Latest.
    var plainName: String {
        switch self {
        case .sum: return "Total"
        case .average: return "Average"
        case .min: return "Minimum"
        case .max: return "Maximum"
        case .mostRecent: return "Latest"
        case .duration: return "Duration"
        }
    }

    /// The values a new aggregate can take for a type, in menu order. Duration
    /// is left out (time covered by samples, rarely what anyone wants) but an
    /// existing config keeps it, labelled and editable.
    static func choices(for typeIdentifier: String) -> [AggregateFunction] {
        let allowed = HealthTypeCatalog.allowedAggregateFunctions(for: typeIdentifier)
        return [.sum, .average, .min, .max, .mostRecent].filter(allowed.contains)
    }
}

public extension AggregateIntervalUnit {
    /// The grains a new aggregate can take, each one of its unit. Older configs
    /// may hold others (5 minutes, 2 days); they keep working and stay
    /// editable, and `AggregateConfig.label` names them.
    static let choices: [AggregateIntervalUnit] = [.hour, .day, .week, .month]

    /// "Hourly", "Daily", … for an interval of one; nil for minutes.
    var adjective: String? {
        switch self {
        case .minute: return nil
        case .hour: return "Hourly"
        case .day: return "Daily"
        case .week: return "Weekly"
        case .month: return "Monthly"
        }
    }
}

public extension AggregateDeviceFilter {
    /// A device choice in a menu: "All Devices", "Apple Watch Only", "iPhone Only".
    var choiceName: String {
        switch self {
        case .all: return "All Devices"
        case .watch: return "Apple Watch Only"
        case .iphone: return "iPhone Only"
        }
    }
}

public extension AggregateConfig {
    /// A type's daily default: its daily total for a cumulative type (steps,
    /// energy), its daily average for a discrete one (heart rate, weight); one
    /// day, all devices. It is what the server's daily metrics read
    /// (`metric_daily`). Nil for a type that cannot be aggregated.
    static func dailyDefault(for typeIdentifier: String) -> AggregateConfig? {
        let allowed = HealthTypeCatalog.allowedAggregateFunctions(for: typeIdentifier)
        guard let function = [AggregateFunction.sum, .average].first(where: allowed.contains) else {
            return nil
        }
        return AggregateConfig(
            typeIdentifier: typeIdentifier, function: function,
            intervalValue: 1, intervalUnit: .day, deviceFilter: .all)
    }

    /// Whether this is its type's daily default, whatever its id and options.
    var isDailyDefault: Bool {
        Self.dailyDefault(for: typeIdentifier)?.seriesIdentity == seriesIdentity
    }

    /// The config in plain words: "Daily total", "Hourly average", "Daily
    /// maximum · Apple Watch", "Latest each day", "Average every 5 minutes".
    var label: String {
        let value = function.plainName
        let base: String
        if intervalValue == 1, let adjective = intervalUnit.adjective, function != .mostRecent {
            base = "\(adjective) \(value.lowercased())"
        } else if function == .mostRecent {
            base = "\(value) \(intervalValue == 1 ? "each" : "every") \(intervalPhrase)"
        } else {
            base = "\(value) every \(intervalPhrase)"
        }
        switch deviceFilter {
        case .all: return base
        case .watch: return "\(base) · Apple Watch"
        case .iphone: return "\(base) · iPhone"
        }
    }

    /// "day", "minute", "5 minutes".
    private var intervalPhrase: String {
        let unit = intervalUnit.displayName.lowercased()
        return intervalValue == 1 ? unit : "\(intervalValue) \(unit)s"
    }

    /// Roughly how many values the config produces between two dates: one per
    /// interval, whether or not it holds data.
    func approximateValueCount(from start: Date, to end: Date) -> Int {
        guard end > start else { return 0 }
        return Int((end.timeIntervalSince(start) / approximateIntervalSeconds).rounded(.up))
    }

    /// The same config with another value, interval or device: what the menus
    /// of an aggregate's row produce. Options (start date, settle delay) and
    /// the id carry over, so the sync sees the same config re-identified and
    /// recomputes it from scratch (`AppModel.resetReidentifiedAggregates`).
    func with(
        function: AggregateFunction? = nil,
        interval: (value: Int, unit: AggregateIntervalUnit)? = nil,
        deviceFilter: AggregateDeviceFilter? = nil
    ) -> AggregateConfig {
        var copy = self
        if let function { copy.function = function }
        if let interval {
            copy.intervalValue = max(1, interval.value)
            copy.intervalUnit = interval.unit
        }
        if let deviceFilter { copy.deviceFilter = deviceFilter }
        return copy
    }
}

/// An ordered list of aggregate configs, as the Sync configuration and the
/// export draft each hold one, with the edits their screens make. A type is
/// "aggregated" while it has at least one config; adding a type gives it its
/// daily default, removing it removes all of its configs.
public struct AggregateList: Equatable, Sendable {
    public var configs: [AggregateConfig]

    public init(_ configs: [AggregateConfig]) {
        self.configs = configs
    }

    /// Every catalog type on this OS that can be aggregated, in catalog order.
    public static var measurementTypes: [HealthTypeDescriptor] {
        HealthTypeCatalog.all.filter { AggregateConfig.dailyDefault(for: $0.identifier) != nil }
    }

    /// The types with at least one config.
    public var typeIdentifiers: Set<String> {
        Set(configs.map(\.typeIdentifier))
    }

    public func contains(type typeIdentifier: String) -> Bool {
        configs.contains { $0.typeIdentifier == typeIdentifier }
    }

    /// A type's configs, its daily default first and the rest as added.
    public func configs(for typeIdentifier: String) -> [AggregateConfig] {
        let mine = configs.filter { $0.typeIdentifier == typeIdentifier }
        return mine.filter(\.isDailyDefault) + mine.filter { !$0.isDailyDefault }
    }

    /// True when removing the type would lose more than its daily default:
    /// another config, or a default whose options were changed.
    public func hasMoreThanDefault(type typeIdentifier: String) -> Bool {
        configs(for: typeIdentifier).contains { config in
            guard config.isDailyDefault, let fresh = AggregateConfig.dailyDefault(for: typeIdentifier)
            else { return true }
            return config.startDate != fresh.startDate || config.settleDelay != fresh.settleDelay
                || config.enabled != fresh.enabled
        }
    }

    /// "Daily average", "Daily total, hourly total", "Daily average + 2 more";
    /// nil when the type has none.
    public func summary(for typeIdentifier: String) -> String? {
        let mine = configs(for: typeIdentifier)
        guard let first = mine.first else { return nil }
        switch mine.count {
        case 1: return first.label
        case 2: return "\(first.label), \(Self.lowercasedFirst(mine[1].label))"
        default: return "\(first.label) + \(mine.count - 1) more"
        }
    }

    private static func lowercasedFirst(_ text: String) -> String {
        text.prefix(1).lowercased() + text.dropFirst()
    }

    /// Whether `config` (new, or an edit of one already here) would duplicate
    /// another config's series. Computing the same buckets twice is waste.
    public func duplicates(_ config: AggregateConfig) -> Bool {
        configs.contains { $0.id != config.id && $0.seriesIdentity == config.seriesIdentity }
    }

    /// The common aggregates an Add Aggregate menu suggests for a type: its
    /// daily default when it lacks one, then, for a cumulative type, hourly,
    /// weekly and monthly totals and the daily total from each device; for a
    /// discrete one, the hourly average, daily minimum and maximum, and weekly
    /// and monthly averages. Ones the type already has, and any function
    /// HealthKit does not allow for it, are left out.
    public func suggestions(for typeIdentifier: String) -> [AggregateConfig] {
        guard let daily = AggregateConfig.dailyDefault(for: typeIdentifier) else { return [] }
        func make(_ function: AggregateFunction, _ unit: AggregateIntervalUnit,
                  _ devices: AggregateDeviceFilter = .all) -> AggregateConfig {
            AggregateConfig(
                typeIdentifier: typeIdentifier, function: function,
                intervalValue: 1, intervalUnit: unit, deviceFilter: devices)
        }
        let common: [AggregateConfig] = daily.function == .sum
            ? [make(.sum, .hour), make(.sum, .week), make(.sum, .month),
               make(.sum, .day, .watch), make(.sum, .day, .iphone)]
            : [make(.average, .hour), make(.min, .day), make(.max, .day),
               make(.average, .week), make(.average, .month)]
        let allowed = HealthTypeCatalog.allowedAggregateFunctions(for: typeIdentifier)
        let present = Set(configs.map(\.seriesIdentity))
        return ([daily] + common).filter {
            allowed.contains($0.function) && !present.contains($0.seriesIdentity)
        }
    }

    // MARK: - Edits

    /// Add a type with its daily default. False when the type is already
    /// aggregated or cannot be.
    @discardableResult
    public mutating func addType(_ typeIdentifier: String) -> Bool {
        guard !contains(type: typeIdentifier),
              let daily = AggregateConfig.dailyDefault(for: typeIdentifier) else { return false }
        configs.append(daily)
        return true
    }

    /// Remove every config of a type.
    public mutating func removeType(_ typeIdentifier: String) {
        configs.removeAll { $0.typeIdentifier == typeIdentifier }
    }

    /// Append a config unless it duplicates one already here. False if not
    /// added.
    @discardableResult
    public mutating func add(_ config: AggregateConfig) -> Bool {
        guard !duplicates(config), !configs.contains(where: { $0.id == config.id }) else { return false }
        configs.append(config)
        return true
    }

    /// Replace the config with the same id. Refused (false) when it would
    /// duplicate another.
    @discardableResult
    public mutating func update(_ config: AggregateConfig) -> Bool {
        guard !duplicates(config),
              let index = configs.firstIndex(where: { $0.id == config.id }) else { return false }
        configs[index] = config
        return true
    }

    public mutating func remove(id: UUID) {
        configs.removeAll { $0.id == id }
    }

    /// Give each of `types` that can be aggregated its daily default, unless
    /// it has one already (other configs of the type are kept). Returns how
    /// many were added. Match Raw Samples passes the raw types; All
    /// Measurements passes `measurementTypes`.
    @discardableResult
    public mutating func addDailyDefaults<Types: Sequence>(for types: Types) -> Int
    where Types.Element == String {
        let present = Set(configs.map(\.seriesIdentity))
        let ordered = Self.measurementTypes.map(\.identifier)
        let wanted = Set(types)
        var added = 0
        for type in ordered where wanted.contains(type) {
            guard let daily = AggregateConfig.dailyDefault(for: type),
                  !present.contains(daily.seriesIdentity) else { continue }
            configs.append(daily)
            added += 1
        }
        return added
    }

    /// How many daily defaults `addDailyDefaults(for:)` would add.
    public func missingDailyDefaults<Types: Sequence>(for types: Types) -> Int
    where Types.Element == String {
        var copy = self
        return copy.addDailyDefaults(for: types)
    }

    /// The types whose configs differ between two lists: added, removed, or
    /// any config of theirs changed. What "1 aggregated type" counts in the
    /// Apply bar.
    public static func changedTypes(from old: [AggregateConfig], to new: [AggregateConfig]) -> Set<String> {
        let types = Set(old.map(\.typeIdentifier)).union(new.map(\.typeIdentifier))
        return types.filter { type in
            Set(old.filter { $0.typeIdentifier == type }) != Set(new.filter { $0.typeIdentifier == type })
        }
    }
}

/// Where one synced aggregate stands, from its config and its sync state.
public enum AggregateProgress: Equatable, Sendable {
    /// Turned off: keeps its progress, computes nothing.
    case off
    /// The last run failed.
    case failed(String)
    /// Nothing computed yet.
    case notSynced
    /// Its first full pass is running; `through` is how far it got.
    case catchingUp(through: Date?)
    /// Its newest settled value has been sent.
    case upToDate
    /// Sent up to `through`, which is further back than settling explains.
    case behind(through: Date)

    public init(config: AggregateConfig, state: AggregateSyncState?, now: Date = Date()) {
        if !config.enabled {
            self = .off
        } else if let error = state?.lastError {
            self = .failed(error)
        } else if let state, state.fullRecomputeStartedAt != nil, state.lastFullRecomputeAt == nil {
            // A first pass (or one after Recompute) moves `computedThrough`
            // with it. The monthly repair pass also sets the start marker, but
            // the series is current through it, so it does not count.
            self = .catchingUp(through: state.computedThrough)
        } else if let through = state?.computedThrough {
            // The open bucket is not sent until it has ended and settled, so
            // a value one interval plus the settle delay old (and an hour of
            // slack for the next trigger) is as current as it gets.
            let lag = config.approximateIntervalSeconds + config.settleDelay + 3_600
            self = now.timeIntervalSince(through) <= lag ? .upToDate : .behind(through: through)
        } else {
            self = .notSynced
        }
    }
}
