import SwiftUI
import PulsHealthSync

struct ConnectionsView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: [SyncRoute]
    @State private var history = false
    init(path: Binding<[SyncRoute]>, history: Bool = false) {
        _path = path; _history = State(initialValue: history)
    }
    private var enrollments: [CollectionEnrollment] {
        model.sharing.enrollments.filter { e in
            !model.sharing.hiddenConnections.contains(e.id) &&
            (history == (["stopped", "complete"].contains(e.status) || e.end < Date() && e.request.mode == "ongoing"))
        }
    }
    var body: some View {
        List {
            if model.stateFileUnreadable { StateUnreadableNotice() }
            if !history {
                if model.sharing.hasSavedDraft {
                    NavigationLink { CreateCollectionRequestView() } label: {
                        ConnectionRow(title: "Finish group setup", ownership: "Draft", detail: model.sharing.creationDraft.title, status: "Not created", symbol: "square.and.pencil")
                    }
                }
                ForEach(model.savedDestinations) { destination in
                    NavigationLink { PersonalConnectionView(destination: destination, path: $path) } label: {
                        let active = destination.id == model.activeDestinationID
                        ConnectionRow(title: active && model.usesPulsHealthDatabase ? "PulsHealth database" : destination.identity.serverLabel,
                                      ownership: "Personal", detail: active ? lastPersonalReceipt : "Only the selected database receives uploads",
                                      status: personalStatus(active: active), symbol: "externaldrive")
                    }
                }
                if model.isSettingUpInitialSync {
                    NavigationLink(value: SyncRoute.personal) { Label("Finish database setup", systemImage: "checklist") }
                }
                ForEach(model.sharing.requests.filter { $0.status == "open" }) { request in
                    NavigationLink { OrganizerConnectionView(requestID: request.id) } label: { organizerRow(request) }
                }
            } else {
                ForEach(model.sharing.requests.filter { $0.status != "open" }) { request in
                    NavigationLink { OrganizerConnectionView(requestID: request.id) } label: { organizerRow(request) }
                }
            }
            ForEach(enrollments.filter { e in !model.sharing.requests.contains { $0.id == e.request.id } }) { enrollment in
                NavigationLink { SharingDetailView(enrollmentID: enrollment.id) } label: {
                    let status = ConnectionPresentation.sharing(enrollment, running: model.sharing.running.contains(enrollment.id), enabled: model.sharing.isEnabled(enrollment.id))
                    ConnectionRow(title: enrollment.request.title, ownership: "Managed by \(enrollment.request.organizer)",
                                  detail: enrollment.lastReceived.map { "Last receipt \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "\(enrollment.metrics.count) metrics · \(enrollment.request.mode == "once" ? "One time" : "Ongoing")",
                                  status: status.label, symbol: status.symbol)
                }
            }
            if let problem = model.sharing.problem { Text(problem).foregroundStyle(.red) }
            if !history && model.savedDestinations.isEmpty && model.sharing.requests.isEmpty && enrollments.isEmpty && !model.isSettingUpInitialSync {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "arrow.triangle.2.circlepath").font(.largeTitle).foregroundStyle(.tint)
                        Text("Where should your data go?").font(.title2.bold())
                        Text("Connect to your own database or join another").foregroundStyle(.secondary)
                        NavigationLink("Add a connection") { AddConnectionView(path: $path) }.buttonStyle(.borderedProminent)
                    }.frame(maxWidth: .infinity).padding(.vertical, 30)
                }.listRowBackground(Color.clear)
            }
            if !history {
                NavigationLink { ConnectionsView(path: $path, history: true) } label: { Text("Connection history") }
            }
        }
        .navigationTitle(history ? "History" : "Connections")
        .toolbar { if !history { ToolbarItem(placement: .primaryAction) { NavigationLink { AddConnectionView(path: $path) } label: { Image(systemName: "plus") }.accessibilityLabel("Add a connection") } } }
        .navigationDestination(for: SyncRoute.self) { route in
            switch route {
            case .personal: SyncView(path: $path)
            case .server(let scan, let choice): ServerSettingsView(scanOnArrival: scan, preferred: choice)
            case .rawSamples: RawSamplesPickerView()
            case .aggregates: AggregatesPickerView(scope: .sync)
            case .activity: ActivityView()
            case .type(let id): if let status = model.statuses.first(where: { $0.id == id }) { TypeDetailView(status: status) }
            case .aggregateType(let id): if let descriptor = HealthTypeCatalog.descriptor(for: id) { AggregateTypeView(descriptor: descriptor, scope: .sync) }
            }
        }
        .task { await model.sharing.refresh() }
        .refreshable { await model.sharing.refresh() }
    }
    private var lastPersonalReceipt: String {
        model.statuses.compactMap(\.state.lastSyncAt).max().map { "Last sync \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "No sync recorded yet"
    }
    private func personalStatus(active: Bool) -> String {
        if !active { return "Inactive" }
        if model.syncPausedByPlan { return "Paused by plan" }
        if model.backfillActive || model.isSyncingAll { return "Syncing" }
        if model.typesFailed > 0 { return "Needs attention" }
        return model.statuses.contains { $0.state.lastSyncAt != nil } ? "Synced" : "Active"
    }
    private func organizerRow(_ r: CollectionRequest) -> some View {
        ConnectionRow(title: r.title, ownership: "You organize · \(r.participantCount ?? 0) participants",
                      detail: r.lastContribution.map { "Last contribution \(Date(timeIntervalSince1970: Double($0)/1000).formatted(date: .abbreviated, time: .shortened))" } ?? "No contributions yet",
                      status: r.status == "closed" ? "Closed" : (r.participantCount ?? 0) == 0 ? "Awaiting participants" : "Open", symbol: "person.2")
    }
}
struct ConnectionRow: View {
    var title: String
    var ownership: String
    var detail: String
    var status: String
    var symbol: String
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(ownership).font(.caption).foregroundStyle(.secondary)
            Text(title).font(.headline)
            Label(status, systemImage: symbol).font(.caption).foregroundStyle(status == "Needs attention" ? Color.orange : Color.accentColor)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 8)
    }
}
struct AddConnectionView: View {
    @Binding var path: [SyncRoute]
    var body: some View {
        List {
            NavigationLink { OwnDatabaseEntryView(path: $path) } label: { Label("Your database", systemImage: "externaldrive") }
            NavigationLink(value: SyncRoute.server(scan: false, choice: .pulsHealth)) { Label("PulsHealth database", systemImage: "cloud") }
            NavigationLink { List {
                NavigationLink { OpenDataRequestView() } label: { Label("Join a group", systemImage: "qrcode.viewfinder") }
                NavigationLink { CreateCollectionRequestView() } label: { Label("Create a group", systemImage: "person.2.badge.plus") }
            }.navigationTitle("Group connection") } label: {
                VStack(alignment: .leading, spacing: 4) { Label("Group connection", systemImage: "person.2"); Text("Join or create a group, study, or program.").font(.caption).foregroundStyle(.secondary) }
            }
            NavigationLink("Browse opportunities") { CollectionDirectoryView() }
        }.navigationTitle("Add a connection")
    }
}
struct OwnDatabaseEntryView: View {
    @Binding var path: [SyncRoute]
    var body: some View {
        List {
            NavigationLink(value: SyncRoute.server(scan: true, choice: .own)) { Label("Scan connection code", systemImage: "qrcode.viewfinder") }
            NavigationLink(value: SyncRoute.server(scan: false, choice: .own)) { Text("Enter details manually") }
        }.navigationTitle("Your database")
    }
}
struct PersonalConnectionView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let destination: SavedSyncDestination
    @Binding var path: [SyncRoute]
    @State private var remove = false
    var body: some View {
        List {
            LabeledContent("Server", value: destination.identity.serverLabel)
            LabeledContent("Status", value: destination.id == model.activeDestinationID ? "Selected database" : "Inactive")
            if destination.id == model.activeDestinationID {
                NavigationLink("Data, activity & sync controls", value: SyncRoute.personal)
            } else {
                Button("Use this database") { Task { if await model.switchDestination(id: destination.id) { path.append(.personal) } } }
            }
            Button("Remove connection", role: .destructive) { remove = true }
            if let error = model.lastErrorMessage { Text(error).foregroundStyle(.red) }
        }.navigationTitle("Personal connection")
        .confirmationDialog("Remove this connection from your iPhone?", isPresented: $remove, titleVisibility: .visible) {
            Button("Remove connection", role: .destructive) { Task { if await model.unpairDestination(id: destination.id) { dismiss() } } }
        } message: { Text("Local credentials and sync progress are removed. Data on the server is unchanged.") }
    }
}
