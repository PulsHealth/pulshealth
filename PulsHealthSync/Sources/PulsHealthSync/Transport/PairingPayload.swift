import Foundation

/// The three values a phone needs to start syncing, as encoded in the QR code
/// `scripts/bootstrap.sh` prints:
///
/// ```
/// puls://pair?url=<percent-encoded>&token=<percent-encoded>&user=<uuid>
/// ```
///
/// Nothing else is trusted from a scanned code: the URL goes through the same
/// `ServerURLValidation` rules as a typed one (https everywhere, plain http
/// only for local-network hosts, matching the app's ATS exception) and the user
/// must be a UUID. Unknown query items are ignored so the payload can grow
/// without breaking older apps; anything that is not a pairing code at all is
/// rejected with a message the scanner can show.
public struct PairingPayload: Sendable, Equatable {
    /// Validated and normalized (no trailing slash), ready for `SyncConfiguration.serverURL`.
    public let serverURL: URL
    /// Bearer token, whitespace-trimmed.
    public let token: String
    /// Lowercased UUID string, matching how `SyncConfiguration.userID` is stored.
    public let userID: String

    public init(serverURL: URL, token: String, userID: String) {
        self.serverURL = serverURL
        self.token = token
        self.userID = userID
    }

    /// The URL scheme of a pairing code.
    public static let scheme = "puls"
    /// The host of a pairing code (`puls://pair?…`).
    public static let host = "pair"

    public enum Failure: Error, Equatable, LocalizedError, Sendable {
        /// Not a `puls://pair?…` URL at all — some other QR code was scanned.
        case notAPairingCode
        /// A required query item (`url`, `token`, `user`) is absent or empty.
        case missingField(String)
        /// `url` is present but fails the app's server-URL rules.
        case invalidServerURL(ServerURLValidation.Failure)
        /// `user` is present but is not a UUID.
        case invalidUserID

        public var errorDescription: String? {
            switch self {
            case .notAPairingCode:
                return "That is not a PulsHealth pairing code. Scan the QR code printed by scripts/bootstrap.sh."
            case .missingField(let field):
                return "The pairing code is missing its \(field). Re-run scripts/bootstrap.sh --print-pairing to get a fresh one."
            case .invalidServerURL(let failure):
                return "The pairing code's server URL is unusable. \(failure.errorDescription ?? "")"
                    .trimmingCharacters(in: .whitespaces)
            case .invalidUserID:
                return "The pairing code's user ID is not a UUID."
            }
        }
    }

    /// Parses a scanned string. Percent-encoding is undone by `URLComponents`,
    /// so `url=https%3A%2F%2Fhost%3A8080` arrives as `https://host:8080`.
    public static func parse(_ text: String) -> Result<PairingPayload, Failure> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let components = URLComponents(string: trimmed),
              components.scheme?.lowercased() == scheme,
              (components.host ?? "").lowercased() == host
        else { return .failure(.notAPairingCode) }

        // First occurrence wins; unknown items are ignored on purpose.
        var values: [String: String] = [:]
        for item in components.queryItems ?? [] {
            let key = item.name.lowercased()
            guard values[key] == nil, let value = item.value else { continue }
            values[key] = value
        }

        func field(_ name: String) -> Result<String, Failure> {
            let value = (values[name] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? .failure(.missingField(name)) : .success(value)
        }

        let rawURL: String
        let rawToken: String
        let rawUser: String
        switch field("url") {
        case .success(let value): rawURL = value
        case .failure(let failure): return .failure(failure)
        }
        switch field("token") {
        case .success(let value): rawToken = value
        case .failure(let failure): return .failure(failure)
        }
        switch field("user") {
        case .success(let value): rawUser = value
        case .failure(let failure): return .failure(failure)
        }

        let url: URL
        switch ServerURLValidation.validate(rawURL) {
        case .success(let value): url = value
        case .failure(let failure): return .failure(.invalidServerURL(failure))
        }
        guard let uuid = UUID(uuidString: rawUser) else { return .failure(.invalidUserID) }

        return .success(
            PairingPayload(serverURL: url, token: rawToken, userID: uuid.uuidString.lowercased()))
    }

    /// Writes the three values into a configuration draft. Nothing else in the
    /// configuration is touched — a pairing code cannot change which types sync.
    public func apply(to configuration: inout SyncConfiguration) {
        configuration.serverURL = serverURL
        configuration.authToken = token
        configuration.userID = userID
    }
}
