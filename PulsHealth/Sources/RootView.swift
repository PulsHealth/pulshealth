import SwiftUI
import PulsHealthSync

struct RootView: View {
    private enum Tab: Hashable { case dashboard, dataTypes, log, settings }
    @State private var selection: Tab = .dashboard

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack { DashboardView() }
                .tabItem { Label("Dashboard", systemImage: "waveform.path.ecg") }
                .tag(Tab.dashboard)
            NavigationStack { TypePickerView() }
                .safeAreaInset(edge: .bottom) { PendingChangesBar() }
                .tabItem { Label("Data Types", systemImage: "square.grid.2x2.fill") }
                .tag(Tab.dataTypes)
            NavigationStack { LogView() }
                .tabItem { Label("Log", systemImage: "text.alignleft") }
                .tag(Tab.log)
            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(Tab.settings)
        }
        // Save & Apply on Settings, the User page, or the Data Types bar can
        // all raise the server/user-change prompt; show it above every tab.
        .serverChangePrompt()
    }
}

/// Floating Apply/Discard bar shown on the Data Types tab while the staged
/// configuration draft differs from what's applied to the engine. Nothing the
/// user toggles on that tab — raw types, aggregates, workout routes — reaches
/// the sync engine or starts backfilling until they tap Apply.
private struct PendingChangesBar: View {
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

struct DashboardView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            if model.needsAuthorization || !model.authorizationRequested {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        if model.authorizationRequested {
                            Text("Health access incomplete").font(.headline)
                            Text("Some enabled data types haven't been authorized yet, so their syncs will fail.")
                                .font(.subheadline).foregroundStyle(.secondary)
                            // The Data Types tab's Apply bar only appears while
                            // changes are staged, so in this exact situation
                            // (types added to the catalog after the first grant,
                            // or an interrupted permission sheet) there was no
                            // button to tap. Request access directly; the
                            // request is idempotent and skips determined types.
                            Button("Grant Health Access") {
                                Task { await model.requestAccessForEnabledTypesIfNeeded() }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        } else {
                            Text("Welcome to PulsHealth").font(.headline)
                            Text("Pick your data types on the Data Types tab and tap Apply — that's when Health access is requested. Then set your server in Settings and run the initial backfill.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        if let hint = model.authorizationHint {
                            Text(hint)
                                .font(.footnote)
                                .foregroundStyle(.orange)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            overviewSection

            Section("Types") {
                if model.statuses.isEmpty {
                    Text("No data types enabled yet. Choose some in the Data Types tab.")
                        .foregroundStyle(.secondary)
                }
                ForEach(model.statuses) { status in
                    NavigationLink(value: status.id) {
                        TypeRow(status: status)
                    }
                }
            }
        }
        .navigationTitle("PulsHealth")
        .navigationDestination(for: String.self) { id in
            if let status = model.statuses.first(where: { $0.id == id }) {
                TypeDetailView(status: status)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.syncNow(trigger: "manual") }
                } label: {
                    if model.isSyncingAll {
                        ProgressView()
                    } else {
                        Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
                .disabled(model.backfillActive || !model.configured)
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

    private var overviewSection: some View {
        Section("Overview") {
            LabeledContent("Samples exported", value: model.totalSamples.compactString)
            LabeledContent("Uploaded (gzip)", value: model.totalBytes.byteString)
            if model.typesBackfilling > 0 {
                LabeledContent("Backfilling", value: "\(model.typesBackfilling) types")
                if let eta = model.backfillRemaining {
                    LabeledContent("Backfill ETA", value: eta.shortDuration)
                }
            }
            if model.typesFailed > 0 {
                LabeledContent("Failing types") {
                    Text("\(model.typesFailed)").foregroundStyle(.red)
                }
            }
        }
    }
}

struct TypeRow: View {
    let status: TypeSyncStatus

    var body: some View {
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
