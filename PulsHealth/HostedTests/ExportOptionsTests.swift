import XCTest
import PulsHealthSync
@testable import PulsHealth

@MainActor
final class ExportOptionsTests: XCTestCase {
    func testTypeExportChoicesDefaultToRawAndKeepChangesLocalUntilAdded() throws {
        let id = "HKQuantityTypeIdentifierHeartRate"
        var export = ExportDraft()
        var choice = TypeSyncDraft(identifier: id, configuration: SyncConfiguration(enabledTypes: []))
        XCTAssertTrue(choice.raw)
        XCTAssertFalse(choice.includesAggregates)
        choice.raw = false
        choice.includesAggregates = true
        choice.aggregates = [try XCTUnwrap(AggregateConfig.dailyDefault(for: id))]
        XCTAssertTrue(export.types.isEmpty)
        XCTAssertTrue(export.aggregates.isEmpty, "Cancelling local choices must leave Export unchanged")
        choice.apply(to: &export)
        XCTAssertTrue(export.types.isEmpty)
        XCTAssertEqual(export.aggregates, choice.aggregates)
    }

    func testTypeExportChoicesCanSelectBothAndPreserveOtherTypes() throws {
        let id = "HKQuantityTypeIdentifierHeartRate"
        let steps = "HKQuantityTypeIdentifierStepCount"
        var export = ExportDraft()
        export.types = [steps]
        let other = try XCTUnwrap(AggregateConfig.dailyDefault(for: steps))
        export.aggregates = [other]
        var choice = TypeSyncDraft(identifier: id,
            configuration: SyncConfiguration(enabledTypes: export.types, aggregates: export.aggregates))
        choice.includesAggregates = true
        choice.aggregates = [try XCTUnwrap(AggregateConfig.dailyDefault(for: id))]
        choice.apply(to: &export)
        XCTAssertEqual(export.types, [steps, id])
        XCTAssertEqual(export.aggregates, [other] + choice.aggregates)
        choice.raw = false
        choice.apply(to: &export)
        XCTAssertEqual(export.types, [steps])
        XCTAssertEqual(export.aggregates, [other] + choice.aggregates)
    }

    func testDefaultDraftKeepsSimpleDatasetLayout() {
        let draft = ExportDraft()
        XCTAssertTrue(draft.types.isEmpty)
        XCTAssertTrue(draft.aggregates.isEmpty)
        XCTAssertEqual(draft.selectedTypeCount, 0)
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
