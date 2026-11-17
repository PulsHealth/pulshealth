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
        ConnectionPage {
            if model.stateFileUnreadable { ConnectionNotice(title: "Settings unavailable", message: StateUnreadableNotice.message) }
            if !history {
                if model.sharing.hasSavedDraft {
                    NavigationLink(value: SyncRoute.createRequest) {
                        ConnectionRow(title: "Finish request setup", ownership: "Draft", detail: model.sharing.creationDraft.title, status: "Not created", symbol: "square.and.pencil")
                    }
                }
                ForEach(model.savedDestinations) { destination in
                    NavigationLink(value: ConnectionPresentation.route(destinationID: destination.id, activeID: model.activeDestinationID)) {
                        let active = destination.id == model.activeDestinationID
                        let name = model.connectionName(destination)
                        let receipt = active ? lastPersonalReceipt : "Inactive database"
                        ConnectionRow(title: name,
                                      ownership: "Personal", detail: name == destination.identity.serverLabel ? receipt : "\(destination.identity.serverLabel) · \(receipt)",
                                      status: personalStatus(active: active), symbol: "externaldrive")
                    }
                }
                if model.isSettingUpInitialSync {
                    NavigationLink(value: SyncRoute.personal) { Label("Finish database setup", systemImage: "checklist") }
                }
                ForEach(model.sharing.requests.filter { $0.status == "open" }) { request in
                    NavigationLink(value: SyncRoute.organizer(request.id)) { organizerRow(request) }
                }
            } else {
                ForEach(model.sharing.requests.filter { $0.status != "open" }) { request in
                    NavigationLink(value: SyncRoute.organizer(request.id)) { organizerRow(request) }
                }
            }
            ForEach(enrollments.filter { e in !model.sharing.requests.contains { $0.id == e.request.id } }) { enrollment in
                NavigationLink(value: SyncRoute.contribution(enrollment.id)) {
                    let status = ConnectionPresentation.sharing(enrollment, running: model.sharing.running.contains(enrollment.id), enabled: model.sharing.isEnabled(enrollment.id))
                    ConnectionRow(title: enrollment.request.title, ownership: "Managed by \(enrollment.request.organizer)",
                                  detail: enrollment.lastReceived.map { "Last receipt \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "\(enrollment.metrics.count) metrics · \(enrollment.request.mode == "once" ? "One time" : "Ongoing")",
                                  status: status.label, symbol: status.symbol)
                }
            }
            if let problem = model.sharing.connectionListProblem {
                ConnectionSurface {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Data requests unavailable", systemImage: "exclamationmark.circle").font(.headline)
                        Text(problem).font(.subheadline).foregroundStyle(.secondary)
                        HStack {
                            Button("Try again") { Task { await model.sharing.refresh() } }
                            NavigationLink("Account", value: SyncRoute.account)
                        }.buttonStyle(.bordered)
                    }
                }
            }
            if !history && model.savedDestinations.isEmpty && model.sharing.requests.isEmpty && enrollments.isEmpty && !model.isSettingUpInitialSync {
                VStack(spacing: 14) {
                    Image(systemName: "server.rack").font(.system(size: 38, weight: .light)).foregroundStyle(.tint)
                        .frame(width: 76, height: 76).background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 24))
                    Text("Where should your data go?").font(.title2.bold()).multilineTextAlignment(.center)
                    Text("Connect a database or share data through a request.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                    NavigationLink("Add a connection", value: SyncRoute.addConnection).buttonStyle(.borderedProminent).controlSize(.large)
                }.frame(maxWidth: .infinity).padding(.vertical, 48)
            }
            if !history && (!model.savedDestinations.isEmpty || model.sharing.hasRememberedConnections) {
                NavigationLink(value: SyncRoute.history) { Label("Connection history", systemImage: "clock.arrow.circlepath").font(.subheadline).foregroundStyle(Color.accentColor) }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 10)
            }
        }
        .buttonStyle(.plain)
        .navigationTitle(history ? "History" : "Connections")
        .toolbar { if !history { ToolbarItem(placement: .primaryAction) { NavigationLink(value: SyncRoute.addConnection) { Image(systemName: "plus").foregroundStyle(Color.accentColor) }.accessibilityLabel("Add a connection") } } }
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
/// Quiet cards match the Connections mockups without List's row chrome.
struct ConnectionPage<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14, content: content)
                .frame(maxWidth: 620).frame(maxWidth: .infinity).padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 28)
        }.background(Color(uiColor: .systemGroupedBackground))
    }
}
struct ConnectionSurface<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        content().frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(uiColor: .separator).opacity(0.16), lineWidth: 1))
    }
}
struct ConnectionNotice: View {
    var title: String
    var message: String
    var body: some View { ConnectionSurface { VStack(alignment: .leading, spacing: 8) { Text(title).font(.headline); Text(message).font(.subheadline).foregroundStyle(.secondary) } } }
}
struct ConnectionRow: View {
    var title: String
    var ownership: String
    var detail: String
    var status: String
    var symbol: String
    private var statusColor: Color {
        if status == "Syncing" { return .blue }
        if ["Paused", "Needs attention", "Paused by plan"].contains(status) { return .orange }
        if ["Open", "Awaiting participants"].contains(status) { return .purple }
        if ["Synced", "Active"].contains(status) { return .green }
        return .secondary
    }
    var body: some View {
        ConnectionSurface {
            VStack(alignment: .leading, spacing: 10) {
                Label(ownership, systemImage: ownership.hasPrefix("Personal") ? "externaldrive" : "person.2")
                    .font(.caption).foregroundStyle(.secondary)
                HStack(alignment: .top, spacing: 14) {
                    Text(title).font(.system(.headline, design: .rounded)).foregroundStyle(.primary)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary).padding(.top, 3)
                }
                HStack(spacing: 6) {
                    if status == "Syncing" { ProgressView().controlSize(.mini).tint(statusColor) }
                    else { Circle().fill(statusColor).frame(width: 6, height: 6) }
                    Text(status).font(.subheadline.weight(.medium)).foregroundStyle(statusColor)
                }
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }.contentShape(RoundedRectangle(cornerRadius: 20))
    }
}
struct ConnectionChoice: View {
    var title: String
    var detail: String? = nil
    var symbol: String
    var body: some View {
        ConnectionSurface {
            HStack(spacing: 15) {
                Image(systemName: symbol).font(.system(size: 23, weight: .regular)).foregroundStyle(.tint)
                    .frame(width: 48, height: 48).background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(.headline).foregroundStyle(.primary)
                    if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }.contentShape(RoundedRectangle(cornerRadius: 20))
    }
}
struct AddConnectionView: View {
    var body: some View {
        ConnectionPage {
            NavigationLink(value: SyncRoute.ownDatabase) { ConnectionChoice(title: "Your database", symbol: "externaldrive") }.accessibilityLabel("Your database")
            NavigationLink(value: SyncRoute.managedDatabase) { ConnectionChoice(title: "PulsHealth database", symbol: "cloud") }.accessibilityLabel("PulsHealth database")
            NavigationLink(value: SyncRoute.groupChoice) { ConnectionChoice(title: "Data requests", symbol: "person.2") }.accessibilityLabel("Data requests")
        }.buttonStyle(.plain).navigationTitle("Add a connection")
    }
}
struct GroupConnectionChoiceView: View {
    var body: some View {
        ConnectionPage {
            NavigationLink(value: SyncRoute.openRequest) { ConnectionChoice(title: "Open request", symbol: "qrcode.viewfinder") }.accessibilityLabel("Open request")
            NavigationLink(value: SyncRoute.createRequest) { ConnectionChoice(title: "Create request", symbol: "person.2.badge.plus") }.accessibilityLabel("Create request")
        }.buttonStyle(.plain).navigationTitle("Data requests")
    }
}
struct OwnDatabaseEntryView: View {
    var body: some View {
        ConnectionPage {
            NavigationLink(value: SyncRoute.server(scan: true, choice: .own)) { ConnectionChoice(title: "Scan connection code", symbol: "qrcode.viewfinder") }.accessibilityLabel("Scan connection code")
            NavigationLink(value: SyncRoute.server(scan: false, choice: .own)) { ConnectionChoice(title: "Enter details manually", symbol: "keyboard") }.accessibilityLabel("Enter details manually")
        }.buttonStyle(.plain).navigationTitle("Your database")
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
            LabeledContent("User ID", value: destination.userID).textSelection(.enabled)
            LabeledContent("Status", value: destination.id == model.activeDestinationID ? "Selected database" : "Inactive")
            if destination.id == model.activeDestinationID {
                NavigationLink("Data, activity & sync controls", value: SyncRoute.personal)
            } else {
                Button("Use this database") { Task { if await model.switchDestination(id: destination.id) { path.append(.personal) } } }
            }
            Button("Remove connection", role: .destructive) { remove = true }
            if let error = model.lastErrorMessage { Text(error).foregroundStyle(.red) }
            NavigationLink("Connection settings", value: SyncRoute.connectionSettings(destination.id))
        }.navigationTitle(model.connectionName(destination))
        .fullScreenCover(isPresented: $remove) {
            ConnectionRemovalView(destination: destination) {
                let removed = await model.unpairDestination(id: destination.id)
                if removed { model.sharing.returnToConnections = UUID() }
                return removed
            }
        }
    }
}

