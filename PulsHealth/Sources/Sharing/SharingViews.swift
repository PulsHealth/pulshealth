import SwiftUI
import PulsHealthSync

struct CollectionSummaryView: View {
    let request: CollectionRequest
    var body: some View {
        Section {
            Text(request.title).font(.title2.bold())
            Text(request.organizer).font(.headline)
            Text(request.purpose)
        }
        Section("Sharing period") {
            LabeledContent("Schedule", value: request.mode == "once" ? "One time" : "Ongoing")
            if let start = request.sharingStart, let end = request.sharingEnd {
                LabeledContent("Start", value: start.formatted())
                LabeledContent("End", value: end.formatted())
                Text("Times shown in \(TimeZone.current.identifier). Only data within this window is requested; joining later does not extend it.").font(.footnote).foregroundStyle(.secondary)
            } else {
                LabeledContent("History", value: "\(request.historyDays) days")
                if request.mode == "ongoing" { LabeledContent("Duration", value: "\(request.durationDays) days") }
            }
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
                    if let existing = model.sharing.enrollments.first(where: { $0.request.id == request.id }) {
                        if model.sharing.hiddenConnections.contains(existing.id) {
                            Button("Restore connection") { model.sharing.restoreConnection(existing.id) }
                        }
                        NavigationLink("Open existing connection") { SharingDetailView(enrollmentID: existing.id) }
                    } else if model.sharing.account.hasSession {
                        Toggle("I agree to this request and its data use", isOn: $accepted)
                        Button(request.mode == "once" ? "Agree & send available data" : "Agree & start sharing") {
                            Task { await model.sharing.join(request, metrics: request.metrics.filter { selected.contains($0.id) }, invite: invitation) }
                        }.disabled(!accepted || selected.isEmpty || model.sharing.busy)
                        if model.sharing.busy { ProgressView() }
                        if model.sharing.account.problem != nil || model.sharing.problem != nil {
                            NavigationLink("Check account for this request") { UserView(account: model.sharing.account) }
                        }
                    } else {
                        Text("This request collects through PulsHealth and requires an account.").font(.footnote).foregroundStyle(.secondary)
                        NavigationLink("Sign in for this request") { UserView(account: model.sharing.account) }
                    }
                }
            } else if problem == nil { ProgressView("Loading request…") }
            if let error = problem ?? model.sharing.problem { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle("Review request").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        .task {
            do {
                let loaded: CollectionRequest?
                if let owned = model.sharing.requests.first(where: { $0.id == invitation.id }) { loaded = owned }
                else { loaded = try await model.sharing.discover(invitation).first }
                guard let r = loaded else { throw CollectionError("This invitation has expired or was closed. Ask the organizer for a new link.") }
                request = r; selected = Set(r.metrics.filter(\.required).map(\.id))
                await model.sharing.refresh()
            } catch { problem = error.localizedDescription }
        }
    }
}
struct SharingDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let enrollmentID: UUID
    @State private var confirmStop = false
    @State private var confirmFinish = false
    @State private var confirmRemove = false
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
                        Button("Withdraw", role: .destructive) { confirmStop = true }
                    }.disabled(model.sharing.busy)
                    .confirmationDialog("Withdraw from \(e.request.organizer)?", isPresented: $confirmStop, titleVisibility: .visible) {
                        Button("Withdraw", role: .destructive) { Task { await model.sharing.change("stop", enrollment: e) } }
                    } message: { Text("Future uploads stop. Existing contributions remain until the retention period ends; contact the organizer about downloaded copies.") }
                    .confirmationDialog("Finish this contribution?", isPresented: $confirmFinish, titleVisibility: .visible) {
                        Button("Finish contribution") { Task { await model.sharing.change("finish", enrollment: e) } }
                    } message: { Text("This ends further uploads, including any unsent records. Review the last receipt before finishing.") }
                }
                Section {
                    NavigationLink(e.deletionStatus == "requested" ? "Deletion requested" : e.deletionStatus == "confirmed" ? "Deletion confirmed" : "Request deletion of shared data") { ConnectionDeletionView(enrollment: e) }
                    if ["stopped", "complete"].contains(e.status), e.deletionStatus != "requested" {
                        Button("Remove from this iPhone", role: .destructive) { confirmRemove = true }
                    }
                }
                .confirmationDialog("Remove this connection from your iPhone?", isPresented: $confirmRemove, titleVisibility: .visible) {
                    Button("Remove connection", role: .destructive) { Task { await model.sharing.removeConnection(e); if model.sharing.hiddenConnections.contains(e.id) { dismiss() } } }
                } message: { Text("This removes the local entry. Recipient copies are unchanged.") }
            }
        }.navigationTitle("Connection").navigationBarTitleDisplayMode(.inline)
    }
}
struct ManageCollectionRequestsView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        List {
            Section {
                NavigationLink("Create request") { CreateCollectionRequestView() }
            } footer: { Text("Request data once or on an ongoing basis for yourself, a group or a study. One-time requests can collect through PulsHealth or ask participants to export a file.") }
            ForEach(model.sharing.requests) { request in
                Section { CollectionRequestRow(request: request) }
            }
            if let problem = model.sharing.problem { Text(problem).foregroundStyle(.red) }
            NavigationLink("Sign in or view account") { UserView(account: model.sharing.account) }
        }.navigationTitle("Data requests").task { await model.sharing.refresh() }
    }
}
private struct CollectionRequestRow: View {
    @Environment(AppModel.self) private var model
    let request: CollectionRequest
    var body: some View {
        Button { model.sharing.organizerToOpen = request.id } label: {
            VStack(alignment: .leading, spacing: 5) { Text(request.title).font(.headline); Text("\(request.mode == "once" ? "One time" : "Ongoing") · \(request.status.capitalized) · \(request.metrics.count) metrics").font(.caption).foregroundStyle(.secondary) }
        }
    }
}
struct CreateCollectionRequestView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var title = ""
    @State private var organizer = ""
    @State private var kind = "general"
    @State private var purpose = ""
    @State private var contact = ""
    @State private var consent = ""
    @State private var mode = "ongoing"
    @State private var delivery = "hosted"
    @State private var history = 30
    @State private var startDate = Date()
    @State private var endDate = Calendar.current.date(byAdding: .day, value: 90, to: Date()) ?? Date()
    @State private var retention = 90
    @State private var metrics: [CollectionMetric] = []
    @State private var search = ""
    @State private var busy = false
    @State private var error: String?
    @State private var invitation: URL?
    @State private var fileInvitation: URL?
    @State private var fileDraft = FileConnectionDraft()
    @State private var didCreateFile = false
    struct Definition: Encodable {
        var title, organizer, kind, purpose, contact, consentText, mode: String
        var historyDays, durationDays, retentionDays: Int
        var metrics: [CollectionMetric]
        var startAt: Int64?
        var endAt: Int64?
    }
    struct Create: Encodable { var action = "create"; var definition: Definition; var listed = false }
    var body: some View {
        Form {
            if let invitation {
                Section { Label("Request created", systemImage: "checkmark.circle.fill"); ShareLink("Share invitation", item: invitation) }
            } else {
                Section("Request") {
                    TextField("Request name", text: $title); TextField("Person or organization", text: $organizer)
                    TextField("Purpose and intended use", text: $purpose, axis: .vertical)
                    TextField("Contact email or URL", text: $contact).textInputAutocapitalization(.never)
                }
                Section("Sharing") {
                    if mode == "ongoing" || delivery == "hosted" { LabeledContent("Destination", value: "PulsHealth storage") }

                    Picker("Schedule", selection: $mode) { Text("One time").tag("once"); Text("Ongoing").tag("ongoing") }
                    if mode == "once" {
                        Picker("Delivery", selection: $delivery) { Text("Collect in PulsHealth").tag("hosted"); Text("Export a file").tag("file") }
                    }
                    if mode == "ongoing" || delivery == "hosted" {
                        Picker("Request type", selection: $kind) { Text("General request").tag("general"); Text("Group program").tag("group"); Text("Research study").tag("study") }
                    } else {
                        Text("Participants generate a file to share or send to your receiver. No PulsHealth account is needed.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if mode == "once" && delivery == "file" {
                    FileRequestOptions(title: $title, requester: $organizer, purpose: $purpose, contact: $contact, draft: $fileDraft, link: $fileInvitation)
                } else {
                    Section("Sharing period") {
                        if mode == "ongoing" {
                            DatePicker("Start", selection: $startDate, in: Date(timeIntervalSince1970: 0)..., displayedComponents: [.date, .hourAndMinute])
                            DatePicker("End", selection: $endDate, in: startDate..., displayedComponents: [.date, .hourAndMinute])
                            Text("Times use \(TimeZone.current.identifier). A past start includes history; a future start schedules sharing. Everyone shares the same end date.").font(.footnote).foregroundStyle(.secondary)
                        } else { Stepper("\(history) days of history", value: $history, in: 1...3650) }
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
                        if model.sharing.account.hasSession {
                        Button(busy ? "Creating…" : "Create request") { Task { await create() } }.disabled(busy || metrics.isEmpty || [title,organizer,purpose,contact,consent].contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }))
                    } else { NavigationLink("Sign in to create in PulsHealth") { UserView(account: model.sharing.account) } }
                    if model.sharing.account.problem != nil { NavigationLink("Check account") { UserView(account: model.sharing.account) } }
                    }
                }
            }
            if model.sharing.serviceUnavailable && (mode == "ongoing" || delivery == "hosted") {
                Text("Data requests aren’t available on this server yet.").foregroundStyle(.secondary)
            }
            if let error { Text(error).foregroundStyle(.red) }
        }.navigationTitle(invitation == nil ? "Create request" : "Request created").navigationBarTitleDisplayMode(.inline)
        .onAppear { if !loaded { loadDraft(); loaded = true } }
        .onChange(of: model.sharing.accountRevision) { invitation = nil }
        .task { await model.sharing.account.restore() }
        .onChange(of: fileInvitation) { _, value in
            if value != nil {
                didCreateFile = true
                do { try model.sharing.clearDraft() } catch { self.error = error.localizedDescription }
            }
        }
        .onDisappear { if invitation == nil && !didCreateFile { saveDraft() } }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if invitation != nil {
                    Button("Done") { model.sharing.returnToConnections = UUID() }
                } else { Button("Save & close") { saveDraft(); if error == nil { model.sharing.returnToConnections = UUID() } }.disabled(busy) }
            }
        }
        .navigationDestination(isPresented: Binding(get: { fileInvitation != nil }, set: { if !$0 { fileInvitation = nil } })) {
            if let fileInvitation { RequestCodeView(link: fileInvitation) }
        }
    }
    private var metricPicker: some View {
        List {
            ForEach(HealthTypeCatalog.all.filter { descriptor in [.quantity, .category].contains(descriptor.kind) && !metrics.contains(where: { $0.type == descriptor.identifier }) && (search.isEmpty || descriptor.displayName.localizedCaseInsensitiveContains(search)) }, id: \.identifier) { descriptor in
                Button { metrics.append(CollectionMetric(type: descriptor.identifier, function: "raw", required: true, unit: descriptor.unitString)) } label: { Label(descriptor.displayName, systemImage: "plus.circle") }.disabled(metrics.count >= 30)
            }
        }.searchable(text: $search).navigationTitle("Add metrics")
    }
    private func loadDraft() {
        let d = model.sharing.creationDraft
        title = d.title; organizer = d.organizer; kind = d.kind; purpose = d.purpose
        contact = d.contact; consent = d.consent; mode = d.mode; delivery = d.delivery
        history = d.history; startDate = d.startDate; endDate = d.endDate; retention = d.retention; metrics = d.metrics; fileDraft = d.file ?? FileConnectionDraft()
    }
    private func saveDraft() {
        model.sharing.creationDraft = ConnectionDraft(title: title, organizer: organizer, kind: kind, purpose: purpose, contact: contact, consent: consent, mode: mode, delivery: delivery, history: history, startDate: startDate, endDate: endDate, retention: retention, metrics: metrics, file: fileDraft)
        do { try model.sharing.saveDraft(); error = nil } catch { self.error = error.localizedDescription }
    }
    private func create() async {
        busy = true; defer { busy = false }
        do {
            if mode == "ongoing" && (endDate <= startDate || endDate <= Date()) { throw CollectionError("Choose an end date after the start and in the future.") }
            let d = Definition(title: title, organizer: organizer, kind: kind, purpose: purpose, contact: contact, consentText: consent, mode: mode, historyDays: history, durationDays: 90, retentionDays: retention, metrics: metrics, startAt: mode == "ongoing" ? Int64(floor(startDate.timeIntervalSince1970 * 1000)) : nil, endAt: mode == "ongoing" ? Int64(floor(endDate.timeIntervalSince1970 * 1000)) : nil)
            let response: CollectionResponse<CollectionRequest> = try await model.sharing.command(Create(definition: d))
            guard let code = response.invite else { throw CollectionError("Invitation unavailable. Open the website to create a new link.") }
            var url = URLComponents(url: PulsHealthDatabase.viewerURL.appending(path: "collect/" + response.result.id.uuidString.lowercased()), resolvingAgainstBaseURL: false)!
            url.fragment = code; invitation = url.url
            try model.sharing.clearDraft()
            await model.sharing.refresh()
        } catch { self.error = error.localizedDescription }
    }
}
