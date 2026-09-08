import Foundation

/// Per-type aggregate the server reports from `GET /v1/stats`.
public struct TypeServerStats: Codable, Sendable, Equatable {
    public var type: String
    public var rows: Int64
    public var earliest: Date?
    public var latest: Date?
    public var lastBatchAt: Date?
    public var batches: Int64
}

/// One reconciliation window from `GET /v1/digest`: row count plus an
/// order-independent digest (XOR of all sample UUID bytes) for one UTC month.
public struct DigestWindow: Codable, Sendable, Equatable {
    public var window: Date
    public var rows: Int64
    public var digest: String
}

/// Read-side client for the ingest server's JSON endpoints (capabilities,
/// stats, reconciliation). Uploads go through `SyncTransport`; this client
/// only ever GETs.
public struct ServerAPIClient: Sendable {
    public var baseURL: URL
    public var authToken: String
    /// User whose rows every read endpoint should return.
    public var userID: String
    public var session: URLSession

    public init(
        baseURL: URL,
        authToken: String,
        userID: String = PulsDefaultUser.id,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.authToken = authToken
        self.userID = userID
        self.session = session
    }

    /// `GET /v1/capabilities`. Optional for receivers: a server without it
    /// answers 404/405 (surfaced as `TransportError.serverError`).
    public func capabilities() async throws -> ServerCapabilities {
        try await get("v1/capabilities", query: [:])
    }

    public func stats() async throws -> [TypeServerStats] {
        try await get("v1/stats", query: [:])
    }

    public func digests(type: String, from: Date, to: Date) async throws -> [DigestWindow] {
        try await get("v1/digest", query: [
            "type": type,
            "from": Self.epochMS(from),
            "to": Self.epochMS(to),
        ])
    }

    public func uuids(type: String, from: Date, to: Date) async throws -> Set<UUID> {
        struct Response: Codable { var uuids: [UUID] }
        let response: Response = try await get("v1/uuids", query: [
            "type": type,
            "from": Self.epochMS(from),
            "to": Self.epochMS(to),
        ])
        return Set(response.uuids)
    }

    private func get<T: Decodable>(_ path: String, query: [String: String]) async throws -> T {
        let request = makeRequest(path: path, query: query)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw TransportError.network(URLError(.badServerResponse))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw TransportError.fromResponse(status: http.statusCode, body: data)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try decoder.decode(T.self, from: data)
    }

    /// Shared request builder for every GET. Internal so tests can verify that
    /// adding a read endpoint cannot accidentally bypass user scoping or the
    /// protocol-version header.
    func makeRequest(path: String, query: [String: String]) -> URLRequest {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(String(PulsProtocol.version), forHTTPHeaderField: PulsProtocol.headerField)
        request.setValue(userID, forHTTPHeaderField: "X-User-ID")
        return request
    }

    private static func epochMS(_ date: Date) -> String {
        String(Int64(date.timeIntervalSince1970 * 1000))
    }
}