/// Register exactly once at the Connections stack root, never on a pushed page.
struct ConnectionRouteView: View {
    @Environment(AppModel.self) private var model
    var route: SyncRoute
    @Binding var path: [SyncRoute]
    var body: some View {
        switch route {
        case .personal: SyncView(path: $path)
        case .account: UserView(account: model.sharing.account)
        case .addConnection: AddConnectionView()
        case .ownDatabase: OwnDatabaseEntryView()
        case .connectionSettings(let id): ConnectionSettingsView(destinationID: id)
        case .managedDatabase: PulsHealthConnectionSetupView()
        case .groupChoice: GroupConnectionChoiceView()
        case .openRequest: OpenDataRequestView()
        case .createRequest: CreateCollectionRequestView()
        case .history: ConnectionsView(path: $path, history: true)
        case .personalDestination(let id):
            if let destination = model.savedDestinations.first(where: { $0.id == id }) { PersonalConnectionView(destination: destination, path: $path) }
        case .organizer(let id): OrganizerConnectionView(requestID: id)
        case .contribution(let id): SharingDetailView(enrollmentID: id)
        case .participants(let id): CollectionParticipantsView(requestID: id)
        case .deletion(let id):
            if let enrollment = model.sharing.enrollments.first(where: { $0.id == id }) { ConnectionDeletionView(enrollment: enrollment) }
        case .server(let scan, let choice): ServerSettingsView(scanOnArrival: scan, preferred: choice)
        case .rawSamples: RawSamplesPickerView()
        case .aggregates: AggregatesPickerView(scope: .sync)
        case .activity: ActivityView()
        case .type(let id): if let status = model.statuses.first(where: { $0.id == id }) { TypeDetailView(status: status) }
        case .aggregateType(let id): if let descriptor = HealthTypeCatalog.descriptor(for: id) { AggregateTypeView(descriptor: descriptor, scope: .sync) }
        }
    }
}

