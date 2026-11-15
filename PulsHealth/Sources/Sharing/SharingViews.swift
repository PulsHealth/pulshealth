import SwiftUI
import PulsHealthSync

struct SharingView: View {
    @Environment(AppModel.self) private var model
    @State private var link = ""
    var body: some View {
        let sharing = model.sharing
        List {
            Section {
                Text("Share on your terms").font(.title2.bold())
                Text("Each request has its own data selection and schedule. You can take part in more than one.").foregroundStyle(.secondary)
            }
            if let problem = sharing.problem { Section { Text(problem).foregroundStyle(.red) } }
            if sharing.enrollments.isEmpty {
                Section {
                    Label("No sharing yet", systemImage: "person.2")
                    Text("Open an invitation from an organizer to review a request.").foregroundStyle(.secondary)
                    NavigationLink("Sign in to PulsHealth") { UserView(account: sharing.account) }
                }
            }
            ForEach(sharing.enrollments) { e in
                NavigationLink { SharingDetailView(enrollmentID: e.id) } label: {
                    VStack(alignment: .leading, spacing: 7) {
                        HStack { Text(e.request.title).font(.headline); Spacer(); Text(e.status.capitalized).font(.caption).foregroundStyle(e.status == "active" ? .green : .secondary) }
                        Text(e.request.organizer).foregroundStyle(.secondary)
                        Text("\(e.metrics.count) metrics · \(e.request.mode == "once" ? "One time" : "Ongoing")").font(.caption)
                        if let last = e.lastReceived { Text("Last receipt \(last.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
                        if let notice = sharing.notices[e.id] { Text(notice).font(.caption).foregroundStyle(.secondary) }
                    }.padding(.vertical, 6)
                }
            }
            Section("Have an invitation?") {
                TextField("Paste invitation link", text: $link).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Review invitation") {
                    do {
                        guard let url = URL(string: link) else { throw CollectionError("Enter a valid invitation.") }
                        if url.scheme == "https", url.host == PulsHealthDatabase.viewerURL.host,
                           url.pathComponents.count == 3, url.pathComponents[1] == "collect", let id = UUID(uuidString: url.lastPathComponent) {
                            sharing.invitation = CollectionInvitation(id: id, code: url.fragment)
                        } else { sharing.invitation = try CollectionInvitation(url: url) }
                    } catch { sharing.problem = error.localizedDescription }
                }.disabled(link.isEmpty)
            }
            Section { NavigationLink { CollectionDirectoryView() } label: { Label("Browse opportunities", systemImage: "magnifyingglass") } } footer: { Text("Optional studies and programs accepting volunteers.") }
        }
        .navigationTitle("Sharing")
        .refreshable { await sharing.refresh() }
        .task { await sharing.refresh() }
    }
}
struct CollectionSummaryView: View {
    let request: CollectionRequest
    var body: some View {
        Section {
            Text(request.title).font(.title2.bold())
            Text(request.organizer).font(.headline)
            Text(request.purpose)
        }
        Section("Collection") {
            LabeledContent("Schedule", value: request.mode == "once" ? "One time" : "\(request.durationDays) days")
            LabeledContent("History", value: "\(request.historyDays) days")
            LabeledContent("Retention after receipt", value: "\(request.retentionDays) days")
            LabeledContent("Contact", value: request.contact)
        }
    }
}
struct CollectionReviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let invitation: CollectionInvitation
    @State private var request: CollectionRequest?
    @State private var selected: Set<String> = []
    @State private var accepted = false
    @State private var problem: String?
    var body: some View {
        List {
            if let request {
                CollectionSummaryView(request: request)
                Section("Requested data") {
                    ForEach(request.metrics) { metric in
                        Toggle(isOn: Binding(get: { selected.contains(metric.id) }, set: { if $0 { selected.insert(metric.id) } else { selected.remove(metric.id) } })) {
                            VStack(alignment: .leading) { Text(metric.name); Text("\(metric.detail) · \(metric.required ? "Required" : "Optional")").font(.caption).foregroundStyle(.secondary) }
                        }.disabled(metric.required)
                    }
                }
                Section("Before you share") {
                    Text(request.consentText)
                    Text("Contributions go to this request’s organizer through PulsHealth. Account profile, source and device names are excluded. The organizer can download copies. Stopping sharing prevents future uploads; it does not recall previous downloads.").font(.footnote).foregroundStyle(.secondary)
                    Text("Health permissions may limit available records. Daily summaries include only complete daily buckets within the approved range.").font(.footnote).foregroundStyle(.secondary)
                    Toggle("I agree to this request and its data use", isOn: $accepted)
                    Button(request.mode == "once" ? "Agree & send available data" : "Agree & start sharing") {
                        Task { await model.sharing.join(request, metrics: request.metrics.filter { selected.contains($0.id) }, invite: invitation) }
                    }.disabled(!accepted || selected.isEmpty || model.sharing.busy)
                    if model.sharing.busy { ProgressView() }
                }
                NavigationLink("Sign in or view account") { UserView(account: model.sharing.account) }
            } else if problem == nil { ProgressView("Loading request…") }
            if let error = problem ?? model.sharing.problem { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle("Review request").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        .task {
            do {
                guard let r = try await model.sharing.discover(invitation).first else { throw CollectionError("This invitation has expired or was closed. Ask the organizer for a new link.") }
                request = r; selected = Set(r.metrics.filter(\.required).map(\.id))
            } catch { problem = error.localizedDescription }
        }
    }
}
struct SharingDetailView: View {
    @Environment(AppModel.self) private var model
    let enrollmentID: UUID
    @State private var confirmStop = false
    @State private var confirmFinish = false
    var body: some View {
        List {
            if let e = model.sharing.enrollments.first(where: { $0.id == enrollmentID }) {
                CollectionSummaryView(request: e.request)
                Section("Your agreement") {
                    LabeledContent("Status", value: e.status.capitalized)
                    LabeledContent("From", value: e.start.formatted())
                    LabeledContent("Until", value: e.end.formatted())
                    ForEach(e.metrics) { m in LabeledContent(m.name, value: m.detail) }
                    Text(e.request.consentText).font(.footnote)
                }
                if let notice = model.sharing.notices[e.id] { Section { Text(notice) } }
                if let problem = model.sharing.problem { Section { Text(problem).foregroundStyle(.red) } }
                if ["active", "paused"].contains(e.status) {
                    Section {
                        if e.status == "active", model.sharing.isEnabled(e.id) {
                            Button(model.sharing.running.contains(e.id) ? "Sending…" : "Send available data") { model.sharing.send(e.id) }.disabled(model.sharing.running.contains(e.id))
                            if e.request.mode == "ongoing" { Button("Pause sharing") { Task { await model.sharing.change("pause", enrollment: e) } } }
                            else { Button("Finish this contribution") { confirmFinish = true }.disabled(model.sharing.running.contains(e.id)) }
                        } else if e.status == "paused", e.request.mode == "ongoing" {
                            Button("Resume with new data") { Task { await model.sharing.change("resume", enrollment: e) } }
                            Text("Resuming starts from now. Data from the paused interval will not be sent.").font(.footnote).foregroundStyle(.secondary)
                        } else if e.status == "active" {
                            Button("Enable sharing on this iPhone") { Task { await model.sharing.change("credential", enrollment: e) } }
                            Text("This replaces the credential used by any other iPhone for this request.").font(.footnote).foregroundStyle(.secondary)
                        }
                        Button("Stop sharing", role: .destructive) { confirmStop = true }
                    }.disabled(model.sharing.busy)
                    .confirmationDialog("Stop sharing with \(e.request.organizer)?", isPresented: $confirmStop, titleVisibility: .visible) {
                        Button("Stop sharing", role: .destructive) { Task { await model.sharing.change("stop", enrollment: e) } }
                    } message: { Text("Future uploads stop. Existing contributions remain until the retention period ends; contact the organizer about downloaded copies.") }
                    .confirmationDialog("Finish this contribution?", isPresented: $confirmFinish, titleVisibility: .visible) {
                        Button("Finish contribution") { Task { await model.sharing.change("finish", enrollment: e) } }
                    } message: { Text("This ends further uploads, including any unsent records. Review the last receipt before finishing.") }
                }
            }
        }.navigationTitle("Sharing details").navigationBarTitleDisplayMode(.inline)
    }
}
struct CollectionDirectoryView: View {
    @Environment(AppModel.self) private var model
    @State private var requests: [CollectionRequest] = []
    @State private var loaded = false
    @State private var problem: String?
    var body: some View {
        List {
            Section { Text("Optional studies and programs. A directory listing is not an endorsement or ethics approval.").foregroundStyle(.secondary) }
            ForEach(requests) { r in Button { model.sharing.invitation = CollectionInvitation(id: r.id) } label: { VStack(alignment: .leading, spacing: 6) { Text(r.title).font(.headline); Text(r.organizer).foregroundStyle(.secondary); Text(r.purpose).font(.subheadline).lineLimit(3) } } }
            if loaded && requests.isEmpty { Text(problem ?? "No opportunities are listed yet. You can still join through an invitation.") }
            if !loaded { ProgressView() }
        }.navigationTitle("Opportunities")
        .task { do { requests = try await model.sharing.discover() } catch { problem = error.localizedDescription }; loaded = true }
    }
}
struct ManageCollectionRequestsView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        List {
            Section {
                NavigationLink("Create request") { CreateCollectionRequestView() }
                Link("Manage requests on the website", destination: PulsHealthDatabase.viewerURL.appending(path: "requests"))
            } footer: { Text("Create a request for yourself, an organization, a group or a study. Invitations and contributions are stored on the PulsHealth server.") }
            ForEach(model.sharing.requests) { request in
                Section { CollectionRequestRow(request: request) }
            }
            if let problem = model.sharing.problem { Text(problem).foregroundStyle(.red) }
            NavigationLink("Sign in or view account") { UserView(account: model.sharing.account) }
        }.navigationTitle("Requests").task { await model.sharing.refresh() }
    }
}
private struct CollectionRequestRow: View {
    let request: CollectionRequest
    var body: some View {
        Link(destination: PulsHealthDatabase.viewerURL.appending(path: "requests")) {
            VStack(alignment: .leading, spacing: 5) { Text(request.title).font(.headline); Text("\(request.status.capitalized) · \(request.metrics.count) metrics").font(.caption).foregroundStyle(.secondary) }
        }
    }
}
struct CreateCollectionRequestView: View {
    @Environment(AppModel.self) private var model
    @State private var title = ""
    @State private var organizer = ""
    @State private var kind = "general"
    @State private var purpose = ""
    @State private var contact = ""
    @State private var consent = ""
    @State private var mode = "ongoing"
    @State private var history = 30
    @State private var duration = 90
    @State private var retention = 90
    @State private var metrics: [CollectionMetric] = []
    @State private var search = ""
    @State private var busy = false
    @State private var error: String?
    @State private var invitation: URL?
    struct Definition: Encodable {
        var title, organizer, kind, purpose, contact, consentText, mode: String
        var historyDays, durationDays, retentionDays: Int
        var metrics: [CollectionMetric]
    }
    struct Create: Encodable { var action = "create"; var definition: Definition; var listed = false }
    var body: some View {
        Form {
            if let invitation {
                Section { Label("Request created", systemImage: "checkmark.circle.fill"); ShareLink("Share invitation", item: invitation); Text("Only people with your invitation can review this request. Manage participants and downloads on the website.") }
            } else {
                Section("Request") {
                    TextField("Request name", text: $title); TextField("Person or organization", text: $organizer)
                    Picker("Type", selection: $kind) { Text("General request").tag("general"); Text("Group program").tag("group"); Text("Research study").tag("study") }
                    TextField("Purpose and intended use", text: $purpose, axis: .vertical)
                    TextField("Contact email or URL", text: $contact).textInputAutocapitalization(.never)
                }
                Section("Collection") {
                    Picker("Schedule", selection: $mode) { Text("One time").tag("once"); Text("Ongoing").tag("ongoing") }
                    Stepper("\(history) days of history", value: $history, in: 1...3650)
                    if mode == "ongoing" { Stepper("\(duration) days of sharing", value: $duration, in: 1...365) }
                    Stepper("Retain for \(retention) days after receipt", value: $retention, in: 1...365)
                }
                Section {
                    ForEach($metrics) { $metric in
                        VStack(alignment: .leading) {
                            Text(metric.name)
                            Picker("Detail", selection: $metric.function) {
                                Text("Individual records").tag("raw")
                                ForEach(HealthTypeCatalog.allowedAggregateFunctions(for: metric.type)) { function in Text("Daily \(function.displayName)").tag(function.rawValue) }
                            }
                            Toggle("Required", isOn: $metric.required)
                        }
                    }.onDelete { metrics.remove(atOffsets: $0) }
                    NavigationLink("Choose metrics") { metricPicker }
                } header: { Text("Requested data") } footer: { Text("Daily summaries include complete days only. Profiles, device names, sources and metadata are excluded.") }
                Section("Consent and data use") { TextField("Who can access contributions, how they are used, and withdrawal contact", text: $consent, axis: .vertical) }
                Section {
                    Text("Invitation-only. Scope is fixed once created. Downloaded copies remain your responsibility, including retention and deletion. Research studies must have their own consent and approval process.").font(.footnote).foregroundStyle(.secondary)
                    Button(busy ? "Creating…" : "Create request") { Task { await create() } }.disabled(busy || metrics.isEmpty || [title,organizer,purpose,contact,consent].contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }))
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
        }.navigationTitle("Create request").navigationBarTitleDisplayMode(.inline)
    }
    private var metricPicker: some View {
        List {
            ForEach(HealthTypeCatalog.all.filter { descriptor in [.quantity, .category].contains(descriptor.kind) && !metrics.contains(where: { $0.type == descriptor.identifier }) && (search.isEmpty || descriptor.displayName.localizedCaseInsensitiveContains(search)) }, id: \.identifier) { descriptor in
                Button { metrics.append(CollectionMetric(type: descriptor.identifier, function: "raw", required: true, unit: descriptor.unitString)) } label: { Label(descriptor.displayName, systemImage: "plus.circle") }.disabled(metrics.count >= 30)
            }
        }.searchable(text: $search).navigationTitle("Add metrics")
    }
    private func create() async {
        busy = true; defer { busy = false }
        do {
            let d = Definition(title: title, organizer: organizer, kind: kind, purpose: purpose, contact: contact, consentText: consent, mode: mode, historyDays: history, durationDays: duration, retentionDays: retention, metrics: metrics)
            let response: CollectionResponse<CollectionRequest> = try await model.sharing.account.collectionCommand(Create(definition: d))
            guard let code = response.invite else { throw CollectionError("Invitation unavailable. Open the website to create a new link.") }
            var url = URLComponents(url: PulsHealthDatabase.viewerURL.appending(path: "collect/" + response.result.id.uuidString.lowercased()), resolvingAgainstBaseURL: false)!
            url.fragment = code; invitation = url.url
            await model.sharing.refresh()
        } catch { self.error = error.localizedDescription }
    }
}
