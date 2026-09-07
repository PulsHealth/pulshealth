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

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Server URL or auth token not configured"
        case .serverError(let status, let body):
            return "Server returned \(status): \(body.prefix(200))"
        case .network(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }

    /// Server 4xx errors won't succeed on retry; everything else might.
    var isRetryable: Bool {
        switch self {
        case .notConfigured: return false
        case .serverError(let status, _): return status >= 500 || status == 429
        case .network: return true
        }
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

    public func upload(_ batch: SyncBatch) async throws -> UploadResult {
        let ndjson = try BatchSerializer.ndjson(for: batch)
        let body = BatchSerializer.gzip(ndjson)

        var request = URLRequest(url: baseURL.appendingPathComponent("v1/batches"))
        request.httpMethod = "POST"
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Content-Type")
        request.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
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
                    throw TransportError.serverError(
                        status: http.statusCode,
                        body: String(data: data, encoding: .utf8) ?? ""
                    )
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
}

extension Duration {
    var seconds: TimeInterval {
        TimeInterval(components.seconds) + TimeInterval(components.attoseconds) / 1e18
    }
}
