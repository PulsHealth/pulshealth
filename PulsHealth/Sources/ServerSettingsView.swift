import AuthenticationServices
import SwiftUI
import PulsHealthSync

/// Where Sync → Database sends the data: the two choices at the top of the
/// screen.
enum DatabaseDestination: Hashable {
    /// The developer's hosted database, paired by signing in
    /// (`PulsHealthDatabase`).
    case pulsHealth
    /// One the person runs, paired with its code or typed in.
    case own
}

/// Sync → Database. Two choices: the PulsHealth database, which needs an
/// account and is paired by signing in, and your own database, paired with
/// the code its setup prints (scanned, pasted, or accepted as a `puls://`
/// link) or typed in by hand.
///
/// Either way the values are held in a `ServerFieldsDraft` — including the
/// user ID a pairing code brings with it — and tested, and nothing reaches the
/// configuration until Save & Apply (which still raises the server/user-change
/// prompt if the target moved).
struct ServerSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    /// A caller that wants the scanner already up on arrival (a pairing
    /// route can); the Sync tab's Set Up opens the form itself.
    let scanOnArrival: Bool

    /// The choice at the top. Nil until one is made on an install with no
    /// database: the screen asks rather than picking for the person.
    @State private var destination: DatabaseDestination?
    /// Your own database's fields.
    @State private var server = ServerFieldsDraft()
    /// The pairing code the PulsHealth sign-in sheet handed back this visit,
    /// waiting for Save & Apply.
    @State private var signedIn: ServerFieldsDraft?
    @State private var signingIn = false
    /// Why the last sign-in did not produce a pairing code.
    @State private var signInProblem: String?
    @State private var confirmDisconnect = false
    @State private var loaded = false
    @State private var testingConnection = false
    /// Outcome of the last Test Connection for the values currently entered;
    /// cleared whenever they change.
    @State private var connectionTest: ConnectionTestResult?
    @State private var connectionTestRun = 0
    @State private var showScanner = false

    var body: some View {
        Form {
            destinationSection
            switch destination {
            case .pulsHealth: pulsHealthSections
            case .own: ownDatabaseSections
            case nil: EmptyView()
            }
        }
        .navigationTitle("Database")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if !loaded {
                loaded = true
                load()
            }
            // This screen is built lazily: an accepted pairing link can be
            // what brings it on screen for the first time, already waiting.
            collectConfirmedPairing()
        }
        .onChange(of: model.pairingAwaitsSyncTab) { collectConfirmedPairing() }
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
        .confirmationDialog(
            "Disconnect from the PulsHealth database?",
            isPresented: $confirmDisconnect,
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                Task { await disconnect() }
            }
        } message: {
            Text("Syncing stops. What was already sent stays in the PulsHealth database until you delete your account.")
        }
    }

    // MARK: - The choice

    private var destinationSection: some View {
        Section {
            destinationRow(
                .pulsHealth, title: "PulsHealth Database",
                detail: "Hosted by the developer. Needs an account.",
                symbol: "person.crop.circle")
            destinationRow(
                .own, title: "Your Own Database",
                detail: "One you run, connected with its pairing code.",
                symbol: "externaldrive.connected.to.line.below")
        } header: {
            Text("Sync To")
        } footer: {
            if destination == nil {
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
                if destination == choice {
                    Image(systemName: "checkmark")
                        .fontWeight(.semibold)
                        .foregroundStyle(.tint)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(destination == choice ? .isSelected : [])
    }

    // MARK: - PulsHealth database

    @ViewBuilder private var pulsHealthSections: some View {
        if let signedIn {
            // The sheet has handed back this iPhone's pairing code. The one
            // step left goes first, so it cannot be missed.
            Section {
                Label {
                    Text("Your PulsHealth account sent this iPhone its pairing code. Tap Save & Apply to start syncing to the PulsHealth database.")
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                if testingConnection {
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
                Text("Nothing is sent until you tap Save & Apply.")
            }
        } else if model.usesPulsHealthDatabase {
            Section {
                Label {
                    Text("Syncing to the PulsHealth database")
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                Link(destination: PulsHealthDatabase.accountURL) {
                    Label("Manage Account", systemImage: "person.crop.circle")
                }
            } footer: {
                Text("Your account page lists the iPhones connected to your account, and is where you change your password.")
            }
            Section {
                Button("Disconnect", role: .destructive) { confirmDisconnect = true }
            } footer: {
                Text("Syncing stops. What was already sent stays in the PulsHealth database until you delete your account.")
            }
        } else {
            Section {
                Text("The PulsHealth database is run by the app’s developer, who can access what is stored in it and uses it only to show it back to you. Accounts are by request: ask for access, and once the developer approves it you get an email to choose a password.")
                    .fixedSize(horizontal: false, vertical: true)
                Link(destination: PulsHealthDatabase.privacyURL) {
                    Label("What the Developer Holds", systemImage: "hand.raised")
                }
            } header: {
                Text("About the PulsHealth Database")
            }
            Section {
                Button {
                    signIn()
                } label: {
                    HStack {
                        Label("Sign In to PulsHealth", systemImage: "person.crop.circle.badge.checkmark")
                        if signingIn {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(signingIn)
                Link(destination: PulsHealthDatabase.requestAccessURL) {
                    Label("Request Access", systemImage: "envelope")
                }
                if let signInProblem {
                    Label(signInProblem, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            } footer: {
                Text("Sign in, tap Connect this iPhone, then Open in PulsHealth. Request Access opens the form in Safari.")
            }
        }
        // App Review 5.1.1(v): an app that leads people to an account lets
        // them start deleting it. Shown whether or not this iPhone is
        // connected — an account can exist without one.
        Section {
            Link(destination: PulsHealthDatabase.accountURL) {
                Label("Delete PulsHealth Account", systemImage: "person.crop.circle.badge.xmark")
            }
            .tint(.red)
        } footer: {
            Text("Opens your account page in Safari. Its Delete my account signs you out, disconnects your iPhones and asks the developer to delete everything stored for you.")
        }
    }

    // MARK: - Your own database

    @ViewBuilder private var ownDatabaseSections: some View {
        Section {
            Button {
                showScanner = true
            } label: {
                Label("Scan Pairing Code", systemImage: "qrcode.viewfinder")
            }
            PastePairingCodeRow(urlText: server.urlText) { applyPairing($0) }
        } footer: {
            Text("A pairing code, scanned, pasted, or opened as a puls:// link, fills in the URL, token and user ID your database's setup prints (`make pairing`) and tests them.")
        }

        Section {
            // Verbatim prompts: as a string literal the URL became a
            // localized key, and Text styled it as a tappable link.
            LabeledContent("Database URL") {
                TextField("Database URL", text: $server.urlText, prompt: Text(verbatim: "https://your-host:8443"))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            if let issue = server.urlIssue {
                Label(issue, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            LabeledContent("Token") {
                SecureField("Token", text: $server.tokenText, prompt: Text(verbatim: "Bearer token"))
            }
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
            if let pairedUserID = server.pairedUserID {
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

        applySection(disabled: server.urlIssue != nil) {
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
            if let result = connectionTest {
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

    /// Starts from what is applied: the PulsHealth database, your own, or —
    /// with neither — no choice yet. Your own database's fields never start
    /// with the PulsHealth database's URL and token in them.
    private func load() {
        if model.appliedConfig.isSignedInDatabase {
            destination = .pulsHealth
        } else if model.appliedConfig.serverURL != nil || scanOnArrival {
            destination = .own
        }
        if !model.config.isSignedInDatabase {
            server = ServerFieldsDraft(configuration: model.config)
        }
        showScanner = scanOnArrival
    }

    private func choose(_ choice: DatabaseDestination) {
        guard destination != choice else { return }
        destination = choice
        // A result shown for the other choice's values says nothing here.
        connectionTestRun += 1
        connectionTest = nil
        testingConnection = false
    }

    /// The one place a pairing code lands for your own database, whatever
    /// brought it: the scanner, the Paste button, a `puls://pair?…` string put
    /// in the URL field, or a link the user accepted (`collectConfirmedPairing`).
    /// It fills the three values and tests them. It never applies anything —
    /// Save & Apply does, and that still runs the server/user-change prompt if
    /// the target moved.
    private func applyPairing(_ payload: PairingPayload) {
        choose(.own)
        server.fill(from: payload)
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

    /// Sign In to PulsHealth: the account page in iOS's web authentication
    /// sheet. The person signs in (or asks for access from the sign-in
    /// page), taps Connect this iPhone, then Open in PulsHealth, whose
    /// `puls://pair?…` link the sheet hands back here.
    ///
    /// The shared browser session, not an ephemeral one, so a sign-in done in
    /// Safari — where the invite to choose a password opens — carries over,
    /// and iOS says which site the app wants to use before the sheet opens.
    /// What comes back is treated like an accepted link: it fills a draft and
    /// is tested, and only Save & Apply applies it. No confirmation alert
    /// first: the person started this from here, and the sheet only returns a
    /// link that page sent.
    private func signIn() {
        guard !signingIn else { return }
        signingIn = true
        signInProblem = nil
        Task {
            let outcome: PulsHealthDatabase.SignInOutcome
            do {
                let callback = try await webAuthenticationSession.authenticate(
                    using: PulsHealthDatabase.accountURL,
                    callbackURLScheme: PulsHealthDatabase.callbackScheme,
                    preferredBrowserSession: .shared)
                outcome = PulsHealthDatabase.outcome(ofCallback: callback)
            } catch {
                outcome = PulsHealthDatabase.outcome(ofError: error)
            }
            signingIn = false
            switch outcome {
            case .paired(let payload):
                var draft = ServerFieldsDraft()
                draft.fill(fromSignIn: payload)
                signedIn = draft
                model.noteSignInPairing(payload)
                runConnectionTest()
            case .cancelled:
                break
            case .failed(let message):
                signInProblem = message
            }
        }
    }

    /// Runs the connection test against the values the current choice would
    /// apply — never the saved ones — and persists nothing; only the result
    /// row changes.
    private func runConnectionTest() {
        let draft = destination == .pulsHealth ? signedIn : server
        guard let draft, let url = draft.validatedURL else { return }
        let token = draft.token
        guard !token.isEmpty else { return }
        let userID = draft.connectionTestUserID(fallback: model.config.userID)
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

    private func apply() async {
        switch destination {
        case .pulsHealth:
            guard var draft = signedIn else { return }
            draft.commit(to: &model.config)
            // As below: the paired user ID is in the draft now.
            draft.markCommitted()
            signedIn = draft
        case .own:
            // Save & Apply is disabled while the URL is invalid; an empty
            // field clears the server.
            server.commit(to: &model.config)
            // The paired user ID is in the draft now, whichever way the
            // server-change prompt goes; holding on to it would overwrite a
            // later edit on the User page.
            server.markCommitted()
        case nil:
            return
        }
        // Applied: back to the Sync tab, which now shows the server's status.
        // Deferred to the server-change prompt instead: stay, so the fields
        // are still here to adjust if the user cancels it.
        if await model.applyConfiguration() {
            dismiss()
        }
    }

    /// Disconnect from the PulsHealth database: the same path as emptying
    /// your own database's URL — no database, no token, so syncing stops and
    /// the Export tab keeps working. The account and what it holds are the
    /// account page's to delete.
    private func disconnect() async {
        ServerFieldsDraft().commit(to: &model.config)
        if await model.applyConfiguration() {
            dismiss()
        }
    }
}
