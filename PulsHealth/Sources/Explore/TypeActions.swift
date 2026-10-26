import Observation
import PulsHealthSync
import SwiftUI

/// Session-only navigation and feedback. Dismissing feedback never changes a draft.
@MainActor @Observable
final class TypeActions {
    enum Destination: Equatable { case export, sync }
    struct Notice {
        let title: String
        let detail: String
        let destination: Destination
    }
    var destination: Destination?
    var notice: Notice?

    func open(_ destination: Destination) {
        notice = nil
        self.destination = destination
    }

    func addedToExport(_ name: String, count: Int, updated: Bool = false) {
        notice = Notice(title: updated ? "Export selection updated" : "\(name) added",
                        detail: "\(count) types selected · export hasn’t started", destination: .export)
    }

    func addedToSync() {
        notice = Notice(title: "Sync changes ready", detail: "Review and apply before syncing starts", destination: .sync)
    }
}

struct TypeActionNoticeView: View {
    @Environment(TypeActions.self) private var actions
    var body: some View {
        if let notice = actions.notice {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(notice.title).font(.subheadline.weight(.semibold))
                    Text(notice.detail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button(notice.destination == .export ? "Open Export" : "Review") {
                    actions.open(notice.destination)
                }
                .font(.subheadline.weight(.semibold))
                Button("Dismiss", systemImage: "xmark") { actions.notice = nil }
                    .labelStyle(.iconOnly)
                    .font(.subheadline)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("typeActions.dismissNotice")
            }
            .padding(.leading, 16)
            .padding(.trailing, 4)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
            .padding(.bottom, 8)
            .accessibilityIdentifier("typeActions.notice")
        }
    }
}

/// A local sheet draft. Constructing/editing/canceling it touches no app state.
struct TypeSyncDraft {
    let identifier: String
    var raw: Bool
    var includesAggregates: Bool
    var aggregates: [AggregateConfig]

    init(identifier: String, configuration: SyncConfiguration) {
        self.identifier = identifier
        raw = configuration.enabledTypes.contains(identifier)
        aggregates = configuration.aggregates.filter { $0.typeIdentifier == identifier }
        includesAggregates = !aggregates.isEmpty
        if !raw && !includesAggregates { raw = true }
    }

    func merging(into configuration: SyncConfiguration) -> SyncConfiguration {
        var proposed = configuration
        if raw { proposed.enabledTypes.insert(identifier) }
        else { proposed.enabledTypes.remove(identifier) }
        let next = includesAggregates ? aggregates : []
        let existingIDs = Set(configuration.aggregates.map(\.id))
        proposed.aggregates = configuration.aggregates.compactMap { current in
            current.typeIdentifier == identifier ? next.first { $0.id == current.id } : current
        }
        proposed.aggregates += next.filter { !existingIDs.contains($0.id) }
        return proposed
    }

    func apply(to export: inout ExportDraft) {
        let proposed = merging(into: SyncConfiguration(enabledTypes: export.types, aggregates: export.aggregates))
        export.types = proposed.enabledTypes
        export.aggregates = proposed.aggregates
    }

    var hasDuplicates: Bool {
        Set(aggregates.map(\.seriesIdentity)).count != aggregates.count
    }
}

extension AppModel {
    @discardableResult
    func stageTypeSync(_ draft: TypeSyncDraft) -> Bool {
        guard !stateFileUnreadable, !draft.hasDuplicates else { return false }
        let proposed = draft.merging(into: config)
        guard acceptSyncTypeSelection(proposed) else { return false }
        config.enabledTypes = proposed.enabledTypes
        config.aggregates = proposed.aggregates
        return true
    }

    func hasPendingTypeChanges(_ identifier: String) -> Bool {
        config.enabledTypes.contains(identifier) != appliedConfig.enabledTypes.contains(identifier)
            || config.aggregates.filter { $0.typeIdentifier == identifier }
                != appliedConfig.aggregates.filter { $0.typeIdentifier == identifier }
    }

    /// Undo just this type's edits, keeping other pending work and settings.
    func discardTypeSyncChanges(_ identifier: String) {
        if appliedConfig.enabledTypes.contains(identifier) { config.enabledTypes.insert(identifier) }
        else { config.enabledTypes.remove(identifier) }
        var remaining = config.aggregates.filter { $0.typeIdentifier != identifier }
        var restored: [AggregateConfig] = []
        for applied in appliedConfig.aggregates {
            if applied.typeIdentifier == identifier {
                restored.append(applied)
            } else if let index = remaining.firstIndex(where: { $0.id == applied.id }) {
                restored += remaining.prefix(through: index)
                remaining.removeFirst(index + 1)
            }
        }
        config.aggregates = restored + remaining
    }
}

struct TypeDataSelectionSheet: View {
    let scope: AggregateScope
    let descriptor: HealthTypeDescriptor
    @Environment(AppModel.self) private var model
    @Environment(TypeActions.self) private var actions
    @Environment(\.dismiss) private var dismiss
    @State private var draft: TypeSyncDraft
    @State private var confirmsChanges = false
    @State private var showsUpgrade = false

    init(descriptor: HealthTypeDescriptor, configuration: SyncConfiguration, scope: AggregateScope = .sync) {
        self.scope = scope
        self.descriptor = descriptor
        _draft = State(initialValue: TypeSyncDraft(identifier: descriptor.identifier, configuration: configuration))
    }

