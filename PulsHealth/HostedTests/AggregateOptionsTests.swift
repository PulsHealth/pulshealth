import XCTest
import PulsHealthSync
@testable import PulsHealth

@MainActor
final class AggregateOptionsTests: XCTestCase {
    func testSameAsSyncCanReadConfigurationWhileEditingAndOnlyStagesChanges() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("aggregate-options-\(UUID())", isDirectory: true)
        let suite = "AggregateOptionsTests-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        let store = SyncStateStore(directory: directory, tokenStore: InMemoryTokenStore())
        let engine = HealthSyncEngine(
            store: store, eventLog: SyncEventLog(directory: directory), wakeLog: WakeLog(directory: directory))
        let model = AppModel(engine: engine, defaults: defaults)
        var initial = SyncConfiguration()
        initial.startDate = Date(timeIntervalSince1970: 1_700_000_000)
        let edited = AggregateConfig(typeIdentifier: "HKQuantityTypeIdentifierStepCount", function: .sum)
        let sibling = AggregateConfig(typeIdentifier: "HKQuantityTypeIdentifierHeartRate", function: .average)
        initial.aggregates = [edited, sibling]
        model.config = initial
        await store.setConfiguration(initial)
        let appliedBefore = model.appliedConfig

        // Exactly the Options sheet's toggle-off edit: its closure reads the
        // same observable configuration that the aggregate belongs to. The
        // former direct inout mutation aborts with overlapping accesses here.
        model.editSyncAggregate(id: edited.id) { $0.startDate = model.config.startDate }
        XCTAssertEqual(model.config.aggregates[0].startDate, initial.startDate)
        XCTAssertEqual(model.config.aggregates[1], sibling)
        XCTAssertEqual(model.appliedConfig, appliedBefore)
        let storedAfterEdit = await store.configuration
        XCTAssertEqual(storedAfterEdit, initial, "Options wait for Apply before reaching the engine")

        model.editSyncAggregate(id: edited.id) { $0.startDate = nil }
        XCTAssertNil(model.config.aggregates[0].startDate, "toggle-on restores Same as Sync")
        model.config.startDate = initial.startDate.addingTimeInterval(86_400)
        model.editSyncAggregate(id: edited.id) { $0.startDate = model.config.startDate }
        XCTAssertEqual(model.config.aggregates[0].startDate, model.config.startDate)

        model.editSyncAggregate(id: edited.id) { $0.settleDelay = 900 }
        XCTAssertEqual(model.config.aggregates[0].settleDelay, 900)
        let beforeMissing = model.config
        model.editSyncAggregate(id: UUID()) { _ in XCTFail("A removed aggregate must not be edited") }
        XCTAssertEqual(model.config, beforeMissing)
        XCTAssertEqual(model.appliedConfig, appliedBefore)
        let storedAfterAllEdits = await store.configuration
        XCTAssertEqual(storedAfterAllEdits, initial)
    }
}
