import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct MedicationIdentityStoreTests {
    @Test func equalObjectsReuseAliasAcrossArchiveRoundTrip() throws {
        var registry = ArchivedMedicationIdentities()
        let original = try registry.resolve([NSString(string: "one"), NSString(string: "two"), NSString(string: "one")])
        #expect(original[0] == original[2])
        #expect(original[0] != original[1])
        #expect(original.allSatisfy { UUID(uuidString: $0) != nil })
        let encoded = try JSONEncoder().encode(registry)
        var reopened = try JSONDecoder().decode(ArchivedMedicationIdentities.self, from: encoded)
        let next = try reopened.resolve([NSString(string: "two"), NSString(string: "one")])
        #expect(next == [original[1], original[0]])
    }

    @Test func changedNamespaceDoesNotReuseAlias() throws {
        var first = ArchivedMedicationIdentities()
        var second = ArchivedMedicationIdentities()
        #expect(try first.resolve([NSString(string: "one")]) != second.resolve([NSString(string: "one")]))
    }

    @Test func rejectsUnknownVersionsAndDuplicateAliases() throws {
        var registry = ArchivedMedicationIdentities()
        _ = try registry.resolve([NSString(string: "one"), NSString(string: "two")])
        let data = try JSONEncoder().encode(registry)
        var json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        json["version"] = 2
        var future = try JSONDecoder().decode(ArchivedMedicationIdentities.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(throws: (any Error).self) { try future.resolve([NSString(string: "one")]) }
        json["version"] = 1
        var entries = try #require(json["entries"] as? [[String: Any]])
        entries[1]["identifier"] = entries[0]["identifier"]
        json["entries"] = entries
        var duplicate = try JSONDecoder().decode(ArchivedMedicationIdentities.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(throws: (any Error).self) { try duplicate.resolve([NSString(string: "one")]) }
    }

    @Test func persistsBeforeReturningAndRefusesCorruption() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = MedicationIdentityStore(directory: directory)
        let original = try await first.resolve([NSString(string: "one")])
        let reopened = MedicationIdentityStore(directory: directory)
        let restored = try await reopened.resolve([NSString(string: "one")])
        #expect(restored == original)
        let file = directory.appendingPathComponent("medication-identities.json")
        try Data("invalid JSON".utf8).write(to: file)
        do {
            _ = try await reopened.resolve([NSString(string: "one")])
            Issue.record("A corrupt registry must not silently mint new identities")
        } catch { }
        #expect(try String(contentsOf: file, encoding: .utf8) == "invalid JSON")
    }

    @Test func persistenceFailureDoesNotReturnAnAlias() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        // A regular file cannot be used as the registry directory.
        try Data().write(to: directory)
        let store = MedicationIdentityStore(directory: directory)
        do {
            _ = try await store.resolve([NSString(string: "one")])
            Issue.record("An unpersisted identity must never reach an upload")
        } catch { }
    }
}
