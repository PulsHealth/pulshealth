import SwiftUI
import PulsHealthSync

/// First-run flow. A fresh install has no data types and no Health access, so
/// the Explore and Export tabs have nothing to show. Four steps take the user
/// from "what is this" to a selection with Health access — enough to explore
/// and export. A server is not asked for: it is optional, and the Sync tab
/// offers it whenever the user wants one.
///
/// 1. what the app does (explore, export, and optionally sync),
/// 2. Health access, requested for the preselected Common set,
/// 3. which types (the real Synced Data screen, titled Choose Data here),
/// 4. a summary and the button that applies everything.
///
/// Nothing reaches the engine until step 4 — `model.config` is the same staged
/// draft the Synced Data screen edits, and `finishOnboarding()` is the same
/// Save & Apply path. Backing out at any point leaves the install exactly as it
/// was, and the flow reappears on the next launch until it is finished.
///
/// A `puls://` pairing link can still arrive while this flow is up. It is
/// confirmed here (the prompt cannot come from the covered RootView), and the
/// accepted payload then waits in `AppModel.confirmedPairing` until the flow
/// ends: `pairingAwaitsSyncTab` turns true, RootView opens Sync → Server, and
/// that screen fills its fields from it.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model

    enum Step: Int, CaseIterable, Comparable {
        case welcome, health, types, start

        static func < (a: Step, b: Step) -> Bool { a.rawValue < b.rawValue }

        var title: String {
            switch self {
            case .welcome: "Welcome"
            case .health: "Health Access"
            case .types: "Choose Data"
            case .start: "Ready"
            }
        }
    }

    @State private var step: Step = .welcome
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
        // A pushed detail belongs to the step that pushed it. The Choose Data
        // step is the real picker, so it can be two levels deep (category →
        // per-type config) when the footer's Back/Continue fires — and the
        // footer sits outside the stack, so without this the pushed screen
        // stayed on top of the next step's content. Re-identifying the stack
        // per step drops whatever it had pushed.
        .id(step)
        .safeAreaInset(edge: .bottom) { footer }
        .interactiveDismissDisabled()
        // This flow covers RootView, so the prompt for an incoming `puls://`
        // link has to come from here. Not over the iOS Health sheet, and not
        // during the final Apply.
        .pairingLinkPrompt(canPresent: !requestingHealthAccess && !finishing)
    }

    // MARK: - Steps

    @ViewBuilder private var stepContent: some View {
        switch step {
        case .welcome: welcomeStep
        case .health: healthStep
        case .types: TypePickerView(title: Step.types.title)
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
                Text("Your Apple Health data, explored, exported, and, if you like, synced to a server you run.")
                    .font(.title3.weight(.semibold))

                VStack(alignment: .leading, spacing: 14) {
                    bullet(
                        "heart.text.square", "Explore",
                        "See what is in Apple Health, how much, and where it came from.")
                    bullet(
                        "square.and.arrow.up", "Export",
                        "CSV or JSONL files, any range, any types. No account needed.")
                    bullet(
                        "arrow.triangle.2.circlepath", "Sync, if you want",
                        "A self-hosted PulsHealth server keeps a live copy. Optional, and you can add one any time.")
                }
                .padding(.top, 4)

                Text("PulsHealth only reads from Apple Health and never writes to it. Nothing leaves your phone unless you share an export or connect a server of your own.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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

    private var healthStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "heart.text.square")
                    .font(.system(size: 46))
                    .foregroundStyle(.pink)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 8)
                Text("Next, iOS asks which health data PulsHealth may read.")
                    .font(.title3.weight(.semibold))
                Text("The sheet comes from iOS and lists the starter selection. PulsHealth asks for read access only; it can never write to or delete anything in Apple Health. You can change any of it later in Settings → Privacy & Security → Health.")
                    .foregroundStyle(.secondary)
                Text("Anything you add on the next step is requested when you finish.")
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
                LabeledContent("Data types", value: "\(model.config.enabledTypes.count) selected")
                LabeledContent("User ID") {
                    Text(model.config.userID)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                Text("Explore shows what Apple Health holds for these types, and Export writes them to files. Nothing is uploaded anywhere.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if model.confirmedPairing != nil {
                    // Accepted during the flow; Sync → Server opens with it
                    // filled in once the flow is done (RootView, on
                    // `pairingAwaitsSyncTab`).
                    Label("A pairing link is waiting. The Sync tab opens with the server filled in when you finish.", systemImage: "qrcode")
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
            if step == .start {
                // Text, not a button: the flow cannot pick a tab in RootView,
                // and the Sync tab's setup card is one tap away anyway.
                Text("Connect a server later in the Sync tab.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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
        // App Review 5.1.1(iv): the button on a pre-permission screen has to be
        // a neutral "Continue"/"Next", never "Grant …", and there is no way past
        // the screen that avoids the permission sheet.
        case .health: "Continue"
        case .types: "Continue"
        case .start: "Start Exploring"
        }
    }

    private var primaryDisabled: Bool {
        if finishing || requestingHealthAccess { return true }
        switch step {
        case .types:
            return model.config.observedTypeIdentifiers.isEmpty
        default:
            return false
        }
    }

    private func primaryAction() {
        switch step {
        case .welcome:
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

    private func back() {
        guard let previous = Step(rawValue: step.rawValue - 1) else { return }
        step = previous
    }
}
