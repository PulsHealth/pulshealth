import SwiftUI
import PulsHealthSync

/// Named starting selections. `common` is what the Raw Samples menu's
/// "Common Set" applies and what first-run onboarding preselects, so the two
/// cannot drift apart.
enum TypePresets {
    static let common: Set<String> = [
        "HKQuantityTypeIdentifierStepCount",
        "HKQuantityTypeIdentifierHeartRate",
        "HKQuantityTypeIdentifierRestingHeartRate",
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
        "HKQuantityTypeIdentifierActiveEnergyBurned",
        "HKQuantityTypeIdentifierBasalEnergyBurned",
        "HKQuantityTypeIdentifierDistanceWalkingRunning",
        "HKQuantityTypeIdentifierAppleExerciseTime",
        "HKQuantityTypeIdentifierRespiratoryRate",
        "HKQuantityTypeIdentifierOxygenSaturation",
        "HKQuantityTypeIdentifierVO2Max",
        "HKQuantityTypeIdentifierBodyMass",
        "HKCategoryTypeIdentifierSleepAnalysis",
        HealthTypeCatalog.workoutIdentifier,
    ]
}

/// Sync → Raw Samples → Edit, structured like Apple Health's Browse screen:
/// a category list with colored icons that drills into per-category pages of
/// switches, plus search across every type. A type switched on sends its
/// raw samples, and nothing else: its aggregates are the Aggregates picker's.
struct RawSamplesPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var searchText = ""

    var body: some View {
        List {
            if searchText.isEmpty {
                categoriesSection
            } else {
                searchResultsSection
            }
        }
        .navigationTitle("Raw Samples")
        .searchable(
            text: $searchText, placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search data types")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("All Types") {
                        model.config.enabledTypes = Set(HealthTypeCatalog.all.map(\.identifier))
                    }
                    Button {
                        model.config.enabledTypes = TypePresets.common
                    } label: {
                        Text("Common Set")
                        Text("Steps, heart, sleep, workouts and more")
                    }
                    Button("None", role: .destructive) {
                        model.config.enabledTypes = []
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    private var categoriesSection: some View {
        Section {
            ForEach(HealthTypeDescriptor.Group.allCases, id: \.self) { group in
                let types = HealthTypeCatalog.all.filter { $0.group == group }
                if !types.isEmpty {
                    NavigationLink {
                        TypeCategoryView(group: group, types: types)
                    } label: {
                        PickerCategoryRow(
                            group: group, total: types.count,
                            selected: types.count { model.config.enabledTypes.contains($0.identifier) })
                    }
                }
            }
        } header: {
            Text("Health Categories")
        } footer: {
            Text("\(model.config.enabledTypes.count) of \(HealthTypeCatalog.all.count) types send their raw samples: every reading, as recorded.")
        }
    }

    private var searchResultsSection: some View {
        let matches = HealthTypeCatalog.all.filter { $0.matchesSearch(searchText) }
        let routeMatches = "Workout Routes".localizedCaseInsensitiveContains(searchText)
        let enhancedMatches = "Enhanced Workout Data".localizedCaseInsensitiveContains(searchText)
        return Section {
            if matches.isEmpty && !routeMatches && !enhancedMatches {
                ContentUnavailableView.search(text: searchText)
            } else {
                ForEach(matches) { descriptor in
                    TypeToggleRow(descriptor: descriptor, showsCategory: true)
                }
                if routeMatches {
                    WorkoutRoutesToggleRow(showsCategory: true)
                }
                if enhancedMatches {
                    WorkoutEnhancedDataToggleRow(showsCategory: true)
                }
            }
        }
    }
}

/// One category's switches (Apple Health category page).
private struct TypeCategoryView: View {
    @Environment(AppModel.self) private var model
    let group: HealthTypeDescriptor.Group
    let types: [HealthTypeDescriptor]

    var body: some View {
        List {
            Section {
                ForEach(types) { descriptor in
                    TypeToggleRow(descriptor: descriptor, showsCategory: false)
                }
                if group == .workouts {
                    WorkoutRoutesToggleRow(showsCategory: false)
                    WorkoutEnhancedDataToggleRow(showsCategory: false)
                }
            } header: {
                let enabled = types.count { model.config.enabledTypes.contains($0.identifier) }
                Text("\(enabled) of \(types.count) on")
            } footer: {
                if group == .workouts {
                    Text("Workout Routes attaches the GPS path to each exported workout. Enhanced Data adds the intra-workout heart-rate / power / cadence / speed curves, per-metric min/avg/max, lap & segment markers, multi-sport splits, and your age (for heart-rate zones). Both apply only to workouts synced from then on; effort scores are always included.")
                }
            }
        }
        .navigationTitle(group.rawValue)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Turn All On", systemImage: "checkmark.circle") {
                        model.config.enabledTypes.formUnion(types.map(\.identifier))
                    }
                    Button("Turn All Off", systemImage: "xmark.circle", role: .destructive) {
                        model.config.enabledTypes.subtract(types.map(\.identifier))
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }
}

/// A single data-type toggle with its colored Health-style icon.
private struct TypeToggleRow: View {
    @Environment(AppModel.self) private var model
    let descriptor: HealthTypeDescriptor
    let showsCategory: Bool

    var body: some View {
        Toggle(isOn: binding) {
            HStack(spacing: 12) {
                TypeIcon(descriptor)
                VStack(alignment: .leading, spacing: 1) {
                    Text(descriptor.displayName)
                    if showsCategory {
                        Text(descriptor.group.rawValue)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var binding: Binding<Bool> {
        Binding(
            get: { model.config.enabledTypes.contains(descriptor.identifier) },
            set: { enabled in
                if enabled {
                    model.config.enabledTypes.insert(descriptor.identifier)
                } else {
                    model.config.enabledTypes.remove(descriptor.identifier)
                }
            }
        )
    }
}

/// Toggle for `SyncConfiguration.includeWorkoutRoutes` — routes aren't a catalog
/// type (they ride along with workout payloads), so this row binds to the config
/// flag instead of `enabledTypes`.
private struct WorkoutRoutesToggleRow: View {
    @Environment(AppModel.self) private var model
    let showsCategory: Bool

    var body: some View {
        Toggle(isOn: binding) {
            HStack(spacing: 12) {
                TypeIcon(symbol: "map.fill", color: HealthTypeDescriptor.Group.workouts.color)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Workout Routes")
                    if showsCategory {
                        Text(HealthTypeDescriptor.Group.workouts.rawValue)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var binding: Binding<Bool> {
        Binding(
            get: { model.config.includeWorkoutRoutes },
            set: { enabled in
                model.config.includeWorkoutRoutes = enabled
            }
        )
    }
}

/// Toggle for `SyncConfiguration.includeWorkoutEnhancedData` — the intra-workout
/// streams, detailed stats, events, and sub-activities that power the rich
/// workout view. Like routes, this rides with workout payloads, so it binds to
/// the config flag rather than `enabledTypes`.
private struct WorkoutEnhancedDataToggleRow: View {
    @Environment(AppModel.self) private var model
    let showsCategory: Bool

    var body: some View {
        Toggle(isOn: binding) {
            HStack(spacing: 12) {
                TypeIcon(symbol: "waveform.path.ecg", color: HealthTypeDescriptor.Group.workouts.color)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Enhanced Data")
                    if showsCategory {
                        Text(HealthTypeDescriptor.Group.workouts.rawValue)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var binding: Binding<Bool> {
        Binding(
            get: { model.config.includeWorkoutEnhancedData },
            set: { enabled in
                model.config.includeWorkoutEnhancedData = enabled
            }
        )
    }
}

/// Floating Apply/Discard bar shown on the Sync tab while the staged
/// configuration draft differs from what's applied to the engine. Nothing
/// chosen in the Raw Samples or Aggregates pickers, or on a type's aggregate
/// page — raw types, aggregates, workout routes — reaches the sync engine or
/// starts backfilling until they tap Apply.
struct PendingChangesBar: View {
    @Environment(AppModel.self) private var model
    @State private var applying = false

    var body: some View {
        Group {
            if model.hasPendingChanges {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Unapplied changes")
                            .font(.subheadline.weight(.semibold))
                        Text(model.pendingChangesSummary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Button("Discard", role: .destructive) {
                        model.discardChanges()
                    }
                    .buttonStyle(.bordered)
                    .disabled(applying)
                    Button {
                        applying = true
                        Task {
                            await model.applyChanges()
                            applying = false
                        }
                    } label: {
                        if applying {
                            ProgressView().frame(minWidth: 44)
                        } else {
                            Text("Apply").frame(minWidth: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(applying)
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
                .background(.bar)
                .overlay(alignment: .top) { Divider() }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: model.hasPendingChanges)
    }
}
