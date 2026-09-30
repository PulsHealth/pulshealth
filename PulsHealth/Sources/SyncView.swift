import SwiftUI
import PulsHealthSync

/// Screens the Sync tab pushes. Value-based so `RootView`, which owns the
/// stack's path, can pop back to the Server screen when a pairing link is
/// accepted while another of them is on top.
enum SyncRoute: Hashable {
    /// The server form; `scan` opens the pairing scanner on arrival.
    case server(scan: Bool)
    case syncedData
    case activity
    case type(String)
}

/// The Sync tab: where the data goes and how that is going. With no server
/// applied it is a setup card — a supported way to use the app, not a fault.
/// With one it is the status of the sync, the synced types, and the way to
/// the Server, Synced Data and Activity screens.
struct SyncView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            if model.appliedConfig.serverURL == nil {
                setupCard
            } else {
                statusCard
                syncNowSection
                typesSection
            }
            linksSection
        }
        .navigationTitle("Sync")
        .navigationDestination(for: SyncRoute.self) { route in
            switch route {
            case .server(let scan): ServerSettingsView(scanOnArrival: scan)
            case .syncedData: TypePickerView()
            case .activity: ActivityView()
            case .type(let id):
                if let status = model.statuses.first(where: { $0.id == id }) {
                    TypeDetailView(status: status)
                }
            }
        }
        .refreshable { await model.syncNow(trigger: "pull-to-refresh") }
        .alert(
            "Error",
            isPresented: Binding(
                get: { model.lastErrorMessage != nil },
                set: { if !$0 { model.lastErrorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.lastErrorMessage ?? "")
        }
    }

    // MARK: - No server

    // Keyed on the *applied* server — where data goes today — so a URL
    // half-typed on the Server screen does not hide it.
    private var setupCard: some View {
        CardSection(
            "Keep a copy on your own server",
            subtitle: "Nothing is syncing yet. Pair with a PulsHealth server and new data is sent as it arrives; until then, the Export tab writes files without one."
        ) {
            HStack(spacing: 10) {
                NavigationLink(value: SyncRoute.server(scan: true)) {
                    Label("Scan Pairing Code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                NavigationLink(value: SyncRoute.server(scan: false)) {
                    Text("Enter Server Details")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .padding(.top, 2)
        }
    }

    // MARK: - Status

    private var statusCard: some View {
        let lastSync = model.statuses.compactMap(\.state.lastSyncAt).max()
        let connection = connectionSummary
        return CardSection(host, subtitle: lastSync.map { "Last sync \($0.relativeString)" } ?? "Not synced yet") {
            if model.typesFailed > 0 {
                StatusPill(text: "\(model.typesFailed) failing", color: .red)
            }
        } content: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(connection.color)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text("Connection")
                        .font(.subheadline)
                    Spacer()
                    Text(connection.label)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let detail = connection.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(connection.color == .red ? Color.red : .secondary)
                        .lineLimit(3)
                }
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                StatTile(label: "Samples sent", value: model.totalSamples.compactString)
                StatTile(label: "Uploaded", value: model.totalBytes.byteString, footnote: "gzip")
            }
            if model.typesBackfilling > 0 {
                ProgressBanner(
                    title: "Backfilling \(model.typesBackfilling) type\(model.typesBackfilling == 1 ? "" : "s")",
                    subtitle: model.backfillRemaining.map { "About \($0.shortDuration) left" }
                        ?? "Estimating how long it will take")
            }
        }
    }

    private var host: String {
        guard let url = model.appliedConfig.serverURL else { return "Server" }
        return url.host().map { $0 + (url.port.map { ":\($0)" } ?? "") } ?? url.absoluteString
    }

    /// What is known about reaching the applied server, newest evidence first:
    /// a type's sync error, then this session's Test Connection against that
    /// URL, then the fact that something has synced at all. A successful test
    /// after the last error outranks the error, which stays on the type until
    /// its next sync clears it.
    private var connectionSummary: (color: Color, label: String, detail: String?) {
        let failed = model.statuses
            .compactMap { status -> (at: Date, message: String)? in
                guard let message = status.state.lastError else { return nil }
                return (status.state.lastErrorAt ?? .distantPast, message)
            }
            .max { $0.at < $1.at }
        let test = model.lastConnectionTest.flatMap { $0.url == model.appliedConfig.serverURL ? $0 : nil }
        if let failed, test.map({ !$0.result.isSuccess || $0.at < failed.at }) ?? true {
            return (.red, "Error", failed.message)
        }
        if let test {
            return test.result.isSuccess
                ? (.green, "Connected", nil)
                : (.orange, "Failed", test.result.message)
        }
        if model.statuses.contains(where: { $0.state.lastSyncAt != nil }) {
            return (.green, "Connected", nil)
        }
        return (.gray, "Not tested", nil)
    }

    private var syncNowSection: some View {
        Section {
            Button {
                Task { await model.syncNow(trigger: "manual") }
            } label: {
                HStack {
                    Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
                    if model.isSyncingAll {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(model.backfillActive || !model.configured)
        }
    }

    private var typesSection: some View {
        Section("Types") {
            if model.statuses.isEmpty {
                EmptyState(
                    title: "No types synced",
                    symbol: "square.grid.2x2",
                    message: "Choose some under Synced Data below and tap Apply.")
            }
            ForEach(sortedStatuses) { status in
                NavigationLink(value: SyncRoute.type(status.id)) {
                    TypeRow(status: status)
                }
            }
        }
    }

    /// Failing first, then backfilling, then by name: what needs attention
    /// before what is busy before the rest.
    private var sortedStatuses: [TypeSyncStatus] {
        func rank(_ status: TypeSyncStatus) -> Int {
            if status.state.lastError != nil || status.activity == .failed { return 0 }
            if status.activity == .backfilling { return 1 }
            return 2
        }
        return model.statuses.sorted {
            let (a, b) = (rank($0), rank($1))
            if a != b { return a < b }
            return $0.descriptor.displayName.localizedStandardCompare($1.descriptor.displayName) == .orderedAscending
        }
    }

    // MARK: - Links

    private var linksSection: some View {
        Section {
            NavigationLink(value: SyncRoute.syncedData) {
                Label {
                    LabeledContent("Synced Data") {
                        Text("\(model.appliedConfig.enabledTypes.count) types")
                    }
                } icon: {
                    Image(systemName: "checklist")
                }
            }
            if model.appliedConfig.serverURL != nil {
                NavigationLink(value: SyncRoute.server(scan: false)) {
                    Label("Server", systemImage: "externaldrive.connected.to.line.below")
                }
            }
            NavigationLink(value: SyncRoute.activity) {
                Label("Activity", systemImage: "text.alignleft")
            }
        }
    }
}

struct TypeRow: View {
    let status: TypeSyncStatus

    var body: some View {
        HStack(spacing: 12) {
            TypeIcon(status.descriptor)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(status.descriptor.displayName)
                    Spacer()
                    activityBadge
                }
                HStack(spacing: 12) {
                    Text("\(status.state.totalSamplesExported.compactString) samples")
                    if let last = status.state.lastSyncAt {
                        Text("synced \(last.relativeString)")
                    }
                    if let rate = status.currentRate {
                        Text("\(Int(rate))/s").monospacedDigit()
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let error = status.state.lastError {
                    Text(error).font(.caption2).foregroundStyle(.red).lineLimit(1)
                }
            }
        }
    }

    @ViewBuilder private var activityBadge: some View {
        switch status.activity {
        case .backfilling:
            HStack(spacing: 4) {
                ProgressView().controlSize(.mini)
                if let eta = status.estimatedSecondsRemaining {
                    Text(eta.shortDuration).font(.caption2)
                }
            }
        case .syncing:
            ProgressView().controlSize(.mini)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
        case .idle:
            if status.state.backfillComplete {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .imageScale(.small)
            } else if status.state.anchorData == nil {
                Text("not synced").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/// A Test Connection and what it ran against (`AppModel.testConnection`), so
/// the Sync tab's status card can attribute the result to the applied server
/// and ignore one run against a URL that was never saved.
struct ConnectionTestRecord: Equatable {
    let url: URL
    let result: ConnectionTestResult
    let at: Date
}
