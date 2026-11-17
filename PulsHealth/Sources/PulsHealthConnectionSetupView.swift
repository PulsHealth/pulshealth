import SwiftUI
import AuthenticationServices

struct PulsHealthConnectionSetupView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var connecting = false
    @State private var problem: String?
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 24) {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 36, weight: .light))
                        .foregroundStyle(.tint)
                        .frame(width: 64, height: 64)
                        .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 18))
                    Text("Sign in to your\nPulsHealth account")
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Button { Task { await connect() } } label: {
                        HStack(spacing: 10) {
                            if connecting { ProgressView().tint(.white) }
                            Text(connecting ? "Signing in…" : "Sign in")
                        }.frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(connecting)
                    if let problem { ConnectionNotice(title: "Couldn’t connect", message: problem) }
                }
                .frame(maxWidth: 340)
                .padding(24)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .background(Color(uiColor: .systemGroupedBackground))
        }
        .navigationTitle("PulsHealth")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func connect() async {
        guard !connecting else { return }; connecting = true; problem = nil
        defer { connecting = false }
        do {
            let page = PulsHealthDatabase.connectURL
            let callback = try await webAuthenticationSession.authenticate(using: page, callbackURLScheme: PulsHealthDatabase.callbackScheme, preferredBrowserSession: .shared)
            try Task.checkCancellation()
            switch PulsHealthDatabase.outcome(ofCallback: callback) {
            case .paired(let payload):
                guard PulsHealthDatabase.isUnderDomain(payload.serverURL) else {
                    throw CollectionError("The returned connection is not a PulsHealth database.")
                }
                var setup = DatabaseSetup(applied: model.appliedConfig, preferred: .pulsHealth)
                guard setup.receiveSignIn(payload) else {
                    throw CollectionError("The database connection could not be prepared. Sign in again.")
                }
                let isNew = setup.needsInitialSyncReview(
                    applied: model.appliedConfig, draft: model.config, saved: model.savedDestinations)
                let committed = isNew
                    ? setup.commitNewConnection(to: &model.config)
                    : setup.commit(to: &model.config)
                guard committed else {
                    throw CollectionError("The database connection could not be prepared. Sign in again.")
                }
                model.noteSignInPairing(payload)
                model.isSettingUpInitialSync = true
                model.initialSyncReviewRequested = UUID()
            case .cancelled: return
            case .failed(let message): problem = message
            }
        } catch {
            if case .cancelled = PulsHealthDatabase.outcome(ofError: error) { return }
            problem = error.localizedDescription
        }
    }
}
