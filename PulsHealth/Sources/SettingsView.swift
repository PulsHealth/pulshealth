import SwiftUI
import AuthenticationServices
import PulsHealthSync

/// Screens pushed from Settings.
enum SettingsRoute: Hashable {
    case user, benchmark
}

/// The Settings tab: who the data is stored as, the sync window and backfill
/// (only once a server is applied), how many types run at once, Health access
/// and the on-device data under Privacy & Data, diagnostics, and About. The
/// database is not here — it is the Sync tab's (`ServerSettingsView`).
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmResetAll = false
    @State private var confirmBackfill = false
    @State private var confirmDeleteExport = false
    @State private var confirmDeleteAnalysis = false
    @State private var validatingAggregates = false
    /// Failures in the last Validate Aggregate Functions run; nil before one.
    @State private var aggregateValidationFailures: Int?

    private var syncStartDate: Binding<Date> {
        Binding {
            model.subscriptions.hasPro ? model.config.startDate
                : max(model.config.startDate, SyncAccessPolicy.free.earliestDate() ?? model.config.startDate)
        } set: { date in
            model.setSyncStartDate(date)
        }
    }

    var body: some View {
        @Bindable var model = model
        let analyzed = model.explore.profiles.count
        Form {
            if model.stateFileUnreadable {
                StateUnreadableNotice()
            }
            Section {
                NavigationLink(value: SettingsRoute.user) {
                    UserRow(name: model.config.userName, email: model.config.userEmail)
                }
            }

            Section("Plan") {
                Button { model.showPro() } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.subscriptions.hasPro ? "PulsHealth Pro" : "PulsHealth Free")
                            Text(model.subscriptions.hasPro
                                 ? (model.subscriptions.plan?.status ?? "Pro is active")
                                 : "Recent exports · 5 automatic-sync types")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: model.subscriptions.hasPro ? "checkmark.seal" : "person.crop.circle")
                    }
                }
            }

            Section("Data Requests") {
                NavigationLink { CreateDataRequestView() } label: { Label("Create Request", systemImage: "qrcode") }
                NavigationLink { OpenDataRequestView() } label: { Label("Open or Scan Request", systemImage: "qrcode.viewfinder") }
            }

            // Keyed on the *applied* server, like the Sync tab's first-time screen:
            // without one there is nothing for a start date, a backfill or
            // an anchor to act on.
            if model.appliedConfig.serverURL != nil {
                Section("Sync") {
                    DatePicker(
                        // "Sync", not "Export": the Export tab has its own time
                        // range, and this date is not it.
                        "Sync data from",
                        selection: syncStartDate,
                        in: ...Date(),
                        displayedComponents: .date
                    )
                    Button {
                        confirmBackfill = true
                    } label: {
                        HStack {
                            Text("Start Initial Backfill")
                            // Progress and ETA are the Sync tab's status card;
                            // this only says why the button is disabled.
                            if model.backfillActive {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    // Not under a running export: the two are the same sweep
                    // over the same HealthKit store (AppModel.exportBlockedByBackfill
                    // is this rule from the other side).
                    .disabled(!model.configured || model.backfillActive || model.export.isRunning)
                    Button("Reset All Anchors", role: .destructive) { confirmResetAll = true }
                        .disabled(model.anySyncActive)
                }
            }

            // Not sync-only: the on-device export and the benchmark run the
            // same sweep with these values.
            Section("Performance") {
                Stepper(value: $model.config.maxConcurrentTypes, in: 1...8) {
                    LabeledContent("Concurrent types", value: "\(model.config.maxConcurrentTypes)")
                }
                Picker("Batch size", selection: $model.config.batchSize) {
                    ForEach([250, 500, 1_000, 2_000, 5_000], id: \.self) {
                        Text($0.formatted()).tag($0)
                    }
                }
            }

            // Only while there is something to apply: the draft holds edits
            // from this screen and the User page until this or another
            // Save & Apply commits them.
            if model.hasPendingSettingsChanges {
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
            }

            Section("Privacy & Data") {
                // iOS has no link into the Health permission list itself; the
                // app's own Settings page carries a Health row that opens it.
                Link("Health Access", destination: URL(string: UIApplication.openSettingsURLString)!)
                // The staged export is health data at rest on the device,
                // and this is the way to remove it without going back to the
                // Export tab. Only while there is one: a run in flight owns
                // its files until it ends (`ExportModel.discard`).
                if case .finished(let finished) = model.export.state, !finished.filesRemoved {
                    Button("Delete Export", role: .destructive) { confirmDeleteExport = true }
                }
                // The per-type summaries the Explore tab keeps
                // (`TypeProfileStore`): derived numbers, never samples, but
                // health-derived data at rest, so the privacy policy promises
                // this one-tap way to remove all of them.
                Button("Delete Analysis", role: .destructive) { confirmDeleteAnalysis = true }
                    .disabled(analyzed == 0 || !model.explore.running.isEmpty)
                // App Review 5.1.1(v): the account the PulsHealth database
                // needs can be deleted from the app. Sync → Database has it
                // too; this is where people look for it. Always shown: an
                // iPhone paired from the account page's link, rather than by
                // signing in here, looks like any other database to the app.
                Link("Delete PulsHealth Account", destination: PulsHealthDatabase.deleteAccountURL)
                    .tint(.red)
            }

            Section("Diagnostics") {
                NavigationLink("Run Throughput Benchmark", value: SettingsRoute.benchmark)
                Button {
                    runAggregateValidation()
                } label: {
                    HStack {
                        Text("Validate Aggregate Functions")
                        Spacer()
                        if validatingAggregates {
                            ProgressView()
                        } else if let failures = aggregateValidationFailures {
                            // Each failure is logged under Sync → Activity.
                            if failures == 0 {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                    .accessibilityLabel("All passed")
                            } else {
                                Text("\(failures) failed").foregroundStyle(.red)
                            }
                        }
                    }
                }
                .disabled(validatingAggregates)
                Button("Show Onboarding Again") { model.restartOnboarding() }
            }

            Section("About") {
                LabeledContent("Version", value: Self.versionString)
                Link("Write a Review", destination: ReviewRequests.writeReviewURL)
                Link("Documentation", destination: URL(string: "https://pulshealth.com/docs/")!)
                Link("Privacy Policy", destination: URL(string: "https://pulshealth.com/privacy")!)
                Link("Open Source on GitHub", destination: URL(string: "https://github.com/PulsHealth/pulshealth")!)
                Link("Report an Issue", destination: URL(string: "https://github.com/PulsHealth/pulshealth/issues/new/choose")!)
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
            Text("Re-sends everything from the start date for every synced type. Your database skips what it already has.")
        }
        .alert("Delete all analysis?", isPresented: $confirmDeleteAnalysis) {
            Button("Delete", role: .destructive) { Task { await model.deleteAnalysis() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Removes the stored summaries for \(analyzed) type\(analyzed == 1 ? "" : "s"). Nothing in Apple Health changes.")
        }
        .deleteExportAlert(isPresented: $confirmDeleteExport, export: model.export)
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
            Text("Syncs \(model.config.enabledTypes.count) data types from \(model.config.startDate.formatted(date: .abbreviated, time: .omitted)) onward.")
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
        aggregateValidationFailures = nil
        Task {
            let failures = await model.engine.validateAggregateFunctionMatrix()
            for failure in failures {
                await model.engine.eventLog.log(.error, failure)
            }
            aggregateValidationFailures = failures.count
            validatingAggregates = false
        }
    }
}

/// The row that opens the User page, in the style of iOS Settings' own
/// account row: initials on an accent circle (a person glyph until there is a
/// name), the name, and the e-mail under it when there is one.
private struct UserRow: View {
    let name: String?
    let email: String?

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.accentColor.gradient)
                if let initials {
                    Text(initials)
                        .font(.headline)
                } else {
                    Image(systemName: "person.fill")
                        .font(.title3)
                }
            }
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(name.flatMap { $0.isEmpty ? nil : $0 } ?? "User")
                    .font(.headline)
                if let email, !email.isEmpty {
                    Text(email)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var initials: String? {
        guard let name, !name.isEmpty,
              let components = PersonNameComponentsFormatter().personNameComponents(from: name)
        else { return nil }
        let formatter = PersonNameComponentsFormatter()
        formatter.style = .abbreviated
        let initials = formatter.string(from: components)
        return initials.isEmpty ? nil : initials
    }
}

/// Icon + one-liner for a `ConnectionTestResult`, plus the advertised feature
/// list on success so it is visible why (say) reconciliation is offered or not.
/// Shown by `ServerSettingsView`, under Test Connection.
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
        case .userMismatch: "person.crop.circle.badge.exclamationmark"
        case .unsupportedProtocol: "exclamationmark.triangle.fill"
        case .unreachable: "wifi.exclamationmark"
        case .serverError: "exclamationmark.octagon.fill"
        }
    }

    private var color: Color {
        switch result {
        case .ok, .okNoCapabilities: .green
        case .unsupportedProtocol: .orange
        case .tokenRejected, .userMismatch, .unreachable, .serverError: .red
        }
    }
}

