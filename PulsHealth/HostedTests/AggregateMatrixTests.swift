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
