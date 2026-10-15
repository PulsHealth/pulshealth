import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct SyncAccessPolicyTests {
    @Test func fiveTypesCountsRawAndAggregatesOnce() {
        var config = SyncConfiguration()
        config.enabledTypes = ["a", "b", "c", "d", "e"]
        config.aggregates = [AggregateConfig(typeIdentifier: "a", function: .sum)]
        #expect(SyncAccessPolicy.free.allows(config))
        config.enabledTypes.insert("f")
        #expect(!SyncAccessPolicy.free.allows(config))
        #expect(SyncAccessPolicy.unrestricted.allows(config))
    }

    @Test func disabledAggregatesDoNotCountButAggregateOnlyTypesDo() {
        var config = SyncConfiguration()
        config.enabledTypes = ["a", "b", "c", "d", "e"]
        var aggregate = AggregateConfig(typeIdentifier: "f", function: .sum)
        aggregate.enabled = false
        config.aggregates = [aggregate]
        #expect(SyncAccessPolicy.free.allows(config))
        config.aggregates[0].enabled = true
        #expect(!SyncAccessPolicy.free.allows(config))
    }

    @Test func staleRecordedHealthLimitCannotWidenFreeHistory() throws {
        let now = Date()
        let old = now.addingTimeInterval(-90 * 86_400)
        let boundary = try #require(SyncAccessPolicy.free.earliestDate(now: now))
        #expect(SyncAccessPolicy.free.limitingRecordedDate(old, now: now) == boundary)
        #expect(SyncAccessPolicy.free.limitingRecordedDate(nil, now: now) == nil)
        let newer = now.addingTimeInterval(-86_400)
        #expect(SyncAccessPolicy.free.limitingRecordedDate(newer, now: now) == newer)
        #expect(SyncAccessPolicy.unrestricted.limitingRecordedDate(old, now: now) == old)
    }

    @Test func engineChecksLivePolicyWithoutDroppingSavedTypes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SyncStateStore(directory: directory, tokenStore: InMemoryTokenStore())
        var config = SyncConfiguration()
        config.enabledTypes = ["a", "b", "c", "d", "e", "f"]
        await store.setConfiguration(config)
        let engine = HealthSyncEngine(store: store, eventLog: SyncEventLog(directory: directory),
            wakeLog: WakeLog(directory: directory), accessPolicy: { .free })
        #expect(await !engine.allowsSync())
        #expect(await store.configuration.enabledTypes.count == 6)
        do {
            _ = try await engine.reconcile(type: "a")
            Issue.record("Over-limit reconciliation must stop before HealthKit or transport work")
        } catch SyncError.accessRestricted {}
        #expect(!(await engine.isSyncing("a")))
        #expect(await store.configuration.enabledTypes.count == 6)
        config.enabledTypes.remove("f")
        await store.setConfiguration(config)
        #expect(await engine.allowsSync(types: ["a"]))
        #expect(await !engine.allowsSync(types: ["f"]))
        let old = Date().addingTimeInterval(-90 * 86_400)
        #expect(await engine.limitedSyncStart(old) > old)
        let dates = await engine.syncReadableDates([:], for: ["a"])
        #expect(dates["a"] != nil)
    }

    @Test func freeHistoryIsRecentThirtyCalendarDaysAcrossDST() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let now = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 15, hour: 15)))
        let boundary = try #require(calendar.date(from: DateComponents(year: 2026, month: 10, day: 16)))
        #expect(SyncAccessPolicy.free.earliestDate(now: now, calendar: calendar) == boundary)
        #expect(SyncAccessPolicy.free.allowsExport(start: boundary, now: now, calendar: calendar))
        #expect(!SyncAccessPolicy.free.allowsExport(start: boundary.addingTimeInterval(-1), now: now, calendar: calendar))
        #expect(!SyncAccessPolicy.free.allowsExport(start: nil, now: now, calendar: calendar))
        #expect(SyncAccessPolicy.unrestricted.allowsExport(start: nil, now: now, calendar: calendar))
    }
}
