import SwiftUI
import PulsHealthSync

/// Add Aggregate → Custom…, in Sync or Export: pick a value, an interval and
/// the devices, see what it would have produced recently and how many values
/// it makes, then Add. Nothing is added until Add.
struct CustomAggregateSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let descriptor: HealthTypeDescriptor
    let scope: AggregateScope
    @State private var function: AggregateFunction
    @State private var unit: AggregateIntervalUnit
    @State private var deviceFilter: AggregateDeviceFilter = .all
    @State private var readout: String?

    init(descriptor: HealthTypeDescriptor, scope: AggregateScope) {
        self.descriptor = descriptor
        self.scope = scope
        let start = AggregateConfig.dailyDefault(for: descriptor.identifier)
        _function = State(initialValue: start?.function ?? .average)
        _unit = State(initialValue: .day)
    }

    private var config: AggregateConfig {
        AggregateConfig(
            typeIdentifier: descriptor.identifier, function: function,
            intervalValue: 1, intervalUnit: unit, deviceFilter: deviceFilter)
    }

    private var isDuplicate: Bool {
        model.aggregateList(scope).duplicates(config)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        TypeIcon(descriptor)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(descriptor.displayName)
                            Text(config.unitString ?? "")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Value") {
                    Picker("Value", selection: $function) {
                        ForEach(AggregateFunction.choices(for: descriptor.identifier)) {
                            Text($0.plainName).tag($0)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                Section("Every") {
                    Picker("Every", selection: $unit) {
                        ForEach(AggregateIntervalUnit.choices) { Text($0.displayName).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    Picker("Devices", selection: $deviceFilter) {
                        ForEach(AggregateDeviceFilter.allCases) { Text($0.choiceName).tag($0) }
                    }
                }
                Section {
                    AggregatePreviewPane(
                        config: config, days: previewDays, color: descriptor.group.color, readout: $readout)
                    if let readout {
                        Text(readout)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                } header: {
                    Text("Preview · Last \(previewWindow)")
                } footer: {
                    Text(isDuplicate ? "\(descriptor.displayName) already has \(config.label.lowercasedFirst.withArticle)." : countText)
                }
            }
            .navigationTitle("Custom Aggregate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        model.editAggregates(scope) { $0.add(config) }
                        dismiss()
                    }
                    .disabled(isDuplicate)
                }
            }
            .onAppear {
                // Opens on the daily default, or on the first interval the
                // type does not have yet, so it does not open on something it
                // cannot add.
                let list = model.aggregateList(scope)
                if let free = [AggregateIntervalUnit.day, .hour, .week, .month].first(where: { unit in
                    !list.duplicates(config.with(interval: (1, unit)))
                }) {
                    unit = free
                }
            }
            // Asks iOS once for a type it has never asked about, as a type's
            // page in Explore does; without access the preview reads empty.
            .task { await model.explore.requestAccessIfNeeded(descriptor.identifier) }
        }
    }

    /// Enough of the past to show a few values at any interval.
    private var previewDays: Int {
        switch unit {
        case .minute, .hour: 7
        case .day: 30
        case .week: 182
        case .month: 365
        }
    }

    private var previewWindow: String {
        switch unit {
        case .minute, .hour: "7 Days"
        case .day: "30 Days"
        case .week: "6 Months"
        case .month: "Year"
        }
    }

    /// How many values it makes: in Sync from its start date to now, in an
    /// export over the export's range.
    private var countText: String {
        let now = Date()
        switch scope {
        case .sync:
            let start = model.config.startDate
            let count = config.approximateValueCount(from: start, to: now)
            return "About \(approximateCount(count)) values since \(start.formatted(date: .abbreviated, time: .omitted))."
        case .export:
            let dates = model.export.draft.dates(now: now)
            let start = dates.start
                ?? model.explore.quickFacts[descriptor.identifier]?.earliestStart
                ?? model.config.startDate
            let count = config.approximateValueCount(from: start, to: dates.end ?? now)
            return "About \(approximateCount(count)) values in this export."
        }
    }
}

/// The values an aggregate would have produced over the last `days`,
/// computed as the sync computes them (`HealthExplorer.aggregatePreview`) and
/// sent nowhere, with its empty, error and loading states. Recomputed after
/// a short pause whenever the aggregate or the window changes.
struct AggregatePreviewPane: View {
    @Environment(AppModel.self) private var model
    let config: AggregateConfig
    let days: Int
    let color: Color
    @Binding var readout: String?
    @State private var buckets: [HealthExplorer.AggregateBucket] = []
    @State private var isComputing = true
    @State private var error: String?

    var body: some View {
        Group {
            if let error {
                PreviewState(title: "Could not compute", symbol: "exclamationmark.triangle", message: error, tint: .orange)
            } else if buckets.isEmpty, !isComputing {
                PreviewState(title: "No values", symbol: "chart.bar", message: "Nothing in this window.")
            } else if buckets.isEmpty {
                ProgressView().frame(maxWidth: .infinity, minHeight: 200)
            } else {
                // The spinner sits top-leading: the chart's top-trailing
                // corner is where its unit label is.
                AggregatePreviewChart(
                    buckets: buckets, function: config.function,
                    unit: config.unitString, color: color, readout: $readout)
                .opacity(isComputing ? 0.6 : 1)
                .overlay(alignment: .topLeading) {
                    if isComputing { ProgressView().controlSize(.small).padding(6) }
                }
            }
        }
        .task(id: "\(config.seriesIdentity)|\(days)") { await compute() }
    }

    private func compute() async {
        readout = nil
        isComputing = true
        error = nil
        // Debounce: a control tapped twice computes once. A newer change
        // cancels this task (`.task(id:)`) before it gets further.
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        let to = Date()
        let from = Calendar.current.date(byAdding: .day, value: -days, to: to) ?? to
        let anchor = Calendar.current.startOfDay(for: model.appliedConfig.startDate)
        do {
            let result = try await model.explore.explorer.aggregatePreview(
                config, from: from, to: to, gridAnchor: anchor)
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

    /// The chart slot's empty and error states, the chart's own height so the
    /// card does not jump between them, with explicit fonts: `EmptyState`
    /// (`ContentUnavailableView`) is sized for a whole screen and its title
    /// grows with the runtime (larger on iOS 27), so inside a card it read
    /// bigger than every other state text around it.
    private struct PreviewState: View {
        let title: String
        let symbol: String
        let message: String
        var tint: Color = .secondary

        var body: some View {
            VStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.title3)
                    .foregroundStyle(tint)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 200)
        }
    }
}
