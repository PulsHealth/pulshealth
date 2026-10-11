import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct SavedDestinationTests {
    private func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("puls-destinations-\(UUID())")
    }

    private func configuration(_ host: String, token: String) -> SyncConfiguration {
        SyncConfiguration(serverURL: URL(string: "https://\(host).test"), authToken: token)
    }

    private func writeLegacyFile(in dir: URL, config: SyncConfiguration, tokens: InMemoryTokenStore,
                                 raw: TypeSyncState? = nil, rings: ActivitySummaryState = ActivitySummaryState()) throws -> String {
        struct LegacyState: Encodable {
            var configuration: SyncConfiguration
            var typeStates: [String: TypeSyncState]
            var activitySummaryState: ActivitySummaryState
            var deviceID: String
        }
        let deviceID = UUID().uuidString
        try tokens.setToken(config.authToken)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let state = LegacyState(configuration: config, typeStates: raw.map { [$0.identifier: $0] } ?? [:],
                                activitySummaryState: rings, deviceID: deviceID)
        try JSONEncoder.puls.encode(state).write(to: dir.appendingPathComponent("sync-state.json"))
        return deviceID
    }

    @Test func switchingRestoresEveryProgressFamilyAndCredentialsAfterRestart() async throws {
        let dir = directory()
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        var a = configuration("alpha", token: "alpha-secret")
        let aggregate = AggregateConfig(typeIdentifier: "HKQuantityTypeIdentifierStepCount", function: .sum)
        a.aggregates = [aggregate]
        try await store.applySavedConfiguration(a)
        let aID = try #require(await store.activeDestinationID)
        let date = Date(timeIntervalSince1970: 12_345)
        await store.update("raw") {
            $0.anchorData = Data([1, 2])
            $0.recentAnchorData = Data([3, 4])
            $0.recentWindowStart = date
            $0.totalSamplesExported = 42
            $0.backfillComplete = true
        }
        await store.updateAggregate(aggregate.id) {
            $0.computedThrough = date
            $0.fullRecomputeStartedAt = date
            $0.fullRecomputeThrough = date
        }
        await store.updateActivitySummary { $0.computedThrough = date }
        for kind in WorkoutEnrichmentKind.allCases {
            await store.updateWorkoutEnrichment(kind) {
                $0.computedThrough = date
                $0.fullRecomputeStartedAt = date
                $0.fullRecomputeThrough = date
                $0.forcedRestartPending = true
            }
        }
        let raw = await store.typeStates
        let aggregates = await store.aggregateStates
        let rings = await store.activitySummaryState
        let routes = await store.workoutRoutesState
        let streams = await store.workoutStreamsState

        try await store.applySavedConfiguration(configuration("beta", token: "beta-secret"))
        let bID = try #require(await store.activeDestinationID)
        #expect(aID != bID)
        #expect(await store.typeStates.isEmpty)
        #expect(await store.aggregateStates.isEmpty)
        #expect(await store.activitySummaryState.computedThrough == nil)
        #expect(await store.workoutRoutesState.computedThrough == nil)
        #expect(await store.workoutStreamsState.computedThrough == nil)
        await store.update("raw") { $0.anchorData = Data([9]); $0.totalSamplesExported = 7 }
        await store.persistNow()

        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.activeDestinationID == bID)
        #expect(await reloaded.configuration.authToken == "beta-secret")
        try await reloaded.switchDestination(id: aID)
        #expect(await reloaded.typeStates == raw)
        #expect(await reloaded.aggregateStates == aggregates)
        #expect(await reloaded.activitySummaryState == rings)
        #expect(await reloaded.workoutRoutesState == routes)
        #expect(await reloaded.workoutStreamsState == streams)
        #expect(await reloaded.configuration.authToken == "alpha-secret")
        try await reloaded.switchDestination(id: bID)
        #expect(await reloaded.state(for: "raw").anchorData == Data([9]))
        #expect(await reloaded.state(for: "raw").totalSamplesExported == 7)
        #expect(try tokens.token(for: aID) == "alpha-secret")
        #expect(try tokens.token(for: bID) == "beta-secret")
        let json = try String(contentsOf: dir.appendingPathComponent("sync-state.json"), encoding: .utf8)
        #expect(!json.contains("alpha-secret"))
        #expect(!json.contains("beta-secret"))
    }

    @Test func migrationAdoptsLegacyServerWithoutLosingProgressOrDeviceID() async throws {
        let dir = directory()
        let tokens = InMemoryTokenStore()
        var raw = TypeSyncState(identifier: "raw")
        raw.anchorData = Data([5])
        raw.recentAnchorData = Data([6])
        var rings = ActivitySummaryState()
        rings.totalDaysUploaded = 33
        let deviceID = try writeLegacyFile(in: dir, config: configuration("alpha", token: "legacy-secret"),
                                          tokens: tokens, raw: raw, rings: rings)
        let migrated = SyncStateStore(directory: dir, tokenStore: tokens)
        let id = try #require(await migrated.activeDestinationID)
        #expect(await migrated.savedDestinations.count == 1)
        let migratedDeviceID = await migrated.deviceID
        #expect(migratedDeviceID == deviceID)
        #expect(await migrated.configuration.authToken == "legacy-secret")
        try await migrated.applySavedConfiguration(configuration("beta", token: "beta-secret"))
        try await migrated.switchDestination(id: id)
        #expect(await migrated.state(for: "raw").anchorData == Data([5]))
        #expect(await migrated.state(for: "raw").recentAnchorData == Data([6]))
        #expect(await migrated.activitySummaryState.totalDaysUploaded == 33)
    }

    @Test func migrationPreservesAllLegacyProgressFamiliesAndInterruptedPasses() async throws {
        let seedDirectory = directory(), migratedDirectory = directory()
        let seed = SyncStateStore(directory: seedDirectory, tokenStore: InMemoryTokenStore())
        var a = configuration("alpha", token: "legacy")
        let aggregate = AggregateConfig(typeIdentifier: "HKQuantityTypeIdentifierStepCount", function: .sum)
        a.aggregates = [aggregate]
        try await seed.applySavedConfiguration(a)
        let date = Date(timeIntervalSince1970: 123_456)
        await seed.update("raw") {
            $0.anchorData = Data([1]); $0.recentAnchorData = Data([2])
            $0.recentWindowStart = date; $0.totalSamplesExported = 9
            $0.totalBytesUploaded = 40; $0.totalBatchesUploaded = 3
        }
        await seed.updateAggregate(aggregate.id) {
            $0.computedThrough = date; $0.fullRecomputeStartedAt = date
            $0.fullRecomputeThrough = date; $0.totalBucketsUploaded = 11
        }
        await seed.updateActivitySummary { $0.computedThrough = date; $0.totalDaysUploaded = 7 }
        for kind in WorkoutEnrichmentKind.allCases {
            await seed.updateWorkoutEnrichment(kind) {
                $0.computedThrough = date; $0.fullRecomputeStartedAt = date
                $0.fullRecomputeThrough = date; $0.forcedRestartPending = true
                $0.totalWorkoutsUploaded = 5
            }
        }
        await seed.persistNow()
        let bytes = try Data(contentsOf: seedDirectory.appendingPathComponent("sync-state.json"))
        var legacy = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        legacy.removeValue(forKey: "destinations")
        legacy.removeValue(forKey: "activeDestinationID")
        try FileManager.default.createDirectory(at: migratedDirectory, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: legacy).write(to: migratedDirectory.appendingPathComponent("sync-state.json"))
        let tokens = InMemoryTokenStore(token: "legacy")
        let migrated = SyncStateStore(directory: migratedDirectory, tokenStore: tokens)
        let id = try #require(await migrated.activeDestinationID)
        try await migrated.applySavedConfiguration(configuration("beta", token: "beta"))
        let restarted = SyncStateStore(directory: migratedDirectory, tokenStore: tokens)
        try await restarted.switchDestination(id: id)
        let deviceID = await seed.deviceID
        let raw = await seed.typeStates, aggregates = await seed.aggregateStates
        let rings = await seed.activitySummaryState
        let routes = await seed.workoutRoutesState, streams = await seed.workoutStreamsState
        #expect(await restarted.deviceID == deviceID)
        #expect(await restarted.typeStates == raw)
        #expect(await restarted.aggregateStates == aggregates)
        #expect(await restarted.activitySummaryState == rings)
        #expect(await restarted.workoutRoutesState == routes)
        #expect(await restarted.workoutStreamsState == streams)
        #expect(await restarted.configuration.authToken == "legacy")
    }

    @Test func rePairUpdatesCredentialWithoutDuplicatingOrResetting() async throws {
        let store = SyncStateStore(directory: directory(), tokenStore: InMemoryTokenStore())
        var config = configuration("alpha", token: "first")
        try await store.applySavedConfiguration(config)
        let id = await store.activeDestinationID
        await store.update("raw") { $0.totalSamplesExported = 22 }
        config.authToken = "rotated"
        config.serverURL = URL(string: "https://ALPHA.test:443/")
        try await store.applySavedConfiguration(config)
        #expect(await store.savedDestinations.count == 1)
        #expect(await store.activeDestinationID == id)
        #expect(await store.configuration.authToken == "rotated")
        #expect(await store.state(for: "raw").totalSamplesExported == 22)
    }

    @Test func unpairInactivePreservesActiveAndUnpairActiveDisconnectsAcrossRestart() async throws {
        let dir = directory()
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        try await store.applySavedConfiguration(configuration("alpha", token: "alpha-secret"))
        let aID = try #require(await store.activeDestinationID)
        try await store.applySavedConfiguration(configuration("beta", token: "beta-secret"))
        let bID = try #require(await store.activeDestinationID)
        await store.update("raw") { $0.totalSamplesExported = 9 }
        try await store.unpairDestination(id: aID)
        #expect(await store.activeDestinationID == bID)
        #expect(await store.configuration.authToken == "beta-secret")
        #expect(await store.state(for: "raw").totalSamplesExported == 9)
        #expect(try tokens.token(for: aID) == nil)
        #expect(try tokens.token(for: bID) == "beta-secret")
        try await store.unpairDestination(id: bID)
        #expect(await store.activeDestinationID == nil)
        #expect(await store.configuration.serverURL == nil)
        #expect(await store.configuration.authToken == nil)
        #expect(await store.typeStates.isEmpty)
        await store.persistNow()
        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.savedDestinations.isEmpty)
        #expect(await reloaded.configuration.authToken == nil)
        #expect(await reloaded.activeDestinationID == nil)
    }

    @Test func refusedScopedTokenUsesProtectedFallbackAndRetriesAtLaunch() async throws {
        struct RefusingScopedStore: TokenStore {
            let underlying: InMemoryTokenStore
            func token() throws -> String? { try underlying.token() }
            func setToken(_ token: String?) throws { try underlying.setToken(token) }
            func token(for id: UUID) throws -> String? { try underlying.token(for: id) }
            func setToken(_ token: String?, for id: UUID) throws { throw SavedDestinationError.credential }
        }
        let dir = directory()
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: RefusingScopedStore(underlying: tokens))
        try await store.applySavedConfiguration(configuration("alpha", token: "parked-secret"))
        let id = try #require(await store.activeDestinationID)
        let file = dir.appendingPathComponent("sync-state.json")
        #expect(try String(contentsOf: file, encoding: .utf8).contains("parked-secret"))
        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.configuration.authToken == "parked-secret")
        #expect(try tokens.token(for: id) == "parked-secret")
        #expect(!(try String(contentsOf: file, encoding: .utf8)).contains("parked-secret"))
    }

    @Test func diskFailureDoesNotSwitchOrRotateCredential() async throws {
        let dir = directory()
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        var config = configuration("alpha", token: "original")
        try await store.applySavedConfiguration(config)
        let id = try #require(await store.activeDestinationID)
        let file = dir.appendingPathComponent("sync-state.json")
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        config.authToken = "replacement"
        do {
            try await store.applySavedConfiguration(config)
            Issue.record("Expected a persistence error")
        } catch SavedDestinationError.persistence { }
        #expect(await store.activeDestinationID == id)
        #expect(await store.configuration.authToken == "original")
        #expect(try tokens.token(for: id) == "original")
        do {
            try await store.unpairDestination(id: id)
            Issue.record("Expected a persistence error")
        } catch SavedDestinationError.persistence { }
        #expect(await store.activeDestinationID == id)
        #expect(try tokens.token(for: id) == "original")
    }

    @Test func engineRefusesSwitchAndUnpairWhileRunOwnsConfiguration() async throws {
        let dir = directory()
        let engine = HealthSyncEngine(store: SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore()),
                                      eventLog: SyncEventLog(directory: dir), wakeLog: WakeLog(directory: dir))
        #expect(await engine.configure(configuration("alpha", token: "alpha-secret")))
        let aID = try #require(await engine.store.activeDestinationID)
        #expect(await engine.configure(configuration("beta", token: "beta-secret")))
        let bID = await engine.store.activeDestinationID
        #expect(await engine.claimTypes(["test-type"]) == ["test-type"])
        do { try await engine.switchDestination(id: aID); Issue.record("Expected busy") }
        catch SavedDestinationError.busy { }
        do { try await engine.unpairDestination(id: aID); Issue.record("Expected busy") }
        catch SavedDestinationError.busy { }
        #expect(await engine.store.activeDestinationID == bID)
        #expect(await engine.store.savedDestinations.count == 2)
        await engine.sweep(["test-type"], reason: .backfill)
        try await engine.switchDestination(id: aID)
        #expect(await engine.store.activeDestinationID == aID)
        try await engine.unpairDestination(id: aID)
        #expect(await engine.transport == nil)
    }
}

