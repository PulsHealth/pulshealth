import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct TypeProfileStoreTests {
    private static let heartRate = "HKQuantityTypeIdentifierHeartRate"
    private let now = Date(timeIntervalSince1970: 1_767_225_600)

    private func tempDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("profile-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func profile(
        _ identifier: String = heartRate, version: Int = TypeProfile.currentVersion,
        unit: String? = "count/min", complete: Bool = true,
        rangeStart: Date? = nil, rangeEnd: Date? = nil,
        earliest: Date? = nil, latest: Date? = nil, computedAt: Date? = nil
    ) -> TypeProfile {
        TypeProfile(
            version: version, typeIdentifier: identifier, kind: .quantity, unitString: unit,
            computedAt: computedAt ?? now, scanDuration: 2, timeZoneID: "UTC",
            rangeStart: rangeStart, rangeEnd: rangeEnd, isComplete: complete,
            sampleCount: 3, earliestStart: earliest ?? now.addingTimeInterval(-86_400),
            latestStart: latest ?? now.addingTimeInterval(-60),
            dailyCounts: [TypeProfile.DailyCount(day: now.addingTimeInterval(-86_400), count: 3)])
    }

    private func facts(for profile: TypeProfile) -> TypeQuickFacts {
        TypeQuickFacts(
            typeIdentifier: profile.typeIdentifier, earliestStart: profile.earliestStart,
            latestStart: profile.latestStart, sourceNames: ["Watch"])
    }

    // MARK: - Persistence

    @Test func saveThenLoadRoundTripsThroughDiskAndAFreshStore() async throws {
        let dir = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = TypeProfileStore(directory: dir)
        let profile = profile()
        try await store.save(profile)

        #expect(await store.profile(for: Self.heartRate) == profile)
        let file = dir.appendingPathComponent("\(Self.heartRate).json")
        #expect(FileManager.default.fileExists(atPath: file.path))
        let json = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        #expect(json["computedAt"] as? Double == 1_767_225_600_000)

        // A second store reads the file, not the first store's cache.
        let reopened = TypeProfileStore(directory: dir)
        #expect(await reopened.profile(for: Self.heartRate) == profile)
        #expect(await reopened.allProfiles() == [profile])
        #expect(await reopened.profile(for: "HKQuantityTypeIdentifierStepCount") == nil)
    }

    @Test func removeAndRemoveAllDeleteFiles() async throws {
        let dir = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = TypeProfileStore(directory: dir)
        try await store.save(profile())
        try await store.save(profile("HKQuantityTypeIdentifierStepCount", unit: "count"))
        #expect(await store.allProfiles().count == 2)

        await store.remove(Self.heartRate)
        #expect(await store.profile(for: Self.heartRate) == nil)
        #expect(await store.allProfiles().map(\.typeIdentifier) == ["HKQuantityTypeIdentifierStepCount"])

        await store.removeAll()
        #expect(await store.allProfiles().isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path).isEmpty)
        // The directory is still there for the next save.
        try await store.save(profile())
        #expect(await store.allProfiles().count == 1)
    }

    @Test func anotherVersionIsDroppedAndItsFileDeleted() async throws {
        let dir = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = TypeProfileStore(directory: dir)
        try await store.save(profile(version: 0))
        let file = dir.appendingPathComponent("\(Self.heartRate).json")
        #expect(FileManager.default.fileExists(atPath: file.path))

        let reopened = TypeProfileStore(directory: dir)
        #expect(await reopened.profile(for: Self.heartRate) == nil)
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    @Test func undecodableFileIsDroppedAndDeleted() async throws {
        let dir = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("\(Self.heartRate).json")
        try Data("not json".utf8).write(to: file)
        let store = TypeProfileStore(directory: dir)
        #expect(await store.profile(for: Self.heartRate) == nil)
        #expect(await store.allProfiles().isEmpty)
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    // MARK: - Staleness

    @Test func aMatchingCompleteProfileIsFresh() {
        let p = profile()
        #expect(!TypeProfileStore.isStale(p, facts: facts(for: p), options: .init(), now: now))
        #expect(!TypeProfileStore.isStale(p, facts: facts(for: p), options: .init(), maxAge: 3_600, now: now.addingTimeInterval(60)))
    }

    @Test func versionMismatchIsStale() {
        let p = profile(version: 0)
        #expect(TypeProfileStore.isStale(p, facts: facts(for: p), options: .init(), now: now))
    }

    @Test func catalogUnitChangeIsStale() {
        let p = profile(unit: "bpm")
        #expect(TypeProfileStore.isStale(p, facts: facts(for: p), options: .init(), now: now))
    }

    @Test func movedBoundariesAreStale() {
        let p = profile()
        var newer = facts(for: p)
        newer.latestStart = now
        #expect(TypeProfileStore.isStale(p, facts: newer, options: .init(), now: now))

        var older = facts(for: p)
        older.earliestStart = now.addingTimeInterval(-10 * 86_400)
        #expect(TypeProfileStore.isStale(p, facts: older, options: .init(), now: now))

        var emptied = facts(for: p)
        emptied.earliestStart = nil
        emptied.latestStart = nil
        #expect(TypeProfileStore.isStale(p, facts: emptied, options: .init(), now: now))
    }

    @Test func aBoundedProfileIgnoresBoundariesOutsideItsRange() {
        let start = now.addingTimeInterval(-7 * 86_400)
        let p = profile(rangeStart: start, earliest: start.addingTimeInterval(3_600))
        var options = HealthExplorer.ProfileOptions()
        options.rangeStart = start
        // HealthKit's oldest sample is older than the range; the profile never
        // saw it and is not stale for it. The newest still counts.
        var older = facts(for: p)
        older.earliestStart = now.addingTimeInterval(-400 * 86_400)
        #expect(!TypeProfileStore.isStale(p, facts: older, options: options, now: now))
        older.latestStart = now
        #expect(TypeProfileStore.isStale(p, facts: older, options: options, now: now))
    }

    @Test func differentRangeOptionsAreStale() {
        let p = profile()
        var options = HealthExplorer.ProfileOptions()
        options.rangeStart = now.addingTimeInterval(-30 * 86_400)
        #expect(TypeProfileStore.isStale(p, facts: facts(for: p), options: options, now: now))
        options.rangeStart = nil
        options.rangeEnd = now
        #expect(TypeProfileStore.isStale(p, facts: facts(for: p), options: options, now: now))
    }

    @Test func ageBeyondMaxAgeIsStale() {
        let p = profile(computedAt: now.addingTimeInterval(-2 * 86_400))
        #expect(!TypeProfileStore.isStale(p, facts: facts(for: p), options: .init(), maxAge: nil, now: now))
        #expect(TypeProfileStore.isStale(p, facts: facts(for: p), options: .init(), maxAge: 86_400, now: now))
        #expect(!TypeProfileStore.isStale(p, facts: facts(for: p), options: .init(), maxAge: 3 * 86_400, now: now))
    }

    @Test func anIncompleteProfileIsStale() {
        let p = profile(complete: false)
        #expect(TypeProfileStore.isStale(p, facts: facts(for: p), options: .init(), now: now))
    }
}
