import SwiftUI
import PulsHealthSync

/// Screens pushed from Settings.
enum SettingsRoute: Hashable {
    case user, benchmark
}

/// The Settings tab: who the data is stored as, how the sync is tuned and
/// started, the destructive actions under Privacy & Data, diagnostics, and
/// About. The server is not here — it is the Sync tab's (`ServerSettingsView`).
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmResetAll = false
    @State private var confirmBackfill = false
    @State private var confirmDeleteExport = false
    @State private var validatingAggregates = false
    @State private var aggregateValidationResult: String?

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                NavigationLink(value: SettingsRoute.user) {
                    LabeledContent(model.config.userName?.isEmpty == false
                        ? model.config.userName! : "User") {
                        Text(model.config.userEmail ?? "")
                            .foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("User")
            } footer: {
                Text("Synced data is stored under this user on the server.")
            }

            Section {
                DatePicker(
                    // "Sync", not "Export": the Export tab has its own time
                    // range, and this date is not it.
                    "Sync data from",
                    selection: $model.config.startDate,
                    in: ...Date(),
                    displayedComponents: .date
                )
                Stepper(
                    "Concurrent types: \(model.config.maxConcurrentTypes)",
                    value: $model.config.maxConcurrentTypes, in: 1...8
                )
                Picker("Batch size", selection: $model.config.batchSize) {
                    ForEach([250, 500, 1_000, 2_000, 5_000], id: \.self) {
                        Text($0.formatted()).tag($0)
                    }
                }
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
                DisclosureGroup("Why isn't the latest data here yet?") {
                    Text("Data written on this iPhone arrives in seconds. iOS throttles steps and energy to roughly hourly in the background. Apple Watch data must first sync to the phone, which iOS schedules itself, typically minutes and sometimes hours. Opening the app forces a catch-up.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Sync")
            } footer: {
                Text("The start date applies to sync only; the Export tab has its own range.")
            }

            Section {
                Button {
                    Task { await model.applyConfiguration() }
                } label: {
                    Text("Save & Apply")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))
                .listRowSeparator(.hidden)
            }

            Section {
                Button("Reset All Anchors", role: .destructive) { confirmResetAll = true }
                    .disabled(model.anySyncActive)
                // The staged export is health data at rest on the device,
                // and this is the way to remove it without going back to the
                // Export tab. Only while there is one: a run in flight owns
                // its files until it ends (`ExportModel.discard`).
                if case .finished(let finished) = model.export.state, !finished.filesRemoved {
                    Button("Delete Export", role: .destructive) { confirmDeleteExport = true }
                }
                // TODO(phase 3): wire to the profile store (Explore's analysis)
                // and enable once something has been analyzed.
                Button(role: .destructive) {
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Delete Analysis")
                        Text("Nothing analyzed yet")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .disabled(true)
            } header: {
                Text("Privacy & Data")
            } footer: {
                Text("Resetting anchors re-sends everything from the start date; the server deduplicates.")
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
            } header: {
                Text("Diagnostics")
            } footer: {
                Text("Validation runs every type and aggregate-function combination against HealthKit; failures are listed under Sync → Activity.")
            }

            Section {
                LabeledContent("Version", value: Self.versionString)
                Link("Open Source on GitHub", destination: URL(string: "https://github.com/PulsHealth/pulshealth")!)
                Link("Privacy Policy", destination: URL(string: "https://pulshealth.com/privacy")!)
                Link("Documentation", destination: URL(string: "https://pulshealth.com/docs/")!)
            } header: {
                Text("About")
            } footer: {
                Text("No analytics. No third-party code.")
            }
        }
        .navigationTitle("Settings")
        .navigationDestination(for: SettingsRoute.self) { route in
            switch route {
            case .user: UserView()
            case .benchmark: BenchmarkView()
            }
        }
        .alert("Reset all anchors?", isPresented: $confirmResetAll) {
            Button("Reset All", role: .destructive) {
                Task { await model.resetAll() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Re-exports everything from the start date for all enabled types.")
        }
        .alert("Delete this export?", isPresented: $confirmDeleteExport) {
            Button("Delete", role: .destructive) { model.export.discard() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Removes the exported files from this iPhone. Copies you already saved or sent elsewhere are not affected.")
        }
        .alert("Start initial backfill?", isPresented: $confirmBackfill) {
            Button("Start Backfill") {
                Task {
                    // A server/user change defers the apply to the fresh-vs-
                    // keep prompt; the backfill is then part of "start fresh".
                    if await model.applyConfiguration() {
                        await model.startBackfill()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Exports \(model.config.enabledTypes.count) data types from \(model.config.startDate.formatted(date: .abbreviated, time: .omitted)) onward.")
        }
    }

    /// "1.6 (17)", from the bundle so it can never disagree with what shipped.
    private static var versionString: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
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
                : "\(failures.count) failure\(failures.count == 1 ? "" : "s") — details under Sync → Activity."
            validatingAggregates = false
        }
    }
}

/// Icon + one-liner for a `ConnectionTestResult`, plus the advertised feature
/// list on success so it is visible why (say) reconciliation is offered or not.
/// Shared by the Server screen and the onboarding flow's server step.
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

/// The fresh-vs-keep prompt raised when Save & Apply (from the Server screen,
/// Settings, the User page or the Synced Data bar) would point the sync at a different server or
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
