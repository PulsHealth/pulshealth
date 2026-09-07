import Foundation
import os

/// Result of uploading one batch — fed into per-type stats.
public struct UploadResult: Sendable {
    /// Compressed bytes actually sent on the wire.
    public var bytesSent: Int
    public var duration: TimeInterval

    public init(bytesSent: Int, duration: TimeInterval) {
        self.bytesSent = bytesSent
        self.duration = duration
    }
}

public enum TransportError: Error, LocalizedError {
    case notConfigured
    case serverError(status: Int, body: String)
    case network(Error)
    /// HTTP 400 `{"error":"unsupported protocol version","supportedVersions":[…]}`:
    /// the server does not speak `PulsProtocol.version`. Distinct from
    /// `serverError` so the UI can name the cause instead of showing a raw 400.
    case unsupportedProtocol(supportedVersions: [Int])

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Server URL or auth token not configured"
        case .serverError(let status, let body):
            return "Server returned \(status): \(body.prefix(200))"
        case .network(let error):
            return "Network error: \(error.localizedDescription)"
        case .unsupportedProtocol(let versions):
            let list = versions.isEmpty ? "none" : versions.map(String.init).joined(separator: ", ")
            return "This server does not support this app version (server protocol \(list), app protocol \(PulsProtocol.version))"
        }
    }

    /// Server 4xx errors won't succeed on retry; everything else might.
    var isRetryable: Bool {
        switch self {
        case .notConfigured: return false
        case .serverError(let status, _): return status >= 500 || status == 429
        case .network: return true
        case .unsupportedProtocol: return false
        }
    }

    /// Classifies a non-2xx response. A 400 whose body is the protocol
    /// rejection becomes `unsupportedProtocol`; everything else is `serverError`.
    static func fromResponse(status: Int, body: Data) -> TransportError {
        if status == 400, let versions = Self.unsupportedProtocolVersions(in: body) {
            return .unsupportedProtocol(supportedVersions: versions)
        }
        return .serverError(status: status, body: String(data: body.prefix(512), encoding: .utf8) ?? "")
    }

    private static func unsupportedProtocolVersions(in body: Data) -> [Int]? {
        struct Rejection: Decodable {
            var error: String
            var supportedVersions: [Int]?
        }
        guard let rejection = try? JSONDecoder().decode(Rejection.self, from: body),
              rejection.error.lowercased() == "unsupported protocol version"
        else { return nil }
        return rejection.supportedVersions ?? []
    }
}

/// Pluggable upload destination. The engine only ever talks to this protocol,
/// so tests and benchmarks can swap in mocks, and other backends (file export,
/// S3, etc.) can be added without touching sync logic.
public protocol SyncTransport: Sendable {
    func upload(_ batch: SyncBatch) async throws -> UploadResult
}

/// POSTs gzip NDJSON batches to the Puls ingest server with exponential-backoff retry.
public struct HTTPSyncTransport: SyncTransport {
    public var baseURL: URL
    public var authToken: String
    /// The user every batch is attributed to (sent as the `X-User-ID` header).
    public var userID: String
    public var maxRetries: Int

    private let session: URLSession
    private let logger = Logger(subsystem: PulsLog.subsystem, category: "transport")

    public init(baseURL: URL, authToken: String, userID: String = PulsDefaultUser.id, maxRetries: Int = 4, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.authToken = authToken
        self.userID = userID
        self.maxRetries = maxRetries
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 60
            config.httpMaximumConnectionsPerHost = 8
            // Uploads are useless stale; don't let the OS queue them for hours.
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
    }

    /// Uploads a header-only batch (every count zero, `reason` manual, `type`
    /// `PulsProtocol.probeBatchType`). Any 2xx proves the server accepts
    /// batches from this client; used by the connection test when the server
    /// has no `/v1/capabilities`.
    public func probe(deviceID: String) async throws -> UploadResult {
        try await upload(SyncBatch(
            deviceID: deviceID, type: PulsProtocol.probeBatchType, reason: .manual,
            samples: [], deletions: []))
    }

    public func upload(_ batch: SyncBatch) async throws -> UploadResult {
        let ndjson = try BatchSerializer.ndjson(for: batch)
        let body = BatchSerializer.gzip(ndjson)
        let request = makeRequest(for: batch, body: body)

        // Observer wakes hold HealthKit's completion handlers until the whole
        // wake finishes. Offline, the full backoff ladder (2+4+8+16 s, per pack)
        // can outlast the app's background allowance, and HealthKit stops
        // waking the app after three unacknowledged deliveries. Spend one retry
        // there and give up: anchors stay put, so the next wake resends.
        let retryBudget = WakeScope.current?.trigger == .observer ? min(maxRetries, 1) : maxRetries

        var attempt = 0
        while true {
            let start = ContinuousClock.now
            do {
                let (data, response) = try await session.data(for: request)
                let elapsed = (ContinuousClock.now - start).seconds
                guard let http = response as? HTTPURLResponse else {
                    throw TransportError.network(URLError(.badServerResponse))
                }
                guard (200..<300).contains(http.statusCode) else {
                    throw TransportError.fromResponse(status: http.statusCode, body: data)
                }
                logger.debug("Uploaded \(batch.samples.count) samples (\(body.count) bytes gzip, \(ndjson.count) raw) in \(elapsed, format: .fixed(precision: 3))s")
                return UploadResult(bytesSent: body.count, duration: elapsed)
            } catch {
                // A cancelled request surfaces as URLError.cancelled, which would
                // otherwise count as a retryable network error and burn a backoff
                // sleep before the CancellationError from Task.sleep escapes.
                if Task.isCancelled { throw CancellationError() }
                let transportError = (error as? TransportError) ?? .network(error)
                attempt += 1
                guard transportError.isRetryable, attempt <= retryBudget else {
                    throw transportError
                }
                let delay = min(30, pow(2.0, Double(attempt))) * .random(in: 0.7...1.3)
                logger.warning("Upload attempt \(attempt) failed (\(String(describing: transportError))); retrying in \(delay, format: .fixed(precision: 1))s")
                try await Task.sleep(for: .seconds(delay))
            }
        }
    }

    /// The upload request for one batch. Internal so tests can verify the
    /// headers every upload must carry (protocol version, user, wake).
    func makeRequest(for batch: SyncBatch, body: Data) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/batches"))
        request.httpMethod = "POST"
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Content-Type")
        request.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(String(PulsProtocol.version), forHTTPHeaderField: PulsProtocol.headerField)
        request.setValue(batch.batchID.uuidString, forHTTPHeaderField: "X-Batch-ID")
        request.setValue(userID, forHTTPHeaderField: "X-User-ID")
        // Stamp the originating wake (task-local, inherited from the sync that
        // built this batch) so the server's `batches` rows join back to the
        // device's wake records. Like X-User-ID, this is transport metadata, not
        // NDJSON body — absent for work outside a wake (reconciliation, tests).
        if let wake = WakeScope.current {
            request.setValue(wake.id.uuidString, forHTTPHeaderField: "X-Wake-ID")
            request.setValue(wake.trigger.rawValue, forHTTPHeaderField: "X-Wake-Trigger")
        }
        request.httpBody = body
        return request
    }
}

extension Duration {
    var seconds: TimeInterval {
        TimeInterval(components.seconds) + TimeInterval(components.attoseconds) / 1e18
    }
}
