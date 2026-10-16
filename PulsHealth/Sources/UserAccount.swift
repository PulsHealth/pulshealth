import Foundation
import Observation
import CryptoKit
import PulsHealthSync

struct AccountProfile: Codable, Equatable {
    var userID: String
    var name: String?
    var email: String
    var dateOfBirth: Date?
    var biologicalSex: String?
}

/// Account access is independent of the sync engine, its destinations and Health permissions.
@MainActor @Observable
final class UserAccount {
    var profile: AccountProfile?
    private(set) var savedProfile: AccountProfile?
    private(set) var busy = false
    private(set) var hasSession = false
    var problem: String?
    private let credentials: any TokenStore
    private let session: URLSession
    private var token: String?
    private static var endpoint: URL { PulsHealthDatabase.viewerURL.appending(path: "api/native/profile") }

    init(credentials: any TokenStore = KeychainTokenStore(account: "user-account"), session: URLSession? = nil) {
        self.credentials = credentials
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        self.session = session ?? URLSession(configuration: configuration, delegate: NoAccountRedirects(), delegateQueue: nil)
    }

    struct SignIn: Equatable {
        let state: String
        let verifier: String
        let url: URL

        init() {
            state = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
                + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            verifier = UUID().uuidString.replacingOccurrences(of: "-", with: "")
                + UUID().uuidString.replacingOccurrences(of: "-", with: "")
            let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            var components = URLComponents(url: PulsHealthDatabase.viewerURL.appending(path: "connect/account"), resolvingAgainstBaseURL: false)!
            components.queryItems = [.init(name: "state", value: state), .init(name: "challenge", value: challenge)]
            url = components.url!
        }

        func code(from callback: URL) throws -> String {
            guard callback.scheme == "puls", callback.host == "account", callback.path.isEmpty,
                  callback.user == nil, callback.password == nil, callback.port == nil, callback.fragment == nil,
                  let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
                  items.filter({ $0.name == "state" }).count == 1,
                  items.first(where: { $0.name == "state" })?.value == state,
                  items.filter({ $0.name == "code" }).count == 1,
                  let code = items.first(where: { $0.name == "code" })?.value,
                  code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
            else { throw AccountError("Sign-in could not be verified. Try again.") }
            return code
        }
    }

    func restore() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            token = try credentials.token()
            hasSession = token != nil
            guard let token else { return }
            let loaded: AccountProfile = try await request("GET", token: token)
            profile = loaded
            savedProfile = loaded
            problem = nil
        } catch { problem = error.localizedDescription }
    }

    func finishSignIn(_ callback: URL, attempt: SignIn) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let code = try attempt.code(from: callback)
            struct Exchange: Encodable { let code: String; let verifier: String }
            struct Credential: Decodable { let token: String }
            let credential: Credential = try await request("POST", body: Exchange(code: code, verifier: attempt.verifier))
            let loaded: AccountProfile = try await request("GET", token: credential.token)
            try credentials.setToken(credential.token)
            token = credential.token
            hasSession = true
            profile = loaded
            savedProfile = loaded
            problem = nil
        } catch { problem = error.localizedDescription }
    }

    @discardableResult
    func save(currentPassword: String) async -> Bool {
        guard !busy, let token, let profile else { return false }
        busy = true
        defer { busy = false }
        do {
            struct Update: Encodable {
                let name: String?
                let email: String
                let dateOfBirth: Date?
                let biologicalSex: String?
                let currentPassword: String
                // Explicit nulls mean "clear", not "leave unchanged".
                func encode(to encoder: Encoder) throws {
                    var c = encoder.container(keyedBy: Keys.self)
                    try c.encode(name, forKey: .name)
                    try c.encode(email, forKey: .email)
                    try c.encode(dateOfBirth, forKey: .dateOfBirth)
                    try c.encode(biologicalSex, forKey: .biologicalSex)
                    try c.encode(currentPassword, forKey: .currentPassword)
                }
                enum Keys: CodingKey { case name, email, dateOfBirth, biologicalSex, currentPassword }
            }
            let loaded: AccountProfile = try await request("PUT", token: token, body: Update(
                name: profile.name, email: profile.email, dateOfBirth: profile.dateOfBirth,
                biologicalSex: profile.biologicalSex, currentPassword: currentPassword))
            self.profile = loaded
            savedProfile = loaded
            problem = nil
            return true
        } catch { problem = error.localizedDescription; return false }
    }

    func signOut() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            // Remove the device credential even when the server is unreachable.
            try credentials.setToken(nil)
            let oldToken = token
            token = nil
            hasSession = false
            profile = nil
            savedProfile = nil
            problem = nil
            if let oldToken {
                struct Empty: Decodable {}
                let _: Empty = try await request("DELETE", token: oldToken)
            }
        } catch { problem = error.localizedDescription }
    }

    private struct Failure: Decodable { let error: String }
    private struct EmptyBody: Encodable {}
    private func request<Response: Decodable>(_ method: String, token: String? = nil) async throws -> Response {
        try await request(method, token: token, body: Optional<EmptyBody>.none)
    }
    private func request<Response: Decodable, Body: Encodable>(
        _ method: String, token: String? = nil, body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: Self.endpoint)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .millisecondsSince1970
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw AccountError("Your account could not be reached. Try again.") }
            guard (200..<300).contains(response.statusCode) else {
                let message = try? JSONDecoder().decode(Failure.self, from: data).error
                throw AccountError(message ?? "Your account could not be reached. Try again.")
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .millisecondsSince1970
            return try decoder.decode(Response.self, from: data)
        } catch let error as AccountError { throw error }
        catch { throw AccountError("Your account could not be reached. Try again.") }
    }
}

private struct AccountError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

private final class NoAccountRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
