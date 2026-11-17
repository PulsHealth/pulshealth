import AuthenticationServices
import SwiftUI
import PulsHealthSync

/// Connections → Database. Two choices: the PulsHealth database, which needs an
/// account and is paired by signing in, and your own database, paired with
/// the code its setup prints (scanned, pasted, or accepted as a `puls://`
/// link) or typed in by hand.
///
/// Either way the values are held in a `ServerFieldsDraft` — including the
/// user ID a pairing code brings with it — and tested, and nothing reaches the
/// configuration until Add Database stages a new destination on the main Sync
/// screen, or Save & Apply updates an existing one. The main screen's Apply
/// starts the first sync and still confirms a server/user change when needed.
/// `DatabaseSetup` decides which fields to stage and whether review is needed.
struct ServerSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    /// A caller that wants the scanner already up on arrival (a pairing
    /// route can); the Connections tab's Set Up opens the form itself.
    let scanOnArrival: Bool
    /// The choice made on the Connections tab's first-time screen, if that is what
    /// opened this one (`DatabaseSetup.init(applied:scanOnArrival:preferred:)`).
    var preferred: DatabaseDestination? = nil

    @State private var setup = DatabaseSetup(applied: SyncConfiguration())
    /// The page the web authentication sheet was opened on, while it is up.
    @State private var sheetOpenOn: URL?
    /// Why the last sheet did not produce a pairing code.
    @State private var signInProblem: String?
    /// The host of a code the sign-in sheet handed back for a database outside
    /// the viewer's domain, now filled in under your own database instead.
    @State private var signInElsewhere: String?
    @State private var loaded = false
    @State private var showSignupNotice = false
    /// Outcome of the last Test Connection for the values currently entered;
    /// cleared whenever they change.
    @State private var connectionTest = DatabaseConnectionTest()
    @State private var showScanner = false

    private var needsInitialSyncReview: Bool {
        setup.needsInitialSyncReview(applied: model.appliedConfig, draft: model.config, saved: model.savedDestinations)
    }

    private var applyTitle: String { needsInitialSyncReview ? "Continue" : "Save changes" }

    var body: some View {
        @Bindable var model = model
        Form {
            if let message = model.lastErrorMessage {
                Section {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
            if setup.destination == nil { destinationSection }
            switch setup.destination {
            case .pulsHealth: pulsHealthSections
            case .own: ownDatabaseSections
            case nil: EmptyView()
            }
        }
        .task(id: setup.destination) {
            guard setup.destination == .pulsHealth, setup.signedIn == nil,
                  !model.usesPulsHealthDatabase else { return }
            guard sheetOpenOn == nil else { return }
            openSheet(on: PulsHealthDatabase.connectURL)
        }
        .disabled(model.isUpdatingConnection)
        .navigationTitle(preferred != nil || needsInitialSyncReview ? "Connect database" : "Connection details")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if !loaded {
                loaded = true
                setup = DatabaseSetup(applied: preferred != nil ? SyncConfiguration() : model.isSettingUpInitialSync ? model.config : model.appliedConfig, scanOnArrival: scanOnArrival, preferred: preferred, isStaged: model.isSettingUpInitialSync)
                showScanner = scanOnArrival
            }
            // This screen is built lazily: an accepted pairing link can be
            // what brings it on screen for the first time, already waiting.
            collectConfirmedPairing()
        }
        .onChange(of: model.pairingAwaitsSyncTab) { collectConfirmedPairing() }
        // A sign-in's code stops asking for Save & Apply once it is applied,
        // here or through the server-change prompt this screen raised.
        .onChange(of: model.appliedConfig) { _, applied in setup.settle(applied: applied) }
        .onChange(of: setup.own.urlText) {
            // A whole `puls://pair?…` string pasted into the URL field is a
            // pairing code, not a malformed URL.
            if let payload = setup.own.pairingCodeInURLField {
                applyPairing(payload)
            } else {
                connectionTest.invalidate(for: setup.fieldsForChoice)
            }
        }
        .onChange(of: setup.own.tokenText) { connectionTest.invalidate(for: setup.fieldsForChoice) }
        // The confirmation for an incoming link is an alert on RootView, and
        // it cannot come up over this sheet.
        .onChange(of: model.pairingLinkPrompt) { _, prompt in
            if prompt != nil { showScanner = false }
        }
        .alert("Currently Full", isPresented: $showSignupNotice) {
            Button("Create Account & Join Waitlist") { openSheet(on: PulsHealthDatabase.signUpURL) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("PulsHealth hosting is currently full. Create an account request to join the waitlist. We’ll email you when a spot is available so you can finish setting up your account.")
        }
        .sheet(isPresented: $showScanner) {
            PairingScannerView { applyPairing($0) }
        }
    }

    // MARK: - The choice

    private var destinationSection: some View {
        Section {
            destinationRow(
                .own, title: "Your database",
                detail: "Connect a server you run and control.",
                symbol: "externaldrive.connected.to.line.below")
            destinationRow(
                .pulsHealth, title: "PulsHealth database",
                detail: "Sign in and connect to your PulsHealth server.",
                symbol: "cloud")
        } header: {
            Text("Connect database")
        } footer: {
            if setup.destination == nil {
                Text("Choose where PulsHealth keeps a live copy of your Health data. You can change it later.")
            }
        }
    }

    /// A row of the choice, in the style of a Settings list: a checkmark on
    /// the chosen one.
    private func destinationRow(
        _ choice: DatabaseDestination, title: String, detail: String, symbol: String
    ) -> some View {
        Button {
            choose(choice)
        } label: {
            HStack {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .foregroundStyle(.primary)
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: symbol)
                }
                Spacer()
                if isSelected(choice) {
                    Image(systemName: "checkmark")
                        .fontWeight(.semibold)
                        .foregroundStyle(.tint)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected(choice) ? .isSelected : [])
    }

    private func isSelected(_ choice: DatabaseDestination) -> Bool {
        setup.destination == choice
    }

    // MARK: - PulsHealth database

    @ViewBuilder private var pulsHealthSections: some View {
        if let signedIn = setup.signedIn {
            // The sheet has handed back a pairing code. The one step left
            // goes first, so it cannot be missed, with where it leads.
            Section {
                Label {
                    Text("Your PulsHealth account sent this iPhone its pairing code. Tap \(applyTitle) to continue.")
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                if let label = setup.signedInDatabaseLabel {
                    LabeledContent("Database", value: label)
                }
                if connectionTest.running {
                    HStack {
                        Text("Testing Connection…")
                        Spacer()
                        ProgressView()
                    }
                    .foregroundStyle(.secondary)
                }
            } header: {
                Text("Signed In")
            }
            applySection(disabled: signedIn.validatedURL == nil) {
                Text("No Health data is uploaded until you apply your selection. Testing the connection only asks the database what it supports.")
            }
        } else if model.usesPulsHealthDatabase {
            Section {
                Label {
                    Text("Connected to the PulsHealth database")
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                // Always with its address: the label says whose database it
                // is, and the host says where the data actually goes.
                if let label = DatabaseSetup.databaseLabel(model.appliedConfig.serverURL) {
                    LabeledContent("Database", value: label)
                }
                Link(destination: PulsHealthDatabase.accountURL) {
                    Label("Manage Account", systemImage: "person.crop.circle")
                }
            }

        } else {
            Section {
                Button {
                    openSheet(on: PulsHealthDatabase.connectURL)
                } label: {
                    Label("Connect PulsHealth Server", systemImage: "person.crop.circle")
                }
                .disabled(sheetOpenOn != nil)
                Button { showSignupNotice = true } label: {
                    Label("Create Account", systemImage: "person.crop.circle.badge.plus")
                }
                .disabled(sheetOpenOn != nil)
                if sheetOpenOn != nil { ProgressView("Connecting your account…") }
                if let signInProblem {
                    Text(signInProblem).font(.caption).foregroundStyle(.red)
                }
            } footer: {
                Text("Sign in and tap Connect this iPhone in the browser. Then add the database and review your selection on the Connections tab.")
            }
        }
    }

    // MARK: - Your own database

    @ViewBuilder private var ownDatabaseSections: some View {
        if let signInElsewhere {
            Section {
                Label {
                    Text("The page you signed in to sent a pairing code for \(signInElsewhere), which is not the PulsHealth database. It is filled in below as your own database. Tap Save & Apply only if you trust that database.")
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }
        }
        Section {
            Button {
                showScanner = true
            } label: {
                Label("Scan Pairing Code", systemImage: "qrcode.viewfinder")
            }
            PastePairingCodeRow(urlText: setup.own.urlText) { applyPairing($0) }
        }

        Section {
            // Verbatim prompts: as a string literal the URL became a
            // localized key, and Text styled it as a tappable link.
            LabeledContent("Database URL") {
                TextField("Database URL", text: $setup.own.urlText, prompt: Text(verbatim: "https://your-host:8443"))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            if let issue = setup.own.urlIssue {
                Label(issue, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            LabeledContent("Token") {
                SecureField("Token", text: $setup.own.tokenText, prompt: Text(verbatim: "Bearer token"))
            }
            Button {
                runConnectionTest()
            } label: {
                HStack {
                    Text(connectionTest.running ? "Testing Connection…" : "Test Connection")
                    if connectionTest.running {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(connectionTest.running || !setup.own.isTestable)
            if let pairedUserID = setup.own.pairedUserID {
                // The third value of a pairing code has no field on this
                // screen (it lives under Settings → User → Advanced), so
                // say that it is staged too rather than changing it out
                // of sight.
                Label {
                    Text("Filled in from a pairing code, with user ID \(pairedUserID). Nothing changes until you apply your selection.")
                } icon: {
                    Image(systemName: "qrcode")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        } header: {
            Text("Connection details")
        } footer: {
            Text("Use the address and token provided by your server.")
        }

        applySection(disabled: setup.own.urlIssue != nil) {
            if needsInitialSyncReview {
                Text("Choose your data and history next. Nothing is uploaded until you apply.")
            }
        }
    }

    // MARK: - Save & Apply

    /// The outcome of the last test, right above the button that commits the
    /// values it was run against.
    private func applySection<Footer: View>(
        disabled: Bool, @ViewBuilder footer: () -> Footer
    ) -> some View {
        Section {
            if let result = connectionTest.result {
                ConnectionTestResultRow(result: result)
            }
            Button {
                if needsInitialSyncReview {
                    guard setup.commit(to: &model.config) else { return }
                    model.isSettingUpInitialSync = true
                    model.initialSyncReviewRequested = UUID()
                } else {
                    Task { await apply() }
                }
            } label: {
                Text(applyTitle)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(disabled || (needsInitialSyncReview && setup.fieldsForChoice?.isTestable != true))
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .listRowSeparator(.hidden)
        } footer: {
            footer()
        }
    }

    // MARK: - Actions

    private func choose(_ choice: DatabaseDestination) {
        guard setup.choose(choice) else { return }
        // A result shown for the other choice's values says nothing here.
        connectionTest.cancel()
    }

    /// The one place a pairing code lands for your own database, whatever
    /// brought it: the scanner, the Paste button, a `puls://pair?…` string put
    /// in the URL field, or a link the user accepted (`collectConfirmedPairing`).
    /// It fills the three values and tests them. It never applies anything —
    /// Save & Apply does, and that still runs the server/user-change prompt if
    /// the target moved.
    private func applyPairing(_ payload: PairingPayload) {
        choose(.own)
        signInElsewhere = nil
        setup.receivePairing(payload)
        // The code was printed by the server it describes; find out now
        // whether the phone can reach it rather than after Save & Apply.
        runConnectionTest()
    }

    /// Takes a pairing link the user accepted (`AppModel.confirmPairingLink`).
    /// Not while the first-run flow is up: it has no database step, so the
    /// payload waits until the flow ends and RootView opens this screen.
    private func collectConfirmedPairing() {
        guard model.pairingAwaitsSyncTab, let payload = model.takeConfirmedPairing() else { return }
        applyPairing(payload)
    }

    /// Sign In to PulsHealth, or Create Account: one of the viewer's pages in
    /// iOS's web authentication sheet. On the connection page the person signs
    /// in and taps Connect this iPhone, whose
    /// `puls://pair?…` link the sheet hands back here; on the sign-up page
    /// they create an account and close the sheet.
    ///
    /// The shared browser session, not an ephemeral one, so a sign-in done in
    /// Safari — where the invite to choose a password opens — carries over,
    /// and iOS says which site the app wants to use before the sheet opens.
    /// What comes back is treated like an accepted link: it fills a draft and
    /// is tested, and only Save & Apply applies it. No confirmation alert
    /// first — the person started this from here — but the screen names the
    /// database the code points at.
    private func openSheet(on page: URL) {
        guard sheetOpenOn == nil else { return }
        sheetOpenOn = page
        signInProblem = nil
        signInElsewhere = nil
        Task {
            let outcome: PulsHealthDatabase.SignInOutcome
            do {
                let callback = try await webAuthenticationSession.authenticate(
                    using: page,
                    callbackURLScheme: PulsHealthDatabase.callbackScheme,
                    preferredBrowserSession: .shared)
                outcome = PulsHealthDatabase.outcome(ofCallback: callback)
            } catch {
                outcome = PulsHealthDatabase.outcome(ofError: error)
            }
            sheetOpenOn = nil
            switch outcome {
            case .paired(let payload) where PulsHealthDatabase.isUnderDomain(payload.serverURL):
                choose(.pulsHealth)
                setup.receiveSignIn(payload)
                model.noteSignInPairing(payload)
                runConnectionTest()
            case .paired(let payload):
                // Not under the viewer's domain: an ordinary pairing code for
                // your own database (`DatabaseSetup.receiveSignIn`), filled in
                // and tested, with a warning naming where it leads.
                applyPairing(payload)
                signInElsewhere = DatabaseSetup.databaseLabel(payload.serverURL)
                    ?? payload.serverURL.absoluteString
            case .cancelled:
                if page == PulsHealthDatabase.connectURL {
                    signInProblem = "This iPhone isn’t connected yet. Sign in and tap Connect this iPhone to return to PulsHealth."
                }
            case .failed(let message):
                signInProblem = message
            }
        }
    }

    /// Runs the connection test against the values the current choice would
    /// apply — never the saved ones — and persists nothing; only the result
    /// row changes. It asks the database for its capabilities with the token
    /// (falling back to a probe batch with no samples), and uploads no health
    /// data.
    private func runConnectionTest() {
        guard let draft = setup.fieldsForChoice, let url = draft.validatedURL else { return }
        let token = draft.token
        guard !token.isEmpty else { return }
        let userID = draft.connectionTestUserID(fallback: model.config.userID)
        // A pairing code can arrive while an earlier test is still out; only
        // the latest run may report, or the row could describe old values.
        let run = connectionTest.begin(for: draft)
        Task {
            let result = await model.testConnection(url: url, token: token, userID: userID)
            connectionTest.invalidate(for: setup.fieldsForChoice)
            connectionTest.finish(result, run: run)
        }
    }

    private func apply() async {
        // Save & Apply is disabled while the URL is invalid; an empty field
        // clears the server.
        guard setup.commit(to: &model.config) else { return }
        // Applied: back to the Connections tab, which now shows the server's status.
        // Deferred to the server-change prompt instead: stay, so the fields
        // are still here to adjust if the user cancels it (and if they
        // confirm it, `settle(applied:)` notices).
        if await model.applyDatabaseConfiguration() {
            setup.settle(applied: model.appliedConfig)
            dismiss()
        }
    }

}
