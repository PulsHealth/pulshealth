import Foundation
import HealthKit

/// Installation-local aliases, separate from receiver progress. Exports share this
/// registry with sync so they agree without sharing anchors or acknowledgements.
/// Apple's secure archives remain private; only independently generated UUIDs leave
/// the phone. Deleting the app/registry starts a new identity namespace.
actor MedicationIdentityStore {
    static let shared = MedicationIdentityStore()

    private let file: URL

    init(directory: URL? = nil) {
        let directory = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PulsHealthSync", isDirectory: true)
        file = directory.appendingPathComponent("medication-identities.json")
    }

    @available(iOS 26.0, *)
    func identifiers(for concepts: [HKHealthConceptIdentifier]) throws -> [String] {
        try resolve(concepts)
    }

    /// Generic only to exercise archival, equality, and persistence with constructible
    /// secure-coding test objects; HealthKit identifiers have no public initializer.
    func resolve<Identifier: NSObject & NSSecureCoding>(_ concepts: [Identifier]) throws -> [String] {
        guard !concepts.isEmpty else { return [] }
        let data: Data?
        switch ProtectedStateFile.read(file) {
        case .missing: data = nil
        case .unreadable(let error): throw error
        case .data(let contents): data = contents
        }
        var registry = try data.map { try JSONDecoder().decode(ArchivedMedicationIdentities.self, from: $0) }
            ?? ArchivedMedicationIdentities()
        let result = try registry.resolve(concepts)
        // Persist before exposing an ID to either transport. Failure keeps the page
        // unacknowledged instead of uploading an alias that cannot survive restart.
        ProtectedStateFile.prepareDirectory(file.deletingLastPathComponent())
        try ProtectedStateFile.write(try JSONEncoder().encode(registry), to: file)
        return result
    }
}

/// Never hashes archive bytes: a secure-coding archive is a storage format, not a
/// canonical identifier. Matching always asks the decoded public object for equality.
struct ArchivedMedicationIdentities: Codable {
    private struct Entry: Codable {
        let identifier: UUID
        let archive: Data
    }
    private var version = 1
    private var entries: [Entry] = []

    enum InvalidRegistry: Error { case unsupportedVersion, duplicateIdentity, invalidArchive }

    mutating func resolve<Identifier: NSObject & NSSecureCoding>(_ concepts: [Identifier]) throws -> [String] {
        guard version == 1 else { throw InvalidRegistry.unsupportedVersion }
        guard Set(entries.map(\.identifier)).count == entries.count else { throw InvalidRegistry.duplicateIdentity }
        var decoded: [Identifier] = try entries.map {
            guard let concept = try NSKeyedUnarchiver.unarchivedObject(ofClass: Identifier.self, from: $0.archive)
            else { throw InvalidRegistry.invalidArchive }
            return concept
        }
        for index in decoded.indices {
            guard !decoded[..<index].contains(where: { $0.isEqual(decoded[index]) }) else {
                throw InvalidRegistry.duplicateIdentity
            }
        }
        return try concepts.map { concept in
            if let index = decoded.firstIndex(where: { $0.isEqual(concept) }) {
                return entries[index].identifier.uuidString.lowercased()
            }
            let entry = Entry(identifier: UUID(), archive: try NSKeyedArchiver.archivedData(
                withRootObject: concept, requiringSecureCoding: true))
            entries.append(entry)
            decoded.append(concept)
            return entry.identifier.uuidString.lowercased()
        }
    }
}
