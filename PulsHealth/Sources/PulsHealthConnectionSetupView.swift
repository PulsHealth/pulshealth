import SwiftUI
import AuthenticationServices

struct PulsHealthConnectionSetupView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var connecting = false
    @State private var problem: String?
    var body: some View {
        ConnectionPage {
            ConnectionSurface {
                VStack(alignment: .leading, spacing: 18) {
                    Image(systemName: "cloud").font(.system(size: 34, weight: .light)).foregroundStyle(.tint)
                        .frame(width: 68, height: 68).background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 20))
                    Text("Your health data, in your database.").font(.title2.bold())
                    Button(connecting ? "Connecting…" : "Sign in & continue") { Task { await connect() } }
                        .buttonStyle(.borderedProminent).controlSize(.large).disabled(connecting)
                }.padding(.vertical, 10)
            }
            if connecting { ProgressView().frame(maxWidth: .infinity) }
            if let problem { ConnectionNotice(title: "Couldn’t connect", message: problem) }
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
