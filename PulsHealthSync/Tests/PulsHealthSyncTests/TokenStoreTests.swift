import Foundation
import Security
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

// MARK: - Token store

@Suite struct TokenStoreTests {
    @Test func inMemoryStoreRoundTripsAndDeletes() throws {
        let store = InMemoryTokenStore()
        #expect(try store.token() == nil)
        try store.setToken("abc")
        #expect(try store.token() == "abc")
        try store.setToken("def")
        #expect(try store.token() == "def")
        try store.setToken(nil)
        #expect(try store.token() == nil)
    }

    /// The one test that touches the real Keychain. A unique service name
    /// keeps it clear of the app's item and of parallel test runs.
    @Test func keychainStoreRoundTripsAndDeletes() throws {
        let store = KeychainTokenStore(service: "PulsHealthSyncTests.\(UUID().uuidString)")
        defer { try? store.setToken(nil) }
        do {
            try store.setToken("first")
        } catch KeychainTokenStore.Failure.status(let status)
            where status == errSecMissingEntitlement || status == errSecInteractionNotAllowed
        {
            // A test host without Keychain access — nothing to verify here.
            return
        }
        #expect(try store.token() == "first")
        // Update path (item already exists).
        try store.setToken("second")
        #expect(try store.token() == "second")
        try store.setToken(nil)
        #expect(try store.token() == nil)
        // Deleting an absent item is not an error.
        try store.setToken(nil)
    }

    @Test func defaultServiceIsNamespacedByBundle() {
        #expect(KeychainTokenStore.defaultService.hasSuffix(".sync-token"))
        #expect(KeychainTokenStore().account == "sync-token")
    }
}

// MARK: - Token never persists in the state file

@Suite struct StateFileTokenTests {
    @Test func configurationEncoderOmitsTheToken() throws {
        let config = SyncConfiguration(
            serverURL: URL(string: "https://example.test:8080")!, authToken: "secret-token")
        let json = try JSONSerialization.jsonObject(
            with: JSONEncoder.puls.encode(config)) as! [String: Any]
        #expect(json["authToken"] == nil)
        #expect(json["serverURL"] as? String == "https://example.test:8080")
        // Still decodable, for the migration of older files.
        let legacy = #"{"enabledTypes":[],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000,"authToken":"legacy"}"#
        let decoded = try JSONDecoder.puls.decode(SyncConfiguration.self, from: Data(legacy.utf8))
        #expect(decoded.authToken == "legacy")
    }

    @Test func tokenGoesToTheStoreAndNotTheFile() async throws {
        let dir = makeDir()
        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        var config = await store.configuration
        config.serverURL = URL(string: "https://example.test")
        config.authToken = "secret-token"
        await store.setConfiguration(config)
        await store.persistNow()

        #expect(try tokens.token() == "secret-token")
        let raw = try String(contentsOf: dir.appendingPathComponent("sync-state.json"), encoding: .utf8)
        #expect(!raw.contains("secret-token"))
        #expect(!raw.contains("authToken"))

        // In memory the configuration still carries the token for the transport.
        #expect(await store.configuration.authToken == "secret-token")

        // A new instance over the same file + store reads it back.
        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.configuration.authToken == "secret-token")
        #expect(await reloaded.configuration.serverURL == URL(string: "https://example.test"))
    }

    @Test func clearingTheTokenDeletesItFromTheStore() async throws {
        let tokens = InMemoryTokenStore(token: "old")
        let store = SyncStateStore(directory: makeDir(), tokenStore: tokens)
        #expect(await store.configuration.authToken == "old")
        var config = await store.configuration
        config.authToken = nil
        await store.setConfiguration(config)
        #expect(try tokens.token() == nil)
    }

    @Test func legacyFileTokenMigratesIntoTheStoreAndOutOfTheFile() async throws {
        let dir = makeDir()
        try writeLegacyState(#"""
        {"configuration":{"enabledTypes":["type-a"],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000,
         "serverURL":"https://example.test","authToken":"legacy-secret"},
         "typeStates":{"type-a":{"identifier":"type-a","anchorData":"AQID","backfillComplete":true,
         "totalSamplesExported":5,"totalDeletionsExported":0,"totalBytesUploaded":1,"totalBatchesUploaded":1}},
         "deviceID":"dev-1"}
        """#, in: dir)

        let tokens = InMemoryTokenStore()
        let store = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(try tokens.token() == "legacy-secret")
        #expect(await store.configuration.authToken == "legacy-secret")
        // Anchors survived the migration.
        #expect(await store.state(for: "type-a").totalSamplesExported == 5)

        // The file was rewritten immediately, without waiting for the next
        // debounced write, and no longer names the token.
        let raw = try String(contentsOf: dir.appendingPathComponent("sync-state.json"), encoding: .utf8)
        #expect(!raw.contains("legacy-secret"))
        #expect(!raw.contains("authToken"))

        // Loading again finds the token in the store, not the file.
        let reloaded = SyncStateStore(directory: dir, tokenStore: tokens)
        #expect(await reloaded.configuration.authToken == "legacy-secret")
    }

    @Test func rejectedMigrationLeavesTheTokenInTheFile() async throws {
        struct Refusing: TokenStore {
            struct Nope: Error {}
            func token() throws -> String? { nil }
            func setToken(_ token: String?) throws { throw Nope() }
        }
        let dir = makeDir()
        try writeLegacyState(#"{"configuration":{"enabledTypes":[],"startDate":0,"maxConcurrentTypes":4,"batchSize":1000,"authToken":"legacy-secret"},"typeStates":{},"deviceID":"dev-1"}"#, in: dir)
        let store = SyncStateStore(directory: dir, tokenStore: Refusing())
        // Still usable in memory — a sync must not stall because of the Keychain.
        #expect(await store.configuration.authToken == "legacy-secret")
        // Untouched on disk, so the migration retries next launch.
        let raw = try String(contentsOf: dir.appendingPathComponent("sync-state.json"), encoding: .utf8)
        #expect(raw.contains("legacy-secret"))
    }

    @Test func stateFilesAreExcludedFromBackup() async throws {
        let dir = makeDir()
        let store = SyncStateStore(directory: dir, tokenStore: InMemoryTokenStore())
        await store.persistNow()
        let log = SyncEventLog(directory: dir)
        await log.log(.info, "hello")
        try await Task.sleep(for: .milliseconds(1_300))

        for name in ["sync-state.json", "event-log.json"] {
            let url = dir.appendingPathComponent(name)
            let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
            #expect(values.isExcludedFromBackup == true, "\(name) should be excluded from backup")
        }
        let dirValues = try dir.resourceValues(forKeys: [.isExcludedFromBackupKey])
        #expect(dirValues.isExcludedFromBackup == true)
    }
}
