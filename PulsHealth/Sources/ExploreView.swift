import SwiftUI
import PulsHealthSync

/// Screens the Explore tab pushes. `type` opens the per-type page
/// (`TypePageView`), which links on to the sync detail when the type is
/// synced.
enum ExploreRoute: Hashable {
    case type(String)
}

/// The home tab: the catalog by category, the way Apple Health's Browse
/// screen lays it out, with what HealthKit holds for each type from
/// `ExploreModel` — the cheap facts for every row, the profile for the ones
/// that have been analyzed. Every type opens its page, whether it is synced
/// or not; turning sync on is the Sync tab's job.
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
                TypePageView(identifier: id)
            }
        }
        .task {
            await model.explore.load()
            model.explore.refreshQuickFactsIfNeeded()
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
                    "Health access not requested yet",
                    subtitle: "Tap a type to analyze it. The first analysis asks for Health access, and nothing is read until you allow it."
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

    /// How much of the catalog Health has anything for, and one button to
    /// analyze all of it.
    private var headerCard: some View {
        let explore = model.explore
        let withData = explore.typesWithData.count
        let total = HealthTypeCatalog.all.count
        return CardSection(
            "Your health data",
            subtitle: explore.quickFactsLoaded
                ? "\(withData) of \(total) types have data"
                    + (explore.earliestSample.map { " · since \($0.formatted(.dateTime.month(.abbreviated).year()))" } ?? "")
                : "Checking what Apple Health holds",
            action: {
                if explore.isAnalyzingAll {
                    Button("Cancel", role: .destructive) { explore.cancelAll() }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                } else {
                    Button("Analyze All") { explore.analyzeAll() }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(!explore.quickFactsLoaded || withData == 0)
                }
            }
        ) {
            if explore.isAnalyzingAll {
                ProgressBanner(
                    title: "Analyzing \(min(explore.analyzeAllDone + 1, explore.analyzeAllTotal)) of \(explore.analyzeAllTotal)",
                    subtitle: explore.running.keys.sorted()
                        .compactMap { HealthTypeCatalog.descriptor(for: $0)?.displayName }
                        .joined(separator: ", "),
                    fraction: explore.analyzeAllTotal > 0
                        ? Double(explore.analyzeAllDone) / Double(explore.analyzeAllTotal) : nil)
            } else {
                let analyzed = explore.profiles.count
                Text(analyzed == 0
                    ? "Analyze a type to see its counts, dates, values and sources. Summaries only, never samples."
                    : "\(analyzed) analyzed · \(model.appliedConfig.enabledTypes.count) synced")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Catalog

    @ViewBuilder private func categorySection(
        _ group: HealthTypeDescriptor.Group, types: [HealthTypeDescriptor]
    ) -> some View {
        if !types.isEmpty {
            Section {
                ForEach(ordered(types)) { descriptor in
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

    /// Types with data first, in catalog order; the rest after them.
    private func ordered(_ types: [HealthTypeDescriptor]) -> [HealthTypeDescriptor] {
        let facts = model.explore.quickFacts
        guard model.explore.quickFactsLoaded else { return types }
        return types.filter { facts[$0.identifier]?.latestStart != nil }
            + types.filter { facts[$0.identifier]?.latestStart == nil }
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

    private func typeRow(_ descriptor: HealthTypeDescriptor, showsCategory: Bool) -> some View {
        let explore = model.explore
        return NavigationLink(value: ExploreRoute.type(descriptor.identifier)) {
            ExploreTypeRow(
                descriptor: descriptor,
                profile: explore.profiles[descriptor.identifier],
                facts: explore.quickFacts[descriptor.identifier],
                factsLoaded: explore.quickFactsLoaded,
                isRunning: explore.isRunning(descriptor.identifier),
                status: model.statuses.first { $0.id == descriptor.identifier },
                showsCategory: showsCategory)
        }
    }
}

private struct ExploreTypeRow: View {
    let descriptor: HealthTypeDescriptor
    let profile: TypeProfile?
    let facts: TypeQuickFacts?
    let factsLoaded: Bool
    let isRunning: Bool
    let status: TypeSyncStatus?
    let showsCategory: Bool

    private var hasData: Bool { facts?.latestStart != nil || profile != nil }
    /// Greyed once the facts are in and say there is nothing.
    private var muted: Bool { factsLoaded && facts != nil && !hasData }

    var body: some View {
        HStack(spacing: 12) {
            TypeIcon(descriptor)
            VStack(alignment: .leading, spacing: 1) {
                Text(descriptor.displayName)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if isRunning {
                ProgressView().controlSize(.small)
            } else if let profile, !profile.dailyCounts.isEmpty {
                SparklineView(counts: last30Days(profile), color: descriptor.group.color)
            }
            if let status, status.state.lastError != nil {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            }
        }
        .padding(.vertical, 2)
        .opacity(muted ? 0.55 : 1)
    }

    private var detail: String {
        var parts: [String] = []
        if showsCategory { parts.append(descriptor.group.rawValue) }
        if let profile {
            parts.append("\(profile.sampleCount.compactString) samples")
            if let last = profile.latestStart { parts.append("last \(last.relativeString)") }
        } else if let facts, let first = facts.earliestStart {
            parts.append("Data since \(first.formatted(.dateTime.year()))")
            parts.append("tap to analyze")
        } else if facts != nil {
            parts.append("No data")
        } else if let status {
            parts.append("\(status.state.totalSamplesExported.compactString) synced")
        } else {
            parts.append(kindLabel(descriptor.kind))
        }
        return parts.joined(separator: " · ")
    }

    /// One count per calendar day for the 30 days ending on the profile's
    /// last day with data; zero where the profile has no entry.
    private func last30Days(_ profile: TypeProfile) -> [Int] {
        let calendar = Calendar.current
        guard let last = profile.dailyCounts.last?.day else { return [] }
        let byDay = Dictionary(profile.dailyCounts.map { ($0.day, $0.count) }, uniquingKeysWith: +)
        return (0..<30).reversed().map { offset in
            let day = calendar.date(byAdding: .day, value: -offset, to: last) ?? last
            return byDay[calendar.startOfDay(for: day)] ?? 0
        }
    }
}