/// The fresh-vs-keep prompt raised when Save & Apply (from the Database screen,
/// Settings, the User page or the Sync tab's Apply bar) would point the sync at a different server or
/// user ID than the stored anchors and watermarks were earned against.
/// Attached at the root so it appears whichever tab the apply came from.
struct ServerChangePrompt: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        content.alert(
            model.pendingServerChange?.serverChanged == false
                ? "Sync as a different user?" : "Sync to a different database?",
            isPresented: Binding(
                get: { model.pendingServerChange != nil },
                // An alert only closes through its buttons, and each of them
                // clears the pending change itself; the binding's own
                // dismissal must not race ahead and cancel the choice.
                set: { _ in }
            )
        ) {
            Button("Add and Switch") { model.confirmServerChange() }
            Button("Cancel", role: .cancel) { model.cancelServerChange() }
        } message: {
            Text(Self.message(for: model.pendingServerChange))
        }
    }

    static func message(for change: ServerIdentityChange?) -> String {
        guard let change else { return "" }
        let what = change.serverChanged && change.userChanged
            ? "The database and user ID changed"
            : change.serverChanged ? "The database changed" : "The user ID changed"
        let target = change.userChanged && !change.serverChanged
            ? "your database treats a new user ID as a different person, so nothing synced so far counts for it"
            : "your sync progress belongs to the previous database"
        return """
        \(what) (\(change.summary)) — \(target).

        This destination starts its own sync history from your start date. \
        Your previous database stays saved with its own progress, and receives \
        no further uploads after the switch succeeds.
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
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var account = UserAccount()
    @State private var signingIn = false
    @State private var currentPassword = ""
    @State private var userIDText = ""
    @State private var userIDLoaded = false

    init(account: UserAccount = UserAccount()) {
        _account = State(initialValue: account)
    }

    private var signedIn: Bool { account.hasSession }
    private var userIDValid: Bool { signedIn || AppModel.normalizedUserID(userIDText) != nil }
    private var name: Binding<String> {
        Binding(get: { signedIn ? account.profile?.name ?? "" : model.config.userName ?? "" }, set: {
            if signedIn { account.profile?.name = $0.isEmpty ? nil : $0 }
            else { model.config.userName = $0.isEmpty ? nil : $0 }
        })
    }
    private var email: Binding<String> {
        Binding(get: { signedIn ? account.profile?.email ?? "" : model.config.userEmail ?? "" }, set: {
            if signedIn { account.profile?.email = $0 }
            else { model.config.userEmail = $0.isEmpty ? nil : $0 }
        })
    }
    private var dateOfBirth: Binding<Date?> {
        Binding(get: { signedIn ? account.profile?.dateOfBirth : model.config.userDateOfBirth }, set: {
            if signedIn { account.profile?.dateOfBirth = $0 }
            else { model.config.userDateOfBirth = $0 }
        })
    }
    private var biologicalSex: Binding<String?> {
        Binding(get: { signedIn ? account.profile?.biologicalSex : model.config.userBiologicalSex }, set: {
            if signedIn { account.profile?.biologicalSex = $0 }
            else { model.config.userBiologicalSex = $0 }
        })
    }

    var body: some View {
        Form {
            Section {
                if signedIn {
                    Label("Signed in to PulsHealth", systemImage: "person.crop.circle.badge.checkmark")
                    if let email = account.savedProfile?.email { Text(email).foregroundStyle(.secondary) }
                    Button("Sign Out", role: .destructive) {
                        currentPassword = ""
                        Task { await account.signOut() }
                    }
                    if account.profile == nil {
                        Button("Reload Account") { Task { await account.restore() } }
                    }
                } else {
                    Button("Sign In to PulsHealth") { signIn() }
                }
                if account.busy || signingIn { ProgressView() }
                if let problem = account.problem {
                    Text(problem).font(.caption).foregroundStyle(.red)
                }
            } header: { Text("PulsHealth Account") } footer: {
                Text(signedIn
                    ? "Changes here are saved to your PulsHealth account. Signing in does not turn on Health data sync."
                    : "Sign-in is optional. You can use PulsHealth and enter your details below without an account.")
            }
            .disabled(account.busy || signingIn)

            Section {
                TextField("Name", text: name).textContentType(.name)
                TextField("Email", text: email)
                    .textContentType(.emailAddress).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                if signedIn, account.profile?.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != account.savedProfile?.email {
                    SecureField("Current password", text: $currentPassword).textContentType(.password)
                    Text("Enter your current password to change your sign-in email.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } header: { Text("Identity") } footer: {
                if !signedIn { Text("Name and email are optional.") }
            }
            .disabled(account.busy || (signedIn && account.profile == nil))

            Section {
                if let dob = dateOfBirth.wrappedValue {
                    DatePicker("Date of birth", selection: Binding(
                        get: { dateOfBirth.wrappedValue ?? dob },
                        set: { dateOfBirth.wrappedValue = $0 }
                    ), in: ...Date(), displayedComponents: .date)
                    .environment(\.timeZone, signedIn ? TimeZone(secondsFromGMT: 0)! : .current)
                    Button("Clear date of birth", role: .destructive) { dateOfBirth.wrappedValue = nil }
                } else {
                    LabeledContent("Date of birth") {
                        Button("Set") {
                            var calendar = Calendar(identifier: .gregorian)
                            calendar.timeZone = signedIn ? TimeZone(secondsFromGMT: 0)! : .current
                            dateOfBirth.wrappedValue = calendar.startOfDay(for: calendar.date(byAdding: .year, value: -30, to: Date()) ?? Date())
                        }
                    }
                }
                Picker("Biological sex", selection: biologicalSex) {
                    Text("Not set").tag(String?.none)
                    Text("Female").tag(String?.some("female"))
                    Text("Male").tag(String?.some("male"))
                    Text("Other").tag(String?.some("other"))
                }
            } header: { Text("Characteristics") } footer: {
                Text("These details are optional. You can leave them blank.")
            }
            .disabled(account.busy || (signedIn && account.profile == nil))

            Section("Advanced") {
                if signedIn {
                    if let userID = account.profile?.userID {
                        LabeledContent("User ID") { Text(userID).font(.footnote.monospaced()).textSelection(.enabled) }
                    }
                } else {
                    TextField("User ID (UUID)", text: $userIDText)
                        .font(.footnote.monospaced()).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: userIDText) { _, text in
                            if let normalized = AppModel.normalizedUserID(text) { model.config.userID = normalized }
                        }
                    if !userIDValid { Text("Not a valid UUID.").font(.caption).foregroundStyle(.red) }
                    Button("Generate New ID") { userIDText = UUID().uuidString.lowercased() }
                }
            }
            .disabled(account.busy)

            Section {
                Button(signedIn ? "Save to Account" : "Save & Apply") {
                    Task {
                        if signedIn {
                            guard await account.save(currentPassword: currentPassword) else { return }
                            currentPassword = ""
                            // Keep this account's active sync profile consistent with the edit.
                            // A different database or user retains its separate local identity.
                            if let profile = account.savedProfile, model.appliedConfig.userID == profile.userID,
                               model.usesPulsHealthDatabase {
                                guard await model.updateAppliedAccountProfile(profile) else {
                                    account.problem = "Your account was saved. Wait for the current sync to finish, then save again to update this iPhone’s sync profile."
                                    return
                                }
                            }
                            dismiss()
                        } else if await model.applyConfiguration() { dismiss() }
                    }
                }
                .disabled(!userIDValid || account.busy || signingIn || (signedIn && account.profile == nil))
            }
        }
        .navigationTitle("User").navigationBarTitleDisplayMode(.inline)
        .task {
            guard !userIDLoaded else { return }
            userIDLoaded = true
            userIDText = model.config.userID
            await account.restore()
        }
    }

    private func signIn() {
        guard !signingIn else { return }
        signingIn = true
        account.problem = nil
        let attempt = UserAccount.SignIn()
        Task {
            defer { signingIn = false }
            do {
                let callback = try await webAuthenticationSession.authenticate(
                    using: attempt.url, callbackURLScheme: PulsHealthDatabase.callbackScheme,
                    preferredBrowserSession: .shared)
                await account.finishSignIn(callback, attempt: attempt)
            } catch {
                if case .cancelled = PulsHealthDatabase.outcome(ofError: error) { return }
                account.problem = "Sign-in did not finish. Try again."
            }
        }
    }
}
