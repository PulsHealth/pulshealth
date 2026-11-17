import PulsHealthSync
import SwiftUI

/// Review the complete shared draft, including edits made outside Explore.
struct SyncChangesReviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var showsRaw = false
    @State private var showsAggregates = false
    @State private var showsSettings = false
    let onApply: () -> Void

    private var rawChanges: [String] {
        model.config.enabledTypes.symmetricDifference(model.appliedConfig.enabledTypes).sorted { name($0) < name($1) }
    }
    private var aggregateTypes: [String] {
        AggregateList.changedTypes(from: model.appliedConfig.aggregates, to: model.config.aggregates)
            .sorted { name($0) < name($1) }
    }
    private func name(_ identifier: String) -> String {
        HealthTypeCatalog.descriptor(for: identifier)?.displayName ?? identifier
    }
    private func summary(added: Int, removed: Int) -> String {
        [added > 0 ? "\(added) added" : nil, removed > 0 ? "\(removed) removed" : nil]
            .compactMap { $0 }.joined(separator: " · ")
    }
    private var rawSummary: String {
        summary(added: model.config.enabledTypes.subtracting(model.appliedConfig.enabledTypes).count,
                removed: model.appliedConfig.enabledTypes.subtracting(model.config.enabledTypes).count)
    }
    private var aggregateSummary: String {
        let added = model.config.aggregates.filter { !model.appliedConfig.aggregates.contains($0) }
        let removed = model.appliedConfig.aggregates.filter { !model.config.aggregates.contains($0) }
        let changes = summary(added: added.count, removed: removed.count)
        return !added.isEmpty && removed.isEmpty && added.allSatisfy(\.isDailyDefault)
            ? "\(changes) · Daily" : changes
    }

    private var canApply: Bool {
        model.config.serverURL != nil && !model.stateFileUnreadable
            && (model.hasPendingChanges || model.hasPendingSettingsChanges || model.isSettingUpInitialSync)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List {
                    Section {
                        LabeledContent("Database", value: DatabaseSetup.databaseLabel(model.config.serverURL) ?? "Not connected")
                        LabeledContent("History from", value: model.config.startDate.formatted(date: .abbreviated, time: .omitted))
                    }
                    Section("Data to sync") {
                        if !rawChanges.isEmpty {
                            DisclosureGroup(isExpanded: $showsRaw) {
                                ForEach(rawChanges, id: \.self) { identifier in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(name(identifier))
                                            Text(model.config.enabledTypes.contains(identifier) ? "Add raw samples" : "Remove raw samples")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Button("Undo") {
                                            if model.appliedConfig.enabledTypes.contains(identifier) {
                                                model.config.enabledTypes.insert(identifier)
                                            } else {
                                                model.config.enabledTypes.remove(identifier)
                                            }
                                        }.buttonStyle(.borderless)
                                            .accessibilityLabel("Undo raw sample changes for \(name(identifier))")
                                    }
                                }
                            } label: {
                                summaryRow("Raw Samples", detail: rawSummary, symbol: "waveform.path.ecg")
                            }.accessibilityIdentifier("syncReview.raw")
                        }
                        if !aggregateTypes.isEmpty {
                            DisclosureGroup(isExpanded: $showsAggregates) {
                                ForEach(aggregateTypes, id: \.self) { identifier in
                                    DisclosureGroup(name(identifier)) {
                                        aggregateChanges(for: identifier)
                                        Button("Undo aggregate changes") {
                                            model.discardTypeAggregateChanges(identifier)
                                        }.buttonStyle(.borderless)
                                    }
                                }
                            } label: {
                                summaryRow("Aggregates", detail: aggregateSummary, symbol: "chart.bar")
                            }.accessibilityIdentifier("syncReview.aggregates")
                        }
                        if rawChanges.isEmpty && aggregateTypes.isEmpty {
                            Text("No data selection changes").foregroundStyle(.secondary)
                        }
                    }
                    let settings = SyncSettingsChanges(from: model.appliedConfig, to: model.config).lines
                    if !settings.isEmpty {
                        Section {
                            DisclosureGroup(isExpanded: $showsSettings) {
                                ForEach(settings, id: \.self) { Text($0) }
                            } label: {
                                summaryRow("Connection settings", detail: settings.count == 1 ? "1 change" : "\(settings.count) changes", symbol: "slider.horizontal.3")
                            }
                        }
                    }
                }
                VStack(spacing: 12) {
                    Button(action: onApply) {
                        HStack {
                            Text(model.isSettingUpInitialSync ? "Apply & Start Sync" : "Apply Changes")
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(!canApply)
                    .opacity(canApply ? 1 : 0.5)
                    .accessibilityIdentifier("syncReview.apply")
                    Button("Discard All Changes", role: .destructive) {
                        model.discardChanges()
                        dismiss()
                    }.font(.subheadline)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 12)
                .frame(maxWidth: .infinity).background(.bar)
            }
            .navigationTitle("Review Sync Changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not Now") { dismiss() } } }
        }
    }

    private func summaryRow(_ title: String, detail: String, symbol: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).foregroundStyle(.primary)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }.padding(.vertical, 6)
        } icon: { Image(systemName: symbol).foregroundStyle(.tint) }
    }

    @ViewBuilder private func aggregateChanges(for identifier: String) -> some View {
        let before = model.appliedConfig.aggregates.filter { $0.typeIdentifier == identifier }
        let after = model.config.aggregates.filter { $0.typeIdentifier == identifier }
        ForEach(before.filter { !after.contains($0) }) { config in
            VStack(alignment: .leading, spacing: 3) {
                Text("Remove: \(config.label)")
                aggregateOptions(config)
            }
        }
        ForEach(after.filter { !before.contains($0) }) { config in
            VStack(alignment: .leading, spacing: 3) {
                Text("Add: \(config.label)")
                aggregateOptions(config)
            }
        }
    }
    private func aggregateOptions(_ config: AggregateConfig) -> some View {
        Text([config.enabled ? "On" : "Off",
              config.startDate.map { "From \($0.formatted(date: .abbreviated, time: .omitted))" } ?? "Same history as Sync",
              "Wait \(Int(config.settleDelay / 60)) min for late data"].joined(separator: " · "))
            .font(.caption).foregroundStyle(.secondary)
    }
}

