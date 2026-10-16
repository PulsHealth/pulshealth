import CryptoKit
import Foundation
import XCTest
import PulsHealthSync
@testable import PulsHealth

@MainActor
final class UserAccountTests: XCTestCase {
    func testSignInBindsCallbackStateAndPKCE() throws {
        let attempt = UserAccount.SignIn()
        let query = URLComponents(url: attempt.url, resolvingAgainstBaseURL: false)!.queryItems!
        let challenge = Data(SHA256.hash(data: Data(attempt.verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        XCTAssertEqual(query.first(where: { $0.name == "challenge" })?.value, challenge)
        XCTAssertNotEqual(attempt.state, UserAccount.SignIn().state)
        let code = String(repeating: "A", count: 43)
        XCTAssertEqual(try attempt.code(from: URL(string: "puls://account?state=\(attempt.state)&code=\(code)")!), code)
        for callback in [
            "puls://account?state=wrong&code=\(code)",
            "puls://pair?state=\(attempt.state)&code=\(code)",
            "puls://account?state=\(attempt.state)&state=\(attempt.state)&code=\(code)",
            "puls://account?state=\(attempt.state)&code=\(code)&code=\(code)",
            "puls://account?state=\(attempt.state)&code=short",
            "puls://account?state=\(attempt.state)&code=\(code)#fragment"
        ] { XCTAssertThrowsError(try attempt.code(from: URL(string: callback)!)) }
    }

    func testSaveLoadsAccountAndClearsOptionalFields() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AccountFixtureProtocol.self]
        let credentials = InMemoryTokenStore(token: "fixture-account-session")
        let account = UserAccount(credentials: credentials, session: URLSession(configuration: configuration))
        await account.restore()
        XCTAssertEqual(account.profile?.name, "Example Person")
        account.profile?.name = nil
        account.profile?.dateOfBirth = nil
        let saved = await account.save(currentPassword: "")
        XCTAssertTrue(saved)
        XCTAssertNil(account.savedProfile?.name)
        XCTAssertNil(account.savedProfile?.dateOfBirth)
        XCTAssertEqual(account.savedProfile?.email, "person@example.test")
        XCTAssertEqual(try credentials.token(), "fixture-account-session")
    }

    func testRestoreFailureDoesNotExposeEditableLocalProfileAsAnAccount() async {
        let credentials = InMemoryTokenStore(token: "existing-account-token")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AccountTestProtocol.self]
        let account = UserAccount(credentials: credentials, session: URLSession(configuration: configuration))
        await account.restore()
        XCTAssertTrue(account.hasSession)
        XCTAssertNil(account.profile)
        XCTAssertNotNil(account.problem)
        XCTAssertEqual(try credentials.token(), "existing-account-token")
    }

    func testInvalidCallbackCannotReplaceAnExistingCredential() async {
        let credentials = InMemoryTokenStore(token: "existing-account-token")
        let account = UserAccount(credentials: credentials)
        await account.finishSignIn(URL(string: "puls://account?state=wrong&code=invalid")!, attempt: .init())
        XCTAssertEqual(try credentials.token(), "existing-account-token")
        XCTAssertNil(account.profile)
        XCTAssertNotNil(account.problem)
    }

    func testSignOutRemovesLocalCredentialEvenWhenServerIsUnavailable() async throws {
        let credentials = InMemoryTokenStore(token: "existing-account-token")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AccountTestProtocol.self]
        let account = UserAccount(credentials: credentials, session: URLSession(configuration: configuration))
        await account.restore()
        await account.signOut()
        XCTAssertNil(try credentials.token())
        XCTAssertFalse(account.hasSession)
        XCTAssertNil(account.profile)
    }
}

private final class AccountTestProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}

/// Stateless server fixture: GET loads an account; PUT returns its cleared profile.
final class AccountFixtureProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let name = request.httpMethod == "PUT" ? "null" : "\"Example Person\""
        let body = "{\"userID\":\"5ea4d000-0000-4000-8000-0000000000aa\",\"name\":\(name),\"email\":\"person@example.test\",\"dateOfBirth\":null,\"biologicalSex\":null}"
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
