#if DEBUG
import AVFoundation
import SwiftUI
import PulsHealthSync

struct HostedProgramView: View {
    @Bindable var model: HostedProgramModel
    @State private var scanning = false
    @State private var confirmLeave = false

    var body: some View {
        Form {
            Section {
                Text("Experimental hosting").font(.headline)
                Text("Use synthetic data while testing. This branch adds a separate destination; your ordinary database keeps its own sync progress.")
                Text("Private: health records are encrypted on this phone. Only the recipient holding the program’s private key can decrypt them. Hosting still sees membership, sizes and access times.")
                Text("Traditional: the hosting operator and program can read records in the existing database.")
            }
            if let enrollment = model.enrollment, model.joined {
                Section(enrollment.review.spec.name) {
                    LabeledContent("Hosting", value: enrollment.review.spec.mode.capitalized)
                    LabeledContent("Collection", value: "Health types reviewed at enrollment")
                    Text("From \(Date(timeIntervalSince1970: Double(enrollment.review.spec.startMs) / 1000).formatted(date: .abbreviated, time: .omitted)) onward")
                    ForEach(enrollment.review.spec.types, id: \.self) { Text(typeName($0)) }
                    Text("Profile details, workout routes and enhanced workout streams are excluded in this first experiment. Health samples can still contain source labels and metadata; private hosting encrypts those too.").font(.footnote)
                    Button("Start Collection / Sync Now") { model.startCollection() }
                        .disabled(model.busy)
                    Button("Pause Collection") { Task { await model.pause() } }
                    Text(enrollment.collecting ? "Ongoing collection is enabled, including HealthKit background deliveries." : "Collection is paused.").font(.footnote)
                    Button("Leave and Revoke Upload Access", role: .destructive) { confirmLeave = true }
                        .disabled(model.busy)
                }
                if !model.statuses.isEmpty {
                    Section("Progress") {
                        ForEach(model.statuses) { status in
                            LabeledContent(status.descriptor.displayName, value: status.state.lastError == nil ? status.activity.rawValue.capitalized : "Needs retry")
                        }
                    }
                }
            } else if model.enrollmentPending {
                Section("Resume Enrollment") {
                    Text("An enrollment was interrupted. Retry with the saved credential to avoid consuming the invitation twice.")
                    Button("Retry Enrollment") { Task { await model.join() } }.disabled(model.busy)
                    Button("Discard Pending Setup", role: .destructive) { model.discardPending() }.disabled(model.busy)
                }
            } else {
                Section("Join a Program or Personal Vault") {
                    TextField("Gateway URL", text: $model.serverText).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Picker("Expected hosting", selection: $model.expectedMode) {
                        Text("Private").tag("private")
                        Text("Traditional").tag("traditional")
                    }
                    SecureField("Invitation code", text: $model.code).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Scan Invitation QR") {
                        Task {
                            let authorized = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
                            let granted = authorized ? true : await AVCaptureDevice.requestAccess(for: .video)
                            if granted {
                                scanning = true
                            } else { model.message = "Enable Camera access in Settings, or enter the code manually." }
                        }
                    }
                    Button("Review Invitation") { Task { await model.fetchReview() } }.disabled(model.busy || model.code.isEmpty)
                }
                if let review = model.review {
                    Section("Review \(review.spec.name)") {
                        LabeledContent("Hosting", value: review.spec.mode.capitalized)
                        LabeledContent("Consent version", value: review.spec.consentVersion)
                        Text(review.spec.consent)
                        Text("From \(Date(timeIntervalSince1970: Double(review.spec.startMs) / 1000).formatted(date: .abbreviated, time: .omitted)) onward")
                        ForEach(review.spec.types, id: \.self) { Text(typeName($0)) }
                        if review.spec.mode == "private" {
                            Text("Verify this recipient with the program through a separate trusted channel. A QR from the program fills the expected fingerprint.")
                            Text(review.spec.fingerprint).font(.caption.monospaced()).textSelection(.enabled)
                            TextField("Expected recipient fingerprint", text: $model.expectedFingerprint).textInputAutocapitalization(.never).autocorrectionDisabled()
                            Label(model.pinMatches ? "Recipient matches" : "Recipient not verified", systemImage: model.pinMatches ? "checkmark.shield" : "exclamationmark.shield")
                        }
                        Text("Joining grants the program ongoing collection of these types after you start collection. Leaving stops future uploads; it does not erase copies already collected. Password reset cannot recover a lost private key.")
                        Toggle("I agree to this collection and recipient", isOn: $model.accepted)
                        Button("Join") { Task { await model.join() } }.disabled(model.busy || !model.accepted || !model.pinMatches)
                    }
                }
            }
            if model.busy { ProgressView("Working…") }
            if let message = model.message { Section { Text(message).font(.footnote) } }
        }
        .navigationTitle("Experimental Hosting")
        .task { await model.load() }
        .onChange(of: model.serverText) { _, _ in model.invalidateReview() }
        .onChange(of: model.code) { _, _ in model.invalidateReview() }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                CameraPreview(onCode: { code in model.openLink(code); scanning = false }, onFailure: { model.message = $0; scanning = false })
                    .navigationTitle("Scan Program Invitation")
                    .toolbar { Button("Cancel") { scanning = false } }
            }
        }
        .confirmationDialog("Leave this program?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave and Revoke", role: .destructive) { Task { await model.leave() } }
        } message: { Text("The program keeps existing records under its retention terms. This stops new uploads from this enrollment.") }
    }
    private func typeName(_ id: String) -> String { HealthTypeCatalog.all.first { $0.identifier == id }?.displayName ?? id }
}
#endif