extension SavedDestinationTests {
    @Test func interruptedCredentialRemovalCanBeRepairedWithoutLosingOtherReceivers() async throws {
        let dir = directory()
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        let a = configuration("alpha", token: "alpha")
        try await store.applySavedConfiguration(a)
        let aID = try #require(await store.activeDestinationID)
        await store.update("raw") { $0.anchorData = Data([4]); $0.totalSamplesExported = 7 }
        try await store.applySavedConfiguration(configuration("beta", token: "beta"))
        let bID = try #require(await store.activeDestinationID)
        try await store.switchDestination(id: aID)
        // Termination after Keychain deletion, before the registry write:
        // the entry survives but cannot upload until explicitly paired again.
        try tokens.setToken(nil, for: aID)
        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.activeDestinationID == aID)
        #expect(await reloaded.configuration.authToken == nil)
        let engine = HealthSyncEngine(store: reloaded, eventLog: SyncEventLog(directory: dir), wakeLog: WakeLog(directory: dir))
        await engine.ensureTransport()
        #expect(await engine.transport == nil)
        try await reloaded.applySavedConfiguration(a)
        #expect(await reloaded.activeDestinationID == aID)
        #expect(await reloaded.state(for: "raw").anchorData == Data([4]))
        #expect(await reloaded.savedDestinations.count == 2)
        try await reloaded.switchDestination(id: bID)
        #expect(await reloaded.configuration.authToken == "beta")
    }

    @Test func interruptedFirstPairingReusesCheckpointedCredentialIdentity() async throws {
        let dir = directory()
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        await store.persistNow()
        let file = dir.appendingPathComponent("sync-state.json")
        let checkpoint = try Data(contentsOf: file)
        let a = configuration("alpha", token: "alpha")
        try await store.applySavedConfiguration(a)
        let id = try #require(await store.activeDestinationID)
        // The durable pre-pair checkpoint survives, while the scoped Keychain
        // write has completed and the registry commit has not.
        try checkpoint.write(to: file, options: .atomic)
        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        try await reloaded.applySavedConfiguration(a)
        #expect(await reloaded.activeDestinationID == id)
        #expect(await reloaded.savedDestinations.count == 1)
        #expect(try tokens.token(for: id) == "alpha")
        try await reloaded.unpairDestination(id: id)
        #expect(try tokens.token(for: id) == nil)
    }

    @Test func migratedPublicStoreAPIsKeepScopedCredentialsCoherent() async throws {
        let dir = directory()
        let tokens = InMemoryTokenStore()
        _ = try writeLegacyFile(in: dir, config: configuration("alpha", token: "old-alpha"), tokens: tokens)
        let migrated = SyncStateStore(directory: dir, tokenStore: tokens)
        let aID = try #require(await migrated.activeDestinationID)
        await migrated.setAuthToken("rotated-alpha")
        await migrated.setConfiguration(configuration("beta", token: "beta"))
        let bID = try #require(await migrated.activeDestinationID)
        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.activeDestinationID == bID)
        #expect(await reloaded.configuration.authToken == "beta")
        try await reloaded.switchDestination(id: aID)
        #expect(await reloaded.configuration.authToken == "rotated-alpha")
        try await reloaded.unpairDestination(id: aID)
        #expect(try tokens.token(for: aID) == nil)
        #expect(try tokens.token() == nil, "The obsolete pre-migration token must also be removed")
        try await reloaded.switchDestination(id: bID)
        await reloaded.clearAuthToken()
        let disconnected = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await disconnected.configuration.authToken == nil)
        #expect(try tokens.token(for: bID) == nil)
    }
}

