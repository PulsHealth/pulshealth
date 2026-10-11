import Foundation
import CryptoKit

/// A paired receiver. Only the active destination receives automatic uploads.
public struct SavedSyncDestination: Identifiable, Sendable, Equatable, Codable {
    public let id: UUID
    public let identity: ServerIdentity
    public let serverURL: URL
    public let userID: String
    /// Stable across a retried migration or interrupted pairing. A credential
    /// never gets a new, unreachable random Keychain account on every retry.
    static func identifier(identity: ServerIdentity, deviceID: String) -> UUID {
        let parts = [deviceID, identity.host, identity.port.map(String.init) ?? "",
                     identity.path, identity.userID]
        let digest = Array(SHA256.hash(data: Data(parts.map { "\($0.utf8.count):\($0)" }.joined().utf8)))
        return UUID(uuid: (digest[0], digest[1], digest[2], digest[3], digest[4], digest[5], digest[6], digest[7],
                           digest[8], digest[9], digest[10], digest[11], digest[12], digest[13], digest[14], digest[15]))
    }

}

public enum SavedDestinationError: Error, LocalizedError {
    case busy, readOnly, notFound, credential, persistence

    public var errorDescription: String? {
        switch self {
        case .busy: "Wait for the current sync or connection request to finish before changing databases."
        case .readOnly: "Sync settings could not be read. Unlock your device and reopen the app."
        case .notFound: "This paired database is no longer available."
        case .credential: "The database credential could not be read or removed. Please try again."
        case .persistence: "The database change could not be saved. Your active database has not changed."
        }
    }
}

/// Every cursor is owned by a single receiver/user identity, including partial
/// full-pass and recent-window cursors. Configuration encoding omits credentials.
struct SavedDestinationState: Codable, Sendable {
    var destination: SavedSyncDestination
    var configuration: SyncConfiguration
    var typeStates: [String: TypeSyncState]
    var aggregateStates: [String: AggregateSyncState]
    var activitySummaryState: ActivitySummaryState
    var workoutRoutesState: WorkoutEnrichmentState
    var workoutStreamsState: WorkoutEnrichmentState
    /// Only used if the destination-specific Keychain item rejected a write.
    var fallbackAuthToken: String?
}
