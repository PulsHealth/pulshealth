import Foundation
import CryptoKit
import PulsHealthSync

/// The only outbound representation for a collection. Never encode SyncBatch
/// itself: that carries source/device/profile fields the participant did not approve.
struct CollectionRecord: Encodable, Sendable {
    var key: String; var type: String; var function: String
    var start: Int64; var end: Int64
    var value: Double?; var category: Int?; var unit: String?
    enum CodingKeys: String, CodingKey { case key, type, function, start, end, value, category, unit }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(key, forKey: .key); try c.encode(type, forKey: .type); try c.encode(function, forKey: .function)
        try c.encode(start, forKey: .start); try c.encode(end, forKey: .end)
        try c.encode(value, forKey: .value); try c.encode(category, forKey: .category); try c.encode(unit, forKey: .unit)
    }
}
struct CollectionBatch: Encodable, Sendable {
    var batchID: UUID; var records: [CollectionRecord]; var deletions: [String]
    static func milliseconds(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded(.down)) }
    // A sample cannot be linked across different requests through its HealthKit UUID.
    static func key(_ uuid: UUID, enrollment: UUID) -> String {
        let bytes = Array(SHA256.hash(data: Data((enrollment.uuidString + uuid.uuidString).utf8)).prefix(16))
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        let pieces = [0..<8,8..<12,12..<16,16..<20,20..<32].map { range in
            String(hex[hex.index(hex.startIndex, offsetBy: range.lowerBound)..<hex.index(hex.startIndex, offsetBy: range.upperBound)])
        }
        return pieces.joined(separator: "-")
    }
    init(_ batch: SyncBatch, enrollment e: CollectionEnrollment) {
        batchID = batch.batchID
        let allowed = Set(e.metrics.map(\.id))
        records = batch.samples.filter {
            allowed.contains($0.type + ":raw") && $0.start >= e.start && $0.start < e.end && $0.end <= e.end
        }.map { s in
            CollectionRecord(key: Self.key(s.uuid, enrollment: e.id), type: s.type, function: "raw",
                start: Self.milliseconds(s.start), end: Self.milliseconds(s.end), value: s.value, category: s.category, unit: s.unit)
        }
        records += batch.aggregates.filter {
            allowed.contains($0.type + ":" + $0.function.rawValue) && $0.bucketStart >= e.start && $0.bucketEnd <= e.end
                && $0.intervalValue == 1 && $0.intervalUnit == .day && $0.deviceFilter == .all
        }.map { a in
            let start = Self.milliseconds(a.bucketStart)
            return CollectionRecord(key: "\(a.type):\(a.function.rawValue):\(start)", type: a.type, function: a.function.rawValue,
                start: start, end: Self.milliseconds(a.bucketEnd), value: a.value, category: nil, unit: a.unit)
        }
        deletions = batch.deletions.map { Self.key($0.uuid, enrollment: e.id) }
    }
}
actor CollectionTransport: SyncTransport {
    let enrollment: CollectionEnrollment
    private let token: String
    private let session: URLSession
    private var enabled = true
    init(enrollment: CollectionEnrollment, token: String) {
        self.enrollment = enrollment; self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCache = nil
        session = URLSession(configuration: config, delegate: CollectionNoRedirects(), delegateQueue: nil)
    }
    func disable() { enabled = false; session.invalidateAndCancel() }
    func upload(_ batch: SyncBatch) async throws -> UploadResult {
        guard enabled else { throw CancellationError() }
        try Task.checkCancellation()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(CollectionBatch(batch, enrollment: enrollment))
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        var request = URLRequest(url: PulsHealthDatabase.viewerURL.appending(path: "api/sharing"))
        request.httpMethod = "POST"; request.httpBody = data; request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let started = Date()
        let (body, response) = try await session.data(for: request)
        guard enabled else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw TransportError.serverError(status: (response as? HTTPURLResponse)?.statusCode ?? 500, body: "Collection upload was not accepted. Check sharing status.")
        }
        struct Receipt: Decodable { var batchID: UUID; var digest: String }
        let receipt = try JSONDecoder().decode(Receipt.self, from: body)
        guard receipt.batchID == batch.batchID, receipt.digest == digest else { throw CollectionError("The collection receipt could not be verified.") }
        return UploadResult(bytesSent: data.count, duration: Date().timeIntervalSince(started))
    }
}
final class CollectionNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