extension SavedDestinationTests {
    @Test func temporarilyUnreadableLegacyCredentialDoesNotCompleteMigration() async throws {
        struct LockedLegacyStore: TokenStore {
            let underlying: InMemoryTokenStore
            func token() throws -> String? { throw SavedDestinationError.credential }
            func setToken(_ token: String?) throws { try underlying.setToken(token) }
            func token(for id: UUID) throws -> String? { try underlying.token(for: id) }
            func setToken(_ token: String?, for id: UUID) throws { try underlying.setToken(token, for: id) }
        }
        let dir = directory()
        let tokens = InMemoryTokenStore()
        _ = try writeLegacyFile(in: dir, config: configuration("alpha", token: "recoverable"), tokens: tokens)
        let locked = SyncStateStore(directory: dir, tokenStore: LockedLegacyStore(underlying: tokens))
        #expect(await locked.activeDestinationID == nil)
        await locked.persistNow()
        do {
            try await locked.applySavedConfiguration(configuration("beta", token: "beta"))
            Issue.record("Credential migration must finish before replacing the receiver")
        } catch SavedDestinationError.credential { }
        let unlocked = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await unlocked.activeDestinationID != nil)
        #expect(await unlocked.configuration.authToken == "recoverable")
        #expect(await unlocked.configuration.serverURL == URL(string: "https://alpha.test"))
    }
}

