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
                    await apply()
                    await model.startBackfill()
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

    private func apply() async {
        // Save & Apply is disabled while the URL is invalid; an empty field
        // clears the server.
        model.config.serverURL = validatedServerURL
        let token = enteredToken
        model.config.authToken = token.isEmpty ? nil : token
        await model.applyConfiguration()
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

/// Edits the active user's identity (name/email/dob/sex). Every field starts
/// unset — nothing about the person is assumed — and each may be left that way.
/// The user_id is stable and shown read-only. Saving pushes the configuration
/// to the engine so the next batch syncs as this user and updates the server's
/// `users` row.
struct UserView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

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
                LabeledContent("User ID", value: model.config.userID)
                    .textSelection(.enabled)
                    .font(.footnote)
            } footer: {
                Text("This ID tags every row stored for you on the server and is stable across reinstalls. If several people share one server, each should sync under a distinct ID — editing it here is planned.")
            }

            Section {
                Button("Save & Apply") {
                    Task { await model.applyConfiguration() }
                    dismiss()
                }
            }
        }
        .navigationTitle("User")
        .navigationBarTitleDisplayMode(.inline)
    }
}
