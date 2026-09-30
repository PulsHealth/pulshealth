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
    @Environment(\.horizontalSizeClass) private var sizeClass

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
        let color = descriptor.group.color
        return List {
            header(descriptor, profile: profile, facts: facts)
            analysisCard(descriptor, profile: profile, facts: facts)
            if let profile {
                statTiles(profile)
                distributionSection(descriptor, profile: profile, color: color)
                if !profile.dailyCounts.isEmpty {
                    SamplesOverTimeSection(profile: profile, color: color)
                }
                if !profile.sources.isEmpty || !profile.devices.isEmpty {
                    SourcesSection(profile: profile, color: color)
                }
                if let cadence = profile.cadence {
                    cadenceSection(cadence, profile: profile)
                }
            }
            // Only after an analysis: that is what requests Health access for
            // the type, and a preview of a type with no data has nothing to
            // draw but an error.
            if profile != nil, descriptor.kind == .quantity,
               !HealthTypeCatalog.allowedAggregateFunctions(for: identifier).isEmpty {
                AggregatePreviewSection(descriptor: descriptor)
            }
            actions
        }
        .navigationTitle(descriptor.displayName)
        .navigationBarTitleDisplayMode(.inline)
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
                if let first = profile?.earliestStart ?? facts?.earliestStart,
                   let last = profile?.latestStart ?? facts?.latestStart
                {
                    Text(spanLine(first: first, last: last))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if let about = knowledge?.shortDescription {
                    Text(about)
                        .font(.footnote)
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
            let stale = explore.isStale(identifier)
            CardSection(
                "Analysis",
                subtitle: profile.isComplete
                    ? nil
                    : "The scan stopped early: every number is a lower bound. " + (profile.failureReason ?? ""),
                action: {
                    Button(stale ? "Refresh" : "Rescan") { explore.analyze(identifier, force: true) }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            ) {
                HStack(spacing: 8) {
                    StatusPill(
                        text: "as of \(profile.computedAt.formatted(date: .abbreviated, time: .shortened))",
                        color: stale ? .orange : .secondary)
                    if stale {
                        Text("Health has new data since").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let error = explore.errors[identifier] {
                    Text(error).font(.footnote).foregroundStyle(.orange)
                }
                if let note = profile.failureReason, profile.isComplete {
                    Text(note).font(.caption).foregroundStyle(.secondary)
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
        Array(repeating: GridItem(.flexible(), alignment: .top), count: sizeClass == .compact ? 2 : 4)
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
                ValueDistributionSection(
                    values: values, unit: profile.unitString, color: color,
                    typicalRange: knowledge?.typicalRange)
            }
        case .workout:
            if !profile.labelCounts.isEmpty {
                let rows = profile.labelCounts.map {
                    LabelBarsChart.Row(
                        label: $0.label, count: $0.count,
                        detail: $0.totalDurationSeconds.map { Self.durationFormatter.string(from: $0) ?? "" })
                }
                let total = profile.workouts?.totalDurationSeconds
                ChartCard(
                    "Workouts by activity",
                    subtitle: total.map { "\(Self.durationFormatter.string(from: $0) ?? "") in total" },
                    readout: rows.count > 1 ? "\(rows.count) activities" : nil, placeholder: ""
                ) {
                    LabelBarsChart(rows: rows, color: color)
                }
            }
        default:
            if !profile.labelCounts.isEmpty {
                let rows = profile.labelCounts.map { label in
                    LabelBarsChart.Row(
                        label: label.rawValue.flatMap { knowledge?.categoryLabel(for: $0) } ?? label.label,
                        count: label.count,
                        detail: label.totalDurationSeconds.map { Self.durationFormatter.string(from: $0) ?? "" })
                }
                ChartCard("Values", readout: "\(rows.count) distinct values", placeholder: "") {
                    LabelBarsChart(rows: rows, color: color)
                }
            }
        }
    }

    private static let durationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = [.day, .hour, .minute]
        formatter.maximumUnitCount = 2
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

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

    @ViewBuilder private var actions: some View {
        let status = model.statuses.first { $0.id == identifier }
        Section {
            // Adds the type to the Export tab's draft; the export itself is
            // started there, where the range and format are chosen.
            let inExport = model.export.draft.types.contains(identifier)
            Button {
                model.export.include(type: identifier)
            } label: {
                Label(inExport ? "In the Export draft" : "Export This Type", systemImage: "square.and.arrow.up")
            }
            .disabled(inExport || model.export.isRunning)
            if let status {
                NavigationLink {
                    TypeDetailView(status: status)
                } label: {
                    Label("Sync details", systemImage: "arrow.triangle.2.circlepath")
                }
            }
        } footer: {
            if inExportFooter {
                Text("Choose the range and format on the Export tab.")
            }
        }
    }

    private var inExportFooter: Bool { model.export.draft.types.contains(identifier) }
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

/// A gap between samples: seconds for the short ones, days for the long.
func gapString(_ seconds: TimeInterval) -> String {
    if seconds >= 2 * 86_400 { return String(format: "%.0f d", seconds / 86_400) }
    if seconds >= 5_400 { return String(format: "%.1f h", seconds / 3_600) }
    if seconds >= 90 { return String(format: "%.0f min", seconds / 60) }
    if seconds >= 1 { return String(format: "%.0f s", seconds) }
    return String(format: "%.0f ms", seconds * 1_000)
}

// MARK: - Sections

private struct ValueDistributionSection: View {
    let values: TypeProfile.ValueDistribution
    let unit: String?
    let color: Color
    var typicalRange: TypeKnowledge.TypicalRange?
    @State private var readout: String?

    private var band: ClosedRange<Double>? {
        guard let typicalRange, let low = typicalRange.min, let high = typicalRange.max, low < high else { return nil }
        return low...high
    }

    var body: some View {
        ChartCard(
            "Value distribution",
            subtitle: values.isEstimated ? "Histogram and percentiles are estimates from a sample" : nil,
            readout: readout
        ) {
            VStack(alignment: .leading, spacing: 8) {
                HistogramChart(histogram: values.histogram, unit: unit, color: color, typicalRange: band, readout: $readout)
                if band != nil {
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 2).fill(.gray.opacity(0.25)).frame(width: 14, height: 10)
                        Text("Typical range (knowledge base)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                statsRow
            }
        }
    }

    private var statsRow: some View {
        let unitText = unit ?? ""
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { statLabels }
            VStack(alignment: .leading, spacing: 4) { statLabels }
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Minimum \(formatValue(values.min)), median \(formatValue(values.median)), mean \(formatValue(values.mean)), "
                + "maximum \(formatValue(values.max)) \(unitText)")
    }

    @ViewBuilder private var statLabels: some View {
        Text("min \(formatValue(values.min))")
        Text("p5 \(formatValue(values.p5))")
        Text("median \(formatValue(values.median))")
        Text("mean \(formatValue(values.mean))")
        Text("p95 \(formatValue(values.p95))")
        Text("max \(formatValue(values.max))\(unit.map { " \($0)" } ?? "")")
    }
}

private struct SamplesOverTimeSection: View {
    let profile: TypeProfile
    let color: Color
    @State private var window: TimeWindow = .month
    @State private var readout: String?

    var body: some View {
        ChartCard("Samples over time", readout: readout) {
            Picker("Window", selection: $window) {
                ForEach(TimeWindow.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        } chart: {
            DailyCountsChart(dailyCounts: profile.dailyCounts, window: window, color: color, readout: $readout)
        }
    }
}

private struct SourcesSection: View {
    let profile: TypeProfile
    let color: Color
    @State private var showsDevices = false

    private var rows: [LabelBarsChart.Row] {
        if showsDevices {
            return profile.devices.map {
                LabelBarsChart.Row(
                    label: $0.name ?? $0.model ?? "No device", count: $0.count,
                    detail: range($0.earliestStart, $0.latestStart))
            }
        }
        return profile.sources.map {
            LabelBarsChart.Row(label: $0.name, count: $0.count, detail: range($0.earliestStart, $0.latestStart))
        }
    }

    private func range(_ from: Date, _ to: Date) -> String {
        "from \(from.formatted(date: .abbreviated, time: .omitted)) to \(to.formatted(date: .abbreviated, time: .omitted))"
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
            LabelBarsChart(rows: rows, color: color)
        }
        .onAppear { showsDevices = profile.sources.isEmpty }
    }
}

/// The buckets a configured series would produce, computed through the
/// explorer as the sync would compute them and uploaded nowhere. Recomputed
/// on every control change after a short debounce; the previous computation
/// is cancelled first.
private struct AggregatePreviewSection: View {
    let descriptor: HealthTypeDescriptor
    @Environment(AppModel.self) private var model
    @State private var function: AggregateFunction?
    @State private var interval: AggregateIntervalUnit = .day
    @State private var deviceFilter: AggregateDeviceFilter = .all
    @State private var window: PreviewWindow = .month
    @State private var buckets: [HealthExplorer.AggregateBucket] = []
    @State private var isComputing = false
    @State private var error: String?
    @State private var readout: String?
    @State private var task: Task<Void, Never>?
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
        HealthTypeCatalog.allowedAggregateFunctions(for: descriptor.identifier)
    }

    private var config: AggregateConfig? {
        guard let function else { return nil }
        return AggregateConfig(
            typeIdentifier: descriptor.identifier, function: function,
            intervalValue: 1, intervalUnit: interval, deviceFilter: deviceFilter)
    }

    private var alreadyInDraft: Bool {
        guard let config else { return false }
        return model.aggregates(for: descriptor.identifier).contains { $0.seriesIdentity == config.seriesIdentity }
    }

    var body: some View {
        ChartCard(
            "Aggregate preview",
            subtitle: "What a synced series would hold, computed the way the sync computes it",
            readout: readout
        ) {
            controls
        } chart: {
            if let error {
                EmptyState(title: "Could not compute", symbol: "exclamationmark.triangle", message: error)
            } else if buckets.isEmpty, !isComputing {
                EmptyState(title: "No buckets", symbol: "chart.bar", message: "Nothing in this window.")
            } else {
                AggregatePreviewChart(
                    buckets: buckets, function: function ?? .average,
                    unit: config?.unitString, color: descriptor.group.color, readout: $readout)
                .overlay(alignment: .topTrailing) {
                    if isComputing { ProgressView().controlSize(.small).padding(6) }
                }
            }
            syncButtons
        }
        .onAppear {
            if function == nil { function = functions.first }
            schedule()
        }
        .onChange(of: function) { schedule() }
        .onChange(of: interval) { schedule() }
        .onChange(of: deviceFilter) { schedule() }
        .onChange(of: window) { schedule() }
        .onDisappear { task?.cancel() }
    }

    @ViewBuilder private var controls: some View {
        VStack(spacing: 8) {
            HStack {
                Picker("Function", selection: $function) {
                    ForEach(functions) { Text($0.displayName).tag(Optional($0)) }
                }
                Spacer()
                Picker("Interval", selection: $interval) {
                    ForEach([AggregateIntervalUnit.hour, .day, .week, .month]) { Text(intervalLabel($0)).tag($0) }
                }
            }
            .pickerStyle(.menu)
            .font(.subheadline)
            Picker("Device", selection: $deviceFilter) {
                Text("All").tag(AggregateDeviceFilter.all)
                Text("Watch").tag(AggregateDeviceFilter.watch)
                Text("iPhone").tag(AggregateDeviceFilter.iphone)
            }
            .pickerStyle(.segmented)
            Picker("Window", selection: $window) {
                ForEach(PreviewWindow.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        }
    }

    @ViewBuilder private var syncButtons: some View {
        if let config {
            HStack(spacing: 12) {
                // The same series the chart shows, into the Export tab's
                // draft (dedupes by series identity).
                Button(inExportDraft ? "In Export draft" : "Add to Export") {
                    model.export.addAggregate(config)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(inExportDraft)
                if model.appliedConfig.serverURL != nil {
                    Button(alreadyInDraft ? "In sync draft" : "Sync this series") {
                        model.addAggregate(config)
                        added = true
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(alreadyInDraft)
                }
            }
            if added || alreadyInDraft {
                Text("Apply it on Sync → Synced Data.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var inExportDraft: Bool {
        guard let config else { return false }
        return model.export.draft.aggregates.contains { $0.seriesIdentity == config.seriesIdentity }
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

    private func schedule() {
        task?.cancel()
        guard let config else { return }
        readout = nil
        isComputing = true
        error = nil
        let days = window.days
        let explorer = model.explore.explorer
        let anchor = Calendar.current.startOfDay(for: model.appliedConfig.startDate ?? Date())
        task = Task {
            // Debounce: a picker tapped twice computes once.
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let to = Date()
            let from = Calendar.current.date(byAdding: .day, value: -days, to: to) ?? to
            do {
                let result = try await explorer.aggregatePreview(config, from: from, to: to, gridAnchor: anchor)
                guard !Task.isCancelled else { return }
                buckets = result
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self.error = ExploreModel.friendlyMessage(for: error)
                buckets = []
            }
            isComputing = false
        }
    }
}
