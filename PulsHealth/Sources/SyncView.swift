import SwiftUI
import PulsHealthSync

/// Screens the Sync tab pushes. Value-based so `RootView`, which owns the
/// stack's path, can pop back to the Database screen when a pairing link is
/// accepted while another of them is on top.
enum SyncRoute: Hashable {
    /// The Database screen; `scan` opens the pairing scanner on arrival, and
    /// `choice` is the option picked on the first-time screen (`SyncIntro`).
    case server(scan: Bool, choice: DatabaseDestination? = nil)
    /// The Raw Samples and Aggregates pickers (each section's Edit).
    case rawSamples
    case aggregates
    case activity
    /// A type's raw sync details.
    case type(String)
    /// A type's aggregates.
    case aggregateType(String)
}

/// Shown while this launch could not read the stored settings
/// (`AppModel.stateFileUnreadable`): what is on screen is an empty stand-in,
/// nothing is lost, and a relaunch loads the real thing.
struct StateUnreadableNotice: View {
    static let message = "PulsHealth started before this iPhone was unlocked and couldn’t read its settings, so none are shown and nothing can be saved. Nothing is lost: close PulsHealth from the app switcher and open it again."

    var body: some View {
        CardSection("Settings not loaded", subtitle: Self.message) {
            Image(systemName: "lock.fill")
                .font(.title3)
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
        } content: {
            EmptyView()
        }
    }
}

/// The Sync tab: where the data goes and how that is going. With no server
/// applied it is the first-time screen (`SyncIntro`): what syncing does and
/// the two places it can go — a supported way to use the app, not a fault;
/// the first tap on Sync is where the database is asked for, never the
/// first-run flow. With one it is the status of the sync, what is sent —
/// Raw Samples and Aggregates, each with Edit for its picker — and the way to
/// the Database and Activity screens.
struct SyncView: View {
    /// The stack's path, owned by `RootView` (a pairing link pushes onto it
    /// from outside); the first-time screen pushes the Database screen
    /// through it so its choices can be buttons rather than list rows, and
    /// the sections' Edit buttons push their pickers the same way.
    @Binding var path: [SyncRoute]
    @Environment(AppModel.self) private var model
    @State private var showsAllRaw = false
    @State private var showsAllAggregates = false

    /// Rows a section shows before Show All.
    private static let collapsedRows = 5

