import SwiftUI
import PulsHealthSync

/// Which list of aggregates a screen edits: the Sync tab's staged
/// configuration (`AppModel.config`, applied by the Apply bar) or the Export
/// tab's draft (`ExportModel.draft`, this export's alone). The Aggregates
/// picker, a type's aggregate page and the Custom… sheet are built once and
/// take one of these; status rows and Options… are Sync's only.
enum AggregateScope: Hashable {
    case sync
    case export
}

extension AppModel {
    /// The list `scope` names, as it stands in its draft.
    func aggregateList(_ scope: AggregateScope) -> AggregateList {
        switch scope {
        case .sync: AggregateList(config.aggregates)
        case .export: AggregateList(export.draft.aggregates)
        }
    }

    /// Make one edit to the list `scope` names. Sync's waits for Apply like
    /// every other change on the Sync tab.
    func editAggregates(_ scope: AggregateScope, _ edit: (inout AggregateList) -> Void) {
        var list = aggregateList(scope)
        edit(&list)
        switch scope {
        case .sync:
            if config.aggregates != list.configs { config.aggregates = list.configs }
        case .export:
            if export.draft.aggregates != list.configs { export.draft.aggregates = list.configs }
        }
    }

    /// The raw types Match Raw Samples matches in `scope`: the Sync
    /// selection, or the export's data types.
    func rawTypes(_ scope: AggregateScope) -> Set<String> {
        switch scope {
        case .sync: config.enabledTypes
        case .export: export.draft.types
        }
    }

    // MARK: - Sync only

    /// The applied config with this id, if Apply has sent it to the engine.
    func appliedAggregate(id: UUID) -> AggregateConfig? {
        appliedConfig.aggregates.first { $0.id == id }
    }

    /// True when changing what `config` computes would leave values behind in
    /// the database: it is applied as it stands and has sent something.
    func aggregateHasSentValues(_ config: AggregateConfig) -> Bool {
        guard let applied = appliedAggregate(id: config.id),
              applied.seriesIdentity == config.seriesIdentity,
              let state = aggregateStates[config.id] else { return false }
        return state.totalBucketsUploaded > 0 || state.computedThrough != nil
    }

    /// Where one aggregate of the Sync draft stands: waiting for Apply, or
    /// its applied self's progress.
    func aggregateStatus(_ config: AggregateConfig) -> AggregateStatus {
        guard let applied = appliedAggregate(id: config.id),
              applied.seriesIdentity == config.seriesIdentity,
              applied.startDate == config.startDate, applied.enabled == config.enabled
        else { return .waitingForApply }
        return .progress(AggregateProgress(config: applied, state: aggregateStates[config.id]))
    }
}

/// An aggregate's line under its name on Sync screens.
enum AggregateStatus: Equatable {
    case waitingForApply
    case progress(AggregateProgress)

    var text: String {
        switch self {
        case .waitingForApply: return "Waiting for Apply"
        case .progress(let progress):
            switch progress {
            case .off: return "Off"
            case .failed(let message): return message
            case .notSynced: return "Not synced yet"
            case .catchingUp(let through):
                guard let through else { return "Catching up" }
                return "Catching up, \(through.formatted(.dateTime.month(.abbreviated).year()))"
            case .upToDate: return "Up to date"
            case .behind(let through): return "Through \(through.formatted(date: .abbreviated, time: .omitted))"
            }
        }
    }

    var isFailure: Bool {
        if case .progress(.failed) = self { return true }
        return false
    }

    /// One line for a type with several aggregates: the one needing the
    /// most attention speaks for all of them.
    static func combined(_ statuses: [AggregateStatus]) -> AggregateStatus? {
        func rank(_ status: AggregateStatus) -> Int {
            switch status {
            case .progress(.failed): 0
            case .waitingForApply: 1
            case .progress(.catchingUp): 2
            case .progress(.notSynced): 3
            case .progress(.behind): 4
            case .progress(.upToDate): 5
            case .progress(.off): 6
            }
        }
        return statuses.min { rank($0) < rank($1) }
    }
}

/// "3,100" for a count of values: exact below a hundred, two significant
/// digits above, since it is an estimate.
func approximateCount(_ count: Int) -> String {
    guard count >= 100 else { return count.formatted() }
    let magnitude = pow(10, floor(log10(Double(count))) - 1)
    return (Int((Double(count) / magnitude).rounded() * magnitude)).formatted()
}
