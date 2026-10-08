import Foundation
import CryptoKit

/// One explicit submission; no automatic retry, cookies, persistent cache or redirects.
public final class RequestUploader: NSObject, URLSessionTaskDelegate, Sendable {
    public struct Receipt: Codable, Sendable, Equatable {
        public let submissionID: UUID
        public let sha256: String
        public let receipt: String
    }
    public override init() { super.init() }

    public func upload(file: URL, request: DataRequest, submissionID: UUID, configuration: URLSessionConfiguration? = nil) async throws -> Receipt {
        try request.validate()
        guard let destination = request.destination else { throw DataRequest.Invalid("No destination was selected.") }
        let hash = try Self.digest(file)
        var upload = URLRequest(url: destination.url)
        upload.httpMethod = "POST"
        upload.setValue("application/zip", forHTTPHeaderField: "Content-Type")
        upload.setValue("application/json", forHTTPHeaderField: "Accept")
        upload.setValue(request.id.uuidString.lowercased(), forHTTPHeaderField: "X-Puls-Request-ID")
        upload.setValue(submissionID.uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key")
        upload.setValue(hash, forHTTPHeaderField: "X-Puls-SHA256")
        let config = configuration ?? URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false; config.urlCache = nil; config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 60; config.timeoutIntervalForResource = 600
        let exchange = BoundedUpload()
        let (data, response) = try await exchange.run(request: upload, file: file, configuration: config)
        try Task.checkCancellation()
        return try Self.validateReceipt(data, response: response, submissionID: submissionID, hash: hash)
    }

    public static func validateReceipt(_ data: Data, response: URLResponse, submissionID: UUID, hash: String) throws -> Receipt {
        guard let response = response as? HTTPURLResponse, [200, 201].contains(response.statusCode),
              data.count <= 16_384, let receipt = try? JSONDecoder().decode(Receipt.self, from: data),
              receipt.submissionID == submissionID, receipt.sha256 == hash,
              !receipt.receipt.isEmpty, receipt.receipt.utf8.count <= 200,
              !receipt.receipt.unicodeScalars.contains(where: { $0.value < 32 }) else {
            throw DataRequest.Invalid("The destination did not confirm receipt. You can retry this same export; it may already have arrived.")
        }
        return receipt
    }

    public static func digest(_ file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
        var hash = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty { hash.update(data: chunk) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// URLSession's convenience upload API buffers the response without a bound.
/// A request endpoint is untrusted, so stop after 16 KiB, even for chunked responses.
private final class BoundedUpload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<(Data, URLResponse), any Error>?
    private var task: URLSessionUploadTask?
    private var response: URLResponse?
    private var data = Data()
    private var cancelled = false

    func run(request: URLRequest, file: URL, configuration: URLSessionConfiguration) async throws -> (Data, URLResponse) {
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                self.continuation = continuation
                let task = session.uploadTask(with: request, fromFile: file)
                self.task = task
                let shouldCancel = cancelled
                lock.unlock()
                task.resume()
                if shouldCancel { task.cancel() }
            }
        } onCancel: { self.cancel() }
    }
    private func cancel() {
        lock.lock(); cancelled = true; let task = task; lock.unlock()
        task?.cancel()
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        lock.lock(); self.response = response; lock.unlock()
        completionHandler(response.expectedContentLength > 16_384 ? .cancel : .allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        lock.lock()
        let exceeds = chunk.count > 16_384 - data.count
        if !exceeds { data.append(chunk) }
        lock.unlock()
        if exceeds { dataTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        lock.lock()
        let continuation = continuation; self.continuation = nil
        let response = response, data = data, cancelled = cancelled
        lock.unlock()
        if cancelled { continuation?.resume(throwing: CancellationError()) }
        else if let error { continuation?.resume(throwing: error) }
        else if let response { continuation?.resume(returning: (data, response)) }
        else { continuation?.resume(throwing: DataRequest.Invalid("Receipt not confirmed.")) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
