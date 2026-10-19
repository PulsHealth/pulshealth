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

    func testFreshSignInCanPrepareManagedConnectionBeforeApplying() async throws {
        let credentials = InMemoryTokenStore()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ManagedAccountFixtureProtocol.self]
        let account = UserAccount(credentials: credentials, session: URLSession(configuration: configuration))
        let attempt = UserAccount.SignIn()
        let callback = URL(string: "puls://account?state=\(attempt.state)&code=\(String(repeating: "A", count: 43))")!
        let signedIn = await account.finishSignIn(callback, attempt: attempt)
        XCTAssertTrue(signedIn)
        XCTAssertFalse(account.busy, "pairing must be able to start immediately after sign-in")
        let connection = await account.connectManagedServer()
        let payload = try XCTUnwrap(connection)
        var setup = DatabaseSetup(applied: SyncConfiguration())
        setup.choose(.pulsHealth)
        XCTAssertTrue(setup.receiveSignIn(payload))
        XCTAssertNotNil(setup.signedIn, "Save & Apply must be available after sign-in")
        XCTAssertEqual(try credentials.token(), "fixture-account-session")
    }

    func testManagedConnectionReusesSavedAccountAndKeepsCredentialsSeparate() async throws {
        let credentials = InMemoryTokenStore(token: "fixture-account-session")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ManagedAccountFixtureProtocol.self]
        let account = UserAccount(credentials: credentials, session: URLSession(configuration: configuration))
        await account.restore()
        let connection = await account.connectManagedServer()
        XCTAssertEqual(connection?.userID, account.savedProfile?.userID)
        XCTAssertEqual(connection?.serverURL.host, "sync.pulshealth.com")
        XCTAssertEqual(connection?.token, "fixture-sync-token")
        XCTAssertEqual(try credentials.token(), "fixture-account-session")
        XCTAssertNil(account.problem)
    }

    func testManagedConnectionRejectsWrongUserForeignHostAndRevokedSession() async {
        for fixture: AnyClass in [WrongUserManagedFixture.self, ForeignManagedFixture.self, RevokedManagedFixture.self] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [fixture]
            let account = UserAccount(credentials: InMemoryTokenStore(token: "fixture-account-session"),
                                      session: URLSession(configuration: configuration))
            await account.restore()
            let connection = await account.connectManagedServer()
            XCTAssertNil(connection)
            XCTAssertNotNil(account.problem)
        }
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
        let signedIn = await account.finishSignIn(URL(string: "puls://account?state=wrong&code=invalid")!, attempt: .init())
        XCTAssertFalse(signedIn)
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

/// The account and sync endpoints require distinct credentials. No browser session is involved.
private class ManagedAccountFixtureProtocol: URLProtocol, @unchecked Sendable {
    class var host: String { "sync.pulshealth.com" }
    class var userID: String { "5ea4d000-0000-4000-8000-0000000000aa" }
    class var connectStatus: Int { 200 }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let connecting = request.url?.path == "/api/native/connect"
        let exchanging = request.httpMethod == "POST" && request.url?.path == "/api/native/profile"
        let authorized = exchanging || request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-account-session"
        let status = authorized ? (connecting ? Self.connectStatus : 200) : 401
        let body: String
        if status != 200 { body = "{\"error\":\"Sign in again.\"}" }
        else if exchanging { body = "{\"token\":\"fixture-account-session\"}" }
        else if connecting {
            body = "{\"link\":\"puls://pair?url=https%3A%2F%2F\(Self.host)&token=fixture-sync-token&user=\(Self.userID)\"}"
        } else {
            body = "{\"userID\":\"5ea4d000-0000-4000-8000-0000000000aa\",\"name\":null,\"email\":\"person@example.test\",\"dateOfBirth\":null,\"biologicalSex\":null}"
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
private final class WrongUserManagedFixture: ManagedAccountFixtureProtocol, @unchecked Sendable {
    override class var userID: String { "5ea4d000-0000-4000-8000-0000000000bb" }
}
private final class ForeignManagedFixture: ManagedAccountFixtureProtocol, @unchecked Sendable {
    override class var host: String { "other.example.test" }
}
private final class RevokedManagedFixture: ManagedAccountFixtureProtocol, @unchecked Sendable {
    override class var connectStatus: Int { 401 }
}
