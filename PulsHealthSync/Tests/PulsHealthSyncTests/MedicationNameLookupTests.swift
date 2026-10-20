import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct MedicationNameLookupTests {
    // Deliberately indistinguishable descriptions: identity must use equality.
    private struct Concept: Hashable, CustomStringConvertible {
        let id: Int
        var description: String { "<HKHealthConceptIdentifier: 0x1234>" }
    }

    @Test func matchesConceptEqualityRatherThanObjectDescription() {
        let lookup = MedicationNameLookup([
            (Concept(id: 1), "Medicine A, 10 mg"),
            (Concept(id: 2), "Medicine B, 20 mg")
        ])
        #expect(lookup.name(for: Concept(id: 1)) == "Medicine A, 10 mg")
        #expect(lookup.name(for: Concept(id: 2)) == "Medicine B, 20 mg")
        #expect(lookup.name(for: Concept(id: 3)) == nil)
    }

    @Test func preservesSeparateConceptsWithTheSameDisplayName() {
        let lookup = MedicationNameLookup([(1, "Medicine"), (2, "Medicine")])
        #expect(lookup.name(for: 1) == "Medicine")
        #expect(lookup.name(for: 2) == "Medicine")
    }

    @Test func handlesDuplicateAnnotationsAndMissingNames() {
        let entries = [(1, "  Medicine B\n"), (1, "Medicine A"), (2, " \n")]
        let forward = MedicationNameLookup(entries)
        let reverse = MedicationNameLookup(Array(entries.reversed()))
        #expect(forward.name(for: 1) == "Medicine A")
        #expect(reverse.name(for: 1) == forward.name(for: 1))
        #expect(forward.name(for: 2) == nil)
        #expect(MedicationNameLookup<Int>([]).name(for: 1) == nil)
    }
}
