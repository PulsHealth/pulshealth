import PulsHealthSync
import SwiftUI

/// The per-type screen the Explore tab opens: what HealthKit holds for one
/// catalog type (its `TypeProfile`), the knowledge base's one-line description and typical range,
/// and the ways out — an aggregate preview, the sync detail.
///
/// Everything numeric comes from `ExploreModel`; nothing here reads
/// HealthKit itself except the aggregate preview, which goes through the
/// explorer (read-only, no sync state).
struct TypePageView: View {
    let identifier: String
    @Environment(AppModel.self) private var model
    @Environment(TypeActions.self) private var typeActions
    @State private var showsSyncChoices = false
    @State private var showsExportChoices = false
    @State private var showsSyncDetails = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var descriptor: HealthTypeDescriptor? { HealthTypeCatalog.descriptor(for: identifier) }
    private var knowledge: TypeKnowledge? { TypeKnowledge.article(for: identifier) }

    var body: some View {
        if let descriptor {
            content(descriptor)
        } else {
            EmptyState(title: "Unknown type", symbol: "questionmark.circle", message: identifier)
        }
    }

    private func content(_ descriptor: HealthTypeDescriptor) -> some View {
        let explore = model.explore
        let profile = explore.profiles[identifier]
        let facts = explore.quickFacts[identifier]
        return List {
            analysisCard(descriptor, profile: profile, facts: facts)
            if let profile, profile.sampleCount > 0 {
                if descriptor.kind == .quantity,
                   !AggregateFunction.choices(for: identifier).isEmpty {
                    AggregatePreviewSection(descriptor: descriptor, analysisRevision: profile.computedAt)
                } else if descriptor.kind == .category {
                    CategoryValuesSection(profile: profile, knowledge: knowledge, color: .accentColor)
                } else {
                    distributionSection(descriptor, profile: profile, color: .accentColor)
                }
                Section("Explore further") {
                    if let values = profile.values, values.count > 0 {
                        NavigationLink {
                            List {
                                analysisScope(profile)
                                distributionSection(descriptor, profile: profile, color: .accentColor)
                            }
                            .navigationTitle("Distribution")
                            .navigationBarTitleDisplayMode(.inline)
                        } label: {
                            detailLabel("Value distribution", subtitle: "Common readings, spread and extremes")
                        }
                    }
                    NavigationLink {
                        List {
                            analysisScope(profile)
                            statTiles(profile)
                            if !profile.dailyCounts.isEmpty {
                                SamplesOverTimeSection(profile: profile, color: .accentColor)
                            }
                            if !profile.sources.isEmpty || !profile.devices.isEmpty {
                                SourcesSection(profile: profile, color: .accentColor)
                            }
                            if let cadence = profile.cadence {
                                cadenceSection(cadence, profile: profile)
                            }
                        }
                        .navigationTitle("Recording details")
                        .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        detailLabel("Recording details", subtitle: "Coverage, sources and gaps")
                    }
                    NavigationLink {
                        List { header(descriptor, profile: profile, facts: facts) }
                            .navigationTitle("About this data")
                            .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        detailLabel("About this data", subtitle: "What is measured and available history")
                    }
                }
            } else if let profile, profile.isComplete {
                Section {
                    Text("No readable samples in this analysis period. There may be no data, or Health access may be off.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            if profile == nil || profile?.sampleCount == 0 {
                header(descriptor, profile: profile, facts: facts)
            }
        }
        .navigationTitle(descriptor.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { actions(descriptor) } }
        .navigationDestination(isPresented: $showsSyncDetails) {
            if let status = model.statuses.first(where: { $0.id == identifier }) { TypeDetailView(status: status) }
        }
        .sheet(isPresented: $showsSyncChoices) {
            TypeDataSelectionSheet(descriptor: descriptor, configuration: model.config)
        }
        .sheet(isPresented: $showsExportChoices) {
            TypeDataSelectionSheet(descriptor: descriptor,
                configuration: SyncConfiguration(enabledTypes: model.export.draft.types, aggregates: model.export.draft.aggregates),
                scope: .export)
        }
        .task {
            // The facts decide whether the profile is current; cheap enough
            // to refresh on every visit. Opening a type that has never been
            // analyzed starts its one analysis (which requests Health access
            // for the type when it has none); a stored profile is kept, and
            // stale ones are refreshed only by the Refresh button.
            await explore.refreshQuickFacts(for: [identifier])
            if explore.profiles[identifier] == nil { explore.analyze(identifier) }
        }
    }

    private func detailLabel(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.body)
            Text(subtitle).font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func analysisScope(_ profile: TypeProfile) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("Readings · " + (profileScope(profile) ?? "Available history"))
                    .font(.subheadline.weight(.medium))
                Text("Analyzed \(profile.computedAt.formatted(date: .abbreviated, time: .shortened))")
                if let start = profile.readableSince ?? profile.rangeStart {
                    Text("From \(start.formatted(date: .abbreviated, time: .omitted))")
                }
                if !profile.isComplete { Text("Incomplete scan: statistics describe only the data read.") }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Header

    private func header(_ descriptor: HealthTypeDescriptor, profile: TypeProfile?, facts: TypeQuickFacts?) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 14) {
                    TypeIcon(descriptor, size: .large)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(descriptor.displayName)
                            .font(.title3.weight(.semibold))
                        Text(subtitle(descriptor))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                // The type's own first sample: the facts', or a profile's
                // only when it covered the whole history.
                if let first = facts?.earliestStart ?? (profile?.rangeStart == nil ? profile?.earliestStart : nil),
                   let last = facts?.latestStart ?? profile?.latestStart
                {
                    Text(spanLine(first: first, last: last))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if let about = knowledge?.shortDescription {
                    Text(about)
                        .font(.footnote)
                }
                if let definitions = knowledge?.categoryValues, !definitions.isEmpty {
                    DisclosureGroup("Possible values") {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(Array(definitions.enumerated()), id: \.offset) { _, value in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(value.displayName).font(.subheadline.weight(.medium))
                                    if let description = value.description {
                                        Text(description).font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }.padding(.top, 8)
                    }.font(.subheadline)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func subtitle(_ descriptor: HealthTypeDescriptor) -> String {
        var parts = [descriptor.group.rawValue]
        if let unit = descriptor.unitString { parts.append(unit) }
        parts.append(kindLabel(descriptor.kind))
        return parts.joined(separator: " · ")
    }

    private func spanLine(first: Date, last: Date) -> String {
        let span = Self.spanFormatter.string(from: first, to: last) ?? ""
        return "first \(first.formatted(date: .abbreviated, time: .omitted)) · latest "
            + "\(last.formatted(date: .abbreviated, time: .omitted))" + (span.isEmpty ? "" : " · \(span)")
    }

    private static let spanFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = [.year, .month, .day]
        formatter.maximumUnitCount = 2
        formatter.unitsStyle = .full
        return formatter
    }()

    // MARK: - Analysis card

    @ViewBuilder
    private func analysisCard(_ descriptor: HealthTypeDescriptor, profile: TypeProfile?, facts: TypeQuickFacts?) -> some View {
        let explore = model.explore
        if let progress = explore.running[identifier] {
            Section {
                ProgressBanner(
                    title: "Analyzing \(descriptor.displayName)",
                    subtitle: progressText(progress),
                    fraction: explore.fraction(for: identifier),
                    onCancel: { explore.cancel(identifier) })
            }
        } else if profile == nil {
            // The analysis starts on its own when the page opens, so this is
            // only what stopped it: no data, a declined read, or a failure.
            let noData = facts != nil && facts?.latestStart == nil
            CardSection(
                noData ? "No data" : "Not analyzed",
                subtitle: noData
                    ? "Apple Health holds no \(descriptor.displayName) data, or read access was declined. iOS does not tell apps which."
                    : nil
            ) {
                if let error = explore.errors[identifier] {
                    Text(error).font(.footnote).foregroundStyle(.orange)
                }
                Button("Analyze") { explore.analyze(identifier, force: true) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        } else if let profile {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Reading analysis · " + (profileScope(profile) ?? "Available history"))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Refresh") { explore.analyze(identifier, force: true) }
                            .font(.subheadline)
                    }
                    if !profile.isComplete {
                        Label("Incomplete analysis", systemImage: "exclamationmark.circle")
                            .font(.subheadline.weight(.medium))
                        Text("Only part of the data was read. Counts may be low; averages and ranges may not represent the full period.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let since = profile.readableSince {
                        Text("Health access limited to data from \(since.formatted(date: .abbreviated, time: .omitted)). Change access in Settings → Privacy & Security → Health → PulsHealth.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if explore.isStale(identifier) {
                        Text(explore.readableHistoryChanged(identifier)
                            ? "Health access changed. Refresh this analysis."
                            : "New recordings are available. Refresh this analysis.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let note = explore.errors[identifier] ?? profile.failureReason {
                        Text(note).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }

        }
    }

    private func progressText(_ progress: ProfileProgress) -> String {
        switch progress.phase {
        case .probing: return "Starting"
        case .scanning:
            var text = "\(progress.samplesScanned.formatted()) samples scanned"
            if let through = progress.scannedThrough {
                text += " · through \(through.formatted(date: .abbreviated, time: .omitted))"
            }
            return text
        case .finishing: return "Finishing · \(progress.samplesScanned.formatted()) samples"
        }
    }

    // MARK: - Stat tiles

    private var gridColumns: [GridItem] {
        let count = dynamicTypeSize.isAccessibilitySize ? 1
            : (dynamicTypeSize >= .xxxLarge || sizeClass == .compact ? 2 : 4)
        return Array(repeating: GridItem(.flexible(), alignment: .top), count: count)
    }

    private func statTiles(_ profile: TypeProfile) -> some View {
        Section {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                StatTile(
                    label: "Samples", value: profile.sampleCount.compactString,
                    footnote: profile.unmappableCount > 0
                        ? "\(profile.unmappableCount.formatted()) not in \(profile.unitString ?? "unit")" : nil)
                StatTile(
                    label: "Days with data",
                    value: (profile.coverage?.daysWithSamples ?? profile.dailyCounts.count).compactString,
                    footnote: profile.coverage.map { "\(Int(($0.fraction * 100).rounded()))% of the span" })
                StatTile(
                    label: "Median gap",
                    value: profile.cadence.map { gapString($0.medianGapSeconds) } ?? "—")
                StatTile(
                    label: "Sources", value: "\(profile.sources.count)",
                    footnote: profile.sources.first?.name)
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - Distribution

    @ViewBuilder
    private func distributionSection(_ descriptor: HealthTypeDescriptor, profile: TypeProfile, color: Color) -> some View {
        switch descriptor.kind {
        case .quantity:
            if let values = profile.values, values.count > 0 {
                // A cumulative type's typical range is a day's total (0 to
                // 50,000 steps); against per-sample values it is only a grey
                // wash over the whole plot.
                let cumulative = HealthTypeCatalog.allowedAggregateFunctions(for: identifier).contains(.sum)
                ValueDistributionSection(
                    values: values, unit: profile.unitString, color: color,
                    isCumulative: cumulative)
            }
        case .category:
            EmptyView()  // the values card sits above the stat tiles
        case .workout:
            if !profile.labelCounts.isEmpty {
                let rows = profile.labelCounts.sorted { $0.count > $1.count }.map { activity in
                    ShareBars.Row(
                        label: TypeKnowledge.humanize(activity.label), measure: Double(activity.count),
                        measureText: "\(activity.count.formatted()) · "
                            + durationString(activity.totalDurationSeconds ?? 0))
                }
                let total = profile.workouts?.totalDurationSeconds
                ChartCard(
                    "Workouts by activity",
                    subtitle: total.map { "\(durationString($0)) in total, most frequent first" },
                    readout: "\(rows.count) \(rows.count == 1 ? "activity" : "activities")", placeholder: ""
                ) {
                    ShareBars(rows: rows, color: color)
                }
            }
        default:
            if !profile.labelCounts.isEmpty {
                let rows = profile.labelCounts.sorted { $0.count > $1.count }.map { label in
                    ShareBars.Row(
                        label: TypeKnowledge.humanize(label.label), measure: Double(label.count),
                        measureText: label.count.formatted())
                }
                ChartCard("Values", readout: "\(rows.count) distinct values", placeholder: "") {
                    ShareBars(rows: rows, color: color)
                }
            }
        }
    }

    // MARK: - Cadence

    private func cadenceSection(_ cadence: TypeProfile.Cadence, profile: TypeProfile) -> some View {
        let days = max(profile.coverage?.daysWithSamples ?? profile.dailyCounts.count, 1)
        let perDay = Double(profile.sampleCount) / Double(days)
        return CardSection("Cadence", subtitle: cadence.isEstimated ? "Gap percentiles are estimates" : nil) {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                StatTile(label: "Median gap", value: gapString(cadence.medianGapSeconds))
                StatTile(label: "90th percentile gap", value: gapString(cadence.p90GapSeconds))
                StatTile(label: "Per day with data", value: formatValue(perDay), unit: "samples")
                StatTile(label: "Longest gap", value: gapString(cadence.maxGapSeconds))
            }
            if cadence.zeroGapCount > 0 {
                Text("\(cadence.zeroGapCount.formatted()) samples share a timestamp with another. Usually the Watch and the iPhone both recording.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Actions

    private func actions(_ descriptor: HealthTypeDescriptor) -> some View {
        Menu {
            if model.export.isRunning {
                Button("View Export in Progress", systemImage: "square.and.arrow.up") { typeActions.open(.export) }
            } else {
                let selected = model.export.draft.types.contains(identifier)
                    || model.export.draft.aggregates.contains { $0.typeIdentifier == identifier }
                Button(selected ? "Edit Export Selection" : "Add to Export", systemImage: "square.and.arrow.up") {
                    showsExportChoices = true
                }
                if selected {
                    Button("Open Export", systemImage: "arrow.right") {
                        model.export.prepareDraft()
                        typeActions.open(.export)
                    }
                }
            }
            Section {
                Button(syncActionTitle, systemImage: "arrow.triangle.2.circlepath") { showsSyncChoices = true }
                    .disabled(model.stateFileUnreadable)
                if model.hasPendingTypeChanges(identifier) {
                    Button("Undo Sync Changes for This Type", systemImage: "arrow.uturn.backward") {
                        model.discardTypeSyncChanges(identifier)
                        typeActions.notice = nil
                    }
                }
                if model.statuses.contains(where: { $0.id == identifier }), model.appliedConfig.serverURL != nil {
                    Button("Sync Details", systemImage: "info.circle") { showsSyncDetails = true }
                }
            }
        } label: {
            Label("Use This Type", systemImage: "plus")
        }
        .accessibilityIdentifier("typeActions.menu")
    }

    private var syncActionTitle: String {
        if model.hasPendingTypeChanges(identifier) { return "Edit Sync Draft…" }
        if model.appliedConfig.serverURL != nil, model.appliedConfig.observedTypeIdentifiers.contains(identifier) {
            return "Manage Sync…"
        }
        return "Add to Sync…"
    }

}

// MARK: - Helpers

func kindLabel(_ kind: SampleKind) -> String {
    switch kind {
    case .quantity: "Quantity"
    case .category: "Category"
    case .workout: "Workouts"
    case .heartbeatSeries: "Heartbeat series"
    case .ecg: "ECG"
    case .stateOfMind: "State of Mind"
    case .medicationDose: "Medication doses"
    case .activitySummary: "Activity rings"
    }
}

/// The part of the history a profile covers, as the pages say it: "past
/// year", "past 90 days"; nil for a whole history.
func profileScope(_ profile: TypeProfile) -> String? {
    guard let days = profile.lookbackDays else { return nil }
    return days == 365 ? "past year" : "past \(days) days"
}

/// A gap between samples: seconds for the short ones, days for the long.
func gapString(_ seconds: TimeInterval) -> String {
    if seconds >= 2 * 86_400 { return String(format: "%.0f d", seconds / 86_400) }
    if seconds >= 5_400 { return String(format: "%.1f h", seconds / 3_600) }
    if seconds >= 90 { return String(format: "%.0f min", seconds / 60) }
    // Decided on the rounded milliseconds: a Watch's 0.9999 s gap is "1 s",
    // not "1000 ms".
    if (seconds * 1_000).rounded() >= 1_000 { return String(format: "%.0f s", seconds) }
    return String(format: "%.0f ms", seconds * 1_000)
}

// MARK: - Sections

private struct ValueDistributionSection: View {
    let values: TypeProfile.ValueDistribution
    let unit: String?
    let color: Color
    var isCumulative = false
    @State private var readout: String?

    var body: some View {
        ChartCard(
            "Value distribution",
            subtitle: isCumulative ? "Individual recorded amounts, not daily totals." : "How often each reading occurs.",
            readout: readout
        ) {
            VStack(alignment: .leading, spacing: 8) {
                HistogramChart(
                    histogram: values.histogram, unit: unit, color: color,
                    median: values.median, readout: $readout)
                Text("Middle 90%: \(formatValue(values.p5))–\(formatValue(values.p95))\(unit.map { " \($0)" } ?? "")")
                    .font(.subheadline.weight(.medium))
                Text(values.isEstimated
                    ? "Percentiles and chart counts are estimated from a sample of the readings."
                    : "The middle 90% runs from the 5th to the 95th percentile.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let axisNote {
                    Text(axisNote)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text("This describes your recorded values, not a healthy range.")
                    .font(.footnote).foregroundStyle(.secondary)
                statsRow
            }
        }
    }

    /// What the histogram leaves off its axis, when anything: the tails
    /// past the 1st and 99th percentiles (the 5th and 95th, past a long
    /// tail) that would otherwise squash every bar into a corner. The stats
    /// row under it still has the true extremes.
    private var axisNote: String? {
        let histogram = values.histogram
        let below = histogram.belowCount
        let above = histogram.aboveCount
        guard below + above > 0 else { return nil }
        let share = Double(below + above) / Double(max(values.count, 1))
        let percent = share < 0.005 ? "under 1%" : share.formatted(.percent.precision(.fractionLength(0)))
        let unitText = unit.map { " \($0)" } ?? ""
        let lower = formatValue(histogram.lowerBound)
        let upper = formatValue(histogram.upperBound)
        switch (below > 0, above > 0) {
        case (false, _): return "The axis stops at \(upper)\(unitText); \(percent) of samples are above it."
        case (_, false): return "The axis starts at \(lower)\(unitText); \(percent) of samples are below it."
        default: return "The axis covers \(lower)–\(upper)\(unitText); \(percent) of samples fall outside it."
        }
    }

    private var statsRow: some View {
        DisclosureGroup("All statistics") {
            VStack(spacing: 10) {
                statistic("Median", values.median)
                statistic("Average", values.mean)
                statistic("Lowest", values.min)
                statistic("Highest", values.max)
                statistic("5th percentile", values.p5)
                statistic("95th percentile", values.p95)
                statistic("Standard deviation", values.stddev)
                Text("Each reading has equal weight. Frequent recording periods contribute more than sparse ones.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(.top, 10)
        }
        .font(.subheadline)
    }

    private func statistic(_ label: String, _ value: Double) -> some View {
        LabeledContent(label, value: formatValue(value) + (unit.map { " \($0)" } ?? ""))
            .monospacedDigit()
    }

}

private struct SamplesOverTimeSection: View {
    let profile: TypeProfile
    let color: Color
    @State private var window: TimeWindow = .month
    @State private var readout: String?

    var body: some View {
        ChartCard("Recording frequency", subtitle: "Number of records, not the measured value. Days without records are not zero measurements.", readout: readout) {
            Picker("Window", selection: $window) {
                ForEach(TimeWindow.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        } chart: {
            DailyCountsChart(dailyCounts: profile.dailyCounts, window: window, color: color, readout: $readout)
        }
    }
}

/// Every value HealthKit defines for a category type — from the knowledge
/// base, in enum order, with its description — and how much of the data
/// each holds. A value with no samples stays in the list as an empty bar,
/// so the page says what the type *can* record, not only what it did.
/// Values seen in the data that the article does not know are appended
/// by raw value.
private struct CategoryValuesSection: View {
    let profile: TypeProfile?
    let knowledge: TypeKnowledge?
    let color: Color
    @State private var measure: Measure = .count
    @State private var showsDefinitions = false

    enum Measure: String, CaseIterable, Identifiable {
        case count = "Samples"
        case time = "Time"

        var id: String { rawValue }
    }

    private struct Entry: Identifiable {
        let id: String
        let name: String
        let rawValue: Int?
        let description: String?
        let count: Int
        let duration: TimeInterval
    }

    private var entries: [Entry] {
        let counts = profile?.labelCounts ?? []
        var seen = Set<Int>()
        var result: [Entry] = []
        for value in knowledge?.categoryValues ?? [] {
            let match = value.value.flatMap { raw in counts.first { $0.rawValue == raw } }
            if let raw = value.value { seen.insert(raw) }
            result.append(
                Entry(
                    id: value.value.map { "kb-\($0)" } ?? "kb-\(value.name ?? UUID().uuidString)",
                    name: value.displayName, rawValue: value.value, description: value.description,
                    count: match?.count ?? 0, duration: match?.totalDurationSeconds ?? 0))
        }
        for label in counts where label.rawValue.map({ !seen.contains($0) }) ?? true {
            result.append(
                Entry(
                    id: "data-\(label.label)",
                    name: label.rawValue.map { "Value \($0)" } ?? TypeKnowledge.humanize(label.label),
                    rawValue: label.rawValue, description: "Not described by the knowledge base.",
                    count: label.count, duration: label.totalDurationSeconds ?? 0))
        }
        return result
    }

    /// Time is only worth a toggle when the samples have length: sleep
    /// stages and stand hours do, a logged symptom is an instant.
    private var isSleep: Bool { profile?.typeIdentifier == "HKCategoryTypeIdentifierSleepAnalysis" }

    private var totalDuration: TimeInterval { entries.reduce(0) { $0 + $1.duration } }
    private var hasDuration: Bool { totalDuration >= 60 }

    private var rows: [ShareBars.Row] {
        entries.filter { showsDefinitions || $0.count > 0 }.map { entry in
            let text: String
            switch measure {
            case .count: text = entry.count.formatted()
            case .time: text = entry.count == 0 ? "0" : durationString(entry.duration)
            }
            return ShareBars.Row(
                id: entry.id, label: entry.name,
                measure: measure == .count ? Double(entry.count) : entry.duration,
                measureText: text, detail: showsDefinitions ? entry.description : nil)
        }
    }

    private var readout: String? {
        guard profile != nil else { return nil }
        let present = entries.filter { $0.count > 0 }.count
        let known = knowledge?.categoryValues?.count ?? 0
        if known == 0 { return "\(present) distinct values" }
        return "\(present) of \(entries.count) values in your data"
    }

    var body: some View {
        let hasDuration = hasDuration
        if entries.isEmpty {
            EmptyView()
        } else {
        ChartCard(
            isSleep ? "Sleep records" : "Recorded values",
            subtitle: isSleep
                ? (measure == .time ? "Recorded time by stage, not time asleep per night." : "Number of records by stage, not time asleep.")
                : "Bars compare the recorded categories.",
            readout: readout, placeholder: ""
        ) {
            if hasDuration {
                Picker("Measure", selection: $measure) {
                    ForEach(Measure.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
            }
        } chart: {
            ShareBars(rows: rows, color: color)
            Toggle("Show definitions and unrecorded values", isOn: $showsDefinitions)
                .font(.subheadline)
            if hasDuration, measure == .time {
                Text(isSleep
                    ? "In-bed and sleep stages can overlap, as can records from different sources. These durations cannot be added to find total sleep or stage percentages."
                    : "Durations include overlapping records from all sources.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear { if hasDuration { measure = .time } }
        }
    }
}

private struct SourcesSection: View {
    let profile: TypeProfile
    let color: Color
    @State private var showsDevices = false

    private var rows: [ShareBars.Row] {
        if showsDevices {
            return profile.devices.sorted { $0.count > $1.count }.enumerated().map { index, device in
                ShareBars.Row(
                    id: "device-\(index)", label: device.name ?? device.model ?? "No device",
                    measure: Double(device.count), measureText: device.count.formatted(),
                    detail: range(device.earliestStart, device.latestStart),
                    tag: device.name != nil ? device.model : nil)
            }
        }
        return profile.sources.sorted { $0.count > $1.count }.enumerated().map { index, source in
            ShareBars.Row(
                id: "source-\(index)", label: source.name,
                measure: Double(source.count), measureText: source.count.formatted(),
                detail: range(source.earliestStart, source.latestStart))
        }
    }

    private func range(_ from: Date, _ to: Date) -> String {
        "\(from.formatted(date: .abbreviated, time: .omitted)) – \(to.formatted(date: .abbreviated, time: .omitted))"
    }

    var body: some View {
        ChartCard(
            "Sources and devices",
            readout: "\(rows.count) \(showsDevices ? "devices" : "sources")", placeholder: ""
        ) {
            if !profile.devices.isEmpty, !profile.sources.isEmpty {
                Picker("Breakdown", selection: $showsDevices) {
                    Text("Source").tag(false)
                    Text("Device").tag(true)
                }
                .pickerStyle(.segmented)
            }
        } chart: {
            ShareBars(rows: rows, color: color)
        }
        .onAppear { showsDevices = profile.sources.isEmpty }
    }
}

/// The buckets an aggregate would produce, computed through the explorer as
/// the sync would compute them and sent nowhere (`AggregatePreviewPane`),
/// with the controls to try others and the buttons that add the one shown to
/// Sync or to the export.
private struct AggregatePreviewSection: View {
    @Environment(TypeActions.self) private var typeActions
    let descriptor: HealthTypeDescriptor
    let analysisRevision: Date
    @Environment(AppModel.self) private var model
    @State private var function: AggregateFunction?
    @State private var interval: AggregateIntervalUnit = .day
    @State private var deviceFilter: AggregateDeviceFilter = .all
    @State private var window: PreviewWindow = .month
    @State private var readout: String?
    @State private var added = false

    enum PreviewWindow: String, CaseIterable, Identifiable {
        case week = "7 d"
        case month = "30 d"
        case year = "1 y"

        var id: String { rawValue }
        var days: Int {
            switch self {
            case .week: 7
            case .month: 30
            case .year: 365
            }
        }
    }

    private var functions: [AggregateFunction] {
        AggregateFunction.choices(for: descriptor.identifier)
    }

    /// Where the selected window begins, as the preview computes it.
    private var windowStart: Date {
        Calendar.current.date(byAdding: .day, value: -window.days, to: Date()) ?? Date()
    }

    private var config: AggregateConfig? {
        guard let function else { return nil }
        return AggregateConfig(
            typeIdentifier: descriptor.identifier, function: function,
            intervalValue: 1, intervalUnit: interval, deviceFilter: deviceFilter)
    }

    var body: some View {
        ChartCard(
            "Over time",
            subtitle: config.map { $0.label + (deviceFilter == .all ? " · All devices" : "") },
            readout: readout
        ) {
            controls
        } chart: {
            if let config {
                AggregatePreviewPane(
                    config: config, days: window.days, color: .accentColor, readout: $readout, showsSummary: true, revision: analysisRevision)
            }
            if let since = model.explore.quickFacts[descriptor.identifier]?.readableSince,
               since > windowStart {
                // The explorer starts the series at the first whole bucket
                // it may read; say why the chart starts late rather than
                // let it look like missing data.
                Text("Nothing before \(since.formatted(date: .abbreviated, time: .omitted)): iOS lets PulsHealth read \(descriptor.displayName) only from then on.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if descriptor.identifier == "HKQuantityTypeIdentifierBloodPressureSystolic"
                || descriptor.identifier == "HKQuantityTypeIdentifierBloodPressureDiastolic" {
                Text("This chart summarizes one blood-pressure component. Daily averages are not paired blood-pressure readings.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            DisclosureGroup("Use this summary") { addButtons.padding(.top, 8) }
                .font(.subheadline)
        }
        .onAppear {
            if function == nil { function = functions.first }
        }
    }

    @ViewBuilder private var controls: some View {
        Picker("Window", selection: $window) {
            ForEach(PreviewWindow.allCases) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        DisclosureGroup("Chart options") {
            VStack(spacing: 8) {
                Picker("Value", selection: $function) {
                    ForEach(functions) { Text($0.plainName).tag(Optional($0)) }
                }
                Picker("Interval", selection: $interval) {
                    ForEach(AggregateIntervalUnit.choices) { Text(intervalLabel($0)).tag($0) }
                }
                Picker("Source", selection: $deviceFilter) {
                    Text("All devices").tag(AggregateDeviceFilter.all)
                    Text("Apple Watch").tag(AggregateDeviceFilter.watch)
                    Text("iPhone").tag(AggregateDeviceFilter.iphone)
                }
            }
            .pickerStyle(.menu)
        }
        .font(.subheadline)
    }

    /// The aggregate the chart shows, into the export's draft or Sync's. In
    /// either it joins the type's aggregates, which puts the type among the
    /// aggregated ones if it was not already.
    @ViewBuilder private var addButtons: some View {
        if let config {
            let inExport = model.aggregateList(.export).duplicates(config)
            let inSync = model.aggregateList(.sync).duplicates(config)
            HStack(spacing: 12) {
                Button(inExport ? "In Export" : "Add to Export") {
                    model.export.prepareDraft()
                    model.editAggregates(.export) { $0.add(config) }
                    typeActions.addedToExport(descriptor.displayName, count: model.export.draft.selectedTypeCount)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(inExport || model.export.isRunning)
                if model.appliedConfig.serverURL != nil {
                    Button(inSync ? "In Sync" : "Add to Sync") {
                        model.editAggregates(.sync) { $0.add(config) }
                        added = true
                        if model.aggregateList(.sync).configs.contains(config) { typeActions.addedToSync() }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(inSync)
                }
            }
            if added, inSync, model.hasPendingChanges {
                Text("Apply it on the Sync tab.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func intervalLabel(_ unit: AggregateIntervalUnit) -> String {
        switch unit {
        case .minute: "Every minute"
        case .hour: "Hourly"
        case .day: "Daily"
        case .week: "Weekly"
        case .month: "Monthly"
        }
    }
}
