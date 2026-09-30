import SwiftUI
import PulsHealthSync

/// Screens the Explore tab pushes. `type` is a seam: today it opens the
/// per-type sync detail, and the type page that replaces it takes the same
/// route, so nothing that pushes one has to change.
enum ExploreRoute: Hashable {
    case type(String)
}

/// The home tab: the catalog by category, the way Apple Health's Browse screen
/// lays it out, with a card of what this install is doing at the top. A type
/// that is synced opens its detail; one that is not is listed but leads
/// nowhere yet — turning it on is the Sync tab's job.
///
/// The two Health-access cards live here, not on Sync, because they are about
/// what the app may read at all, server or no server.
struct ExploreView: View {
    @Environment(AppModel.self) private var model
    @State private var searchText = ""

    var body: some View {
        List {
            if searchText.isEmpty {
                accessCards
                headerCard
                ForEach(HealthTypeDescriptor.Group.allCases, id: \.self) { group in
                    categorySection(group, types: HealthTypeCatalog.all.filter { $0.group == group })
                }
            } else {
                searchResults
            }
        }
        .navigationTitle("Explore")
        .searchable(text: $searchText, prompt: "Search data types")
        .navigationDestination(for: ExploreRoute.self) { route in
            switch route {
            case .type(let id):
                if let status = model.statuses.first(where: { $0.id == id }) {
                    TypeDetailView(status: status)
                }
            }
        }
    }

    // MARK: - Cards

    @ViewBuilder private var accessCards: some View {
        if model.needsAuthorization || !model.authorizationRequested {
            if model.authorizationRequested {
                CardSection(
                    "Health access incomplete",
                    subtitle: "Some enabled data types haven't been authorized yet, so their syncs will fail."
                ) {
                    // The Synced Data screen's Apply bar only appears while
                    // changes are staged, so in this exact situation (types
                    // added to the catalog after the first grant, or an
                    // interrupted permission sheet) there was no button to
                    // tap. Request access directly; the request is idempotent
                    // and skips determined types.
                    Button("Grant Health Access") {
                        Task { await model.requestAccessForEnabledTypesIfNeeded() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    authorizationHint
                }
            } else {
                CardSection(
                    "Welcome to PulsHealth",
                    subtitle: "Choose what to sync under Sync → Synced Data and tap Apply — that's when Health access is requested. Then add a server on the Sync tab, or export files from the Export tab without one."
                ) {
                    authorizationHint
                }
            }
        }

        // A read denial is invisible to HealthKit's own API — after the
        // sheet, granted and denied report the same status, and a denied
        // read returns an empty set rather than an error. So nothing above
        // this fires: no banner, no failed type, no error. Every enabled
        // type finishing a sync with zero samples is the only evidence
        // left, and without this the app just looks idle and healthy.
        if model.readsLookBlocked {
            CardSection(
                "No data is coming through",
                subtitle: "Every enabled type has synced and returned nothing. Either Apple Health has no data for them yet, or read access was declined — iOS doesn't tell apps which. Check Settings → Privacy & Security → Health → PulsHealth."
            ) {
                Button("Open Health Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
    }

    @ViewBuilder private var authorizationHint: some View {
        if let hint = model.authorizationHint {
            Text(hint)
                .font(.footnote)
                .foregroundStyle(.orange)
        }
    }

    private var headerCard: some View {
        let enabled = model.appliedConfig.enabledTypes.count
        let lastSync = model.statuses.compactMap(\.state.lastSyncAt).max()
        return CardSection("Your health data") {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                StatTile(label: "Types synced", value: "\(enabled)", unit: "of \(HealthTypeCatalog.all.count)")
                StatTile(label: "Samples", value: model.totalSamples.compactString)
                StatTile(label: "Last sync", value: lastSync?.relativeString ?? "—")
                StatTile(label: "Uploaded", value: model.totalBytes.byteString)
            }
        }
    }

    // MARK: - Catalog

    @ViewBuilder private func categorySection(
        _ group: HealthTypeDescriptor.Group, types: [HealthTypeDescriptor]
    ) -> some View {
        if !types.isEmpty {
            Section {
                ForEach(types) { descriptor in
                    typeRow(descriptor, showsCategory: false)
                }
            } header: {
                HStack(spacing: 8) {
                    TypeIcon(group, size: .small)
                    Text(group.rawValue)
                }
            }
        }
    }

    private var searchResults: some View {
        let matches = HealthTypeCatalog.all.filter {
            $0.displayName.localizedCaseInsensitiveContains(searchText)
                || $0.group.rawValue.localizedCaseInsensitiveContains(searchText)
                || $0.identifier.localizedCaseInsensitiveContains(searchText)
        }
        return Section {
            if matches.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else {
                ForEach(matches) { descriptor in
                    typeRow(descriptor, showsCategory: true)
                }
            }
        }
    }

    /// Synced types open their detail; the rest are listed as they are, so
    /// the catalog reads the same whether three types are on or eighty.
    @ViewBuilder private func typeRow(_ descriptor: HealthTypeDescriptor, showsCategory: Bool) -> some View {
        if let status = model.statuses.first(where: { $0.id == descriptor.identifier }) {
            NavigationLink(value: ExploreRoute.type(status.id)) {
                ExploreTypeRow(descriptor: descriptor, status: status, showsCategory: showsCategory)
            }
        } else {
            ExploreTypeRow(descriptor: descriptor, status: nil, showsCategory: showsCategory)
        }
    }
}

private struct ExploreTypeRow: View {
    let descriptor: HealthTypeDescriptor
    let status: TypeSyncStatus?
    let showsCategory: Bool

    var body: some View {
        HStack(spacing: 12) {
            TypeIcon(descriptor)
            VStack(alignment: .leading, spacing: 1) {
                Text(descriptor.displayName)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let status, status.state.lastError != nil {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            }
        }
        .padding(.vertical, 2)
    }

    private var detail: String {
        var parts: [String] = []
        if showsCategory { parts.append(descriptor.group.rawValue) }
        if let status {
            parts.append("\(status.state.totalSamplesExported.compactString) samples")
            if let last = status.state.lastSyncAt { parts.append("synced \(last.relativeString)") }
        } else {
            parts.append("Not synced")
        }
        return parts.joined(separator: " · ")
    }
}