    private var functions: [AggregateFunction] { AggregateFunction.choices(for: descriptor.identifier) }
    private var wasSelected: Bool {
        scope == .export ? model.export.draft.types.contains(descriptor.identifier) || model.export.draft.aggregates.contains { $0.typeIdentifier == descriptor.identifier }
            : model.config.observedTypeIdentifiers.contains(descriptor.identifier)
    }
    private var canSave: Bool {
        (draft.raw || (draft.includesAggregates && !draft.aggregates.isEmpty) || wasSelected)
            && !draft.hasDuplicates && (scope == .export ? !model.export.isRunning : !model.stateFileUnreadable)
    }

    var body: some View {
        NavigationStack {
            Form {
                if scope == .sync {
                    Section {
                        LabeledContent("Database", value: DatabaseSetup.databaseLabel(model.config.serverURL) ?? "Not connected")
                    } footer: {
                        Text(model.config.serverURL == nil
                             ? "Choose your data now. Connect a database on Sync before applying."
                             : "Uses this database’s current history settings.")
                    }
                }
                Section {
                    Toggle(isOn: $draft.raw) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Raw readings")
                            Text("Every individual measurement").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("typeActions.raw")
                    if !functions.isEmpty {
                        Toggle(isOn: $draft.includesAggregates) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Aggregates")
                                Text("Computed values, such as a daily average").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityIdentifier("typeActions.aggregates")
                        .onChange(of: draft.includesAggregates) { _, on in
                            if on, draft.aggregates.isEmpty,
                               let initial = AggregateConfig.dailyDefault(for: descriptor.identifier) {
                                draft.aggregates = [initial]
                            }
                        }
                    }
                } footer: {
                    Text(functions.isEmpty ? "Aggregates aren’t available for this type."
                         : "Choose raw readings, aggregates, or both.")
                }
                if draft.includesAggregates {
                    ForEach($draft.aggregates) { $aggregate in
                        Section(aggregate.label) {
                            Picker("Function", selection: $aggregate.function) {
                                ForEach(Array(Set(functions + [aggregate.function])).sorted { $0.rawValue < $1.rawValue }) {
                                    Text($0.plainName).tag($0)
                                }
                            }
                            Picker("Interval", selection: $aggregate.intervalUnit) {
                                ForEach(AggregateIntervalUnit.allCases) { Text($0.adjective ?? $0.displayName).tag($0) }
                            }
                            DisclosureGroup("Custom interval") {
                                Stepper("Every \(aggregate.intervalValue) \(aggregate.intervalUnit.displayName.lowercased())", value: $aggregate.intervalValue, in: 1...1_000)
                            }
                            Picker("Devices", selection: $aggregate.deviceFilter) {
                                ForEach(AggregateDeviceFilter.allCases) { Text($0.choiceName).tag($0) }
                            }
                            if scope == .sync && !aggregate.enabled { Text("This aggregate is off.").font(.caption).foregroundStyle(.secondary) }
                            Button("Remove Aggregate", role: .destructive) {
                                draft.aggregates.removeAll { $0.id == aggregate.id }
                            }
                        }
                    }
                    if let suggestion = AggregateList(draft.aggregates).suggestions(for: descriptor.identifier).first {
                        Section {
                            Button("Add Another Aggregate", systemImage: "plus") { draft.aggregates.append(suggestion) }
                        }
                    }
                    if draft.hasDuplicates {
                        Section { Text("Choose different settings for each aggregate.").foregroundStyle(.orange) }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    Button(scope == .export ? (wasSelected ? "Update Export Selection" : "Add to Export")
                           : (wasSelected ? "Stage Changes" : "Add to Sync")) {
                        if scope == .export { save(); return }
                        let existing = model.appliedConfig.aggregates.filter { $0.typeIdentifier == descriptor.identifier }
                        let next = draft.includesAggregates ? draft.aggregates : []
                        if !existing.isEmpty && existing != next { confirmsChanges = true }
                        else { save() }
                    }
                    .frame(maxWidth: .infinity)
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSave)
                    .accessibilityIdentifier(scope == .export ? "typeActions.selectExport" : "typeActions.stageSync")
                    Text(scope == .export ? "Adds to your selection. Start the export when you’re ready on Export."
                         : "Nothing is uploaded until you review and apply on Sync.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(.bar)
            }
            .navigationTitle(descriptor.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .sheet(isPresented: $showsUpgrade) {
                NavigationStack {
                    ProView(context: .syncTypes(draft.merging(into: model.config).observedTypeIdentifiers.count))
                }
            }
            .confirmationDialog("Change this type’s aggregates?", isPresented: $confirmsChanges, titleVisibility: .visible) {
                Button("Stage Changes") { save() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Changed aggregates compute a new series when applied. Values already sent stay in your database.")
            }
        }
    }

    private func save() {
        if scope == .export {
            guard !model.export.isRunning, !draft.hasDuplicates else { return }
            let updated = wasSelected
            model.export.prepareDraft()
            draft.apply(to: &model.export.draft)
            actions.addedToExport(descriptor.displayName, count: model.export.draft.selectedTypeCount, updated: updated)
            dismiss()
            return
        }
        let proposed = draft.merging(into: model.config)
        guard model.subscriptions.hasPro || SyncAccessPolicy.free.allows(proposed)
                || proposed.observedTypeIdentifiers.isSubset(of: model.config.observedTypeIdentifiers) else {
            showsUpgrade = true
            return
        }
        guard model.stageTypeSync(draft) else { return }
        actions.addedToSync()
        dismiss()
    }
}