/// No credentials appear in review copy. Include every non-type setting that
/// may be committed by Apply, even when it was changed on another tab.
struct SyncSettingsChanges {
    let lines: [String]
    init(from old: SyncConfiguration, to new: SyncConfiguration) {
        var changes: [String] = []
        func value<T: Equatable>(_ name: String, _ before: T, _ after: T, render: (T) -> String) {
            if before != after { changes.append("\(name): \(render(before)) → \(render(after))") }
        }
        func onOff(_ value: Bool) -> String { value ? "On" : "Off" }
        value("Database", old.serverURL, new.serverURL) { DatabaseSetup.databaseLabel($0) ?? "Not connected" }
        if old.authToken != new.authToken { changes.append("Database credentials updated") }
        if old.signedInDatabaseURL != new.signedInDatabaseURL { changes.append("Database sign-in updated") }
        value("History", old.startDate, new.startDate) { $0.formatted(date: .abbreviated, time: .omitted) }
        value("Workout routes", old.includeWorkoutRoutes, new.includeWorkoutRoutes, render: onOff)
        value("Enhanced workouts", old.includeWorkoutEnhancedData, new.includeWorkoutEnhancedData, render: onOff)
        value("Concurrent types", old.maxConcurrentTypes, new.maxConcurrentTypes, render: String.init)
        value("Batch size", old.batchSize, new.batchSize, render: String.init)
        value("Observer delay", old.observerCoalesceWindow, new.observerCoalesceWindow) { "\($0) seconds" }
        value("Merged batch limit", old.maxMergedBatchSamples, new.maxMergedBatchSamples, render: String.init)
        value("Workout point limit", old.maxEnrichmentPointsPerBatch, new.maxEnrichmentPointsPerBatch, render: String.init)
        value("User ID", old.userID, new.userID, render: { $0 })
        value("Name", old.userName, new.userName) { $0 ?? "Not set" }
        value("Email", old.userEmail, new.userEmail) { $0 ?? "Not set" }
        value("Date of birth", old.userDateOfBirth, new.userDateOfBirth) { $0?.formatted(date: .abbreviated, time: .omitted) ?? "Not set" }
        value("Biological sex", old.userBiologicalSex, new.userBiologicalSex) { $0 ?? "Not set" }
        lines = changes
    }
}

#if DEBUG && targetEnvironment(simulator)
/// Synthetic full-selection preview. This model is never started or applied.
struct SyncReviewFixtureView: View {
    @State private var model: AppModel = {
        let model = AppModel(subscriptions: SubscriptionStore(entitlementReader: { true }))
        model.config = model.appliedConfig
        model.config.enabledTypes = Set(HealthTypeCatalog.all.map(\.identifier))
        model.config.serverURL = URL(string: "https://example.invalid")
        model.config.aggregates = AggregateList.measurementTypes.compactMap { AggregateConfig.dailyDefault(for: $0.identifier) }
        model.isSettingUpInitialSync = true
        return model
    }()
    var body: some View {
        SyncChangesReviewView(onApply: {}).environment(model)
    }
}
#endif
