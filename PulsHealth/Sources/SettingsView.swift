import SwiftUI
import PulsHealthSync

/// Screens pushed from Settings. Value-based so `RootView`, which owns the
/// stack's path, can pop back to Settings → Server when a pairing link is
/// accepted while one of them is on top.
enum SettingsRoute: Hashable {
    case user, benchmark, export
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    /// The server fields, held here until Save & Apply — including the user ID
    /// a pairing code brought with it.
    @State private var server = ServerFieldsDraft()
    @State private var loaded = false
    @State private var confirmResetAll = false
    @State private var confirmBackfill = false
    @State private var validatingAggregates = false
    @State private var aggregateValidationResult: String?
    @State private var testingConnection = false
    /// Outcome of the last Test Connection for the values currently entered;
    /// cleared whenever either field changes.
    @State private var connectionTest: ConnectionTestResult?
    @State private var connectionTestRun = 0
    @State private var showScanner = false

    var body: some View {
        @Bindable var model = model
        Form {
            Section("User") {
                NavigationLink(value: SettingsRoute.user) {
                    LabeledContent(model.config.userName?.isEmpty == false
                        ? model.config.userName! : "User") {
                        Text(model.config.userEmail ?? "")
                            .foregroundStyle(.secondary)
                    }
                }
                Text("All synced data is stored under this user. Change it before the initial backfill.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section {
                TextField("https://your-host:8080", text: $server.urlText)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if let issue = server.urlIssue {
                    Label(issue, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                SecureField("Bearer token", text: $server.tokenText)
                Button {
                    runConnectionTest()
                } label: {
                    HStack {
                        Text(testingConnection ? "Testing Connection…" : "Test Connection")
                        if testingConnection {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(testingConnection || !server.isTestable)
                if let result = connectionTest {
                    ConnectionTestResultRow(result: result)
                }
                if let pairedUserID = server.pairedUserID {
                    // The third value of a pairing code has no field on this
                    // screen (it lives under User → Advanced), so say that it
                    // is staged too rather than changing it out of sight.
                    Label {
                        Text("Filled in from a pairing code, with user ID \(pairedUserID). Nothing changes until you tap Save & Apply.")
                    } icon: {
                        Image(systemName: "qrcode")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Button {
                    showScanner = true
                } label: {
                    Label("Scan Pairing Code", systemImage: "qrcode.viewfinder")
                }
                PastePairingCodeRow(urlText: server.urlText) { applyPairing($0) }
            } header: {
                Text("Server")
            } footer: {
                Text("Use https://. Plain http:// is accepted only for hosts on your local network (localhost, *.local, 10.x, 172.16–31.x, 192.168.x). Test Connection uses the values entered above without saving them. A pairing code — scanned, pasted, or opened as a puls:// link — fills in the URL, token and user ID the server prints (`make pairing`) and tests them; Save & Apply still has to be tapped.")
            }

            Section("Sync window") {
                DatePicker(
                    // "Sync", not "Export": Export Data is its own screen now,
                    // with its own time range, and this date is not it.
                    "Sync data from",
                    selection: $model.config.startDate,
                    in: ...Date(),
                    displayedComponents: .date
                )
                Text("The initial backfill syncs everything from this date forward. Changing it later only affects types whose anchors are reset. Export Data has its own time range.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Performance") {
                Stepper(
                    "Concurrent types: \(model.config.maxConcurrentTypes)",
                    value: $model.config.maxConcurrentTypes, in: 1...8
                )
                Picker("Batch size", selection: $model.config.batchSize) {
                    ForEach([250, 500, 1_000, 2_000, 5_000], id: \.self) {
                        Text($0.formatted()).tag($0)
                    }
                }
                Text("Defaults (4 types, 1,000/batch) are the field-tested sweet spot. Use the benchmark in Diagnostics to tune for your network.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section {
                Button("Save & Apply") {
                    Task { await apply() }
                }
                    .disabled(server.urlIssue != nil)
            }

            Section("Backfill") {
                Button("Start Initial Backfill") { confirmBackfill = true }
                    // Not under a running export: the two are the same sweep
                    // over the same HealthKit store (AppModel.exportBlockedByBackfill
                    // is this rule from the other side).
                    .disabled(!model.configured || model.backfillActive || model.export.isRunning)
                if model.backfillActive {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text("Sync in progress…").foregroundStyle(.secondary)
                        if let eta = model.backfillRemaining {
                            Spacer()
                            Text("ETA \(eta.shortDuration)")
                        }
                    }
                }
                Text("Keep the app in the foreground and the device plugged in for the fastest backfill. Progress is saved after every batch — it's safe to interrupt.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section {
                NavigationLink(value: SettingsRoute.export) {
                    // An HStack, not LabeledContent: with an empty value that
                    // leaves the row's accessibility label empty too.
                    HStack {
                        Text("Export Data")
                        Spacer()
                        // A run outlives the screen that started it, so the way
                        // back to it says when there is one.
                        switch model.export.state {
                        case .idle:
                            EmptyView()
                        case .running:
                            ProgressView()
                        case .finished(let finished):
                            Text(finished.filesRemoved ? "Shared" : "Ready to share")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } header: {
                Text("Export")
            } footer: {
                Text("Write the selected health data to CSV or JSONL files on this iPhone and share them. Works without a server.")
            }

            Section {
                NavigationLink("Run Throughput Benchmark", value: SettingsRoute.benchmark)
                Button {
                    runAggregateValidation()
                } label: {
                    if validatingAggregates {
                        HStack {
                            Text("Validating Aggregate Functions…")
                            Spacer()
                            ProgressView()
                        }
                    } else {
                        Text("Validate Aggregate Functions")
                    }
                }
                .disabled(validatingAggregates)
                if let result = aggregateValidationResult {
                    Text(result)
                        .font(.caption)
                        .foregroundStyle(result.hasPrefix("All") ? Color.secondary : .red)
                }
                Button("Show Onboarding Again") { model.restartOnboarding() }
                Button("Reset All Anchors", role: .destructive) { confirmResetAll = true }
                    .disabled(model.anySyncActive)
            } header: {
                Text("Diagnostics")
            } footer: {
                Text("Validation runs every type × aggregate-function combo against HealthKit. A crash here means the allowed-function table needs fixing; listed failures (also in the Log) are softer errors like missing authorization.")
            }

            Section("About") {
                LabeledContent("Engine", value: "PulsHealthSync")
                LabeledContent(
                    "Background delivery",
                    value: "immediate (per-type caps apply)"
                )
                Text("Real-time expectations: data written directly on this iPhone arrives in seconds. Steps/energy are throttled by iOS to roughly hourly. Apple Watch data must first sync to the phone, which iOS schedules opportunistically — typically minutes, sometimes hours. Opening this app forces a catch-up.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .navigationDestination(for: SettingsRoute.self) { route in
            switch route {
            case .user: UserView()
            case .benchmark: BenchmarkView()
            case .export: ExportView()
            }
        }
        .onAppear {
            if !loaded {
                loaded = true
                server = ServerFieldsDraft(configuration: model.config)
            }
            // This tab is built lazily: an accepted pairing link can be what
            // brings it on screen for the first time, already waiting.
            collectConfirmedPairing()
        }
        .onChange(of: model.pairingAwaitsSettings) { collectConfirmedPairing() }
        .onChange(of: server.urlText) {
            // A whole `puls://pair?…` string pasted into the URL field is a
            // pairing code, not a malformed URL.
            if let payload = server.pairingCodeInURLField {
                applyPairing(payload)
            } else {
                connectionTest = nil
            }
        }
        .onChange(of: server.tokenText) { connectionTest = nil }
        // The confirmation for an incoming link is an alert on RootView, and
        // it cannot come up over this sheet.
        .onChange(of: model.pairingLinkPrompt) { _, prompt in
            if prompt != nil { showScanner = false }
        }
        .sheet(isPresented: $showScanner) {
            PairingScannerView { applyPairing($0) }
        }
        .alert("Reset all anchors?", isPresented: $confirmResetAll) {
            Button("Reset All", role: .destructive) {
                Task { await model.resetAll() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Re-exports everything from the start date for all enabled types.")
        }
        .alert("Start initial backfill?", isPresented: $confirmBackfill) {
            Button("Start Backfill") {
                Task {
                    // A server/user change defers the apply to the fresh-vs-
                    // keep prompt; the backfill is then part of "start fresh".
                    if await apply() {
                        await model.startBackfill()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Exports \(model.config.enabledTypes.count) data types from \(model.config.startDate.formatted(date: .abbreviated, time: .omitted)) onward.")
        }
    }

    private func runAggregateValidation() {
        validatingAggregates = true
        aggregateValidationResult = nil
        Task {
            let failures = await model.engine.validateAggregateFunctionMatrix()
            for failure in failures {
                await model.engine.eventLog.log(.error, failure)
            }
            aggregateValidationResult = failures.isEmpty
                ? "All type × function combinations passed."
                : "\(failures.count) failure\(failures.count == 1 ? "" : "s") — details in the Log tab."
            validatingAggregates = false
        }
    }

    /// The one place a pairing code lands on this screen, whatever brought it:
    /// the scanner, the Paste button, a `puls://pair?…` string put in the URL
    /// field, or a link the user accepted (`collectConfirmedPairing`). It fills
    /// the three values and tests them. It never applies anything — Save &
    /// Apply does, and that still runs the server/user-change prompt if the
    /// target moved.
    private func applyPairing(_ payload: PairingPayload) {
        server.fill(from: payload)
        // The code was printed by the server it describes; find out now
        // whether the phone can reach it rather than after Save & Apply.
        runConnectionTest()
    }

    /// Takes a pairing link the user accepted (`AppModel.confirmPairingLink`).
    /// Not while the first-run flow is up — then the payload is its.
    private func collectConfirmedPairing() {
        guard model.pairingAwaitsSettings, let payload = model.takeConfirmedPairing() else { return }
        applyPairing(payload)
    }

    /// Runs the connection test against the *entered* URL and token — not the
    /// saved ones — and persists nothing; only the result row changes.
    private func runConnectionTest() {
        guard let url = server.validatedURL else { return }
        let token = server.token
        guard !token.isEmpty else { return }
        let userID = server.connectionTestUserID(fallback: model.config.userID)
        testingConnection = true
        connectionTest = nil
        // A pairing code can arrive while an earlier test is still out; only
        // the latest run may report, or the row could describe old values.
        connectionTestRun += 1
        let run = connectionTestRun
        Task {
            let result = await model.testConnection(url: url, token: token, userID: userID)
            guard run == connectionTestRun else { return }
            connectionTest = result
            testingConnection = false
        }
    }

    /// False when the apply was deferred to the server-change prompt.
    @discardableResult
    private func apply() async -> Bool {
        // Save & Apply is disabled while the URL is invalid; an empty field
        // clears the server.
        server.commit(to: &model.config)
        // The paired user ID is in the draft now, whichever way the
        // server-change prompt goes; holding on to it would overwrite a later
        // edit on the User page.
        server.markCommitted()
        return await model.applyConfiguration()
    }

}

/// Icon + one-liner for a `ConnectionTestResult`, plus the advertised feature
/// list on success so it is visible why (say) reconciliation is offered or not.
/// Shared with the onboarding flow's server step.
struct ConnectionTestResultRow: View {
    let result: ConnectionTestResult

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(result.message)
                if case .ok(let capabilities) = result, !capabilities.features.isEmpty {
                    Text("Features: \(capabilities.features.sorted().joined(separator: ", "))")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.caption)
        } icon: {
            Image(systemName: symbol).foregroundStyle(color)
        }
    }

    private var symbol: String {
        switch result {
        case .ok: "checkmark.circle.fill"
        case .okNoCapabilities: "checkmark.circle"
        case .tokenRejected: "lock.slash"
        case .unsupportedProtocol: "exclamationmark.triangle.fill"
        case .unreachable: "wifi.exclamationmark"
        case .serverError: "exclamationmark.octagon.fill"
        }
    }

    private var color: Color {
        switch result {
        case .ok, .okNoCapabilities: .green
        case .unsupportedProtocol: .orange
        case .tokenRejected, .unreachable, .serverError: .red
        }
    }
}

/// The fresh-vs-keep prompt raised when Save & Apply (from Settings, the User
/// page or the Data Types tab) would point the sync at a different server or
/// user ID than the stored anchors and watermarks were earned against.
/// Attached at the root so it appears whichever tab the apply came from.
struct ServerChangePrompt: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        content.alert(
            model.pendingServerChange?.serverChanged == false
                ? "Sync as a different user?" : "Sync to a different server?",
            isPresented: Binding(
                get: { model.pendingServerChange != nil },
                // An alert only closes through its buttons, and each of them
                // clears the pending change itself; the binding's own
                // dismissal must not race ahead and cancel the choice.
                set: { _ in }
            )
        ) {
            Button("Start Fresh (Recommended)") { model.confirmServerChange(startFresh: true) }
            Button("Keep Progress") { model.confirmServerChange(startFresh: false) }
            Button("Cancel", role: .cancel) { model.cancelServerChange() }
        } message: {
            Text(Self.message(for: model.pendingServerChange))
        }
    }

    static func message(for change: ServerIdentityChange?) -> String {
        guard let change else { return "" }
        let what = change.serverChanged && change.userChanged
            ? "The server and user ID changed"
            : change.serverChanged ? "The server changed" : "The user ID changed"
        let target = change.userChanged && !change.serverChanged
            ? "the server treats a new user ID as a different person, so nothing synced so far counts for it"
            : "your sync progress belongs to the previous server"
        return """
        \(what) (\(change.summary)) — \(target).

        Start fresh re-syncs all history from the start date (recommended). \
        Keep progress sends only new data from here on, and the new target \
        never receives anything older.
        """
    }
}

extension View {
    func serverChangePrompt() -> some View { modifier(ServerChangePrompt()) }
}

/// Edits the active user's identity (name/email/dob/sex). Every field starts
/// unset — nothing about the person is assumed — and each may be left that way.
/// The user ID lives under Advanced: it is stable across reinstalls and only
/// needs changing when several people share one server. Saving pushes the
/// configuration to the engine so the next batch syncs as this user and
/// updates the server's `users` row; a changed ID goes through the same
/// fresh-vs-keep prompt as a server change.
struct UserView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var userIDText = ""
    @State private var userIDLoaded = false

    private var userIDValid: Bool { AppModel.normalizedUserID(userIDText) != nil }

    var body: some View {
        @Bindable var model = model
        Form {
            Section("Identity") {
                TextField("Name", text: Binding(
                    get: { model.config.userName ?? "" },
                    set: { model.config.userName = $0.isEmpty ? nil : $0 }
                ))
                .textContentType(.name)
                TextField("Email", text: Binding(
                    get: { model.config.userEmail ?? "" },
                    set: { model.config.userEmail = $0.isEmpty ? nil : $0 }
                ))
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }

            Section("Characteristics") {
                if let dob = model.config.userDateOfBirth {
                    DatePicker("Date of birth", selection: Binding(
                        get: { model.config.userDateOfBirth ?? dob },
                        set: { model.config.userDateOfBirth = $0 }
                    ), in: ...Date(), displayedComponents: .date)
                    Button("Clear date of birth", role: .destructive) {
                        model.config.userDateOfBirth = nil
                    }
                } else {
                    LabeledContent("Date of birth") {
                        Button("Set") {
                            // Seed the picker with a plausible adult age; the
                            // user adjusts from there.
                            model.config.userDateOfBirth = Calendar.current.date(
                                byAdding: .year, value: -30, to: Date()) ?? Date()
                        }
                    }
                }
                Picker("Biological sex", selection: $model.config.userBiologicalSex) {
                    Text("Not set").tag(String?.none)
                    Text("Female").tag(String?.some("female"))
                    Text("Male").tag(String?.some("male"))
                    Text("Other").tag(String?.some("other"))
                }
                Text("Optional. Date of birth and sex feed derived metrics like heart-rate zones; leave them unset and those metrics are simply not computed.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section {
                TextField("User ID (UUID)", text: $userIDText)
                    .font(.footnote.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onChange(of: userIDText) { _, text in
                        // Only a valid UUID reaches the draft; an in-progress
                        // edit leaves the applied ID untouched.
                        if let normalized = AppModel.normalizedUserID(text) {
                            model.config.userID = normalized
                        }
                    }
                if !userIDValid {
                    Text("Not a valid UUID (8-4-4-4-12 hex digits). The previous ID stays in effect until this is fixed.")
                        .font(.caption).foregroundStyle(.red)
                }
                Button("Generate New ID") {
                    userIDText = UUID().uuidString.lowercased()
                }
            } header: {
                Text("Advanced")
            } footer: {
                Text("Every row stored for you on the server is tagged with this ID, and it survives reinstalls. If several people share one server, each should sync under a distinct ID. Changing it makes the server treat you as a different person, so saving asks whether to re-sync all history under the new ID or keep going with only new data.")
            }

            Section {
                Button("Save & Apply") {
                    Task { await model.applyConfiguration() }
                    dismiss()
                }
                .disabled(!userIDValid)
            }
        }
        .navigationTitle("User")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            guard !userIDLoaded else { return }
            userIDLoaded = true
            userIDText = model.config.userID
        }
    }
}