    var body: some View {
        List {
            if model.stateFileUnreadable {
                StateUnreadableNotice()
            }
            // Keyed on the *applied* server — where data goes today — so a URL
            // half-typed on the Database screen does not hide it.
            if model.appliedConfig.serverURL == nil {
                SyncIntro { path.append(.server(scan: false, choice: $0)) }
            } else {
                statusCard
                limitedHistoryNotice
                syncNowSection
                rawSamplesSection
                aggregatesSection
            }
            linksSection
        }
        .navigationTitle("Sync")
        .reviewRequestOpportunity(.sync, blocked: !path.isEmpty)
        .navigationDestination(for: SyncRoute.self) { route in
            switch route {
            case .server(let scan, let choice): ServerSettingsView(scanOnArrival: scan, preferred: choice)
            case .rawSamples: RawSamplesPickerView()
            case .aggregates: AggregatesPickerView(scope: .sync)
            case .activity: ActivityView()
            case .type(let id):
                if let status = model.statuses.first(where: { $0.id == id }) {
                    TypeDetailView(status: status)
                }
            case .aggregateType(let id):
                if let descriptor = HealthTypeCatalog.descriptor(for: id) {
                    AggregateTypeView(descriptor: descriptor, scope: .sync)
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
                StatusDot(text: connection.label, color: connection.color)
                if let detail = connection.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(connection.color == .red ? Color.red : .secondary)
                        .lineLimit(3)
                }
                if let paused = pausedSummary {
                    Text(paused)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            // Top-aligned, so a tile with a footnote does not push its
            // neighbour's label down to its middle.
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .top), count: 2), spacing: 12) {
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

    /// Any database by its host; the PulsHealth database by name *and* host,
    /// so the label never hides where the data goes.
    private var host: String {
        guard let url = model.appliedConfig.serverURL else { return "Database" }
        let address = url.host().map { $0 + (url.port.map { ":\($0)" } ?? "") } ?? url.absoluteString
        return model.usesPulsHealthDatabase ? "PulsHealth Database · \(address)" : address
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
            return (.red, "Sync error", failed.message)
        }
        if let test {
            return test.result.isSuccess
                ? (.green, "Connected", nil)
                : (.orange, "Connection test failed", test.result.message)
        }
        if model.statuses.contains(where: { $0.state.lastSyncAt != nil }) {
            return (.green, "Connected", nil)
        }
        return (.gray, "Connection not tested", nil)
    }

    /// Types automatic syncs are skipping after a refused upload
    /// (`TypeSyncStatus.cooldownUntil`): named when there is one, counted
    /// when there are more. Each type's own row says until when.
    private var pausedSummary: String? {
        let paused = model.statuses.filter(\.isPaused)
        guard let first = paused.first else { return nil }
        if paused.count == 1, let time = first.pausedUntilTime {
            return "\(first.descriptor.displayName) paused until \(time) after a refused upload. Sync Now retries."
        }
        return "\(paused.count) types paused after refused uploads. Sync Now retries."
    }

    /// iOS 27 limited history access: some types can be read, and so
    /// synced, only from a recent date on. Calm, not a fault — it is the
    /// user's choice — but the server's charts would otherwise just look
    /// short, so it says which types, since when, and the way to widen it.
    /// Nothing else is needed after that: the next sync notices the wider
    /// access and reads the rest of the history (`ReadableHistory`).
    @ViewBuilder private var limitedHistoryNotice: some View {
        if let summary = LimitedHistorySummary(model.readableHistory) {
            CardSection(
                "Limited Health history",
                subtitle: "iOS lets PulsHealth read \(summary.typesText) only from \(since(summary)), so older data has not been synced."
            ) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            } content: {
                Text("To sync all of it, open Settings → Privacy & Security → Health → PulsHealth and give each type Full Access. PulsHealth then syncs the earlier history by itself.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
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

    /// "Sep 1, 2026", or the span when types were limited on different days.
    private func since(_ summary: LimitedHistorySummary) -> String {
        if summary.isOneDay() {
            return summary.earliest.formatted(date: .abbreviated, time: .omitted)
        }
        return "between " + (summary.earliest..<summary.latest)
            .formatted(.interval.day().month(.abbreviated).year())
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

    // MARK: - What is sent

    /// The types that send raw samples, as applied: what needs attention
    /// first, the first few until Show All.
    private var rawSamplesSection: some View {
        let sorted = sortedStatuses
        let shown = showsAllRaw ? sorted : Array(sorted.prefix(Self.collapsedRows))
        return Section {
            if sorted.isEmpty {
                Text("No raw samples are sent. Tap Edit to choose types.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(shown) { status in
                NavigationLink(value: SyncRoute.type(status.id)) {
                    TypeRow(status: status)
                }
            }
            showAllButton(count: sorted.count, expanded: $showsAllRaw)
        } header: {
            sectionHeader("Raw Samples", route: .rawSamples)
        }
    }

    /// The aggregated types, as applied, each with what it has and how far
    /// it has got.
    private var aggregatesSection: some View {
        let types = aggregatedTypes
        let shown = showsAllAggregates ? types : Array(types.prefix(Self.collapsedRows))
        return Section {
            if types.isEmpty {
                aggregatesEmptyState
            }
            ForEach(shown, id: \.identifier) { descriptor in
                NavigationLink(value: SyncRoute.aggregateType(descriptor.identifier)) {
                    AggregatedTypeRow(descriptor: descriptor)
                }
            }
            showAllButton(count: types.count, expanded: $showsAllAggregates)
        } header: {
            sectionHeader("Aggregates", route: .aggregates)
        } footer: {
            Text("Daily totals and averages feed your database’s daily charts and AI assistants.")
        }
    }

    /// No aggregates applied: what they are for, and the one tap that gives
    /// every raw measurement its daily one (a staged edit, like any other).
    private var aggregatesEmptyState: some View {
        let raw = model.config.enabledTypes
        let missing = model.aggregateList(.sync).missingDailyDefaults(for: raw)
        return VStack(alignment: .leading, spacing: 10) {
            Text("A daily total or average for each measurement, computed on this iPhone.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            // Nothing to match (no raw measurements, or already matched and
            // waiting for Apply): no button rather than a dead one.
            if missing > 0 {
                Button("Match Raw Samples") {
                    model.editAggregates(.sync) { $0.addDailyDefaults(for: raw) }
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 4)
    }

    /// The applied aggregates' types, by name.
    private var aggregatedTypes: [HealthTypeDescriptor] {
        Set(model.appliedConfig.aggregates.map(\.typeIdentifier))
            .compactMap(HealthTypeCatalog.descriptor(for:))
            .sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
    }

    /// "Raw Samples ··· Edit", as Apple Health's Pinned header has it.
    private func sectionHeader(_ title: String, route: SyncRoute) -> some View {
        HStack {
            Text(title)
            Spacer()
            Button("Edit") { path.append(route) }
                .font(.subheadline)
                .textCase(nil)
                .accessibilityLabel("Edit \(title)")
        }
    }

    @ViewBuilder
    private func showAllButton(count: Int, expanded: Binding<Bool>) -> some View {
        if count > Self.collapsedRows {
            Button(expanded.wrappedValue ? "Show Less" : "Show All \(count)") {
                withAnimation { expanded.wrappedValue.toggle() }
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
            if model.appliedConfig.serverURL != nil {
                NavigationLink(value: SyncRoute.server(scan: false)) {
                    Label("Database", systemImage: "externaldrive.connected.to.line.below")
                }
            }
            NavigationLink(value: SyncRoute.activity) {
                Label("Activity", systemImage: "text.alignleft")
            }
        }
    }
}

/// An aggregated type in the Sync tab: what it has ("Daily total, hourly
/// total") and how far it has got, from the applied configuration.
private struct AggregatedTypeRow: View {
    @Environment(AppModel.self) private var model
    let descriptor: HealthTypeDescriptor

    var body: some View {
        let list = AggregateList(model.appliedConfig.aggregates)
        let status = AggregateStatus.combined(
            list.configs(for: descriptor.identifier).map(model.aggregateStatus))
        HStack(spacing: 12) {
            TypeIcon(descriptor)
            VStack(alignment: .leading, spacing: 3) {
                Text(descriptor.displayName)
                Text([list.summary(for: descriptor.identifier), status.map { $0.isFailure ? "not synced" : $0.text.lowercasedFirst }]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let status, status.isFailure {
                    Text(status.text).font(.caption2).foregroundStyle(.red).lineLimit(1)
                }
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
                if status.isPaused, let paused = status.pausedUntilText {
                    Text("\(paused) · Sync Now retries")
                        .font(.caption2).foregroundStyle(.orange).lineLimit(1)
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
        case .failed where status.isPaused:
            Image(systemName: "pause.circle.fill").foregroundStyle(.orange)
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
