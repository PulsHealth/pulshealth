import Foundation
import Observation
import PulsHealthSync

@MainActor @Observable
final class SharingModel {
    let account = UserAccount()
    var requests: [CollectionRequest] = []
    var enrollments: [CollectionEnrollment] = []
    var invitation: CollectionInvitation?
    var organizerToOpen: UUID?
    var returnToConnections = UUID()
    var creationDraft = ConnectionDraft()
    var hasSavedDraft = false
    private(set) var hiddenConnections: Set<UUID> = []
    private(set) var serviceUnavailable = false
    var problem: String?
    var notices: [UUID: String] = [:]
    private(set) var busy = false
    private(set) var running: Set<UUID> = []
    var accessPolicy: @Sendable () async -> SyncAccessPolicy = { .free }
    private var engines: [UUID: HealthSyncEngine] = [:]
    private var transports: [UUID: CollectionTransport] = [:]
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private var sessionGeneration = 0
    private var activationRevisions: [UUID: Int] = [:]
    private var runIDs: [UUID: UUID] = [:]
    private var startup: Task<Void, Never>?
    private var writable = true
    private var local: [Local] = []
    private let directory: URL
    private struct Local: Codable {
        var enrollment: CollectionEnrollment
        var owner: String
        var sessionFingerprint: String?
        var enabled: Bool
        var pendingAction: String?
    }
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "CollectionSharing", directoryHint: .isDirectory)
        if let data = try? Data(contentsOf: self.directory.appending(path: "creation-draft.json")),
           let draft = try? JSONDecoder().decode(ConnectionDraft.self, from: data) {
            creationDraft = draft; hasSavedDraft = draft.hasContent
        }
        if let data = try? Data(contentsOf: self.directory.appending(path: "hidden-connections.json")),
           let hidden = try? JSONDecoder().decode(Set<UUID>.self, from: data) { hiddenConnections = hidden }
        account.onSessionEnding = { [weak self] in await self?.stopLocallyForSignOut() }
    }
    var hasRememberedConnections: Bool {
        !requests.isEmpty || !enrollments.isEmpty
    }
    /// Account/group errors do not describe the health of a personal database.
    var connectionListProblem: String? {
        guard hasRememberedConnections || !writable else { return nil }
        return problem ?? (serviceUnavailable ? "Group connections aren’t available on this server yet." : nil)
    }
    var accountRevision: Int { sessionGeneration }
    func command<Value: Decodable, Body: Encodable>(_ body: Body) async throws -> CollectionResponse<Value> {
        let revision = sessionGeneration
        let response: CollectionResponse<Value> = try await account.collectionCommand(body)
        try checkSession(revision)
        return response
    }
    private func writeLocal<Value: Encodable>(_ value: Value, name: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var folder = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true; try folder.setResourceValues(values)
        try JSONEncoder().encode(value).write(to: directory.appending(path: name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func saveDraft() throws {
        try writeLocal(creationDraft, name: "creation-draft.json")
        hasSavedDraft = creationDraft.hasContent
    }
    func clearDraft() throws {
        let empty = ConnectionDraft()
        try writeLocal(empty, name: "creation-draft.json")
        creationDraft = empty; hasSavedDraft = false
    }
    func restoreConnection(_ id: UUID) {
        do {
            var hidden = hiddenConnections; hidden.remove(id)
            try writeLocal(hidden, name: "hidden-connections.json")
            hiddenConnections = hidden; problem = nil
        } catch { problem = error.localizedDescription }
    }
    func removeConnection(_ e: CollectionEnrollment) async {
        guard ["stopped", "complete"].contains(e.status), e.deletionStatus != "requested" else {
            problem = "Withdraw and resolve pending deletion requests before removing this connection."; return
        }
        do {
            await disable(e.id)
            var hidden = hiddenConnections; hidden.insert(e.id)
            try writeLocal(hidden, name: "hidden-connections.json")
            try credential(e.id).setToken(nil)
            hiddenConnections = hidden
        } catch { problem = error.localizedDescription }
    }
    func requestDeletion(_ e: CollectionEnrollment, withdraw: Bool) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        let generation = sessionGeneration
        do {
            if withdraw {
                await disable(e.id)
                if let index = local.firstIndex(where: { $0.enrollment.id == e.id }) { local[index].pendingAction = "stop" }
                try persist()
            }
            let response: CollectionResponse<CollectionEnrollment> = try await account.collectionCommand(CollectionCommand(action: "request-deletion", withdraw: withdraw, id: e.id))
            try checkSession(generation)
            if let index = enrollments.firstIndex(where: { $0.id == e.id }) { enrollments[index] = response.result }
            if let index = local.firstIndex(where: { $0.enrollment.id == e.id }) { local[index].enrollment = response.result; local[index].pendingAction = nil }
            try persist(); problem = nil
        } catch { problem = error.localizedDescription }
    }
    func stopLocallyForSignOut() async {
        sessionGeneration += 1
        // A sign-out can precede the app's launch task. Preserve and disable
        // existing grants without briefly activating them or erasing the file.
        if startup == nil {
            startup = Task { }
            let file = directory.appending(path: "sharing.json")
            do {
                if FileManager.default.fileExists(atPath: file.path) { local = try JSONDecoder().decode([Local].self, from: Data(contentsOf: file)) }
            } catch { writable = false }
        }
        for item in local { await disable(item.enrollment.id) }
        try? persist()
        enrollments = []; requests = []; serviceUnavailable = false
    }
    private func checkSession(_ generation: Int) throws {
        guard generation == sessionGeneration else { throw CancellationError() }
    }
    private func credential(_ id: UUID) -> KeychainTokenStore { KeychainTokenStore(account: "collection-" + id.uuidString) }
    private func persist() throws {
        guard writable else { throw CollectionError("Sharing state is unreadable. Unlock this iPhone and reopen PulsHealth.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var folder = directory; try folder.setResourceValues(values)
        let data = try JSONEncoder().encode(local)
        try data.write(to: directory.appending(path: "sharing.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func start() async {
        if let startup { await startup.value; return }
        let task = Task { await startBody() }
        startup = task
        await task.value
    }
    private func startBody() async {
        let generation = sessionGeneration
        let file = directory.appending(path: "sharing.json")
        do {
            if FileManager.default.fileExists(atPath: file.path) { local = try JSONDecoder().decode([Local].self, from: Data(contentsOf: file)) }
            // Register HealthKit observers without waiting for the network. A hash of
            // the approving session binds local consent to the Keychain account.
            let fingerprint = try account.collectionSessionFingerprint()
            try checkSession(generation)
            for item in local {
                guard let fingerprint, item.sessionFingerprint == fingerprint else { await disable(item.enrollment.id); continue }
                if !enrollments.contains(where: { $0.id == item.enrollment.id }) { enrollments.append(item.enrollment) }
                if item.enabled && item.enrollment.request.mode == "ongoing" { try await activate(item.enrollment) }
            }
            try persist()
        } catch is CancellationError { return }
        catch { writable = false; problem = "Sharing could not be restored. Unlock the iPhone and reopen the app; existing state has been preserved." }
    }
    func refresh() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        let generation = sessionGeneration
        do {
            await start(); await account.restore()
            try checkSession(generation)
            guard account.hasSession else { await stopLocallyForSignOut(); problem = account.problem; return }
            let response: CollectionResponse<CollectionList> = try await account.collectionCommand(CollectionCommand(action: "list"))
            try checkSession(generation)
            serviceUnavailable = false
            requests = response.result.requests; enrollments = response.result.enrollments
            guard let owner = account.savedProfile?.userID else { throw CollectionError("Sign in to load sharing.") }
            // Server-side pause/stop and credential rotation take effect on this device too.
            for item in local {
                let remote = enrollments.first { $0.id == item.enrollment.id }
                if item.owner != owner || remote == nil || remote?.status != "active" || remote?.generation != item.enrollment.generation {
                    await disable(item.enrollment.id)
                }
            }
            for index in local.indices where local[index].owner == owner {
                if let action = local[index].pendingAction {
                    let e: CollectionResponse<CollectionEnrollment> = try await account.collectionCommand(CollectionCommand(action: action, id: local[index].enrollment.id))
                    try checkSession(generation)
                    local[index].enrollment = e.result; local[index].pendingAction = nil
                } else if let e = enrollments.first(where: { $0.id == local[index].enrollment.id }) { local[index].enrollment = e }
            }
            try persist(); problem = nil
        } catch is CollectionServiceUnavailable {
            serviceUnavailable = true
            problem = account.problem
        } catch { serviceUnavailable = false; problem = error.localizedDescription }
    }
    func discover(_ invite: CollectionInvitation? = nil) async throws -> [CollectionRequest] {
        var url = URLComponents(url: PulsHealthDatabase.viewerURL.appending(path: "api/sharing"), resolvingAgainstBaseURL: false)!
        if let invite { url.queryItems = [.init(name: "id", value: invite.id.uuidString)] }
        var request = URLRequest(url: url.url!); request.timeoutInterval = 30; request.cachePolicy = .reloadIgnoringLocalCacheData
        if let code = invite?.code { request.setValue(code, forHTTPHeaderField: "X-Collection-Invite") }
        // Public metadata carries no account credential, even on redirects.
        let session = URLSession(configuration: .ephemeral, delegate: CollectionNoRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw CollectionError("This request is unavailable.") }
        return try JSONDecoder().decode(CollectionResponse<[CollectionRequest]>.self, from: data).result
    }
    func join(_ request: CollectionRequest, metrics: [CollectionMetric], invite: CollectionInvitation) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        let generation = sessionGeneration
        do {
            await start(); guard writable else { throw CollectionError("Sharing state is unavailable.") }
            await account.restore()
            guard let owner = account.savedProfile?.userID else { throw CollectionError("Sign in from Settings → User, then review this invitation again.") }
            try checkSession(generation)
            if enrollments.contains(where: { $0.request.id == request.id }) {
                throw CollectionError("You’re already connected. Open this connection from Connections.")
            }
            let policy = await accessPolicy()
            if let maximum = policy.maximumTypes, Set(metrics.map(\.type)).count > maximum { throw CollectionError("This request needs more than \(maximum) types. Choose fewer optional types or upgrade to Pro before joining.") }
            if let end = request.sharingEnd, end <= Date() { throw CollectionError("This request’s collection window has ended.") }
            if !request.allowsHistory(policy) { throw CollectionError("This request includes history outside your plan. Upgrade to Pro before joining.") }
            for metric in metrics {
                guard let descriptor = HealthTypeCatalog.descriptor(for: metric.type), [.quantity, .category].contains(descriptor.kind),
                      metric.function == "raw" || HealthTypeCatalog.allowedAggregateFunctions(for: metric.type).contains(where: { $0.rawValue == metric.function })
                else { throw CollectionError("This request includes data unavailable on this iOS version.") }
            }
            // HealthKit prompts before the server grant is issued; reviewing a link never starts a query.
            let authorization = HealthSyncEngine(store: SyncStateStore(directory: directory.appending(path: "authorization"), tokenStore: InMemoryTokenStore()), eventLog: SyncEventLog(directory: directory.appending(path: "authorization")), wakeLog: WakeLog(directory: directory.appending(path: "authorization")))
            _ = try await authorization.requestAuthorization(for: metrics.map(\.type))
            try checkSession(generation)
            let response: CollectionResponse<CollectionEnrollment> = try await account.collectionCommand(CollectionCommand(action: "join", id: request.id, invite: invite.code, accepted: true, version: request.version, metrics: metrics, startAt: request.startAt, endAt: request.endAt))
            try checkSession(generation)
            guard let token = response.token else { throw CollectionError("The server did not return a sharing credential.") }
            try credential(response.result.id).setToken(token)
            local.append(Local(enrollment: response.result, owner: owner, sessionFingerprint: try account.collectionSessionFingerprint(), enabled: true))
            try persist()
            enrollments.append(response.result)
            try await activate(response.result)
            invitation = nil; problem = nil
            send(response.result.id)
        } catch { problem = error.localizedDescription }
    }
    private func activate(_ e: CollectionEnrollment) async throws {
        guard engines[e.id] == nil, e.status == "active", e.end > Date() || e.request.mode == "once",
              let token = try credential(e.id).token() else { return }
        let generation = sessionGeneration
        let revision = activationRevisions[e.id, default: 0]
        let folder = directory.appending(path: e.id.uuidString + "-" + String(e.generation), directoryHint: .isDirectory)
        let store = SyncStateStore(directory: folder, tokenStore: InMemoryTokenStore())
        guard !(await store.isReadOnly) else { throw CollectionError("This request’s sync state is unreadable. Unlock the iPhone and reopen the app.") }
        let engine = HealthSyncEngine(store: store, eventLog: SyncEventLog(directory: folder), wakeLog: WakeLog(directory: folder), recentWindowFirst: false, readEnd: e.end, accessPolicy: accessPolicy)
        await Self.configureStore(store, enrollment: e)
        try checkSession(generation)
        guard activationRevisions[e.id, default: 0] == revision, isEnabled(e.id) else { throw CancellationError() }
        let transport = CollectionTransport(enrollment: e, token: token)
        await engine.setTransport(transport)
        try checkSession(generation)
        guard activationRevisions[e.id, default: 0] == revision, isEnabled(e.id) else { await transport.disable(); throw CancellationError() }
        engines[e.id] = engine; transports[e.id] = transport
        if e.request.mode == "ongoing" {
            await engine.startObserving()
            if generation != sessionGeneration || activationRevisions[e.id, default: 0] != revision { await engine.stopObserving(); await transport.disable() }
        }
    }
    static func configureStore(_ store: SyncStateStore, enrollment e: CollectionEnrollment) async {
        var config = await store.configuration
        config.enabledTypes = Set(e.metrics.filter { $0.function == "raw" }.map(\.type)); config.startDate = e.start
        config.serverURL = nil; config.authToken = nil
        config.includeWorkoutRoutes = false; config.includeWorkoutEnhancedData = false
        config.batchSize = 500; config.maxMergedBatchSamples = 500
        config.aggregates = e.metrics.filter { $0.function != "raw" }.compactMap { metric in
            guard let function = AggregateFunction(rawValue: metric.function) else { return nil }
            let existing = config.aggregates.first { $0.typeIdentifier == metric.type && $0.function == function }
            return AggregateConfig(id: existing?.id ?? UUID(), typeIdentifier: metric.type, function: function, startDate: e.start, settleDelay: 0)
        }
        // These are isolated custom-transport stores, not saved personal destinations.
        // configure() switches destinations and resets anchors when the URL is nil.
        await store.setConfiguration(config)
        await store.persistNow()
    }
    private func disable(_ id: UUID) async {
        activationRevisions[id, default: 0] += 1
        if let index = local.firstIndex(where: { $0.enrollment.id == id }) { local[index].enabled = false }
        tasks[id]?.cancel(); tasks[id] = nil; runIDs[id] = nil; running.remove(id)
        let transport = transports.removeValue(forKey: id)
        let engine = engines.removeValue(forKey: id)
        await transport?.disable(); await engine?.stopObserving()
    }
    func change(_ action: String, enrollment e: CollectionEnrollment) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        let generation = sessionGeneration
        do {
            if action == "pause" || action == "stop" {
                await disable(e.id)
                if let i = local.firstIndex(where: { $0.enrollment.id == e.id }) { local[i].pendingAction = action }
                try persist()
                notices[e.id] = "Stopped on this iPhone. Updating the server…"
            }
            let response: CollectionResponse<CollectionEnrollment> = try await account.collectionCommand(CollectionCommand(action: action, id: e.id))
            try checkSession(generation)
            if let i = enrollments.firstIndex(where: { $0.id == e.id }) { enrollments[i] = response.result }
            if let i = local.firstIndex(where: { $0.enrollment.id == e.id }) { local[i].enrollment = response.result; local[i].pendingAction = nil }
            if let token = response.token {
                await disable(e.id)
                try checkSession(generation)
                try credential(e.id).setToken(token)
                if let i = local.firstIndex(where: { $0.enrollment.id == e.id }) { local[i].enabled = true; local[i].sessionFingerprint = try account.collectionSessionFingerprint() }
                else if let owner = account.savedProfile?.userID { local.append(Local(enrollment: response.result, owner: owner, sessionFingerprint: try account.collectionSessionFingerprint(), enabled: true)) }
                try persist(); try await activate(response.result)
            } else { try credential(e.id).setToken(nil) }
            try persist(); notices[e.id] = nil; problem = nil
        } catch {
            problem = error.localizedDescription
            if action == "pause" || action == "stop" { notices[e.id] = "Stopped on this iPhone. Server update pending; reopen Connections when online." }
        }
    }
    func send(_ id: UUID) {
        guard tasks[id] == nil, let engine = engines[id] else { return }
        if let e = enrollments.first(where: { $0.id == id }), e.start > Date() {
            notices[id] = "Scheduled to collect from \(e.start.formatted()). iOS controls background delivery."
            return
        }
        running.insert(id)
        let runID = UUID(); runIDs[id] = runID
        tasks[id] = Task {
            defer { if runIDs[id] == runID { tasks[id] = nil; runIDs[id] = nil; running.remove(id) } }
            let completed = await BackgroundExecution.run("PulsHealth sharing") { await engine.syncAllEnabled(reason: .backfill); await engine.store.persistNow() }
            guard runIDs[id] == runID else { return }
            guard completed, !Task.isCancelled else { notices[id] = "Paused by iOS; open Connections to continue."; return }
            let status = await engine.snapshot()
            let config = await engine.store.configuration
            var errors = status.compactMap { $0.state.lastError }
            for aggregate in config.aggregates {
                if let error = await engine.store.aggregateState(for: aggregate.id).lastError { errors.append(error) }
            }
            let rawComplete = status.allSatisfy { $0.state.backfillComplete }
            notices[id] = errors.isEmpty && rawComplete ? "Sharing pass finished. Check the last server receipt below; permissions can limit or hide records." : "Some data could not be sent. Try again when connected."
            if !(await engine.isHealthDataAccessible()) { notices[id] = "Health data is locked. Unlock this iPhone and try again." }
            await refresh()
        }
    }
    func catchUp() async {
        await start()
        for item in local where item.enabled && item.enrollment.request.mode == "ongoing" { send(item.enrollment.id) }
    }
    func isEnabled(_ id: UUID) -> Bool { local.contains { $0.enrollment.id == id && $0.enabled } }
}
