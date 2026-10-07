import SwiftUI
import PulsHealthSync

/// Sync → Aggregates → Edit, and Export → Aggregated types: the measurements
/// by category, searchable, laid out like the raw picker. A row works like a
/// calendar in the Calendar app's list: tapping it adds the type with its
/// daily default or removes it, and a selected row's ⓘ opens the type's page
/// to add more (`AggregateTypeView`).
struct AggregatesPickerView: View {
    @Environment(AppModel.self) private var model
    let scope: AggregateScope
    @State private var searchText = ""
    @State private var confirmNone = false

    var body: some View {
        List {
            if searchText.isEmpty {
                categoriesSection
            } else {
                searchResultsSection
            }
        }
        .navigationTitle("Aggregates")
        .searchable(
            text: $searchText, placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search measurements")
        .aggregateTypeDestination(scope: scope)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        let raw = model.rawTypes(scope)
                        model.editAggregates(scope) { $0.addDailyDefaults(for: raw) }
                    } label: {
                        Text("Match Raw Samples")
                        Text("A daily aggregate for every raw measurement")
                    }
                    .disabled(model.aggregateList(scope).missingDailyDefaults(for: model.rawTypes(scope)) == 0)
                    Button {
                        let all = AggregateList.measurementTypes.map(\.identifier)
                        model.editAggregates(scope) { $0.addDailyDefaults(for: all) }
                    } label: {
                        Text("All Measurements")
                        Text("A daily aggregate for every one")
                    }
                    Button("None", role: .destructive) {
                        let list = model.aggregateList(scope)
                        if list.typeIdentifiers.contains(where: list.hasMoreThanDefault(type:)) {
                            confirmNone = true
                        } else {
                            model.editAggregates(scope) { $0.configs = [] }
                        }
                    }
                    .disabled(model.aggregateList(scope).configs.isEmpty)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .confirmationDialog("Remove every aggregate?", isPresented: $confirmNone, titleVisibility: .visible) {
            Button("Remove All", role: .destructive) {
                model.editAggregates(scope) { $0.configs = [] }
            }
        } message: {
            Text(scope == .sync
                ? "Including the ones you added. What is already in your database stays."
                : "Including the ones you added.")
        }
    }

    private var categoriesSection: some View {
        let measurements = AggregateList.measurementTypes
        let list = model.aggregateList(scope)
        return Section {
            ForEach(HealthTypeDescriptor.Group.allCases, id: \.self) { group in
                let types = measurements.filter { $0.group == group }
                if !types.isEmpty {
                    NavigationLink {
                        AggregateCategoryView(group: group, types: types, scope: scope)
                    } label: {
                        PickerCategoryRow(
                            group: group, total: types.count,
                            selected: types.count { list.contains(type: $0.identifier) })
                    }
                }
            }
        } header: {
            Text("Health Categories")
        } footer: {
            Text("Only measurements can be aggregated. Each one you add starts with a daily total or average.")
        }
    }

    private var searchResultsSection: some View {
        let matches = AggregateList.measurementTypes.filter { $0.matchesSearch(searchText) }
        return Section {
            if matches.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else {
                ForEach(matches) { descriptor in
                    AggregateTypeRow(descriptor: descriptor, scope: scope)
                }
            }
        }
    }
}

/// One category's measurements.
private struct AggregateCategoryView: View {
    @Environment(AppModel.self) private var model
    let group: HealthTypeDescriptor.Group
    let types: [HealthTypeDescriptor]
    let scope: AggregateScope

    var body: some View {
        let list = model.aggregateList(scope)
        List {
            Section {
                ForEach(types) { descriptor in
                    AggregateTypeRow(descriptor: descriptor, scope: scope)
                }
            } header: {
                Text("\(types.count { list.contains(type: $0.identifier) }) of \(types.count) aggregated")
            } footer: {
                Text("Tap a type to add it with its daily total or average. Tap ⓘ to add more.")
            }
        }
        .navigationTitle(group.rawValue)
        .navigationBarTitleDisplayMode(.large)
        .aggregateTypeDestination(scope: scope)
    }
}