extension SavedDestinationTests {
    @Test func retriedLegacyMigrationReusesCredentialAccount() async throws {
        let dir = directory()
        let tokens = InMemoryTokenStore()
        _ = try writeLegacyFile(in: dir, config: configuration("alpha", token: "legacy"), tokens: tokens)
        let file = dir.appendingPathComponent("sync-state.json")
        let legacyBytes = try Data(contentsOf: file)
        let first = SyncStateStore(directory: dir, tokenStore: tokens)
        let firstID = try #require(await first.activeDestinationID)
        // Model a lost/failed registry write after Keychain accepted the copy.
        try legacyBytes.write(to: file, options: .atomic)
        let retried = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await retried.activeDestinationID == firstID)
        #expect(try tokens.token(for: firstID) == "legacy")
        try await retried.unpairDestination(id: firstID)
        #expect(try tokens.token(for: firstID) == nil)
        #expect(try tokens.token() == nil)
    }
}

extension SavedDestinationTests {
    @Test func legacyTokenStoreConformerCanClearAndUnpairFallbackCredentials() async throws {
        struct LegacyOnlyStore: TokenStore {
            let underlying: InMemoryTokenStore
            func token() throws -> String? { try underlying.token() }
            func setToken(_ token: String?) throws { try underlying.setToken(token) }
        }
        let dir = directory()
        let tokens = LegacyOnlyStore(underlying: InMemoryTokenStore())
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        let config = configuration("alpha", token: "fallback-secret")
        try await store.applySavedConfiguration(config)
        let id = try #require(await store.activeDestinationID)
        #expect(await store.configuration.authToken == "fallback-secret")
        try await store.applySavedConfiguration(config, clearAuthToken: true)
        #expect(await store.configuration.authToken == nil)
        try await store.applySavedConfiguration(config)
        #expect(await store.activeDestinationID == id)
        try await store.unpairDestination(id: id)
        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.savedDestinations.isEmpty)
        #expect(await reloaded.configuration.authToken == nil)
        #expect(await reloaded.configuration.serverURL == nil)
        let file = dir.appendingPathComponent("sync-state.json")
        #expect(!(try String(contentsOf: file, encoding: .utf8)).contains("fallback-secret"))
    }
}
