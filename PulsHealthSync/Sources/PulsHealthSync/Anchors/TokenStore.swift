import Foundation
import Security
import os

/// Where the ingest server's bearer token lives at rest. The token is the one
/// secret the app holds, so it never goes into `sync-state.json` (a plain JSON
/// file that rides device backups): `SyncStateStore` keeps the token in memory
/// on `SyncConfiguration.authToken` and hands it to a `TokenStore` on save.
public protocol TokenStore: Sendable {
    /// The stored token, or nil when none is stored.
    func token() throws -> String?
    /// Replace the stored token. Passing nil removes it.
    func setToken(_ token: String?) throws
}

/// The production `TokenStore`: one `kSecClassGenericPassword` item in the app's
/// Keychain, readable after the first unlock following a reboot so background
/// wakes (observer deliveries, `BGProcessingTask`) can still build a transport
/// while the device is locked, and bound to this device so it is never restored
/// onto another one from a backup.
public struct KeychainTokenStore: TokenStore {
    public enum Failure: Error, LocalizedError, Equatable {
        case unexpectedItem
        case status(OSStatus)

        public var errorDescription: String? {
            switch self {
            case .unexpectedItem:
                return "Keychain returned an item of an unexpected shape"
            case .status(let status):
                let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
                return "Keychain error: \(message)"
            }
        }
    }

    /// Service names are namespaced by bundle identifier so two apps embedding
    /// this package on one device (or a fork with its own bundle ID) never share
    /// or clobber each other's token.
    public static var defaultService: String {
        (Bundle.main.bundleIdentifier ?? "PulsHealthSync") + ".sync-token"
    }

    public let service: String
    public let account: String

    public init(service: String? = nil, account: String = "sync-token") {
        self.service = service ?? Self.defaultService
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func token() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data else { throw Failure.unexpectedItem }
            return String(data: data, encoding: .utf8)
        case errSecItemNotFound:
            return nil
        default:
            throw Failure.status(status)
        }
    }

    public func setToken(_ token: String?) throws {
        guard let token else {
            let status = SecItemDelete(baseQuery as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw Failure.status(status)
            }
            return
        }
        let payload: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, payload as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            let addStatus = SecItemAdd(
                baseQuery.merging(payload) { _, new in new } as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw Failure.status(addStatus) }
        default:
            throw Failure.status(updateStatus)
        }
    }
}

/// A `TokenStore` that forgets on process exit. For tests, benchmarks, and
/// throwaway engines (`BenchmarkView`) that must never touch the real Keychain.
public final class InMemoryTokenStore: TokenStore, Sendable {
    private let storage: OSAllocatedUnfairLock<String?>

    public init(token: String? = nil) {
        storage = OSAllocatedUnfairLock(initialState: token)
    }

    public func token() throws -> String? {
        storage.withLock { $0 }
    }

    public func setToken(_ token: String?) throws {
        storage.withLock { $0 = token }
    }
}