/// A category in either picker: its symbol and name in the category's
/// colour, and how many of its types are chosen.
struct PickerCategoryRow: View {
    let group: HealthTypeDescriptor.Group
    let total: Int
    let selected: Int

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: group.symbol)
                .font(.body)
                .foregroundStyle(group.color)
                .frame(width: 28)
            Text(group.rawValue)
                .fontWeight(.semibold)
                .foregroundStyle(group.color)
            Spacer()
            if selected > 0 {
                Text("\(selected) of \(total)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// One measurement: a selection circle in its category's colour, its name,
/// what it has (a selected row), and ⓘ to its page. Removing a type that
/// has more than its daily default asks first.
private struct AggregateTypeRow: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openAggregateType) private var openType
    let descriptor: HealthTypeDescriptor
    let scope: AggregateScope
    @State private var confirmRemove = false

    var body: some View {
        let list = model.aggregateList(scope)
        let selected = list.contains(type: descriptor.identifier)
        HStack(spacing: 12) {
            Button {
                toggle(list: list, selected: selected)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.title2)
                        .foregroundStyle(selected ? descriptor.group.color : Color.secondary.opacity(0.5))
                        .contentTransition(.symbolEffect(.replace))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(descriptor.displayName)
                            .foregroundStyle(.primary)
                        if let subtitle = subtitle(list: list) {
                            Text(subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
            if selected {
                Button {
                    openType(descriptor.identifier)
                } label: {
                    Image(systemName: "info.circle")
                        .font(.title3)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("\(descriptor.displayName) aggregates")
            }
        }
        .padding(.vertical, 2)
        .confirmationDialog(
            "Remove \(descriptor.displayName)?", isPresented: $confirmRemove, titleVisibility: .visible
        ) {
            Button("Remove \(list.configs(for: descriptor.identifier).count) Aggregates", role: .destructive) {
                model.editAggregates(scope) { $0.removeType(descriptor.identifier) }
            }
        } message: {
            Text(scope == .sync
                ? "Its aggregates stop syncing. What is already in your database stays."
                : "Its aggregates leave this export.")
        }
    }

    /// What a selected type has, and in Sync whether Apply has seen it; the
    /// category for an unselected search result.
    private func subtitle(list: AggregateList) -> String? {
        guard let summary = list.summary(for: descriptor.identifier) else { return nil }
        if scope == .sync,
           !model.appliedConfig.aggregates.contains(where: { $0.typeIdentifier == descriptor.identifier }) {
            return "\(summary) · new"
        }
        return summary
    }

    private func toggle(list: AggregateList, selected: Bool) {
        if !selected {
            model.editAggregates(scope) { $0.addType(descriptor.identifier) }
        } else if list.hasMoreThanDefault(type: descriptor.identifier) {
            confirmRemove = true
        } else {
            model.editAggregates(scope) { $0.removeType(descriptor.identifier) }
        }
    }
}

// MARK: - Opening a type's page

private struct OpenAggregateTypeKey: EnvironmentKey {
    static let defaultValue: @MainActor (String) -> Void = { _ in }
}

extension EnvironmentValues {
    /// Pushes a type's aggregate page (the picker rows' ⓘ).
    var openAggregateType: @MainActor (String) -> Void {
        get { self[OpenAggregateTypeKey.self] }
        set { self[OpenAggregateTypeKey.self] = newValue }
    }
}

private struct AggregateTypeDestination: ViewModifier {
    let scope: AggregateScope
    @State private var shown: String?

    func body(content: Content) -> some View {
        content
            .environment(\.openAggregateType) { shown = $0 }
            .navigationDestination(item: $shown) { id in
                if let descriptor = HealthTypeCatalog.descriptor(for: id) {
                    AggregateTypeView(descriptor: descriptor, scope: scope)
                }
            }
    }
}

extension View {
    /// Lets the rows inside push a type's aggregate page.
    func aggregateTypeDestination(scope: AggregateScope) -> some View {
        modifier(AggregateTypeDestination(scope: scope))
    }
}
