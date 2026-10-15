import Foundation
import HealthKit
import XCTest
import PulsHealthSync

/// Probes EVERY quantity type × EVERY aggregate function against the
/// app-hosted HKHealthStore and checks the result against
/// `HealthTypeCatalog.allowedAggregateFunctions(for:)`.
///
/// HealthKit reports an illegal option×aggregation-style combo by raising
/// NSInvalidArgumentException when the query executes — a crash in production
/// Swift. Verified behavior (iOS 26 sim): the legacy `execute(_:)` path raises
/// synchronously, so `PulsCatchException` can map the full matrix in one run.
///
/// Hosted in PulsHealth.app because executing queries requires the HealthKit
/// entitlement. Read authorization is NOT required: the option validation
/// happens before any data access (compatible combos just return auth errors
/// asynchronously, which we ignore).
///
/// The contract enforced here:
/// - every ALLOWED combo must execute without the incompatibility exception;
/// - every DISALLOWED combo must raise it (if HealthKit starts accepting one,
///   we want to know — it means users could be offered more functions).
final class AggregateMatrixTests: XCTestCase {
    func testAllowedFunctionsMatchHealthKitExactly() {
        let store = HKHealthStore()
        let end = Date(timeIntervalSince1970: 1_750_000_000)
        let start = end.addingTimeInterval(-86_400)
        var wronglyAllowed: [String] = []   // we offer it; HealthKit crashes on it
        var wronglyDisallowed: [String] = [] // HealthKit accepts it; we hide it
        var combos = 0

        for descriptor in HealthTypeCatalog.quantityTypes {
            let allowed = HealthTypeCatalog.allowedAggregateFunctions(for: descriptor.identifier)
            let quantityType = HKQuantityType(
                HKQuantityTypeIdentifier(rawValue: descriptor.identifier))
            for function in AggregateFunction.allCases {
                combos += 1
                let query = HKStatisticsCollectionQuery(
                    quantityType: quantityType,
                    quantitySamplePredicate: HKQuery.predicateForSamples(
                        withStart: start, end: end, options: .strictStartDate),
                    options: statisticsOption(for: function),
                    anchorDate: start,
                    intervalComponents: DateComponents(hour: 1)
                )
                query.initialResultsHandler = { _, _, _ in }
                let exception = PulsCatchException { store.execute(query) }
                if exception == nil { store.stop(query) }

                let combo = "\(descriptor.identifier) × \(function.rawValue)"
                if let exception {
                    if allowed.contains(function) {
                        wronglyAllowed.append("\(combo): \(exception.reason ?? exception.name.rawValue)")
                    }
                } else if !allowed.contains(function) {
                    wronglyDisallowed.append(combo)
                }
            }
        }

        print("[matrix] \(combos) combos probed")
        XCTAssertTrue(
            wronglyAllowed.isEmpty,
            "allowedAggregateFunctions offers combos HealthKit rejects (would crash the app):\n"
                + wronglyAllowed.joined(separator: "\n")
        )
        XCTAssertTrue(
            wronglyDisallowed.isEmpty,
            "HealthKit accepts combos we don't offer — extend allowedAggregateFunctions:\n"
                + wronglyDisallowed.joined(separator: "\n")
        )
    }

    // Exercise the public entry points with stale/imported configurations,
    // bypassing the pickers that normally hide these crashing combinations.
    private var illegalConfigs: [AggregateConfig] {
        [.average, .min, .max].map {
            AggregateConfig(typeIdentifier: "HKQuantityTypeIdentifierStepCount", function: $0)
        } + [AggregateConfig(typeIdentifier: "HKQuantityTypeIdentifierHeartRate", function: .sum)]
    }

    func testPreviewRejectsIllegalFunctionsBeforeExecutingHealthKitQuery() async throws {
        let explorer = HealthExplorer()
        let end = Date(timeIntervalSince1970: 1_750_000_000)
        for config in illegalConfigs {
            do {
                _ = try await explorer.aggregatePreview(
                    config, from: end.addingTimeInterval(-86_400), to: end)
                XCTFail("Preview accepted illegal function: \(config.summaryLabel)")
            } catch let error as HealthExploreError {
                XCTAssertEqual(error, .unsupportedKind(
                    "\(config.function.rawValue) is not allowed for \(config.typeIdentifier)"))
            }
        }
    }

    func testSyncSkipsIllegalFunctionsWithoutAdvancingAggregateState() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("puls-illegal-aggregate-\(UUID())", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SyncStateStore(directory: directory, tokenStore: InMemoryTokenStore())
        let log = SyncEventLog(directory: directory)
        let engine = HealthSyncEngine(
            store: store, eventLog: log, wakeLog: WakeLog(directory: directory))
        let configs = illegalConfigs
        await store.setConfiguration(SyncConfiguration(aggregates: configs))

        for config in configs {
            let before = await store.aggregateState(for: config.id)
            await engine.syncAggregate(configID: config.id, reason: .manual)
            let after = await store.aggregateState(for: config.id)
            XCTAssertEqual(after, before, "Rejected configuration must not move its watermark")
        }
        let events = await log.recent()
        XCTAssertEqual(events.count, configs.count)
        for (event, config) in zip(events, configs) {
            XCTAssertEqual(event.level, .error)
            XCTAssertEqual(event.type, config.typeIdentifier)
            XCTAssertTrue(event.message.contains(
                "\(config.function.rawValue) is not supported by this type's aggregation style"))
        }
        await store.persistNow()
    }

    private func statisticsOption(for function: AggregateFunction) -> HKStatisticsOptions {
        switch function {
        case .sum: return .cumulativeSum
        case .average: return .discreteAverage
        case .min: return .discreteMin
        case .max: return .discreteMax
        case .mostRecent: return .mostRecent
        case .duration: return .duration
        }
    }
}
