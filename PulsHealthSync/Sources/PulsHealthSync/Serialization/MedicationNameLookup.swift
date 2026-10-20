import Foundation

/// Keeps opaque HealthKit identifiers inside the query boundary. Names are
/// presentation only: equal names do not imply equal medication concepts.
struct MedicationNameLookup<Identifier: Hashable> {
    private let names: [Identifier: String]

    init(_ medications: [(Identifier, String)]) {
        names = Dictionary(
            medications.compactMap { identifier, displayName in
                let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
                return name.isEmpty ? nil : (identifier, name)
            },
            // Multiple annotations may reference the same concept. Make the
            // result independent of HealthKit's unspecified query order.
            uniquingKeysWith: { min($0, $1) }
        )
    }

    func name(for identifier: Identifier) -> String? { names[identifier] }
}
