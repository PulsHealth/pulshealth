import XCTest
@testable import PulsHealth
import PulsHealthSync

@MainActor
final class CollectionTests: XCTestCase {
    func testInvitationRejectsCredentialRedirectAndDuplicates() throws {
        let id = UUID()
        XCTAssertEqual(try CollectionInvitation(url: URL(string: "puls://collection?id=\(id)")!).id, id)
        for link in ["puls://collection?id=\(id)&id=\(id)", "puls://collection?id=\(id)&server=https://example.com", "https://collection?id=\(id)", "puls://collection?id=\(id)&invite=short"] {
            XCTAssertThrowsError(try CollectionInvitation(url: URL(string: link)!))
        }
    }
    func testUnifiedRequestLinksAcceptBothDeliveriesAndRejectOtherHosts() throws {
        let id = UUID(), code = String(repeating: "a", count: 43)
        let base = PulsHealthDatabase.viewerURL.appending(path: "collect/" + id.uuidString).absoluteString
        guard case .collection(let invitation) = try RequestInvitation(base + "#" + code) else {
            return XCTFail("Expected a hosted request")
        }
        XCTAssertEqual(invitation.id, id)
        XCTAssertEqual(invitation.code, code)
        let request = DataRequest(title: "One-time program", requester: "Example group", purpose: "Activity summary", contact: "contact@example.org",
            startDay: DataRequest.day(Date().addingTimeInterval(-86400)), endDay: DataRequest.day(Date()),
            metrics: [.init(type: "HKQuantityTypeIdentifierStepCount", function: .sum)], format: .csv)
        guard case .file(let decoded) = try RequestInvitation(request.link().absoluteString) else {
            return XCTFail("Expected a file request")
        }
        XCTAssertEqual(decoded.title, request.title)
        for link in [base + "#short", base + "?server=https://example.org", base + "/extra", "https://example.org/collect/" + id.uuidString, "puls://pair?id=" + id.uuidString] {
            XCTAssertThrowsError(try RequestInvitation(link))
        }
    }
    func testFixedRequestDatesDecodeAndDetermineHistoryAccess() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let json = """
        {"id":"70000000-0000-4000-8000-000000000001","title":"Study","organizer":"Example","kind":"study","purpose":"Test","contact":"contact@example.org","consentText":"Test","mode":"ongoing","historyDays":30,"durationDays":90,"retentionDays":90,"metrics":[],"version":1,"status":"open","listing":"private","startAt":1794816000000,"endAt":1863072000000}
        """
        var request = try JSONDecoder().decode(CollectionRequest.self, from: Data(json.utf8))
        XCTAssertEqual(request.sharingStart, now.addingTimeInterval(-60 * 86400))
        XCTAssertFalse(request.allowsHistory(.free, now: now))
        XCTAssertTrue(request.allowsHistory(.unrestricted, now: now))
        request.startAt = Int64(now.addingTimeInterval(86400).timeIntervalSince1970 * 1000)
        XCTAssertTrue(request.allowsHistory(.free, now: now))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let midday = calendar.date(from: DateComponents(year: 2026, month: 11, day: 15, hour: 12))!
        let boundary = SyncAccessPolicy.free.earliestDate(now: midday, calendar: calendar)!
        request.startAt = Int64(boundary.timeIntervalSince1970 * 1000)
        XCTAssertTrue(request.allowsHistory(.free, now: midday, calendar: calendar))
        request.startAt! -= 1
        XCTAssertFalse(request.allowsHistory(.free, now: midday, calendar: calendar))
        request.startAt = nil; request.endAt = nil
        XCTAssertTrue(request.allowsHistory(.free, now: now))
    }
    func testCollectionEnvelopeStripsIdentityAndEnforcesDatesAndConsent() throws {
        let type = "HKQuantityTypeIdentifierStepCount", now = Date()
        let metric = CollectionMetric(type: type, function: "raw", required: true, unit: "count")
        let request = CollectionRequest(id: UUID(), title: "Fixture", organizer: "Example", kind: "group", purpose: "Test", contact: "contact@example.test", consentText: "Test", mode: "ongoing", historyDays: 30, durationDays: 30, retentionDays: 30, metrics: [metric], version: 1, status: "open", listing: "private")
        let e = CollectionEnrollment(id: UUID(), request: request, status: "active", metrics: [metric], start: now.addingTimeInterval(-100), end: now.addingTimeInterval(100), generation: 1, consentedAt: now)
        let sample = SyncSample(uuid: UUID(), type: type, kind: .quantity, start: now, end: now, value: 10, unit: "count", sourceName: "PRIVATE", sourceBundleID: "PRIVATE", device: "PRIVATE")
        var outside = sample; outside.start = now.addingTimeInterval(-500)
        var unapproved = sample; unapproved.type = "HKQuantityTypeIdentifierHeartRate"
        let batch = SyncBatch(deviceID: "PRIVATE", type: type, reason: .backfill, samples: [sample,outside,unapproved], deletions: [])
        let envelope = CollectionBatch(batch, enrollment: e)
        XCTAssertEqual(envelope.records.count, 1)
        let data = try JSONEncoder().encode(envelope)
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("PRIVATE"))
        XCTAssertNotEqual(envelope.records[0].key, sample.uuid.uuidString.lowercased())
        XCTAssertNotEqual(CollectionBatch.key(sample.uuid,enrollment: e.id), CollectionBatch.key(sample.uuid,enrollment: UUID()))
        XCTAssertEqual(CollectionBatch.key(sample.uuid,enrollment: e.id), envelope.records[0].key)
    }
    func testScheduledTransportRefusesTransmissionBeforeStart() async throws {
        let start = Date().addingTimeInterval(86400)
        let request = CollectionRequest(id: UUID(), title: "Scheduled", organizer: "Example", kind: "study", purpose: "Test", contact: "contact@example.org", consentText: "Test", mode: "ongoing", historyDays: 30, durationDays: 90, retentionDays: 30, metrics: [], version: 1, status: "open", listing: "private")
        let e = CollectionEnrollment(id: UUID(), request: request, status: "active", metrics: [], start: start, end: start.addingTimeInterval(86400), generation: 1, consentedAt: Date())
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NoEarlyCollectionProtocol.self]
        let transport = CollectionTransport(enrollment: e, token: "synthetic", configuration: configuration)
        do {
            _ = try await transport.upload(SyncBatch(deviceID: "Fixture", type: "HKQuantityTypeIdentifierStepCount", reason: .backfill, samples: [], deletions: []))
            XCTFail("Scheduled upload must not be acknowledged")
        } catch {
            XCTAssertEqual(error.localizedDescription, "This request’s collection window has not started.")
        }
        await transport.disable()
    }
    func testRestartPreservesRawAndAggregateProgress() async throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let type = "HKQuantityTypeIdentifierStepCount", now = Date(timeIntervalSince1970: 1_800_000_000)
        let metrics = [CollectionMetric(type: type, function: "raw", required: true, unit: "count"),
                       CollectionMetric(type: type, function: "sum", required: true, unit: "count")]
        let request = CollectionRequest(id: UUID(), title: "Fixture", organizer: "Example", kind: "group", purpose: "Test", contact: "contact@example.test", consentText: "Test", mode: "ongoing", historyDays: 30, durationDays: 30, retentionDays: 30, metrics: metrics, version: 1, status: "open", listing: "private")
        let e = CollectionEnrollment(id: UUID(), request: request, status: "active", metrics: metrics, start: now.addingTimeInterval(-86400), end: now.addingTimeInterval(86400), generation: 1, consentedAt: now)
        let original = SyncStateStore(directory: folder, tokenStore: InMemoryTokenStore())
        await SharingModel.configureStore(original, enrollment: e)
        let aggregate = await original.configuration.aggregates[0].id
        await original.update(type) { $0.backfillComplete = true; $0.lastError = nil }
        await original.updateAggregate(aggregate) { $0.computedThrough = now }
        await original.persistNow()
        let reloaded = SyncStateStore(directory: folder, tokenStore: InMemoryTokenStore())
        await SharingModel.configureStore(reloaded, enrollment: e)
        let raw = await reloaded.state(for: type)
        let aggregateState = await reloaded.aggregateState(for: aggregate)
        let config = await reloaded.configuration
        XCTAssertTrue(raw.backfillComplete)
        XCTAssertEqual(aggregateState.computedThrough, now)
        XCTAssertEqual(config.aggregates[0].id, aggregate)
    }

}

private final class NoEarlyCollectionProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTFail("Scheduled collection reached the network before its start")
        client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
    }
    override func stopLoading() {}
}
