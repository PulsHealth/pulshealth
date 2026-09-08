import SwiftUI
import PulsHealthSync

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var serverURLText = ""
    @State private var tokenText = ""
    @State private var loaded = false
    @State private var confirmResetAll = false
    @State private var confirmBackfill = false
    @State private var validatingAggregates = false
    @State private var aggregateValidationResult: String?
    @State private var testingConnection = false
    /// Outcome of the last Test Connection for the values currently entered;
    /// cleared whenever either field changes.
    @State private var connectionTest: ConnectionTestResult?

    /// Validation of the entered URL; nil while the field is empty (an empty
    /// URL is allowed — it un-configures the server).
    private var serverURLValidation: Result<URL, ServerURLValidation.Failure>? {
        let trimmed = serverURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : ServerURLValidation.validate(trimmed)
    }

    private var validatedServerURL: URL? {
        if case .success(let url) = serverURLValidation { return url }
        return nil
    }

    private var serverURLIssue: String? {
        if case .failure(let failure) = serverURLValidation { return failure.errorDescription }
        return nil
    }

    private var enteredToken: String { Self.normalizeToken(tokenText) }

    var body: some View {
        @Bindable var model = model
        Form {
            Section("User") {
                NavigationLink {
                    UserView()
                } label: {
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
                TextField("https://your-host:8080", text: $serverURLText)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if let issue = serverURLIssue {
                    Label(issue, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                SecureField("Bearer token", text: $tokenText)
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
                .disabled(testingConnection || validatedServerURL == nil || enteredToken.isEmpty)
                if let result = connectionTest {
                    ConnectionTestResultRow(result: result)
                }
            } header: {
                Text("Server")
            } footer: {
                Text("Use https://. Plain http:// is accepted only for hosts on your local network (localhost, *.local, 10.x, 172.16–31.x, 192.168.x). Test Connection uses the values entered above without saving them.")
            }

            Section("Sync window") {
                DatePicker(
                    "Export data from",
                    selection: $model.config.startDate,
                    in: ...Date(),
                    displayedComponents: .date
                )
                Text("The initial backfill exports everything from this date forward. Changing it later only affects types whose anchors are reset.")
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
                    .disabled(serverURLIssue != nil)
            }

            Section("Backfill") {
                Button("Start Initial Backfill") { confirmBackfill = true }
                    .disabled(!model.configured || model.backfillActive)
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
                NavigationLink("Run Throughput Benchmark") { BenchmarkView() }
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
        .onAppear {
            guard !loaded else { return }
            loaded = true
            serverURLText = model.config.serverURL?.absoluteString ?? ""
            tokenText = model.config.authToken ?? ""
        }
        .onChange(of: serverURLText) { connectionTest = nil }
        .onChange(of: tokenText) { connectionTest = nil }
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

    /// Runs the connection test against the *entered* URL and token — not the
    /// saved ones — and persists nothing; only the result row changes.
    private func runConnectionTest() {
        guard let url = validatedServerURL else { return }
        let token = enteredToken
        testingConnection = true
        connectionTest = nil
        Task {
            connectionTest = await model.testConnection(url: url, token: token)
            testingConnection = false
        }
    }

    /// False when the apply was deferred to the server-change prompt.
    @discardableResult
    private func apply() async -> Bool {
        // Save & Apply is disabled while the URL is invalid; an empty field
        // clears the server.
        model.config.serverURL = validatedServerURL
        let token = enteredToken
        model.config.authToken = token.isEmpty ? nil : token
        return await model.applyConfiguration()
    }

    /// Accepts a pasted `PULS_TOKEN=…` line from the server's `.env` as well as
    /// the bare token.
    private static func normalizeToken(_ text: String) -> String {
        var token = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if token.hasPrefix("PULS_TOKEN="), let value = token.split(separator: "=", maxSplits: 1).last {
            token = String(value)
        }
        return token
    }
}

/// Icon + one-liner for a `ConnectionTestResult`, plus the advertised feature
/// list on success so it is visible why (say) reconciliation is offered or not.
private struct ConnectionTestResultRow: View {
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
