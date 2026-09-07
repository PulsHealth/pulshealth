import SwiftUI
import PulsHealthSync

/// Everything we know about one type's sync state — the debugging view.
struct TypeDetailView: View {
    @Environment(AppModel.self) private var model
    let status: TypeSyncStatus
    @State private var confirmReset = false

    private var state: TypeSyncState { status.state }
    private var isActivitySummary: Bool { HealthTypeCatalog.isActivitySummary(status.id) }

    private var supportsReconciliation: Bool {
        [.quantity, .category, .workout].contains(status.descriptor.kind)
    }

    var body: some View {
        List {
            Section("Status") {
                LabeledContent("Activity", value: status.activity.rawValue)
                LabeledContent("Backfill complete", value: state.backfillComplete ? "Yes" : "No")
                LabeledContent(isActivitySummary ? "Day watermark" : "Anchor") {
                    if isActivitySummary {
                        Text(state.latestExported?.formatted(date: .abbreviated, time: .omitted) ?? "none")
                            .foregroundStyle(state.latestExported == nil ? .secondary : .primary)
                    } else if let anchorData = state.anchorData {
                        Text("\(anchorData.count) bytes").monospacedDigit()
                    } else {
                        Text("none (will export from start date)")
                            .foregroundStyle(.secondary)
                    }
                }
                if let rate = status.currentRate {
                    LabeledContent("Current rate", value: "\(Int(rate)) samples/s")
                }
                if let eta = status.estimatedSecondsRemaining {
                    LabeledContent("Backfill ETA", value: eta.shortDuration)
                }
            }

            Section("Volume") {
                LabeledContent(
                    isActivitySummary ? "Days exported" : "Samples exported",
                    value: state.totalSamplesExported.formatted())
                if !isActivitySummary {
                    LabeledContent("Deletions exported", value: state.totalDeletionsExported.formatted())
                }
                LabeledContent("Batches uploaded", value: state.totalBatchesUploaded.formatted())
                LabeledContent("Bytes uploaded (gzip)", value: state.totalBytesUploaded.byteString)
                if state.totalBatchesUploaded > 0 {
                    LabeledContent(
                        "Avg batch size",
                        value: (state.totalSamplesExported / max(1, state.totalBatchesUploaded)).formatted()
                    )
                }
            }

            Section("Timeline") {
                LabeledContent("Earliest sample", value: state.earliestExported?.formatted() ?? "—")
                LabeledContent("Latest sample", value: state.latestExported?.formatted() ?? "—")
                LabeledContent("Last sync", value: state.lastSyncAt.map { "\($0.formatted()) (\($0.relativeString))" } ?? "never")
                if let duration = state.lastSyncDuration {
                    LabeledContent("Last batch duration", value: duration.shortDuration)
                }
                if let latency = state.lastObservedLatency {
                    LabeledContent("Sample→upload latency", value: latency.shortDuration)
                }
            }

            Section("Server") {
                if let stats = model.serverStats[status.id] {
                    LabeledContent("Rows on server") {
                        Text(Int(stats.rows).formatted()).monospacedDigit()
                    }
                    LabeledContent("Batches received", value: Int(stats.batches).formatted())
                    LabeledContent("Earliest row", value: stats.earliest?.formatted() ?? "—")
                    LabeledContent("Latest row", value: stats.latest?.formatted() ?? "—")
                    if let at = stats.lastBatchAt {
                        LabeledContent("Last batch", value: "\(at.formatted()) (\(at.relativeString))")
                    }
                } else if let error = model.serverStatsError {
                    Text("Stats unavailable: \(error)").font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("No rows for this type yet").foregroundStyle(.secondary)
                }
                if let at = state.lastReconcileAt {
                    LabeledContent("Last reconciliation") {
                        VStack(alignment: .trailing) {
                            Text(at.relativeString)
                            if let summary = state.lastReconcileSummary {
                                Text(summary).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            if let error = state.lastError {
                Section("Last error") {
                    Text(error).font(.caption).foregroundStyle(.red)
                    if let at = state.lastErrorAt {
                        LabeledContent("At", value: at.formatted())
                    }
                }
            }

            Section {
                Button("Sync This Type Now") {
                    Task { await model.syncOne(status.id) }
                }
                if supportsReconciliation {
                    Button {
                        Task { await model.reconcile(status.id) }
                    } label: {
                        if model.reconciling.contains(status.id) {
                            HStack {
                                Text("Reconciling…")
                                Spacer()
                                ProgressView()
                            }
                        } else {
                            Text("Reconcile with Server")
                        }
                    }
                    .disabled(model.reconciling.contains(status.id))
                }
                Button(
                    isActivitySummary
                        ? "Reset Progress (recompute everything)"
                        : "Reset Anchor (re-export everything)",
                    role: .destructive
                ) {
                    confirmReset = true
                }
                // A reset under a running sync is undone by that run's next
                // state write; the engine refuses it, and the button says so.
                .disabled(status.activity != .idle)
            } footer: {
                if supportsReconciliation {
                    Text("Reconciliation compares per-month sample digests with the server, re-uploads anything missing, and removes orphans left by purged deletion tombstones.")
                }
            }
        }
        .navigationTitle(status.descriptor.displayName)
        .task { await model.refreshServerStats() }
        .confirmationDialog(
            isActivitySummary
                ? "Recompute all \(status.descriptor.displayName) data from the start date? Existing days are safely updated on the server."
                : "Re-export all \(status.descriptor.displayName) data from the start date? The server deduplicates by UUID, so this is safe but slow.",
            isPresented: $confirmReset, titleVisibility: .visible
        ) {
            Button(isActivitySummary ? "Reset Progress" : "Reset Anchor", role: .destructive) {
                Task { await model.resetType(status.id) }
            }
        }
    }
}
