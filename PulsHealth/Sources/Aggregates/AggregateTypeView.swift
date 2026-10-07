import SwiftUI
import PulsHealthSync

/// One type's aggregates, in Sync's draft or the export's: as many as you
/// like, each a row whose menu changes what it computes (Value, Every,
/// Devices), and, in Sync, its Options…. Add Aggregate suggests common ones
/// and ends with Custom…. Reached from a picker row's ⓘ, or from the Sync
/// tab's Aggregates section.
struct AggregateTypeView: View {
    @Environment(AppModel.self) private var model
    let descriptor: HealthTypeDescriptor
    let scope: AggregateScope
    @State private var addingCustom = false
    @State private var optionsFor: AggregateConfig?
    /// A change to an aggregate that has sent values, until it is confirmed.
    @State private var pendingChange: AggregateConfig?

    var body: some View {
        let list = model.aggregateList(scope)
        let configs = list.configs(for: descriptor.identifier)
        List {
            Section {
                ForEach(configs) { config in
                    AggregateRow(
                        config: config, list: list, scope: scope,
                        change: change, showOptions: { optionsFor = $0 })
                }
                addMenu(list)
            } header: {
                Text("Aggregates")
            } footer: {
                if scope == .sync, !configs.contains(where: \.isDailyDefault),
                   let daily = AggregateConfig.dailyDefault(for: descriptor.identifier) {
                    Text("Without a \(daily.label.lowercased()), \(descriptor.displayName) is left out of your database’s daily metrics.")
                }
            }
        }
        .navigationTitle(descriptor.displayName)
        .navigationBarTitleDisplayMode(.large)
        .sheet(isPresented: $addingCustom) {
            CustomAggregateSheet(descriptor: descriptor, scope: scope)
        }
        .sheet(item: $optionsFor) { config in
            AggregateOptionsSheet(configID: config.id)
        }
        .confirmationDialog(
            pendingChange.map { "Change to \($0.label.lowercasedFirst)?" } ?? "",
            isPresented: Binding(get: { pendingChange != nil }, set: { if !$0 { pendingChange = nil } }),
            titleVisibility: .visible,
            presenting: pendingChange
        ) { config in
            Button("Change") {
                model.editAggregates(scope) { $0.update(config) }
            }
        } message: { config in
            let old = model.aggregateList(scope).configs.first { $0.id == config.id }
            Text("This starts a new aggregate. The \(old?.label.lowercasedFirst ?? "values") already sent stays in your database.")
        }
    }

    /// Apply a change from a row's menu, asking first in Sync when the old
    /// aggregate has values in the database.
    private func change(_ config: AggregateConfig) {
        if scope == .sync, let old = model.aggregateList(scope).configs.first(where: { $0.id == config.id }),
           model.aggregateHasSentValues(old) {
            pendingChange = config
        } else {
            model.editAggregates(scope) { $0.update(config) }
        }
    }

    private func addMenu(_ list: AggregateList) -> some View {
        let suggestions = list.suggestions(for: descriptor.identifier)
        return Menu {
            if !suggestions.isEmpty {
                Section("Suggested") {
                    ForEach(suggestions, id: \.seriesIdentity) { suggestion in
                        Button(suggestion.label) {
                            model.editAggregates(scope) { $0.add(suggestion) }
                        }
                    }
                }
            }
            Button {
                addingCustom = true
            } label: {
                Text("Custom…")
                Text("Any value, interval or device, with a preview")
            }
        } label: {
            // The whole row opens the menu, not just its words.
            Label("Add Aggregate", systemImage: "plus")
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
    }
}

/// One aggregate: its label, a status line, and a menu of what it computes.
private struct AggregateRow: View {
    @Environment(AppModel.self) private var model
    let config: AggregateConfig
    let list: AggregateList
    let scope: AggregateScope
    let change: (AggregateConfig) -> Void
    let showOptions: (AggregateConfig) -> Void

