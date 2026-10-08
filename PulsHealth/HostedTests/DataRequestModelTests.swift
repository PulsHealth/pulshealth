import XCTest
import CoreImage
@testable import PulsHealth
@testable import PulsHealthSync

private actor RequestDeliverySpy {
    var ids: [UUID] = []
    var configurations: [SyncConfiguration] = []
    var failFirst = false
    init(failFirst: Bool = false) { self.failFirst = failFirst }
    func generated(_ request: ExportRequest, partial: Bool) throws -> ExportResult {
        configurations.append(request.configuration)
        let directory = request.outputDirectory!
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("fixture.zip")
        try Data("synthetic test data".utf8).write(to: file)
        return ExportResult(format: .csv, directory: directory, files: [file], manifestURL: nil,
            rowCounts: [.samples: 1], notRepresented: [:], unmappableSamples: [:],
            failures: (partial ? [.init(message: "One type unavailable")] : [])
                + (request.dataRequest?.completionIssues() ?? []), warnings: [], totalBytes: 19, duration: 0)
    }
    func send(_ file: URL, _ request: DataRequest, _ id: UUID) throws -> RequestUploader.Receipt {
        ids.append(id)
        if failFirst && ids.count == 1 { throw URLError(.timedOut) }
        return RequestUploader.Receipt(submissionID: id, sha256: try RequestUploader.digest(file), receipt: "fixture-received")
    }
}

@MainActor
final class DataRequestModelTests: XCTestCase {
    private func request(delivery: Bool = true) -> DataRequest {
        DataRequest(title: "Synthetic request", requester: "Test", purpose: "Test flow", contact: "Test contact",
            startDay: "2026-01-01", endDay: "2026-01-02", metrics: [.init(type: "HKQuantityTypeIdentifierStepCount")],
            destination: delivery ? .init(name: "Test receiver", url: URL(string: "https://example.org/upload")!) : nil)
    }
    private func model(_ spy: RequestDeliverySpy, partial: Bool = false) -> DataRequestModel {
        DataRequestModel(clearStaging: false,
            generate: { request, _ in try await spy.generated(request, partial: partial) },
            upload: { file, request, id in try await spy.send(file, request, id) })
    }
    private func finish(_ model: DataRequestModel) async throws {
        for _ in 0..<500 {
            if !model.isBusy { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Request did not finish")
        model.cancel()
    }
    func testSharedQRCodeDecodesToTheExactRequest() throws {
        let link = try request().link()
        let image = try XCTUnwrap(RequestQRCode.image(for: link)?.cgImage)
        let scanner = try XCTUnwrap(CIDetector(ofType: CIDetectorTypeQRCode,
            context: CIContext(options: [.useSoftwareRenderer: true]),
            options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        let feature = scanner.features(in: CIImage(cgImage: image)).first as? CIQRCodeFeature
        XCTAssertEqual(feature?.messageString, link.absoluteString)
    }
    func testSingleActionGeneratesSendsAndCleansUpWithIsolatedIdentity() async throws {
        let spy = RequestDeliverySpy()
        let subject = self.model(spy)
        subject.open(try request().link().absoluteString)
        var config = SyncConfiguration()
        config.serverURL = URL(string: "https://example.org/sync")
        config.authToken = "synthetic-token"; config.userEmail = "test@example.org"
        subject.start(configuration: config) { _ in }
        try await finish(subject)
        XCTAssertNotNil(subject.receipt); XCTAssertNil(subject.result); XCTAssertNil(subject.error)
        let ids = await spy.ids, configs = await spy.configurations
        XCTAssertEqual(ids.count, 1); XCTAssertEqual(configs.count, 1)
        XCTAssertNil(configs.first?.authToken); XCTAssertNil(configs.first?.serverURL)
        XCTAssertNil(configs.first?.userEmail); XCTAssertNotEqual(configs.first?.userID, config.userID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: DataRequestModel.root.appendingPathComponent(subject.submissionID.uuidString).path))
        subject.close()
    }
    func testPartialRequiresExplicitSend() async throws {
        let spy = RequestDeliverySpy()
        let partial = model(spy, partial: true)
        partial.open(try request().link().absoluteString)
        partial.start(configuration: SyncConfiguration()) { _ in }
        try await finish(partial)
        let before = await spy.ids
        XCTAssertTrue(before.isEmpty); XCTAssertNotNil(partial.result); XCTAssertNil(partial.receipt)
        partial.retrySend(); try await finish(partial)
        let after = await spy.ids
        XCTAssertEqual(after.count, 1); XCTAssertNotNil(partial.receipt)
        partial.close()
    }
    func testCurrentDayAggregateRequiresExplicitSend() async throws {
        let spy = RequestDeliverySpy(), subject = model(spy)
        var today = request()
        today.endDay = DataRequest.day(Date())
        today.metrics = [.init(type: "HKQuantityTypeIdentifierStepCount", function: .sum)]
        subject.open(try today.link().absoluteString)
        subject.start(configuration: SyncConfiguration()) { _ in }
        try await finish(subject)
        let before = await spy.ids
        XCTAssertTrue(before.isEmpty)
        XCTAssertFalse(try XCTUnwrap(subject.result).isComplete)
        XCTAssertTrue(subject.result?.failures.first?.message.contains("Today's aggregate") == true)
        subject.retrySend()
        try await finish(subject)
        let after = await spy.ids
        XCTAssertEqual(after.count, 1)
        XCTAssertNotNil(subject.receipt)
        subject.close()
    }
    func testRetryKeepsSubmissionAndFile() async throws {
        let spy = RequestDeliverySpy(failFirst: true)
        let retry = model(spy)
        retry.open(try request().link().absoluteString)
        retry.start(configuration: SyncConfiguration()) { _ in }
        try await finish(retry)
        let file = try XCTUnwrap(retry.result?.files.first)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path)); XCTAssertNotNil(retry.error)
        retry.retrySend(); try await finish(retry)
        let ids = await spy.ids
        XCTAssertEqual(ids.count, 2); XCTAssertEqual(ids.first, ids.last)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        retry.close()
    }
    func testShareHandoffCleanupAndFirstRequestWins() async throws {
        let spy = RequestDeliverySpy()
        let share = model(spy)
        let first = request(delivery: false)
        share.open(try first.link().absoluteString)
        share.open(try request().link().absoluteString)
        XCTAssertEqual(share.pending?.id, first.id)
        share.start(configuration: SyncConfiguration()) { _ in }
        try await finish(share)
        XCTAssertTrue(share.sharing)
        let file = try XCTUnwrap(share.result?.files.first)
        share.shareFinished(false)
        XCTAssertNotNil(share.result)
        share.showShare(); share.shareFinished(true)
        XCTAssertTrue(share.handedOff); XCTAssertNil(share.result)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        let ids = await spy.ids
        XCTAssertTrue(ids.isEmpty)
        share.close()
    }
    func testCancellationDuringAuthorizationNeverGeneratesOrSends() async throws {
        let spy = RequestDeliverySpy(), subject = model(spy)
        subject.open(try request().link().absoluteString)
        subject.start(configuration: SyncConfiguration()) { _ in
            try? await Task.sleep(for: .seconds(5))
        }
        subject.cancel(); try await finish(subject)
        let ids = await spy.ids, configs = await spy.configurations
        XCTAssertTrue(ids.isEmpty); XCTAssertTrue(configs.isEmpty); XCTAssertNil(subject.result)
        subject.close()
    }
}
