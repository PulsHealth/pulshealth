import Foundation
import Testing
@testable import PulsHealthSync

private func makeDir() -> URL {
    FileManager.default.temporaryDirectory
        .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
}

private func writeLegacyState(_ json: String, in dir: URL) throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try Data(json.utf8).write(to: dir.appendingPathComponent("sync-state.json"))
}

private func stateJSON(in dir: URL) throws -> [String: Any] {
    let data = try Data(contentsOf: dir.appendingPathComponent("sync-state.json"))
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

// MARK: - Server identity

@Suite struct ServerIdentityTests {
    private func identity(_ url: String, user: String = PulsDefaultUser.id) -> ServerIdentity? {
        ServerIdentity(url: URL(string: url)!, userID: user)
    }

    @Test func normalizesCosmeticURLDifferences() throws {
        let a = try #require(identity("https://Example.test:443/"))
        let b = try #require(identity("https://example.test"))
        let c = try #require(identity("http://example.test:80/"))
        #expect(a == b)
        #expect(a == c, "scheme and default ports are not part of the identity")
        #expect(a.serverLabel == "example.test")

        let withPath = try #require(identity("https://example.test/puls/"))
        #expect(withPath.path == "/puls")
        #expect(withPath.serverLabel == "example.test/puls")
        #expect(withPath != b)
    }

    @Test func realDifferencesAreChanges() throws {
        let base = try #require(identity("https://example.test:8080"))
        #expect(base != identity("https://example.test:8081"))
        #expect(base != identity("https://other.test:8080"))
        #expect(base != identity("https://example.test:8080/v2"))
        #expect(base != identity("https://example.test:8080", user: UUID().uuidString))
        // User IDs compare case-insensitively (they're UUIDs).
        let upper = try #require(identity("https://example.test:8080", user: PulsDefaultUser.id.uppercased()))
        #expect(base == upper)
    }

    @Test func pureComparisonIgnoresMissingSides() throws {
        let a = identity("https://a.test")
        let b = identity("https://b.test")
        #expect(SyncStateStore.serverIdentityChanged(stored: a, applied: b))
        #expect(!SyncStateStore.serverIdentityChanged(stored: a, applied: a))
        #expect(!SyncStateStore.serverIdentityChanged(stored: nil, applied: b))
        #expect(!SyncStateStore.serverIdentityChanged(stored: a, applied: nil))
        #expect(ServerIdentity(configuration: SyncConfiguration()) == nil)
    }

    @Test func changeSummaryNamesWhatMoved() throws {
        let from = try #require(identity("https://a.test:8080"))
        let toServer = try #require(identity("https://b.test:8080"))
        let toUser = try #require(identity("https://a.test:8080", user: "11111111-1111-4111-8111-111111111111"))
        let server = ServerIdentityChange(from: from, to: toServer)
        #expect(server.serverChanged && !server.userChanged)
        #expect(server.summary == "database a.test:8080 → b.test:8080")
        let user = ServerIdentityChange(from: from, to: toUser)
        #expect(!user.serverChanged && user.userChanged)
        #expect(user.summary.hasPrefix("user ID "))
    }

    @Test func identityIsRecordedOnFirstConfigureAndKeptAcrossReloads() async throws {
        let dir = makeDir()
        let store = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        #expect(await store.serverIdentity == nil)
        var config = await store.configuration
        config.serverURL = URL(string: "https://a.test:8080")
        await store.setConfiguration(config)
        #expect(await store.serverIdentity == identity("https://a.test:8080"))
        await store.persistNow()

        let reloaded = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        #expect(await reloaded.serverIdentity == identity("https://a.test:8080"))
        #expect(await reloaded.pendingServerIdentityChange() == nil)
    }

    @Test func noProgressMeansNoPromptAndTheIdentityJustMoves() async throws {
        let store = SyncStateStore(directory: makeDir(), tokenStore: InMemoryTokenStore())
        var config = await store.configuration
        config.serverURL = URL(string: "https://a.test")
        await store.setConfiguration(config)
        config.serverURL = URL(string: "https://b.test")
        #expect(await store.serverIdentityChange(applying: config) == nil)
        await store.setConfiguration(config)
        #expect(await store.serverIdentity == identity("https://b.test"))
    }

    @Test func progressMakesAServerOrUserChangeAPrompt() async throws {
        let store = SyncStateStore(directory: makeDir(), tokenStore: InMemoryTokenStore())
        var config = await store.configuration
        config.serverURL = URL(string: "https://a.test")
        await store.setConfiguration(config)
        await store.recordUploadedBatch(
            identifier: "type-a", newAnchorData: Data([1]), samples: 1, deletions: 0,
            bytes: 1, sampleDateRange: nil, duration: 0, latency: nil)
        #expect(await store.hasSyncProgress)

        // Same server, cosmetic edit: nothing to ask.
        config.serverURL = URL(string: "https://A.test:443/")
        #expect(await store.serverIdentityChange(applying: config) == nil)

        // Different server.
        config.serverURL = URL(string: "https://b.test")
        let change = try #require(await store.serverIdentityChange(applying: config))
        #expect(change.from == identity("https://a.test"))
        #expect(change.to == identity("https://b.test"))
        #expect(change.serverChanged)

        // Different user on the same server.
        config.serverURL = URL(string: "https://a.test")
        config.userID = "11111111-1111-4111-8111-111111111111"
        let userChange = try #require(await store.serverIdentityChange(applying: config))
        #expect(userChange.userChanged && !userChange.serverChanged)
    }

    @Test func changingDestinationPreservesOnlyItsOwnProgressAcrossReloads() async throws {
        let dir = makeDir()
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        var config = SyncConfiguration(serverURL: URL(string: "https://a.test"), authToken: "a-token")
        await store.setConfiguration(config)
        let aID = try #require(await store.activeDestinationID)
        await store.recordUploadedBatch(
            identifier: "type-a", newAnchorData: Data([1]), samples: 7, deletions: 0,
            bytes: 1, sampleDateRange: nil, duration: 0, latency: nil)

        config.serverURL = URL(string: "https://b.test")
        config.authToken = "b-token"
        // The compatibility confirmation flag cannot transfer A's progress to B.
        await store.setConfiguration(config, confirmServerIdentity: true)
        let bID = try #require(await store.activeDestinationID)
        #expect(aID != bID)
        #expect(await store.serverIdentity == identity("https://b.test"))
        #expect(await store.pendingServerIdentityChange() == nil)
        #expect(!(await store.hasSyncProgress))
        await store.recordUploadedBatch(
            identifier: "type-a", newAnchorData: Data([2]), samples: 3, deletions: 0,
            bytes: 1, sampleDateRange: nil, duration: 0, latency: nil)
        await store.persistNow()

        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.activeDestinationID == bID)
        #expect(await reloaded.state(for: "type-a").totalSamplesExported == 3)
        try await reloaded.switchDestination(id: aID)
        #expect(await reloaded.serverIdentity == identity("https://a.test"))
        #expect(await reloaded.configuration.authToken == "a-token")
        #expect(await reloaded.state(for: "type-a").anchorData == Data([1]))
        #expect(await reloaded.state(for: "type-a").totalSamplesExported == 7)
        try await reloaded.switchDestination(id: bID)
        #expect(await reloaded.configuration.authToken == "b-token")
        #expect(await reloaded.state(for: "type-a").anchorData == Data([2]))
    }

    @Test func explicitResetClearsEveryActiveAnchorAndWatermark() async throws {
        let store = SyncStateStore(directory: makeDir(), tokenStore: InMemoryTokenStore())
        var config = await store.configuration
        config.serverURL = URL(string: "https://a.test")
        await store.setConfiguration(config)
        let aggID = UUID()
        await store.recordUploadedBatch(
            identifier: "type-a", newAnchorData: Data([1]), samples: 1, deletions: 0,
            bytes: 1, sampleDateRange: nil, duration: 0, latency: nil)
        await store.recordAggregateUpload(configID: aggID, newComputedThrough: Date(), buckets: 1, bytes: 1)
        await store.recordActivitySummaryUpload(newComputedThrough: Date(), days: 1, bytes: 1)
        await store.advanceWorkoutEnrichmentWatermark(.routes, to: Date())
        await store.advanceWorkoutEnrichmentWatermark(.streams, to: Date())

        config.serverURL = URL(string: "https://b.test")
        #expect(await store.serverIdentityChange(applying: config) != nil)

        // An explicit reset remains available independently of destination switching.
        await store.resetAll()
        #expect(!(await store.hasSyncProgress))
        #expect(await store.state(for: "type-a").anchorData == nil)
        #expect(await store.aggregateState(for: aggID).computedThrough == nil)
        #expect(await store.activitySummaryState.computedThrough == nil)
        #expect(await store.workoutEnrichmentState(.routes).computedThrough == nil)
        #expect(await store.workoutEnrichmentState(.streams).computedThrough == nil)
        // resetAll leaves the identity alone: it is the apply that moves it.
        #expect(await store.serverIdentity == identity("https://a.test"))

        await store.setConfiguration(config, confirmServerIdentity: true)
        #expect(await store.serverIdentity == identity("https://b.test"))
        #expect(await store.pendingServerIdentityChange() == nil)
    }

    @Test func legacyPendingEditNeverTransfersOldProgressToTheEditedDestination() async throws {
        let dir = makeDir()
        try writeLegacyState(#"""
        {"configuration":{"enabledTypes":["type-a"],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000,
         "serverURL":"https://b.test","authToken":"b-token"},
         "serverIdentity":{"host":"a.test","path":"","userID":"00000000-0000-4000-8000-000000000001"},
         "typeStates":{"type-a":{"identifier":"type-a","anchorData":"AQID","backfillComplete":true,
         "totalSamplesExported":5,"totalDeletionsExported":0,"totalBytesUploaded":1,"totalBatchesUploaded":1}},
         "deviceID":"dev-pending"}
        """#, in: dir)
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        let pending = try #require(await store.pendingServerIdentityChange())
        #expect(pending.from.host == "a.test")
        #expect(pending.to.host == "b.test")
        var edited = await store.configuration
        await store.setConfiguration(edited, confirmServerIdentity: true)
        #expect(await store.serverIdentity?.host == "b.test")
        #expect(!(await store.hasSyncProgress))
        #expect(await store.savedDestinations.count == 2)

        // The old receiver needs its own credential, but retains its progress.
        edited.serverURL = URL(string: "https://a.test")
        edited.userID = pending.from.userID
        edited.authToken = "a-token"
        await store.setConfiguration(edited)
        #expect(await store.serverIdentity?.host == "a.test")
        #expect(await store.state(for: "type-a").anchorData == Data([1, 2, 3]))
        #expect(await store.state(for: "type-a").totalSamplesExported == 5)
        #expect(await store.configuration.authToken == "a-token")
    }

    @Test func legacyStateFileAdoptsTheIdentityOfItsOwnConfiguration() async throws {
        let dir = makeDir()
        try writeLegacyState(#"""
        {"configuration":{"enabledTypes":["type-a"],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000,
         "serverURL":"https://legacy.test:8080/"},
         "typeStates":{"type-a":{"identifier":"type-a","anchorData":"AQID","backfillComplete":true,
         "totalSamplesExported":5,"totalDeletionsExported":0,"totalBytesUploaded":1,"totalBatchesUploaded":1}},
         "deviceID":"dev-1"}
        """#, in: dir)
        let store = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        #expect(await store.serverIdentity == identity("https://legacy.test:8080"))
        let destinationID = try #require(await store.activeDestinationID)
        #expect(await store.savedDestinations.count == 1)
        #expect(await store.deviceID == "dev-1")
        #expect(await store.state(for: "type-a").anchorData == Data([1, 2, 3]))
        #expect(await store.state(for: "type-a").totalSamplesExported == 5)
        // No prompt on upgrade — the progress belongs to the server the file names.
        #expect(await store.pendingServerIdentityChange() == nil)
        // And it was written back, so the next load doesn't have to infer it.
        let json = try stateJSON(in: dir)
        let stored = try #require(json["serverIdentity"] as? [String: Any])
        #expect(stored["host"] as? String == "legacy.test")
        #expect(stored["port"] as? Int == 8080)
        let reloaded = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        #expect(await reloaded.activeDestinationID == destinationID)
        #expect(await reloaded.state(for: "type-a").anchorData == Data([1, 2, 3]))
    }
}
