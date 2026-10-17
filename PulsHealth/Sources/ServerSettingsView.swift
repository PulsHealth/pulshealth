import AuthenticationServices
import SwiftUI
import PulsHealthSync

/// Sync → Database. Two choices: the PulsHealth database, which needs an
/// account and is paired by signing in, and your own database, paired with
/// the code its setup prints (scanned, pasted, or accepted as a `puls://`
/// link) or typed in by hand.
///
/// Either way the values are held in a `ServerFieldsDraft` — including the
/// user ID a pairing code brings with it — and tested, and nothing reaches the
/// configuration until Save & Apply (which still raises the server/user-change
/// prompt if the target moved). What the screen starts from and what Save &
/// Apply commits is `DatabaseSetup`'s to decide.
struct ServerSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    /// A caller that wants the scanner already up on arrival (a pairing
    /// route can); the Sync tab's Set Up opens the form itself.
    let scanOnArrival: Bool
    /// The choice made on the Sync tab's first-time screen, if that is what
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
    @State private var destinationToSwitch: SavedSyncDestination?
    @State private var destinationToUnpair: SavedSyncDestination?
    @State private var loaded = false
    @State private var account = UserAccount()
    @State private var signingIn = false
    @State private var showSignupNotice = false
    /// Outcome of the last Test Connection for the values currently entered;
    /// cleared whenever they change.
    @State private var connectionTest = DatabaseConnectionTest()
    @State private var showScanner = false

    private var hasVerifiedAccount: Bool { account.hasSession && account.savedProfile != nil }

    var body: some View {
        Form {
            savedDestinationsSection
            if let message = model.lastErrorMessage {
                Section {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
            destinationSection
            switch setup.destination {
            case .pulsHealth: pulsHealthSections
            case .own: ownDatabaseSections
            case nil: EmptyView()
            }
        }
        .task(id: setup.destination) {
            guard setup.destination == .pulsHealth, setup.signedIn == nil,
                  !model.usesPulsHealthDatabase else { return }
            await account.restore()
            guard !Task.isCancelled else { return }
            if !hasVerifiedAccount { signInToAccount() }
        }
        .disabled(model.isUpdatingConnection)
        .navigationTitle("Database")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if !loaded {
                loaded = true
                setup = DatabaseSetup(applied: model.appliedConfig, scanOnArrival: scanOnArrival, preferred: preferred)
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
        .confirmationDialog(
            "Switch active database?",
            isPresented: Binding(get: { destinationToSwitch != nil }, set: { if !$0 { destinationToSwitch = nil } }),
            titleVisibility: .visible,
            presenting: destinationToSwitch
        ) { destination in
            Button("Switch Database") {
                destinationToSwitch = nil
                Task {
                    if await model.switchDestination(id: destination.id) { resetSetup() }
                }
            }
        } message: { destination in
            Text("Sync to \(databaseAddress(destination)) as user \(destination.userID), resuming its saved progress. The previous database stops receiving uploads after the switch succeeds. Unapplied edits will be discarded.")
        }
        .confirmationDialog(
            "Unpair database?",
            isPresented: Binding(get: { destinationToUnpair != nil }, set: { if !$0 { destinationToUnpair = nil } }),
            titleVisibility: .visible,
            presenting: destinationToUnpair
        ) { destination in
            Button("Unpair", role: .destructive) {
                destinationToUnpair = nil
                Task {
                    let wasActive = model.activeDestinationID == destination.id
                    if await model.unpairDestination(id: destination.id), wasActive { resetSetup() }
                }
            }
        } message: { destination in
            Text("Remove \(databaseAddress(destination)), user \(destination.userID), and its saved credentials and sync progress from this iPhone. If active, syncing stops. Already uploaded data remains on the server. Pair again to reconnect.")
        }
    }

    @ViewBuilder private var savedDestinationsSection: some View {
        if !model.savedDestinations.isEmpty {
            Section {
                ForEach(model.savedDestinations) { destination in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Database")
                                .font(.headline)
                            Spacer()
                            if destination.id == model.activeDestinationID {
                                Label("Active", systemImage: "checkmark.circle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.green)
                            }
                        }
                        Text(databaseAddress(destination))
                            .textSelection(.enabled)
                        Text("User ID: \(destination.userID)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                        HStack {
                            if destination.id != model.activeDestinationID {
                                Button("Switch to This Database") { destinationToSwitch = destination }
                                    .buttonStyle(.borderless)
                            }
                            Spacer()
                            Button("Unpair", role: .destructive) { destinationToUnpair = destination }
                                .buttonStyle(.borderless)
                        }
                    }
                    .padding(.vertical, 4)
                }
                if model.isUpdatingConnection {
                    ProgressView("Updating connection…")
                }
            } header: {
                Text("Saved Databases")
            } footer: {
                Text("Only the active database receives synced Health data. Each database and user ID keeps its own sync progress.")
            }
        }
    }

    /// Keep the transport scheme visible without exposing URL credentials,
    /// queries or fragments (a pasted URL may contain secrets there).
    private func databaseAddress(_ destination: SavedSyncDestination) -> String {
        let scheme = destination.serverURL.scheme.map { "\($0)://" } ?? ""
        return scheme + destination.identity.serverLabel
    }

    private func resetSetup() {
        connectionTest.cancel()
        signInProblem = nil
        signInElsewhere = nil
        setup = DatabaseSetup(applied: model.appliedConfig)
    }

    // MARK: - The choice

    private var destinationSection: some View {
        Section {
            destinationRow(
                .own, title: "Your Own Server",
                detail: "Connect a server you run and control.",
                symbol: "externaldrive.connected.to.line.below")
            destinationRow(
                .pulsHealth, title: "PulsHealth Managed Server",
                detail: "Sign in and connect to your PulsHealth server.",
                symbol: "cloud")
        } header: {
            Text(model.savedDestinations.isEmpty ? "Sync To" : "Add or Edit a Database")
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
                    Text("Your PulsHealth account sent this iPhone its pairing code. Tap Save & Apply to start syncing to the PulsHealth database.")
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
                Text("No Health data is uploaded until you tap Save & Apply. Until then PulsHealth has only tested the connection, asking the database what it supports.")
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
            } footer: {
                Text("Your account page lists the iPhones connected to your account, and is where you change your password.")
            }
            Section {
                // Opens in Safari, like the other links: a page of the
                // documentation, not a request the app makes.
                Link(destination: PulsHealthDatabase.aiAssistantsURL) {
                    Label("Connect an AI Assistant", systemImage: "sparkles")
                }
            } footer: {
                Text("Sign in from Claude or another assistant and ask it about your Health data.")
            }

        } else {
            Section {
                if hasVerifiedAccount {
                    if let email = account.savedProfile?.email {
                        Label("Signed in as \(email)", systemImage: "person.crop.circle.badge.checkmark")
                            .foregroundStyle(.secondary)
                    }
                    Text("This iPhone isn’t connected yet. Connect your server, then tap Save & Apply to start syncing.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Connect PulsHealth Server") { Task { await prepareManagedServer() } }
                        .disabled(account.busy || signingIn)
                    if account.problem != nil {
                        Button("Sign In Again", action: signInToAccount)
                            .disabled(account.busy || signingIn)
                    }
                } else {
                    Button(action: signInToAccount) {
                        Label("Sign In to PulsHealth", systemImage: "person.crop.circle")
                    }
                    .disabled(signingIn || account.busy)
                }
                if !hasVerifiedAccount {
                    Button { showSignupNotice = true } label: {
                        Label("Create Account", systemImage: "person.crop.circle.badge.plus")
                    }
                    .disabled(signingIn || account.busy || sheetOpenOn != nil)
                }
                if signingIn || account.busy { ProgressView("Connecting your account…") }
                if let problem = account.problem ?? signInProblem {
                    Text(problem).font(.caption).foregroundStyle(.red)
                }
            }

        }
    }

    private func prepareManagedServer() async {
        signInProblem = nil
        guard let payload = await account.connectManagedServer(), setup.destination == .pulsHealth else { return }
        setup.receiveSignIn(payload)
        model.noteSignInPairing(payload)
        runConnectionTest()
    }

    private func signInToAccount() {
        guard !signingIn, !account.busy else { return }
        signingIn = true
        account.problem = nil
        let attempt = UserAccount.SignIn()
        Task {
            defer { signingIn = false }
            do {
                let callback = try await webAuthenticationSession.authenticate(
                    using: attempt.url, callbackURLScheme: PulsHealthDatabase.callbackScheme,
                    preferredBrowserSession: .shared)
                if await account.finishSignIn(callback, attempt: attempt), setup.destination == .pulsHealth {
                    await prepareManagedServer()
                }
            } catch {
                if case .cancelled = PulsHealthDatabase.outcome(ofError: error) { return }
                account.problem = "Sign-in did not finish. Try again."
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
        } footer: {
            Text("A pairing code, scanned, pasted, or opened as a puls:// link, fills in the URL, token and user ID your database's setup prints (`make pairing`) and tests them.")
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
                    Text("Filled in from a pairing code, with user ID \(pairedUserID). Nothing changes until you tap Save & Apply.")
                } icon: {
                    Image(systemName: "qrcode")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        } header: {
            Text("Or enter it by hand")
        } footer: {
            Text("Database URL is the address your database's pairing code shows. Use https://; plain http:// is accepted only for hosts on your local network (localhost, *.local, 10.x, 172.16–31.x, 192.168.x). Test Connection uses the values entered above without saving them.")
        }

        applySection(disabled: setup.own.urlIssue != nil) {
            Text("An empty URL disconnects the database; syncing stops and the Export tab keeps working.")
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
                Task { await apply() }
            } label: {
                Text("Save & Apply")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(disabled)
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
        // Applied: back to the Sync tab, which now shows the server's status.
        // Deferred to the server-change prompt instead: stay, so the fields
        // are still here to adjust if the user cancels it (and if they
        // confirm it, `settle(applied:)` notices).
        if await model.applyDatabaseConfiguration() {
            setup.settle(applied: model.appliedConfig)
            dismiss()
        }
    }

}
