#if DEBUG
import XCTest
import PulsHealthSync
@testable import PulsHealth

final class ExploreFixtureTests: XCTestCase {
    func testCatalogFactsMatchTheFiveSyntheticProfiles() {
        let profiles = ExploreFixtures.profiles
        XCTAssertEqual(profiles.count, 5)
        let facts = ExploreFixtures.quickFacts(for: HealthTypeCatalog.all.map(\.identifier))
        XCTAssertEqual(facts.count, HealthTypeCatalog.all.count)
        let populated = Set(facts.values.filter { $0.latestStart != nil }.map(\.typeIdentifier))
        XCTAssertEqual(populated, Set(profiles.map(\.typeIdentifier)))
        for profile in profiles {
            XCTAssertEqual(facts[profile.typeIdentifier]?.earliestStart, profile.earliestStart)
            XCTAssertEqual(facts[profile.typeIdentifier]?.latestStart, profile.latestStart)
            XCTAssertEqual(facts[profile.typeIdentifier]?.sourceNames, profile.sources.map(\.name))
        }
    }
}
#endif
