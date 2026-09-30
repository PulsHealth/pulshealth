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
        return CardSection(host, subtitle: lastSync.map { "Last sync \($0.relativeString)" } ?? "Not synced yet") {
            if model.typesFailed > 0 {
                StatusPill(text: "\(model.typesFailed) failing", color: .red)
            }
        } content: {
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
            ForEach(model.statuses) { status in
                NavigationLink(value: SyncRoute.type(status.id)) {
                    TypeRow(status: status)
                }
            }
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
