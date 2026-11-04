#if DEBUG
import CryptoKit
import Foundation
import Observation
import Security
import PulsHealthSync

struct HostedProgramSpec: Codable, Equatable {
    var name: String
    var kind: String
    var mode: String
    var recipientKey: String
    var types: [String]
    var startMs: Int64
    var consent: String
    var consentVersion: String

    var fingerprint: String {
        guard let data = Data(base64Encoded: recipientKey) else { return "" }
        return Data(SHA256.hash(data: data)).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// One additional experimental destination, independent of the ordinary database.
/// All secrets remain in a separate device-only Keychain item. There is no
/// plaintext fallback for this enrollment or any decryption key.
@MainActor @Observable
final class HostedProgramModel {
    struct Review: Codable { var id: String; var spec: HostedProgramSpec }
    struct Enrollment: Codable {
        var server: URL
        var code: String
        var token: String
        var review: Review
        var collecting = false
        var participant: String?
    }
    var serverText = ""
    var code = ""
    var expectedFingerprint = ""
    var expectedMode = "private"
    @ObservationIgnored private var expectedProgram: String?
    @ObservationIgnored private var collectionGeneration = 0
    var accepted = false
    @ObservationIgnored private var reviewedServer: URL?
    @ObservationIgnored private var reviewedCode: String?
    private(set) var review: Review?
    private(set) var enrollment: Enrollment?
    private(set) var busy = false
    var message: String?
    private(set) var statuses: [TypeSyncStatus] = []
    @ObservationIgnored private var collectionTask: Task<Void, Never>?
    @ObservationIgnored private var gate: ExperimentalCollectionTransport?
    @ObservationIgnored private var engine: HealthSyncEngine?
    @ObservationIgnored private let credentials = KeychainTokenStore(account: "experimental-hosting-v1")
    @ObservationIgnored private let session: URLSession

    init(session: URLSession? = nil) {
        self.session = session ?? URLSession(configuration: .ephemeral, delegate: VaultRedirectRefusal(), delegateQueue: nil)
    }
    @ObservationIgnored var accessPolicy: @Sendable () async -> SyncAccessPolicy = { .free }

    var joined: Bool { enrollment?.participant != nil }
    var enrollmentPending: Bool { enrollment != nil && !joined }
    var pinMatches: Bool {
        guard let review else { return false }
        return review.spec.mode == expectedMode && (expectedProgram == nil || expectedProgram == review.id)
            && (review.spec.mode == "traditional" || expectedFingerprint == review.spec.fingerprint)
    }
    func load() async {
        guard enrollment == nil else { return }
        do {
            guard let saved = try credentials.token(), let data = Data(base64Encoded: saved) else { return }
            enrollment = try JSONDecoder().decode(Enrollment.self, from: data)
            if joined {
                try await prepareEngine()
                if enrollment?.collecting == true { await engine?.startObserving() }
            }
        } catch { message = "Experimental enrollment is unavailable. Unlock the device before trying again." }
    }
    private func save(_ value: Enrollment?) throws {
        let token = try value.map { try JSONEncoder().encode($0).base64EncodedString() }
        try credentials.setToken(token)
        enrollment = value
    }
    func openLink(_ value: String) {
        guard let url = URLComponents(string: value), url.scheme == "puls", url.host == "program",
              let server = url.queryItems?.first(where: { $0.name == "server" })?.value,
              let fragment = url.fragment,
              let parts = URLComponents(string: "https://example.invalid/?" + fragment)?.queryItems,
              let code = parts.first(where: { $0.name == "code" })?.value,
              let mode = parts.first(where: { $0.name == "mode" })?.value, ["private", "traditional"].contains(mode),
              let program = parts.first(where: { $0.name == "program" })?.value, UUID(uuidString: program) != nil
        else { message = "This is not an experimental program invitation."; return }
        guard enrollment == nil else { message = "Leave the current experimental destination first."; return }
        serverText = server
        self.code = code
        expectedMode = mode
        expectedProgram = program
        if let key = parts.first(where: { $0.name == "key" })?.value, let data = Data(base64Encoded: key) {
            expectedFingerprint = Data(SHA256.hash(data: data)).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        } else { expectedFingerprint = "" }
        review = nil
        accepted = false
        message = "Review the invitation before joining. Only use a link supplied by the intended program."
    }
    private func serverURL() throws -> URL {
        guard let url = URL(string: serverText.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.scheme == "https" || (url.scheme == "http" && ServerURLValidation.isLocalNetworkHost(url.host ?? ""))
        else { throw URLError(.badURL) }
        return url
    }
    private func call<T: Encodable, U: Decodable>(_ path: String, body: T, server: URL, token: String? = nil) async throws -> U {
        var request = URLRequest(url: server.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(U.self, from: data)
    }
    func discardPending() {
        guard enrollmentPending, !busy else { return }
        do { try save(nil); message = "Pending setup removed. Ask the program for a fresh invitation." } catch { message = "Could not remove pending setup." }
    }
    func invalidateReview() { review = nil; accepted = false }
    func fetchReview() async {
        guard !busy, enrollment == nil else { return }
        busy = true; defer { busy = false }
        review = nil; accepted = false
        do {
            let requestedServer = try serverURL()
            let requestedCode = code
            let value: Review = try await call("v1/invitations/review", body: ["code": requestedCode], server: requestedServer)
            guard requestedServer == (try? serverURL()), requestedCode == code else { return }
            let known = Set(HealthTypeCatalog.all.map(\.identifier))
            guard UUID(uuidString: value.id) != nil, ["private", "traditional"].contains(value.spec.mode),
                  ["individual", "program"].contains(value.spec.kind), !value.spec.types.isEmpty,
                  Set(value.spec.types).isSubset(of: known),
                  !value.spec.types.contains(HealthTypeCatalog.activitySummaryIdentifier), value.spec.startMs >= 0,
                  value.spec.startMs <= Int64(Date().timeIntervalSince1970 * 1000),
                  value.spec.mode != "private" || Data(base64Encoded: value.spec.recipientKey)?.count == 32
            else { throw URLError(.cannotParseResponse) }
            reviewedServer = requestedServer; reviewedCode = requestedCode
            review = value; message = nil
        } catch { message = "Invitation unavailable or unsupported. Check the server, code and expiry." }
    }
    func join() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            let pending: Enrollment
            if let saved = enrollment, saved.participant == nil { pending = saved }
            else {
                guard let review, accepted, pinMatches, reviewedCode == code, reviewedServer == (try? serverURL()) else { return }
                var bytes = [UInt8](repeating: 0, count: 32)
                guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw URLError(.unknown) }
                let token = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
                pending = Enrollment(server: try serverURL(), code: code, token: token, review: review)
                // Save before consuming a one-use invitation; retry with the same
                // secret if the response or Keychain write is interrupted.
                try save(pending)
            }
            struct Result: Decodable { var id: String; var program: String }
            let result: Result = try await call("v1/enrollments", body: ["code": pending.code, "token": pending.token, "consentVersion": pending.review.spec.consentVersion], server: pending.server)
            guard UUID(uuidString: result.id) != nil, result.program == pending.review.id else { throw URLError(.badServerResponse) }
            var joined = pending; joined.participant = result.id; joined.code = ""
            try save(joined)
            code = ""; self.review = nil
            try await prepareEngine()
            // Enrollment never starts a HealthKit read. A separate explicit
            // Start Collection action requests access and begins the first sync.
            message = "Joined. Tap Start Collection to grant Health access and begin sending the reviewed types."
        } catch { message = "Enrollment could not finish. Retry to resume safely." }
    }
    private func prepareEngine() async throws {
        guard engine == nil, let enrollment, let id = enrollment.participant else { return }
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ExperimentalHosting/\(id)", isDirectory: true)
        // This engine's token is intentionally ephemeral: durable enrollment is
        // in the separate Keychain item, never in the sync-state fallback.
        let engine = HealthSyncEngine(store: SyncStateStore(directory: directory, tokenStore: InMemoryTokenStore()),
            eventLog: SyncEventLog(directory: directory), wakeLog: WakeLog(directory: directory), accessPolicy: accessPolicy)
        let spec = enrollment.review.spec
        let endpoint = enrollment.server.appendingPathComponent("v1/participants/\(id)")
        let config = SyncConfiguration(enabledTypes: Set(spec.types), startDate: Date(timeIntervalSince1970: Double(spec.startMs) / 1000),
            serverURL: endpoint, authToken: nil, includeWorkoutRoutes: false, includeWorkoutEnhancedData: false, userID: id)
        guard await engine.configure(config) else { throw URLError(.cannotCreateFile) }
        let underlying: any SyncTransport
        if spec.mode == "private" {
            guard let key = Data(base64Encoded: spec.recipientKey) else { throw URLError(.cannotDecodeContentData) }
            let transport = try PrivateVaultTransport(baseURL: enrollment.server, participantID: id, token: enrollment.token,
                recipientKey: key, directory: directory.appendingPathComponent("outbox", isDirectory: true))
            underlying = transport
        } else {
            underlying = HTTPSyncTransport(baseURL: endpoint, authToken: enrollment.token, userID: id)
        }
        let gate = ExperimentalCollectionTransport(underlying: underlying, enabled: enrollment.collecting, allowedTypes: Set(spec.types))
        await engine.setTransport(gate)
        self.gate = gate
        self.engine = engine
    }
    func startCollection() {
        guard !busy else { return }
        collectionTask = Task { await collect() }
    }
    func foregroundSync() async {
        await load()
        guard enrollment?.collecting == true, !busy, let engine else { return }
        busy = true; defer { busy = false }
        await BackgroundExecution.run("Experimental program sync") { await engine.syncAllEnabled(reason: .incremental) }
        statuses = await engine.snapshot()
        await engine.store.persistNow()
    }
    func pause() async {
        collectionGeneration += 1
        collectionTask?.cancel()
        await gate?.setEnabled(false)
        await engine?.stopObserving()
        if var saved = enrollment { saved.collecting = false; do { try save(saved) } catch { message = "Pause could not be saved. Revoke access at the gateway before restarting the app." } }
    }
    private func collect() async {
        guard !busy, joined else { return }
        busy = true; defer { busy = false }
        let generation = collectionGeneration
        do {
            try await prepareEngine()
            guard let engine, let enrollment else { return }
            _ = try await engine.requestAuthorization(for: enrollment.review.spec.types)
            try Task.checkCancellation()
            guard generation == collectionGeneration else { return }
            var saved = enrollment; saved.collecting = true
            try save(saved)
            await gate?.setEnabled(true)
            guard generation == collectionGeneration, !Task.isCancelled else { await gate?.setEnabled(false); return }
            await engine.startObserving()
            guard generation == collectionGeneration, !Task.isCancelled else { await engine.stopObserving(); return }
            await BackgroundExecution.run("Experimental program collection") { await engine.syncAllEnabled(reason: .manual) }
            statuses = await engine.snapshot()
            await engine.store.persistNow()
            let errors = statuses.filter { $0.state.lastError != nil }.count
            message = errors == 0 ? "Collection finished. Check type progress below; denied Health access can return no records." : "Some types could not sync. Progress is preserved for retry."
        } catch { message = "Collection could not start. Check Health permissions and the connection." }
    }
    func leave() async {
        guard !busy, let enrollment, let id = enrollment.participant else { return }
        await pause()
        busy = true; defer { busy = false }
        do {
            struct Result: Decodable { var revoked: Bool }
            let result: Result = try await call("v1/participants/\(id)/leave", body: [String: String](), server: enrollment.server, token: enrollment.token)
            guard result.revoked else { throw URLError(.badServerResponse) }
            await engine?.stopObserving()
            try save(nil)
            engine = nil; statuses = []
            message = "Collection stopped and upload access revoked. Previously collected records remain with the program under its retention terms."
        } catch { message = "Could not confirm revocation. Collection is paused on this device. Retry revocation when online." }
    }
}

/// Fails closed when paused; the independent engine can never send types beyond
/// the immutable enrollment. This is a client policy, not proof to a blind server.
private actor ExperimentalCollectionTransport: SyncTransport {
    let underlying: any SyncTransport
    let allowedTypes: Set<String>
    var enabled: Bool
    init(underlying: any SyncTransport, enabled: Bool, allowedTypes: Set<String>) {
        self.underlying = underlying; self.enabled = enabled; self.allowedTypes = allowedTypes
    }
    func setEnabled(_ value: Bool) { enabled = value }
    func upload(_ batch: SyncBatch) async throws -> UploadResult {
        guard enabled, batch.samples.allSatisfy({ allowedTypes.contains($0.type) }),
              batch.deletions.allSatisfy({ allowedTypes.contains($0.type) }),
              batch.aggregates.isEmpty, batch.routes.isEmpty, batch.series.isEmpty, batch.profile == nil,
              batch.activitySummaries.isEmpty || allowedTypes.contains(HealthTypeCatalog.activitySummaryIdentifier)
        else { throw TransportError.notConfigured }
        return try await underlying.upload(batch)
    }
}
#endif
