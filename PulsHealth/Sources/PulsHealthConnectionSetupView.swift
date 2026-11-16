import SwiftUI
import AuthenticationServices

struct PulsHealthConnectionSetupView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var connecting = false
    @State private var problem: String?
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: "cloud").font(.largeTitle).foregroundStyle(.tint)
                    Text("PulsHealth database").font(.title2.bold())
                    Text("Sync to your database hosted by PulsHealth.").foregroundStyle(.secondary)
                    Button(connecting ? "Connecting…" : "Sign in & continue") { Task { await connect() } }
                        .buttonStyle(.borderedProminent).disabled(connecting)
                }.padding(.vertical, 16)
            }
            if connecting { ProgressView() }
            if let problem { Section { Text(problem).foregroundStyle(.red) } }
        }.navigationTitle("PulsHealth database").navigationBarTitleDisplayMode(.inline)
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
                guard setup.receiveSignIn(payload), setup.commit(to: &model.config) else {
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
