import SwiftUI
import PulsHealthSync

/// First-run flow. A fresh install has no server, no token and no data types,
/// so every tab is empty and nothing points at the one screen (Settings) that
/// would fix it. Five steps take the user from "what is this" to a running
/// backfill:
///
/// 1. what the app does and where the data goes,
/// 2. the server — scanned from the pairing QR code or typed, then tested,
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
    // the draft only changes when the user moves on.
    @State private var serverURLText = ""
    @State private var tokenText = ""
    @State private var connectionTest: ConnectionTestResult?
    @State private var testing = false
    @State private var showScanner = false
    @State private var scannedUserID: String?
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
        .safeAreaInset(edge: .bottom) { footer }
        .interactiveDismissDisabled()
        .onAppear {
            serverURLText = model.config.serverURL?.absoluteString ?? ""
            tokenText = model.config.authToken ?? ""
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
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 52))
                    .foregroundStyle(.tint)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 8)
                Text("PulsHealth reads the health data on this iPhone and sends it to a server you run yourself.")
                    .font(.title3.weight(.semibold))
                Text("It goes nowhere else. There is no PulsHealth account, no analytics, and no third-party service in the path — the developer never receives your data.")
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 14) {
                    bullet(
                        "heart.text.square", "Read-only",
                        "PulsHealth only reads from Apple Health. It never writes or changes anything there.")
                    bullet(
                        "checklist", "You choose the data",
                        "Pick the types to sync — and change the selection whenever you like.")
                    bullet(
                        "externaldrive.connected.to.line.below", "You need a server",
                        "A machine running the PulsHealth server (Docker, one command). Without one there is nowhere to sync to.")
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
            } footer: {
                Text("`scripts/bootstrap.sh` prints a QR code with the URL, token and user ID already in it. `make pairing` prints it again later.")
            }

            Section {
                TextField("https://your-host:8443", text: $serverURLText)
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
                        Text(testing ? "Testing Connection…" : "Test Connection")
                        if testing {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(testing || validatedServerURL == nil || enteredToken.isEmpty)
                if let result = connectionTest {
                    ConnectionTestResultRow(result: result)
                }
            } header: {
                Text("Or enter it by hand")
            } footer: {
                Text("Use https://. Plain http:// is accepted only for hosts on your local network (localhost, *.local, 10.x, 172.16–31.x, 192.168.x).")
            }

            if let scannedUserID {
                Section("User ID") {
                    Text(scannedUserID)
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                    Text("From the pairing code. Everything stored for you on the server is tagged with this ID; you can change it later under Settings → User.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .sheet(isPresented: $showScanner) {
            PairingScannerView { payload in
                serverURLText = payload.serverURL.absoluteString
                tokenText = payload.token
                model.config.userID = payload.userID
                scannedUserID = payload.userID
                connectionTest = nil
                acceptedServerWarning = false
                // The code was printed by the server that is presumably right
                // here — confirm it now rather than making the user tap again.
                runConnectionTest()
            }
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
                    Label("Access granted for the current selection.", systemImage: "checkmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(.green)
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
                        .foregroundStyle(validatedServerURL == nil ? .orange : .secondary)
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent("Data types", value: "\(model.config.enabledTypes.count) selected")
                LabeledContent(
                    "History from",
                    value: model.config.startDate.formatted(date: .abbreviated, time: .omitted))
                LabeledContent("User ID") {
                    Text(model.config.userID)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                Text(validatedServerURL == nil
                    ? "No server is set, so nothing will be uploaded yet. Add one under Settings → Server whenever you are ready."
                    : "Tapping Start uploads everything from the date above. The first pass is the largest — keep the app open and the phone on power for it. Progress is saved after every batch, so it is safe to interrupt.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section {
                Text("From here on, PulsHealth catches up whenever you open it, and in the background when iOS allows. The Dashboard shows what has been sent.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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
        case .health: model.authorizationRequested && !model.needsAuthorization
            ? "Continue" : "Grant Health Access"
        case .types: "Continue"
        case .start: validatedServerURL == nil ? "Finish" : "Start Syncing"
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

    /// The escape hatch under the primary button: skipping a step, or moving on
    /// past a server that did not answer.
    private var secondaryTitle: String? {
        switch step {
        case .server:
            if serverURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && enteredToken.isEmpty {
                return "I'll Set This Up Later"
            }
            if connectionTest?.isSuccess == true { return nil }
            return connectionTest == nil ? "Continue Without Testing" : "Continue Anyway"
        case .health:
            return model.authorizationRequested && !model.needsAuthorization ? nil : "Skip for Now"
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
        case .health:
            step = .types
        default:
            break
        }
    }

    private func back() {
        guard let previous = Step(rawValue: step.rawValue - 1) else { return }
        step = previous
    }

    // MARK: - Server helpers (same rules as Settings)

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

    private var enteredToken: String {
        tokenText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var serverSummary: String {
        guard let url = validatedServerURL else { return "Not set" }
        return url.host().map { $0 + (url.port.map { ":\($0)" } ?? "") } ?? url.absoluteString
    }

    /// Moves the entered values into the staged draft. Still nothing applied —
    /// the engine sees them only on the final step.
    private func commitServerFields() {
        model.config.serverURL = validatedServerURL
        model.config.authToken = enteredToken.isEmpty ? nil : enteredToken
    }

    private func runConnectionTest() {
        guard let url = validatedServerURL else { return }
        let token = enteredToken
        guard !token.isEmpty else { return }
        testing = true
        connectionTest = nil
        acceptedServerWarning = false
        Task {
            connectionTest = await model.testConnection(url: url, token: token)
            testing = false
        }
    }
}