/// Settings belong to the selected connection; adding another starts at +.
struct ConnectionSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let destinationID: UUID
    @State private var name = ""
    @State private var loaded = false
    private var destination: SavedSyncDestination? { model.savedDestinations.first { $0.id == destinationID } }

    private func defaultName(_ destination: SavedSyncDestination) -> String {
        var automatic = destination
        automatic.name = nil
        return model.connectionName(automatic)
    }

    var body: some View {
        Form {
            if let destination {
                Section("Name (optional)") {
                    TextField(defaultName(destination), text: $name)
                        .accessibilityIdentifier("connection.name")
                }
                Section("Server") {
                    Text(destination.identity.serverLabel).textSelection(.enabled)
                    DisclosureGroup("Account details") {
                        LabeledContent("User ID", value: destination.userID)
                            .font(.caption).textSelection(.enabled)
                    }
                    if destinationID == model.activeDestinationID {
                        NavigationLink("Edit connection details", value: SyncRoute.server(scan: false))
                        NavigationLink("Sync settings") {
                            ConnectionSyncSettingsView(destinationID: destinationID)
                        }
                    }
                }
            }
            if let error = model.lastErrorMessage { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle("Connection settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    Task { if await model.renameDestination(id: destinationID, name: name) { dismiss() } }
                }.disabled(model.isUpdatingConnection || destination == nil)
            }
        }
        .onAppear {
            if !loaded { name = destination?.name ?? ""; loaded = true }
        }
    }
}
