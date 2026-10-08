import Foundation
import Testing
@testable import PulsHealthSync

struct DataRequestTests {
    let now = Date(timeIntervalSince1970: 1_791_417_600) // fixed October 2026
    func request() -> DataRequest {
        DataRequest(title: "Sleep and steps", requester: "Example team", purpose: "Monthly activity",
            contact: "study@example.org", startDay: "2026-09-01", endDay: "2026-09-30",
            metrics: [.init(type: "HKCategoryTypeIdentifierSleepAnalysis"),
                      .init(type: "HKQuantityTypeIdentifierStepCount", function: .sum)], now: now)
    }
    @Test func linkRoundTripAndScope() throws {
        let original = request(), parsed = try DataRequest.parse(original.link(now: now).absoluteString, now: now)
        #expect(parsed == original)
        #expect(parsed.selection().types == ["HKCategoryTypeIdentifierSleepAnalysis"])
        #expect(parsed.selection().aggregates.count == 1)
        #expect(parsed.selection().aggregates[0].function == .sum)
        #expect(!parsed.selection().includeWorkoutRoutes)
        #expect(!parsed.selection().includeWorkoutEnhancedData)
    }
    @Test func datesIncludeLastDayAndRespectDST() throws {
        var r = request(); r.startDay = "2026-03-08"; r.endDay = "2026-03-08"
        let range = try r.bounds(timeZone: TimeZone(identifier: "America/Los_Angeles")!)
        #expect(range.end.timeIntervalSince(range.start) == 23 * 3600)
        r.startDay = "2026-11-01"; r.endDay = "2026-11-01"
        let fall = try r.bounds(timeZone: TimeZone(identifier: "America/Los_Angeles")!)
        #expect(fall.end.timeIntervalSince(fall.start) == 25 * 3600)
        r.startDay = "2026-02-30"
        #expect(throws: (any Error).self) { try r.bounds() }
    }
    @Test func rejectsExpiredFutureUnsupportedAndOversizedRequests() throws {
        var r = request(); r.expiresAt = now
        #expect(throws: (any Error).self) { try r.validate(now: now) }
        r = request(); r.version = 2
        #expect(throws: (any Error).self) { try r.validate(now: now) }
        r = request(); r.endDay = "2099-01-01"
        #expect(throws: (any Error).self) { try r.validate(now: now) }
        r = request(); r.metrics = [.init(type: "unknown")]
        #expect(throws: (any Error).self) { try r.validate(now: now) }
        r = request(); r.metrics[1].function = .average
        #expect(throws: (any Error).self) { try r.validate(now: now) }
        r = request(); r.metrics.append(r.metrics[0])
        #expect(throws: (any Error).self) { try r.validate(now: now) }
        #expect(throws: (any Error).self) { try DataRequest.parse(String(repeating: "a", count: 10_000), now: now) }
        let link = try request().link(now: now).absoluteString
        for suffix in ["&data=bad", "#fragment", "&destination=https://evil.example"] {
            #expect(throws: (any Error).self) { try DataRequest.parse(link + suffix, now: now) }
        }
    }
    @Test func csvRejectsUnrepresentableSeries() throws {
        for type in [HealthTypeCatalog.electrocardiogramIdentifier, HealthTypeCatalog.heartbeatSeriesIdentifier] {
            var r = request(); r.metrics = [.init(type: type)]
            #expect(throws: (any Error).self) { try r.validate(now: now) }
            r.format = .jsonl
            try r.validate(now: now)
        }
    }
    @Test func validatesDestinationsWithoutHiddenCredentials() throws {
        for text in ["http://example.org/upload", "https://user:pass@example.org/", "https://example.org/?token=secret", "https://example.org/#other", "file:///tmp/data"] {
            #expect(throws: (any Error).self) { try DataRequest.validateDestination(URL(string: text)!) }
        }
        try DataRequest.validateDestination(URL(string: "https://uploads.example.org/requests")!)
    }
    @Test func receiptMustMatchBytesAndSubmission() throws {
        let id = UUID(), url = URL(string: "https://example.org/upload")!
        let response = HTTPURLResponse(url: url, statusCode: 201, httpVersion: nil, headerFields: nil)!
        let valid = Data("{\"submissionID\":\"\(id)\",\"sha256\":\"abc\",\"receipt\":\"received\"}".utf8)
        #expect(try RequestUploader.validateReceipt(valid, response: response, submissionID: id, hash: "abc").receipt == "received")
        #expect(throws: (any Error).self) { try RequestUploader.validateReceipt(valid, response: response, submissionID: UUID(), hash: "abc") }
        #expect(throws: (any Error).self) { try RequestUploader.validateReceipt(valid, response: response, submissionID: id, hash: "other") }
        let redirect = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: nil)!
        #expect(throws: (any Error).self) { try RequestUploader.validateReceipt(valid, response: redirect, submissionID: id, hash: "abc") }
    }
}

private final class RequestUploadStub: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if request.url!.path == "/oversized" {
            client?.urlProtocol(self, didLoad: Data(repeating: 65, count: 20_000))
        } else {
            let body: [String: String] = ["submissionID": request.value(forHTTPHeaderField: "Idempotency-Key") ?? "",
                "sha256": request.value(forHTTPHeaderField: "X-Puls-SHA256") ?? "", "receipt": "received"]
            client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: body))
        }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

struct RequestUploadIntegrationTests {
    @Test func postsArchiveAndValidatesReceiverReceipt() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data("test ZIP bytes".utf8).write(to: file); defer { try? FileManager.default.removeItem(at: file) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RequestUploadStub.self]
        var r = DataRequest(title: "Test", requester: "Team", purpose: "Test delivery", contact: "test@example.org",
            startDay: "2026-01-01", endDay: "2026-01-02", metrics: [.init(type: "HKQuantityTypeIdentifierHeartRate")],
            destination: .init(name: "Team", url: URL(string: "https://example.org/upload")!))
        let id = UUID()
        let receipt = try await RequestUploader().upload(file: file, request: r, submissionID: id, configuration: config)
        #expect(receipt.submissionID == id)
        #expect(receipt.sha256 == (try RequestUploader.digest(file)))
        let retry = try await RequestUploader().upload(file: file, request: r, submissionID: id, configuration: config)
        #expect(receipt == retry)
        r.destination?.url = URL(string: "https://example.org/oversized")!
        await #expect(throws: (any Error).self) {
            try await RequestUploader().upload(file: file, request: r, submissionID: id, configuration: config)
        }
    }
}
