import SwiftUI
import UniformTypeIdentifiers

struct ContributionDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText] }
    var data: Data
    init(data: Data = Data()) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
struct OrganizerConnectionView: View {
    @Environment(AppModel.self) private var model
    let requestID: UUID
    @State private var invite: URL?
    @State private var close = false
    @State private var busy = false
    @State private var error: String?
    @State private var export = false
    @State private var document = ContributionDocument()
    @State private var cursor: Int64 = 0
    @State private var pendingCursor: Int64 = 0
    @State private var downloadNotice: String?
    private var request: CollectionRequest? { model.sharing.requests.first { $0.id == requestID } }
    var body: some View {
        List {
            if let request {
                Section {
                    Text("You organize").font(.caption).foregroundStyle(.secondary)
                    Text(request.title).font(.title2.bold())
                    Label(request.status == "closed" ? "Closed" : (request.participantCount ?? 0) == 0 ? "Awaiting participants" : "Open", systemImage: "person.2")
                    LabeledContent("Participants", value: String(request.participantCount ?? 0))
                    if let ms = request.lastContribution { LabeledContent("Last contribution", value: Date(timeIntervalSince1970: Double(ms)/1000).formatted()) }
                }
                CollectionSummaryView(request: request)
                Section {
                    NavigationLink("Participants", value: SyncRoute.participants(requestID))
                    if request.status == "open" {
                        Button("Create new invitation") { Task { await rotateInvitation() } }
                        if let invite { ShareLink("Share invitation", item: invite) }
                    }
                }
                Section {
                    if let enrollment = model.sharing.enrollments.first(where: { $0.request.id == requestID }) {
                        NavigationLink("Your contribution · \(enrollment.status.capitalized)", value: SyncRoute.contribution(enrollment.id))
                    } else if request.status == "open" {
                        DisclosureGroup("Your contribution") {
                            Button("Review & join") { model.sharing.invitation = CollectionInvitation(id: requestID) }
                        }
                    }
                }
                Section("Manage group") {
                    Button(cursor == 0 ? "Download contributions" : "Download next page") { Task { await download() } }
                    if let downloadNotice { Text(downloadNotice).font(.caption).foregroundStyle(.secondary) }
                    if request.status == "open" { Button("Close group", role: .destructive) { close = true } }
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
            if busy { ProgressView() }
        }
        .disabled(busy)
        .navigationTitle("Group connection").navigationBarTitleDisplayMode(.inline)
        .task { await model.sharing.refresh() }
        .onChange(of: model.sharing.accountRevision) {
            invite = nil; export = false; document = ContributionDocument(); cursor = 0; pendingCursor = 0; downloadNotice = nil
        }
        .confirmationDialog("Close this group?", isPresented: $close, titleVisibility: .visible) {
            Button("Close group", role: .destructive) { Task { await closeGroup() } }
        } message: { Text("This stops future contributions from everyone.") }
        .fileExporter(isPresented: $export, document: document, contentType: .plainText, defaultFilename: "contributions.ndjson") { result in
            if case .success = result { cursor = pendingCursor }
            if case .failure(let failure) = result { error = failure.localizedDescription }
            document = ContributionDocument()
        }
    }
    private func rotateInvitation() async {
        busy = true; defer { busy = false }
        do {
            let response: CollectionResponse<CollectionRequest> = try await model.sharing.command(CollectionCommand(action: "invite", id: requestID))
            guard let code = response.invite else { throw CollectionError("Invitation unavailable.") }
            invite = CollectionInvitation.link(id: requestID, code: code)
            error = nil
        } catch { self.error = error.localizedDescription }
    }
    private func closeGroup() async {
        busy = true; defer { busy = false }
        do {
            let _: CollectionResponse<CollectionRequest> = try await model.sharing.command(CollectionCommand(action: "close", id: requestID))
            await model.sharing.refresh(); error = nil
        } catch { self.error = error.localizedDescription }
    }
    private func download() async {
        busy = true; defer { busy = false }
        do {
            struct Command: Encodable { var action = "export"; var id: UUID; var after: Int64 }
            struct Row: Codable { var cursor: Int64; var participant: UUID; var data: Payload }
            struct Payload: Codable {
                var key: String; var type: String; var function: String; var start: Int64; var end: Int64
                var value: Double?; var category: Int?; var unit: String?
            }
            let response: CollectionResponse<[Row]> = try await model.sharing.command(Command(id: requestID, after: cursor))
            var data = Data(); let encoder = JSONEncoder()
            for row in response.result { data.append(try encoder.encode(row)); data.append(0x0a) }
            pendingCursor = response.result.count == 1000 ? response.result.last!.cursor : 0
            document = ContributionDocument(data: data); export = true
            downloadNotice = "\(response.result.count) records. \(pendingCursor == 0 ? "Last page." : "More records may be available.")"
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
struct CollectionParticipantsView: View {
    @Environment(AppModel.self) private var model
    let requestID: UUID
    @State private var participants: [CollectionParticipant] = []
    @State private var error: String?
    @State private var deletion: CollectionParticipant?
    @State private var busy = false
    var body: some View {
        List {
            ForEach(participants) { participant in
                Section {
                    Text("Participant \(participant.id.uuidString.prefix(8))").font(.headline)
                    LabeledContent("Status", value: participant.status.capitalized)
                    if let ms = participant.lastReceived { Text("Last receipt \(Date(timeIntervalSince1970: ms/1000).formatted())").font(.caption) }
                    if participant.deletionStatus == "requested" { Button("Delete contributions & confirm", role: .destructive) { deletion = participant } }
                    if participant.deletionStatus == "confirmed" { Text("Deletion confirmed").foregroundStyle(.secondary) }
                }
            }
            if participants.isEmpty { Text("No participants yet").foregroundStyle(.secondary) }
            if let error { Text(error).foregroundStyle(.red) }
        }.disabled(busy).navigationTitle("Participants").task { await load() }
        .onChange(of: model.sharing.accountRevision) { participants = []; deletion = nil }
        .confirmationDialog("Delete this participant’s contributions?", isPresented: Binding(get: { deletion != nil }, set: { if !$0 { deletion = nil } }), titleVisibility: .visible) {
            if let deletion { Button("Delete & confirm", role: .destructive) { Task { await confirm(deletion) } } }
        } message: { Text("Server records are deleted and future uploads stop. Handle any downloaded copies separately.") }
    }
    private func load() async {
        do {
            let response: CollectionResponse<[CollectionParticipant]> = try await model.sharing.command(CollectionCommand(action: "participants", id: requestID))
            participants = response.result; error = nil
        } catch { self.error = error.localizedDescription }
    }
    private func confirm(_ participant: CollectionParticipant) async {
        busy = true; defer { busy = false }
        do {
            let _: CollectionResponse<CollectionEnrollment> = try await model.sharing.command(CollectionCommand(action: "confirm-deletion", id: participant.id))
            await load()
        } catch { self.error = error.localizedDescription }
    }
}
struct ConnectionDeletionView: View {
    @Environment(AppModel.self) private var model
    let enrollment: CollectionEnrollment
    @State private var withdraw = true
    @State private var sent = false
    var body: some View {
        Form {
            LabeledContent("Recipient", value: enrollment.request.organizer)
            if sent || enrollment.deletionStatus == "requested" {
                Label("Awaiting organizer", systemImage: "clock")
                Text("Deletion has been requested. Confirmation is still pending.")
            } else if enrollment.deletionStatus == "confirmed" {
                Label("Deletion confirmed", systemImage: "checkmark.circle")
                Text("Contributions held for this request were deleted. Downloaded copies may need separate follow-up.")
            } else {
                Toggle("Also withdraw from future sharing", isOn: $withdraw)
                if !withdraw { Text("Sharing continues until the organizer confirms deletion. Confirmation ends this connection.").font(.footnote).foregroundStyle(.secondary) }
                Button("Request deletion", role: .destructive) {
                    Task {
                        await model.sharing.requestDeletion(enrollment, withdraw: withdraw)
                        sent = model.sharing.enrollments.first { $0.id == enrollment.id }?.deletionStatus == "requested"
                    }
                }.disabled(model.sharing.busy)
            }
            LabeledContent("Contact", value: enrollment.request.contact)
            if let problem = model.sharing.problem { Text(problem).foregroundStyle(.red) }
        }.navigationTitle("Delete shared data").navigationBarTitleDisplayMode(.inline)
    }
}
