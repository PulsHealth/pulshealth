import CryptoKit
import Foundation

/// Experimental sealed transport. A whole HealthKit page is acknowledged only
/// after every encrypted part and its atomic commit have been acknowledged.
/// The existing readable transport and wire protocol are unchanged.
public actor PrivateVaultTransport: SyncTransport {
    public let baseURL: URL
    public let participantID: String
    private let token: String
    private let recipient: Curve25519.KeyAgreement.PublicKey
    private let directory: URL
    private let session: URLSession
    public static let partSize = 1_048_576
    public static let maximumPlaintext = 256 * 1_048_576

    private struct Staged: Codable {
        var id: String
        var objects: [String]
    }
    private struct Receipt: Codable {
        var id: String
        var sequence: Int64
        var objects: [String]
    }
    public init(baseURL: URL, participantID: String, token: String, recipientKey: Data, directory: URL) throws {
        guard UUID(uuidString: participantID) != nil,
              baseURL.scheme == "https" || (baseURL.scheme == "http" && ServerURLValidation.isLocalNetworkHost(baseURL.host ?? "")),
              baseURL.user == nil, baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil
        else { throw TransportError.notConfigured }
        self.baseURL = baseURL
        self.participantID = participantID.lowercased()
        self.token = token
        self.recipient = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: recipientKey)
        self.directory = directory
        ProtectedStateFile.prepareDirectory(directory)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration, delegate: VaultRedirectRefusal(), delegateQueue: nil)
    }

    public func upload(_ batch: SyncBatch) async throws -> UploadResult {
        let started = Date()
        let plain = try BatchSerializer.ndjson(for: batch)
        guard plain.count <= Self.maximumPlaintext else { throw TransportError.serverError(status: 413, body: "Page exceeds experimental memory limit") }
        // Batch IDs/export time change when HealthKit replays a page after a
        // restart. Canonical content identifies a local retry journal only;
        // its hash is never uploaded as a potentially guessable object ID.
        var normalized = batch
        normalized.batchID = UUID(uuidString: "00000000-0000-0000-0000-000000000000")!
        normalized.exportedAt = Date(timeIntervalSince1970: 0)
        let encoder = JSONEncoder.puls
        encoder.outputFormatting = [.sortedKeys]
        let digest = SHA256.hash(data: try encoder.encode(normalized)).map { String(format: "%02x", $0) }.joined()
        let journal = directory.appendingPathComponent(digest, isDirectory: true)
        ProtectedStateFile.prepareDirectory(journal)
        let manifestURL = journal.appendingPathComponent("commit.json")
        let staged: Staged
        if FileManager.default.fileExists(atPath: manifestURL.path) {
            // Unreadable/corrupt journals fail closed. Never replace an existing
            // staged operation with different ciphertext under the same IDs.
            staged = try JSONDecoder().decode(Staged.self, from: Data(contentsOf: manifestURL))
        } else {
            let compressed = BatchSerializer.gzip(plain)
            let count = (compressed.count + Self.partSize - 1) / Self.partSize
            guard (1...256).contains(count) else { throw TransportError.notConfigured }
            staged = Staged(id: UUID().uuidString.lowercased(), objects: (0..<count).map { _ in UUID().uuidString.lowercased() })
            for i in 0..<count {
                let part = compressed.subdata(in: (i * Self.partSize)..<min(compressed.count, (i + 1) * Self.partSize))
                let aad = VaultCipher.context(participant: participantID, commit: staged.id, part: i)
                let body = try VaultCipher.seal(part, recipientKey: recipient.rawRepresentation, context: aad)
                try ProtectedStateFile.write(body, to: journal.appendingPathComponent(staged.objects[i]))
            }
            // Publish the local manifest last; an interrupted staging can be
            // rebuilt because none of its IDs has been sent to the service.
            try ProtectedStateFile.write(try JSONEncoder().encode(staged), to: manifestURL)
        }
        var sent = 0
        for id in staged.objects {
            try Task.checkCancellation()
            let body = try Data(contentsOf: journal.appendingPathComponent(id))
            let result = try await request("PUT", path: "objects/\(id)", body: body)
            struct ObjectReceipt: Decodable { var id: String; var digest: String }
            let receipt = try JSONDecoder().decode(ObjectReceipt.self, from: result)
            let expected = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
            guard receipt.id == id, receipt.digest == expected else { throw TransportError.network(URLError(.badServerResponse)) }
            sent += body.count
        }
        let body = try JSONEncoder().encode(staged)
        let result = try await request("POST", path: "commits", body: body)
        let receipt = try JSONDecoder().decode(Receipt.self, from: result)
        guard receipt.id == staged.id, receipt.objects == staged.objects, receipt.sequence > 0 else {
            throw TransportError.network(URLError(.badServerResponse))
        }
        // A crash after server acknowledgment but before local anchors persist
        // can replay the page; recipient materialization deduplicates raw UUIDs.
        try? FileManager.default.removeItem(at: journal)
        return UploadResult(bytesSent: sent, duration: Date().timeIntervalSince(started))
    }
    private func request(_ method: String, path: String, body: Data) async throws -> Data {
        let url = baseURL.appendingPathComponent("v1/participants/\(participantID)/\(path)")
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(method == "PUT" ? "application/octet-stream" : "application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw TransportError.network(URLError(.badServerResponse)) }
        guard (200..<300).contains(response.statusCode) else {
            // Deliberately do not copy a response body into diagnostics.
            throw TransportError.serverError(status: response.statusCode, body: "Experimental vault request failed")
        }
        return data
    }
}

public final class VaultRedirectRefusal: NSObject, URLSessionTaskDelegate, Sendable {
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
