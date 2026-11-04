#if DEBUG
import CryptoKit
import XCTest
@testable import PulsHealth
@testable import PulsHealthSync

@MainActor
final class HostedProgramTests: XCTestCase {
    func testRecipientPinAndModeComeFromTrustedInvitation() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ProgramReviewFixture.self]
        let model = HostedProgramModel(session: URLSession(configuration: configuration))
        let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
        var components = URLComponents()
        components.scheme = "puls"; components.host = "program"
        components.queryItems = [URLQueryItem(name: "server", value: "https://example.invalid")]
        let keyString = key.publicKey.rawRepresentation.base64EncodedString()
        var fragment = URLComponents()
        fragment.queryItems = [URLQueryItem(name: "code", value: "synthetic-invitation"), URLQueryItem(name: "key", value: keyString),
                               URLQueryItem(name: "mode", value: "private"), URLQueryItem(name: "program", value: "11111111-1111-4111-8111-111111111111")]
        components.fragment = fragment.percentEncodedQuery
        model.openLink(components.string!)
        await model.fetchReview()
        XCTAssertTrue(model.pinMatches)
        XCTAssertFalse(model.accepted)
        model.expectedMode = "traditional"
        XCTAssertFalse(model.pinMatches, "A private invitation must not silently downgrade to traditional hosting")
        model.expectedMode = "private"
        model.expectedFingerprint = "untrusted-other-key"
        XCTAssertFalse(model.pinMatches)
        model.code = "different-code"
        model.invalidateReview()
        XCTAssertNil(model.review)
        XCTAssertFalse(model.accepted)
    }
    func testUnpinnedOldLinkDoesNotSetUpCollection() {
        let model = HostedProgramModel()
        model.openLink("puls://program?server=https%3A%2F%2Fexample.invalid#code=synthetic")
        XCTAssertNil(model.review)
        XCTAssertNil(model.enrollment)
        XCTAssertNotNil(model.message)
    }
}

private final class ProgramReviewFixture: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
            let spec = HostedProgramSpec(name: "Synthetic program", kind: "program", mode: "private", recipientKey: key.publicKey.rawRepresentation.base64EncodedString(),
                types: ["HKQuantityTypeIdentifierStepCount"], startMs: 0, consent: "Synthetic only", consentVersion: "1")
            let body = try JSONEncoder().encode(HostedProgramModel.Review(id: "11111111-1111-4111-8111-111111111111", spec: spec))
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
#endif
