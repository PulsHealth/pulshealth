import SwiftUI
import PulsHealthSync

/// Settings → Export Data: write the selected health data to CSV or JSONL files
/// on the phone and hand them to the share sheet. No server is involved, which
/// is the point — this is the app's whole use for someone who does not run one.
///
/// The view is a rendering of `ExportModel` and owns almost nothing: the run,
/// its result and the staged files' lifetime all live there, so leaving this
/// screen mid-export neither cancels it nor strands its files.
struct ExportView: View {
    @Environment(AppModel.self) private var model
    @State private var sharing = false
    @State private var confirmDelete = false

    var body: some View {
        List {
            switch model.export.state {
            case .idle:
                idleSections
            case .running(let progress):
                runningSections(progress)
            case .finished(let finished):
                finishedSections(finished)
            }
        }
        .navigationTitle("Export Data")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Delete this export?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { model.export.discard() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Removes the exported files from this iPhone. Copies you already saved or sent elsewhere are not affected.")
        }
    }

    // MARK: - Idle

    @ViewBuilder private var idleSections: some View {
        @Bindable var export = model.export
        let selection = model.exportSelection

        if let notice = model.export.notice {
            noticeSection(notice)
        }

        Section {
            Text("Writes your health data straight from Apple Health to files on this iPhone. No server is involved. When it finishes you can save the files, AirDrop them, or send them to another app.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }

        Section("Format") {
            ForEach([ExportFormat.csv, .jsonl], id: \.self) { format in
                Button {
                    export.format = format
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(format.title).foregroundStyle(.primary)
                            Text(format.detail).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "checkmark")
                            .fontWeight(.semibold)
                            .foregroundStyle(.tint)
                            .opacity(export.format == format ? 1 : 0)
                    }
                    // The whole row is the target, not just its text.
                    .contentShape(Rectangle())
                }
                // A default button in a List tints its whole label, captions
                // included; these rows are choices, not actions.
                .buttonStyle(.plain)
                .accessibilityAddTraits(export.format == format ? .isSelected : [])
            }
        }

        Section {
            Picker("Time range", selection: $export.range) {
                ForEach(ExportRange.allCases) { Text($0.title).tag($0) }
            }
        } footer: {
            if let note = export.range.sizeNote { Text(note) }
        }

        Section {
            if selection.isEmpty {
                Label {
                    Text("No data types are selected. Choose some on the Data Types tab and tap Apply, then come back.")
                } icon: {
                    Image(systemName: "square.grid.2x2")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            } else {
                LabeledContent("Data types", value: "\(selection.typeCount)")
                if selection.aggregateCount > 0 {
                    LabeledContent("Aggregate series", value: "\(selection.aggregateCount)")
                }
                if selection.includesWorkoutRoutes {
                    LabeledContent("Workout routes", value: "Included")
                }
                if selection.includesWorkoutStreams {
                    // "Enhanced Data" is what the Data Types tab calls the switch.
                    LabeledContent("Enhanced workout data", value: "Included")
                }
            }
        } header: {
            Text("What's included")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if !selection.isEmpty {
                    Text("The selection applied on the Data Types tab. The sync start date in Settings does not apply here — the time range above does.")
                }
                // The draft is deliberately not what gets exported (see
                // AppModel.exportSelection); say so while one is pending.
                if model.hasPendingChanges {
                    Text("Unapplied changes on the Data Types tab are not included. Tap Apply there first.")
                        .foregroundStyle(.orange)
                }
                if model.exportLacksMedicationAccess {
                    Text("Medication Doses needs its own permission, which iOS asks for after Apply on the Data Types tab. Until that has been answered this export contains no doses.")
                        .foregroundStyle(.orange)
                }
            }
        }

        Section {
            Button {
                model.startExport()
            } label: {
                Text("Export").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .disabled(selection.isEmpty || model.exportBlockedByBackfill)
        } footer: {
            if model.exportBlockedByBackfill {
                Text("A backfill is running. It reads the same Health data, and the two would slow each other to a crawl — export once it has finished.")
            } else {
                Text("iOS may ask for Health access first if any selected type has not been asked about yet.")
            }
        }
    }

    @ViewBuilder private func noticeSection(_ notice: ExportModel.Notice) -> some View {
        Section {
            switch notice {
            case .cancelled:
                Label("Export cancelled. Nothing was kept.", systemImage: "xmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            case .failed(let copy):
                VStack(alignment: .leading, spacing: 8) {
                    Label(copy.title, systemImage: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(.orange)
                    Text(copy.message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    ForEach(Array(copy.issues.prefix(Self.issueLimit).enumerated()), id: \.offset) { _, issue in
                        IssueRow(issue: issue)
                    }
                    if copy.issues.count > Self.issueLimit {
                        Text("…and \(copy.issues.count - Self.issueLimit) more.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if copy.suggestion == .healthAccess {
                        // The app's own page in Settings; Health permissions
                        // have no deep link of their own, and the message
                        // above names the path.
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: - Running

    @ViewBuilder private func runningSections(_ progress: ExportProgress) -> some View {
        Section {
            HStack(spacing: 12) {
                ProgressView()
                VStack(alignment: .leading, spacing: 2) {
                    Text(progress.phase.label)
                    // Up to `maxConcurrentTypes` types are read at once; this
                    // is whichever wrote last, which is enough to show life.
                    Text(progress.currentType.map {
                        HealthTypeCatalog.descriptor(for: $0)?.displayName ?? $0
                    } ?? " ")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            // No percentage: HealthKit does not say how many samples a type
            // holds before they have been read, so any fraction would be made up.
            LabeledContent("Rows written") {
                Text(progress.rowsWritten.formatted()).monospacedDigit()
            }
            LabeledContent("Size so far") {
                Text(Int(progress.bytesWritten).byteString).monospacedDigit()
            }
        } footer: {
            Text("Keep PulsHealth open and the iPhone unlocked until this finishes. iOS makes Health data unreadable while the iPhone is locked, so an export that runs into a lock comes out incomplete. The screen stays awake while it runs.")
        }

        Section {
            Button("Cancel Export", role: .destructive) { model.export.cancel() }
                .frame(maxWidth: .infinity)
        } footer: {
            Text("Cancelling keeps nothing — partial files are deleted.")
        }
    }

    // MARK: - Finished

    @ViewBuilder private func finishedSections(_ finished: ExportModel.Finished) -> some View {
        let result = finished.result

        Section {
            VStack(alignment: .leading, spacing: 6) {
                if result.isComplete {
                    Label("Export complete", systemImage: "checkmark.circle.fill")
                        .font(.headline)
                        .foregroundStyle(.green)
                } else {
                    Label("Export incomplete", systemImage: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(.orange)
                    Text("Some of the selection could not be read, so these files are not all of your data. What is missing is listed below and recorded in the manifest file.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 2)
            LabeledContent("Rows", value: result.writtenRows.formatted())
            LabeledContent("Size", value: Int(result.totalBytes).byteString)
            LabeledContent("Took", value: result.duration.shortDuration)
            LabeledContent("Format", value: result.format.title)
            LabeledContent("Time range", value: finished.range.title)
            LabeledContent("Files", value: "\(result.files.count)")
        }

        shareSection(finished)

        Section("What's in it") {
            // Written rows, not `rowCounts`: what CSV has no file for is listed
            // below as left out, and must not also be listed here as exported.
            ForEach(ExportDataset.allCases.filter { result.writtenRowCounts[$0, default: 0] > 0 }, id: \.self) { dataset in
                LabeledContent(dataset.displayName) {
                    Text(result.writtenRowCounts[dataset, default: 0].formatted()).monospacedDigit()
                }
            }
        }

        if !result.isComplete {
            Section {
                ForEach(Array(result.failures.prefix(Self.issueLimit).enumerated()), id: \.offset) { _, issue in
                    IssueRow(issue: issue)
                }
                if result.failures.count > Self.issueLimit {
                    Text("…and \(result.failures.count - Self.issueLimit) more, all listed in the manifest file.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(result.unmappableSamples.sorted(by: { $0.key < $1.key }), id: \.key) { type, count in
                    IssueRow(issue: ExportIssue(
                        type: type,
                        message: "\(count.formatted()) sample\(count == 1 ? "" : "s") could not be converted to the type's unit and are in no file. This is a bug in PulsHealth — please report it."))
                }
            } header: {
                Text("Not exported")
            } footer: {
                if finished.wasBackgrounded {
                    Text("PulsHealth left the foreground during this export. If the iPhone locked, Health data became unreadable from that moment — the usual cause of the failures above. Keep the app open and export again.")
                } else {
                    Text("A type iOS never showed in the Health permission sheet fails here too. Check Settings → Privacy & Security → Health → PulsHealth, then export again.")
                }
            }
        }

        if !result.notRepresented.isEmpty {
            Section {
                ForEach(ExportDataset.allCases.filter { result.notRepresented[$0, default: 0] > 0 }, id: \.self) { dataset in
                    LabeledContent(dataset.displayName) {
                        Text(result.notRepresented[dataset, default: 0].formatted()).monospacedDigit()
                    }
                }
            } header: {
                Text("Not in a CSV export")
            } footer: {
                Text("These have no spreadsheet shape, so CSV leaves them out. Export as JSONL to include them.")
            }
        }

        if !result.warnings.isEmpty {
            Section {
                DisclosureGroup("\(result.warnings.count) warning\(result.warnings.count == 1 ? "" : "s")") {
                    ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, issue in
                        IssueRow(issue: issue)
                    }
                }
            } footer: {
                Text("Exported, with a caveat — for example a workout whose route could not be read.")
            }
        }
    }

    @ViewBuilder private func shareSection(_ finished: ExportModel.Finished) -> some View {
        if finished.filesRemoved {
            Section {
                Label("Shared. The staged copy was removed from this iPhone.", systemImage: "checkmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("New Export") { model.export.discard() }
            }
        } else {
            Section {
                Button {
                    sharing = true
                } label: {
                    Label("Share or Save to Files", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                .listRowSeparator(.hidden)
                // Not `ShareLink`: it has no completion callback, and the
                // promise that the staged files go once they have been shared
                // needs one (`ActivitySheet`).
                .background(
                    ActivitySheet(isPresented: $sharing, items: finished.result.files) { completed in
                        model.export.shareFinished(completed: completed)
                    })
            }
            // Its own section: under the clear row above, a second row would
            // draw as a card with its top corners cut off.
            Section {
                Button("Delete Export", role: .destructive) { confirmDelete = true }
                    .frame(maxWidth: .infinity)
            } footer: {
                Text("The files are in temporary storage on this iPhone, outside any backup. They are deleted once you have shared them, when you start another export, and the next time PulsHealth launches. They are not encrypted: once saved or sent, a file is only as private as the place you put it.")
            }
        }
    }

    /// Rows shown before "…and N more". A selection of eighty types that all
    /// fail the same way (a locked phone) should not push Share off the screen.
    private static let issueLimit = 8
}

/// One failure or warning: the type's name, then the reason.
private struct IssueRow: View {
    let issue: ExportIssue

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let name = issue.typeDisplayName {
                Text(name).font(.subheadline)
            }
            Text(issue.message)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// `UIActivityViewController`, presented from an invisible anchor behind the
/// Share button.
///
/// SwiftUI's `ShareLink` would be less code, but it never says what happened:
/// there is no callback when the sheet closes, let alone whether anything was
/// done with the files. `completionWithItemsHandler` reports both, and
/// `completed == true` is the only signal the app gets that the files have
/// been handed over and the staged copy can go.
///
/// Presented by a child view controller rather than wrapped in `.sheet`: a
/// share sheet inside a SwiftUI sheet is a sheet in a sheet, and on iPad —
/// which the app ships for — it must be a popover with a source view, or UIKit
/// raises an exception. The anchor supplies that view.
private struct ActivitySheet: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    let items: [URL]
    let onFinish: (_ completed: Bool) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        let anchor = UIViewController()
        anchor.view.backgroundColor = .clear
        anchor.view.isUserInteractionEnabled = false
        return anchor
    }

    func updateUIViewController(_ anchor: UIViewController, context: Context) {
        // SwiftUI calls this for any state change; present once per request.
        guard isPresented, anchor.presentedViewController == nil, anchor.view.window != nil else { return }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // Copy would put a file URL on the pasteboard and report success; the
        // staged file is then deleted and the paste finds nothing. It is also
        // the one activity that would park health data on a clipboard other
        // devices can read.
        sheet.excludedActivityTypes = [.copyToPasteboard]
        sheet.popoverPresentationController?.sourceView = anchor.view
        sheet.popoverPresentationController?.sourceRect = anchor.view.bounds
        let isPresented = $isPresented
        let onFinish = onFinish
        sheet.completionWithItemsHandler = { _, completed, _, _ in
            // Called for every way the sheet closes, a swipe-away included
            // (`completed == false`), and only after the chosen activity has
            // finished with the items.
            MainActor.assumeIsolated {
                isPresented.wrappedValue = false
                onFinish(completed)
            }
        }
        anchor.present(sheet, animated: true)
    }
}
