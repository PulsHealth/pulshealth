import XCTest
import PulsHealthSync
@testable import PulsHealth

@MainActor
final class ExportOptionsTests: XCTestCase {
    func testDefaultDraftKeepsSimpleDatasetLayout() {
        let draft = ExportDraft()
        XCTAssertEqual(draft.csvOptions.layout, .datasets)
        XCTAssertFalse(draft.csvOptions.includeSourceDetails)
        XCTAssertFalse(draft.csvOptions.includeMetadata)
        XCTAssertNil(draft.csvOptions.rowsPerFile)
    }

    func testCategoryLabelsUseBundledVocabularyAndKeepUnknownValuesUnknown() {
        let labels = TypeKnowledge.exportCategoryLabels
        XCTAssertEqual(labels["HKCategoryTypeIdentifierSleepAnalysis"]?[3], "asleepCore")
        XCTAssertNil(labels["HKCategoryTypeIdentifierSleepAnalysis"]?[999])
        for (identifier, values) in labels {
            for (value, name) in values {
                XCTAssertTrue(TypeKnowledge.article(for: identifier)?.categoryValues?.contains {
                    $0.value == value && $0.name == name
                } ?? false)
            }
        }
    }
}
