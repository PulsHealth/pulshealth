import Foundation

/// The Puls Sync Protocol version this client speaks.
///
/// Every batch header carries `schemaVersion` (this value) and `clientVersion`
/// (the host app's marketing version and build), and every HTTP request —
/// uploads and the read endpoints alike — carries the `X-Puls-Protocol` header.
/// A server that does not speak the version answers HTTP 400 with
/// `{"error":"unsupported protocol version","supportedVersions":[…]}`, which
/// the transports surface as `TransportError.unsupportedProtocol` so the UI
/// can say "this server does not support this app version" instead of a
/// generic 400.
public enum PulsProtocol {
    /// The protocol version of this client. Bump only with a wire-format change
    /// an older server could not accept.
    public static let version = 1

    /// Request header naming the protocol version, on every request.
    public static let headerField = "X-Puls-Protocol"

    /// `type` of the header-only batch a connection test uploads when the
    /// server offers no `/v1/capabilities`: all counts zero, `reason` manual.
    /// Any 2xx means the server accepts batches from this client.
    public static let probeBatchType = "probe"

    /// `"<marketing version> (<build>)"` of the host app, or `"unknown"` when
    /// the main bundle carries no version. Sent as `clientVersion` in every
    /// batch header so a server can tell which app build produced a batch.
    public static let clientVersion: String = clientVersion(of: .main)

    static func clientVersion(of bundle: Bundle) -> String {
        let info = bundle.infoDictionary ?? [:]
        return clientVersion(
            marketing: info["CFBundleShortVersionString"] as? String,
            build: info["CFBundleVersion"] as? String)
    }

    static func clientVersion(marketing: String?, build: String?) -> String {
        let marketing = marketing?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let build = build?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch (marketing.isEmpty, build.isEmpty) {
        case (false, false): return "\(marketing) (\(build))"
        case (false, true): return marketing
        case (true, false): return "(\(build))"
        case (true, true): return "unknown"
        }
    }
}

/// What a server advertises on `GET /v1/capabilities`. Optional for receivers:
/// a server may answer 404/405, in which case the client falls back to a
/// header-only probe batch and treats every feature as unavailable.
public struct ServerCapabilities: Codable, Sendable, Equatable {
    /// Well-known feature names the reference server advertises. A server that
    /// omits one simply does not offer it; the app hides the matching UI.
    public enum Feature {
        public static let batches = "batches"
        public static let stats = "stats"
        public static let digest = "digest"
        public static let uuids = "uuids"
        public static let aggregates = "aggregates"
        public static let activitySummaries = "activitySummaries"
        public static let routes = "routes"
        public static let series = "series"
        public static let profile = "profile"
    }

    /// Protocol versions the server accepts (`PulsProtocol.version` must be among them).
    public var protocolVersions: [Int]
    /// Advertised feature names (see `Feature`).
    public var features: Set<String>
    /// Server implementation name, e.g. "puls-ingest"; empty when not reported.
    public var server: String
    /// Server implementation version; empty when not reported.
    public var version: String

    public init(protocolVersions: [Int], features: Set<String>, server: String = "", version: String = "") {
        self.protocolVersions = protocolVersions
        self.features = features
        self.server = server
        self.version = version
    }

    private enum CodingKeys: String, CodingKey {
        case protocolVersions, features, server, version
    }

    // Lenient: third-party receivers may omit any field but protocolVersions.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersions = try c.decodeIfPresent([Int].self, forKey: .protocolVersions) ?? []
        features = Set(try c.decodeIfPresent([String].self, forKey: .features) ?? [])
        server = try c.decodeIfPresent(String.self, forKey: .server) ?? ""
        version = try c.decodeIfPresent(String.self, forKey: .version) ?? ""
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(protocolVersions, forKey: .protocolVersions)
        try c.encode(features.sorted(), forKey: .features)
        try c.encode(server, forKey: .server)
        try c.encode(version, forKey: .version)
    }

    public func supports(_ feature: String) -> Bool {
        features.contains(feature)
    }

    /// Whether the server accepts the protocol version this client speaks.
    public var acceptsClientProtocol: Bool {
        protocolVersions.contains(PulsProtocol.version)
    }

    /// Reconciliation needs both the per-month digests and the UUID listing.
    public var supportsReconciliation: Bool {
        supports(Feature.digest) && supports(Feature.uuids)
    }

    public var supportsStats: Bool {
        supports(Feature.stats)
    }

    /// "name version" for display, or an empty string when the server reports neither.
    public var displayName: String {
        [server, version].filter { !$0.isEmpty }.joined(separator: " ")
    }
}