    var body: some View {
        Menu {
            valueMenu
            everyMenu
            devicesMenu
            if scope == .sync {
                Section {
                    if !config.enabled {
                        Button("Turn On", systemImage: "play") {
                            var on = config
                            on.enabled = true
                            model.editAggregates(scope) { $0.update(on) }
                        }
                    }
                    Button("Options…", systemImage: "slider.horizontal.3") { showOptions(config) }
                }
            }
            Button("Remove", systemImage: "trash", role: .destructive) {
                model.editAggregates(scope) { $0.remove(id: config.id) }
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(config.label)
                        .foregroundStyle(.primary)
                    if let subtitle {
                        Text(subtitle.text)
                            .font(.caption)
                            .foregroundStyle(subtitle.isFailure ? Color.red : .secondary)
                            .lineLimit(2)
                    }
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
            .opacity(config.enabled || scope == .export ? 1 : 0.5)
        }
        // A row of the list, not a tinted button: its menu is how it is changed.
        .tint(.primary)
        .padding(.vertical, 2)
    }

    private var subtitle: (text: String, isFailure: Bool)? {
        let defaultNote = config.isDailyDefault ? "Default" : nil
        guard scope == .sync else { return defaultNote.map { ($0, false) } }
        let status = model.aggregateStatus(config)
        let text = [defaultNote, defaultNote == nil ? status.text : status.text.lowercasedFirst]
            .compactMap { $0 }.joined(separator: " · ")
        return (text, status.isFailure)
    }

    private var valueMenu: some View {
        var functions = AggregateFunction.choices(for: config.typeIdentifier)
        if !functions.contains(config.function) { functions.append(config.function) }
        return Menu {
            ForEach(functions) { function in
                choice(function.plainName, selected: config.function == function,
                       config.with(function: function))
            }
        } label: {
            Text("Value")
            Text(config.function.plainName)
        }
    }

    private var everyMenu: some View {
        let standard = AggregateIntervalUnit.choices
        let isStandard = config.intervalValue == 1 && standard.contains(config.intervalUnit)
        return Menu {
            ForEach(standard) { unit in
                choice(unit.displayName, selected: isStandard && config.intervalUnit == unit,
                       config.with(interval: (1, unit)))
            }
            if !isStandard {
                // An older aggregate's own interval (5 minutes, 2 days):
                // shown so it stays checked, and so changing it is a choice.
                choice(config.intervalLabel.capitalizedFirst, selected: true, config)
            }
        } label: {
            Text("Every")
            Text(isStandard ? config.intervalUnit.displayName : config.intervalLabel.capitalizedFirst)
        }
    }

    private var devicesMenu: some View {
        Menu {
            ForEach(AggregateDeviceFilter.allCases) { filter in
                choice(filter.choiceName, selected: config.deviceFilter == filter,
                       config.with(deviceFilter: filter))
            }
        } label: {
            Text("Devices")
            Text(config.deviceFilter.choiceName)
        }
    }

    /// A checkmarked menu item; one that would duplicate another aggregate
    /// of the type is disabled.
    private func choice(_ title: String, selected: Bool, _ changed: AggregateConfig) -> some View {
        Toggle(title, isOn: Binding(
            get: { selected },
            set: { _ in if !selected { change(changed) } }))
        .disabled(!selected && list.duplicates(changed))
    }
}

/// Sync → a type → an aggregate's Options…: where it starts, how long it
/// waits for late Apple Watch data, how far it has got, and Recompute. Edits
/// wait for Apply like the rest of the Sync draft.
private struct AggregateOptionsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let configID: UUID
    @State private var confirmRecompute = false

    private var config: AggregateConfig? {
        model.config.aggregates.first { $0.id == configID }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let config {
                    startSection(config)
                    settleSection
                    if let applied = model.appliedAggregate(id: configID) {
                        statusSection(applied)
                        recomputeSection(config, applied: applied)
                    }
                }
            }
            .navigationTitle(config?.label ?? "Options")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog(
                "Recompute this aggregate?", isPresented: $confirmRecompute, titleVisibility: .visible
            ) {
                Button("Recompute") {
                    Task {
                        await model.resetAggregate(id: configID)
                        model.syncAggregate(id: configID)
                    }
                }
            } message: {
                Text("Every value is computed and sent again from the start. Your database replaces the ones it has.")
            }
        }
    }

    private func startSection(_ config: AggregateConfig) -> some View {
        Section {
            Toggle("Same as Sync", isOn: Binding(
                get: { config.startDate == nil },
                set: { same in
                    update { $0.startDate = same ? nil : model.config.startDate }
                }))
            if let start = config.startDate {
                DatePicker(
                    "From", selection: Binding(get: { start }, set: { date in update { $0.startDate = date } }),
                    in: ...Date(), displayedComponents: .date)
            } else {
                LabeledContent("From", value: model.config.startDate.formatted(date: .abbreviated, time: .omitted))
            }
        } header: {
            Text("Start")
        } footer: {
            Text("A new start date computes the aggregate again from there.")
        }
    }

    private var settleSection: some View {
        Section {
            Picker("Wait", selection: Binding(
                get: { config?.settleDelay ?? 3_600 },
                set: { delay in update { $0.settleDelay = delay } })) {
                Text("Don’t Wait").tag(TimeInterval(0))
                Text("5 minutes").tag(TimeInterval(300))
                Text("15 minutes").tag(TimeInterval(900))
                Text("1 hour").tag(TimeInterval(3_600))
                Text("6 hours").tag(TimeInterval(21_600))
                Text("24 hours").tag(TimeInterval(86_400))
            }
        } header: {
            Text("Late Apple Watch Data")
        } footer: {
            Text("Apple Watch data can reach iPhone late. A value is sent once this long has passed after its interval ends, and recent values are checked again on later syncs.")
        }
    }

    private func statusSection(_ applied: AggregateConfig) -> some View {
        let state = model.aggregateStates[configID]
        let status = AggregateStatus.progress(AggregateProgress(config: applied, state: state))
        return Section("Status") {
            Text(status.text)
                .foregroundStyle(status.isFailure ? Color.red : .primary)
            LabeledContent("Sent through", value: state?.computedThrough?.formatted(date: .abbreviated, time: .shortened) ?? "Nothing yet")
            LabeledContent("Values sent", value: (state?.totalBucketsUploaded ?? 0).formatted())
            if let last = state?.lastComputedAt {
                LabeledContent("Last computed", value: last.relativeString)
            }
        }
    }

    private func recomputeSection(_ config: AggregateConfig, applied: AggregateConfig) -> some View {
        Section {
            Button("Recompute") { confirmRecompute = true }
                .disabled(applied != config || !config.enabled)
        } footer: {
            if applied != config {
                Text("Apply your changes first.")
            }
        }
    }

    private func update(_ edit: (inout AggregateConfig) -> Void) {
        guard let index = model.config.aggregates.firstIndex(where: { $0.id == configID }) else { return }
        edit(&model.config.aggregates[index])
    }
}

extension String {
    /// "daily total" from "Daily total", for a label inside a sentence.
    var lowercasedFirst: String { prefix(1).lowercased() + dropFirst() }
    /// "5 minutes" → "5 minutes"; "minute" → "Minute".
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
