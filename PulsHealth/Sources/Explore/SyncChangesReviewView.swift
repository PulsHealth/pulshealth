import PulsHealthSync
import SwiftUI

/// Review the complete shared draft, including edits made outside Explore.
struct SyncChangesReviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    private var changedTypes: [String] {
        let raw = model.config.enabledTypes.symmetricDifference(model.appliedConfig.enabledTypes)
        let aggregates = AggregateList.changedTypes(from: model.appliedConfig.aggregates, to: model.config.aggregates)
        return raw.union(aggregates).sorted()
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Destination") {
                    LabeledContent("Database", value: DatabaseSetup.databaseLabel(model.config.serverURL) ?? "Not connected")
                    LabeledContent("History from", value: model.config.startDate.formatted(date: .abbreviated, time: .omitted))
                }
                ForEach(changedTypes, id: \.self) { identifier in
                    Section(HealthTypeCatalog.descriptor(for: identifier)?.displayName ?? identifier) {
                        if model.config.enabledTypes.contains(identifier) != model.appliedConfig.enabledTypes.contains(identifier) {
                            Label(model.config.enabledTypes.contains(identifier) ? "Add raw readings" : "Remove raw readings",
                                  systemImage: model.config.enabledTypes.contains(identifier) ? "plus.circle" : "minus.circle")
                        }
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
                        Button("Undo Changes for This Type", role: .destructive) {
                            model.discardTypeSyncChanges(identifier)
                        }
                    }
                }
                let settings = SyncSettingsChanges(from: model.appliedConfig, to: model.config).lines
                if !settings.isEmpty {
                    Section("Other Pending Changes") {
                        ForEach(settings, id: \.self) { Text($0) }
                    }
                }
                Section {
                    Button(model.isSettingUpInitialSync ? "Apply & Start Sync" : "Apply Changes") { onApply() }
                        .buttonStyle(.borderedProminent)
                        .frame(maxWidth: .infinity)
                        .disabled(model.config.serverURL == nil || model.stateFileUnreadable
                                  || (!model.hasPendingChanges && !model.hasPendingSettingsChanges && !model.isSettingUpInitialSync))
                        .accessibilityIdentifier("syncReview.apply")
                    Button("Discard All Changes", role: .destructive) {
                        model.discardChanges()
                        dismiss()
                    }
                } footer: {
                    Text("All pending changes shown here will be applied together. Removing a type stops future uploads; data already in your database stays there.")
                }
            }
            .navigationTitle("Review Sync Changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not Now") { dismiss() } } }
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
