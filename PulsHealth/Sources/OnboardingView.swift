import SwiftUI
import PulsHealthSync

/// First-run flow. A fresh install has no server, no token and no data types,
/// so every tab is empty and nothing points at the one screen (Settings) that
/// would fix it. Five steps take the user from "what is this" to a running
/// backfill — or, for someone with no server, to a selection with Health access
/// that Settings → Export Data can write to files:
///
/// 1. what the app does and where the data goes,
/// 2. the server — from the pairing code (scanned, pasted, or opened as a
///    `puls://` link) or typed, then tested,
/// 3. Health access, requested for the preselected Common set,
/// 4. which types to sync (the real Data Types screen, not a copy),
/// 5. a summary and the button that applies everything.
///
/// Nothing reaches the engine until step 5 — `model.config` is the same staged
/// draft the Data Types tab edits, and `finishOnboarding()` is the same
/// Save & Apply path. Backing out at any point leaves the install exactly as it
/// was, and the flow reappears on the next launch until it is finished.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model

    enum Step: Int, CaseIterable, Comparable {
        case welcome, server, health, types, start

        static func < (a: Step, b: Step) -> Bool { a.rawValue < b.rawValue }

        var title: String {
            switch self {
            case .welcome: "Welcome"
            case .server: "Your Server"
            case .health: "Health Access"
            case .types: "Data Types"
            case .start: "Ready"
            }
        }
    }

    @State private var step: Step = .welcome

    // Server step. Held locally until the step is left, exactly like Settings:
    // the draft only changes when the user moves on — and that includes the
    // user ID a pairing code brought with it.
    @State private var server = ServerFieldsDraft()
    @State private var connectionTest: ConnectionTestResult?
    @State private var connectionTestRun = 0
    @State private var testing = false
    @State private var showScanner = false
    /// Set when the user chose to move past an untested or failing server.
    @State private var acceptedServerWarning = false

    @State private var requestingHealthAccess = false
    @State private var finishing = false

    var body: some View {
        NavigationStack {
            stepContent
                .navigationTitle(step.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if model.onboardingIsRerun {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { model.completeOnboarding() }
                        }
                    }
                }
        }
        // A pushed detail belongs to the step that pushed it. The Data Types
        // step is the real picker, so it can be two levels deep (category →
        // per-type config) when the footer's Back/Continue fires — and the
        // footer sits outside the stack, so without this the pushed screen
        // stayed on top of the next step's content. Re-identifying the stack
        // per step drops whatever it had pushed.
        .id(step)
        .safeAreaInset(edge: .bottom) { footer }
        .interactiveDismissDisabled()
        .onAppear {
            server = ServerFieldsDraft(configuration: model.config)
            // A link can be what launched the app, accepted before this view
            // was listening.
            collectConfirmedPairing()
        }
        .onChange(of: model.confirmedPairing) { collectConfirmedPairing() }
        .onChange(of: server.urlText) {
            // A whole `puls://pair?…` string pasted into the URL field is a
            // pairing code, not a malformed URL. Anything else is an edit, and
            // an edit means the result on screen is about other values — it
            // must not keep Continue lit.
            if let payload = server.pairingCodeInURLField {
                applyPairing(payload)
            } else {
                connectionTest = nil
            }
        }
        .onChange(of: server.tokenText) { connectionTest = nil }
        // This flow covers RootView, so the prompt for an incoming `puls://`
        // link has to come from here. It cannot present over the scanner sheet
        // (closed below when a link arrives) or the iOS Health sheet, and it
        // has no business interrupting the final Apply.
        .pairingLinkPrompt(canPresent: !showScanner && !requestingHealthAccess && !finishing)
        .onChange(of: model.pairingLinkPrompt) { _, prompt in
            if prompt != nil { showScanner = false }
        }
    }

    // MARK: - Steps

    @ViewBuilder private var stepContent: some View {
        switch step {
        case .welcome: welcomeStep
        case .server: serverStep
        case .health: healthStep
        case .types: TypePickerView()
        case .start: startStep
        }
    }

    private var welcomeStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // The app's own mark (Assets.xcassets/Logo, the SVG the site
                // uses, rendered as a template so it takes the tint), not a
                // stand-in SF Symbol.
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 8)
                Text("PulsHealth reads the health data on this iPhone and sends it to a server you run yourself.")
                    .font(.title3.weight(.semibold))
                Text("Nothing else receives it. There is no PulsHealth account, no analytics, and no third-party service in the path — the developer never receives your data.")
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 14) {
                    bullet(
                        "heart.text.square", "Read-only",
                        "PulsHealth only reads from Apple Health. It never writes or changes anything there.")
                    bullet(
                        "checklist", "You choose the data",
                        "Pick the types to sync — and change the selection whenever you like.")
                    bullet(
                        "externaldrive.connected.to.line.below", "A server, for continuous sync",
                        "A machine running the PulsHealth server (Docker, one command) receives new data as it arrives.")
                    // The server is optional, and the flow has to say so before
                    // the step that asks for one: someone without a server who
                    // reads "you need a server" closes the app.
                    bullet(
                        "square.and.arrow.up.on.square", "Or no server at all",
                        "Export the same data to CSV or JSONL files on this iPhone whenever you like, and add a server later if you want one.")
                }
                .padding(.top, 4)
            }
            .padding()
        }
    }

    private func bullet(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    private var serverStep: some View {
        Form {
            Section {
                Button {
                    showScanner = true
                } label: {
                    Label("Scan Pairing Code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                // The button's row is clear, so the hairline under it would
                // float between it and the paste row's card.
                .listRowSeparator(.hidden)
                PastePairingCodeRow(urlText: server.urlText) { applyPairing($0) }
            } footer: {
                Text("`scripts/bootstrap.sh` prints a QR code with the URL, token and user ID already in it, and the same code as a line of text starting with puls://pair. `make pairing` prints both again later.")
            }

            Section {
                TextField("https://your-host:8443", text: $server.urlText)
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
                        Text(testing ? "Testing Connection…" : "Test Connection")
                        if testing {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(testing || !server.isTestable)
                if let result = connectionTest {
                    ConnectionTestResultRow(result: result)
                }
            } header: {
                Text("Or enter it by hand")
            } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Use https://. Plain http:// is accepted only for hosts on your local network (localhost, *.local, 10.x, 172.16–31.x, 192.168.x).")
                    // The way past this step for someone with no server is a
                    // small button under Continue; say what it leads to.
                    if serverFieldsAreEmpty {
                        Text("No server? Tap “I'll Set This Up Later” below. You can still export your data to files under Settings → Export Data, and add a server any time.")
                    }
                }
            }

            if let pairedUserID = server.pairedUserID {
                Section("User ID") {
                    Text(pairedUserID)
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                    Text("From the pairing code. Everything stored for you on the server is tagged with this ID; you can change it later under Settings → User.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .sheet(isPresented: $showScanner) {
            PairingScannerView { applyPairing($0) }
        }
    }

    private var healthStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "heart.text.square")
                    .font(.system(size: 46))
                    .foregroundStyle(.pink)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 8)
                Text("Next, iOS will ask which health data PulsHealth may read.")
                    .font(.title3.weight(.semibold))
                Text("The sheet comes from iOS, not from this app, and it lists every type you are about to sync. PulsHealth asks for read access only — it can never write to or delete anything in Apple Health. You can change any of it later in Settings → Privacy & Security → Health.")
                    .foregroundStyle(.secondary)
                Text("A starter selection is already made for you; anything you add on the next step is requested when you finish.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let hint = model.authorizationHint {
                    Label(hint, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                if !model.needsAuthorization && model.authorizationRequested {
                    // Deliberately NOT "access granted": HealthKit never tells an
                    // app whether a read request was granted. Once the sheet has
                    // been shown, statusForAuthorizationRequest answers
                    // .unnecessary whether the user allowed everything or denied
                    // everything, so the only honest claim is that iOS was asked.
                    // Whether anything was actually granted shows up later, as
                    // samples arriving — or not (see AppModel.readsLookBlocked).
                    Label("iOS has been asked for the current selection.", systemImage: "checkmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
    }

    private var startStep: some View {
        Form {
            Section("Summary") {
                LabeledContent("Server") {
                    Text(serverSummary)
                        .foregroundStyle(server.validatedURL == nil ? .orange : .secondary)
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent("Data types", value: "\(model.config.enabledTypes.count) selected")
                // The sync's start date. With no server nothing syncs, and
                // Export Data takes its own time range — the row would only
                // suggest a limit that does not exist.
                if server.validatedURL != nil {
                    LabeledContent(
                        "History from",
                        value: model.config.startDate.formatted(date: .abbreviated, time: .omitted))
                }
                LabeledContent("User ID") {
                    Text(model.config.userID)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                Text(server.validatedURL == nil
                    ? "No server is set, so nothing will be uploaded. You can still export this data to CSV or JSONL files under Settings → Export Data, and add a server under Settings → Server any time."
                    : "Tapping Start uploads everything from the date above. The first pass is the largest — keep the app open and the phone on power for it. Progress is saved after every batch, so it is safe to interrupt.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            // Only true with somewhere to send to.
            if server.validatedURL != nil {
                Section {
                    Text("From here on, PulsHealth catches up whenever you open it, and in the background when iOS allows. The Dashboard shows what has been sent.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(spacing: 10) {
            progressDots
            if let warning = footerWarning {
                Text(warning)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            HStack(spacing: 12) {
                if step != .welcome {
                    Button("Back") { back() }
                        .buttonStyle(.bordered)
                        .disabled(finishing || requestingHealthAccess)
                }
                Button {
                    primaryAction()
                } label: {
                    if finishing || requestingHealthAccess {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text(primaryTitle).frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(primaryDisabled)
            }
            if let secondary = secondaryTitle {
                Button(secondary) { secondaryAction() }
                    .font(.footnote)
                    .disabled(finishing || requestingHealthAccess)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private var progressDots: some View {
        HStack(spacing: 6) {
            ForEach(Step.allCases, id: \.self) { each in
                Capsule()
                    .fill(each <= step ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary))
                    .frame(width: each == step ? 22 : 7, height: 7)
            }
        }
        .animation(.snappy, value: step)
        .accessibilityLabel("Step \(step.rawValue + 1) of \(Step.allCases.count)")
    }

    private var primaryTitle: String {
        switch step {
        case .welcome: "Get Started"
        case .server: "Continue"
        // App Review 5.1.1(iv): the button on a pre-permission screen has to be
        // a neutral "Continue"/"Next", never "Grant …", and there is no way past
        // the screen that avoids the permission sheet.
        case .health: "Continue"
        case .types: "Continue"
        case .start: server.validatedURL == nil ? "Finish" : "Start Syncing"
        }
    }

    private var primaryDisabled: Bool {
        if finishing || requestingHealthAccess { return true }
        switch step {
        case .server:
            // The result has to be on screen before Continue lights up; the
            // secondary button below is the way past a failing or untested one.
            return connectionTest?.isSuccess != true
        case .types:
            return model.config.observedTypeIdentifiers.isEmpty
        default:
            return false
        }
    }

    /// The escape hatch under the primary button: moving on past a server that
    /// did not answer. The Health step has none — App Review 5.1.1(iv) requires
    /// that the permission request always follows the explanation.
    private var secondaryTitle: String? {
        switch step {
        case .server:
            if serverFieldsAreEmpty { return "I'll Set This Up Later" }
            // An unusable URL cannot be carried forward — `commitServerFields`
            // would store nothing and the typed text would vanish without a
            // word. Fix it, or clear the field to skip the step outright.
            if server.urlIssue != nil { return nil }
            if connectionTest?.isSuccess == true { return nil }
            return connectionTest == nil ? "Continue Without Testing" : "Continue Anyway"
        default:
            return nil
        }
    }

    private var footerWarning: String? {
        guard step == .server, acceptedServerWarning, connectionTest?.isSuccess != true else {
            return nil
        }
        return "This server has not answered a test. Uploads will fail until it does — fix the URL or token in Settings → Server."
    }

    private func primaryAction() {
        switch step {
        case .welcome:
            step = .server
        case .server:
            commitServerFields()
            step = .health
        case .health:
            if model.authorizationRequested && !model.needsAuthorization {
                step = .types
            } else {
                requestingHealthAccess = true
                Task {
                    await model.requestOnboardingHealthAccess()
                    requestingHealthAccess = false
                    step = .types
                }
            }
        case .types:
            step = .start
        case .start:
            finishing = true
            Task {
                await model.finishOnboarding()
                finishing = false
            }
        }
    }

    private func secondaryAction() {
        switch step {
        case .server:
            acceptedServerWarning = true
            commitServerFields()
            step = .health
        default:
            break
        }
    }

    private func back() {
        guard let previous = Step(rawValue: step.rawValue - 1) else { return }
        step = previous
    }

    // MARK: - Server helpers (the rules are `ServerFieldsDraft`'s, shared with Settings)

    /// Nothing typed, scanned or pasted: the state in which the server step can
    /// be skipped outright.
    private var serverFieldsAreEmpty: Bool {
        server.urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && server.token.isEmpty
    }

    private var serverSummary: String {
        guard let url = server.validatedURL else { return "Not set" }
        return url.host().map { $0 + (url.port.map { ":\($0)" } ?? "") } ?? url.absoluteString
    }

    /// The one place a pairing code lands in this flow, whatever brought it:
    /// the scanner, the Paste button, a `puls://pair?…` string put in the URL
    /// field, or a link the user accepted (`collectConfirmedPairing`). Still
    /// only the step's local fields — the draft changes on Continue and the
    /// engine on the last step.
    private func applyPairing(_ payload: PairingPayload) {
        server.fill(from: payload)
        // The code was printed by the server that is presumably right here —
        // confirm it now rather than making the user tap again.
        runConnectionTest()
    }

    /// Takes a pairing link the user accepted (`AppModel.confirmPairingLink`)
    /// and brings them to the step it belongs to, from wherever in the flow
    /// they were. Not during the final Apply: the cover is about to come down,
    /// and Settings → Server picks the payload up instead.
    private func collectConfirmedPairing() {
        guard !finishing, let payload = model.takeConfirmedPairing() else { return }
        step = .server
        applyPairing(payload)
    }

    /// Moves the entered values into the staged draft. Still nothing applied —
    /// the engine sees them only on the final step.
    private func commitServerFields() {
        server.commit(to: &model.config)
    }

    private func runConnectionTest() {
        guard let url = server.validatedURL else { return }
        let token = server.token
        guard !token.isEmpty else { return }
        let userID = server.connectionTestUserID(fallback: model.config.userID)
        testing = true
        connectionTest = nil
        acceptedServerWarning = false
        // Only the latest run may report: a pairing code can arrive while an
        // earlier test is still out.
        connectionTestRun += 1
        let run = connectionTestRun
        Task {
            let result = await model.testConnection(url: url, token: token, userID: userID)
            guard run == connectionTestRun else { return }
            connectionTest = result
            testing = false
        }
    }
}
