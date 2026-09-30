import SwiftUI
import PulsHealthSync

/// The Export tab: build an export (data types, aggregate series, a range, a
/// format), write it straight from Apple Health to files on the phone and hand
/// them to the share sheet. No server is involved, which is the point: this is
/// the app's whole use for someone who does not run one.
///
/// The view is a rendering of `ExportModel` and owns almost nothing: the draft,
/// the run, its result and the staged files' lifetime all live there, so
/// leaving this screen mid-export neither cancels it nor strands its files.
struct ExportView: View {
    @Environment(AppModel.self) private var model
    @State private var sharing = false
    @State private var confirmDelete = false
    /// The Add Series / Edit Series sheet: nil = closed, `.new` = adding,
    /// `.edit` = the series being changed.
    @State private var editing: SeriesEdit?

    private enum SeriesEdit: Identifiable {
        case new
        case edit(AggregateConfig)

        var id: String {
            switch self {
            case .new: "new"
            case .edit(let config): config.id.uuidString
            }
        }
    }

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
        .navigationTitle("Export")
        .sheet(item: $editing) { edit in
            switch edit {
            case .new: ExportSeriesEditor()
            case .edit(let config): ExportSeriesEditor(editing: config)
            }
        }
        .alert("Delete this export?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { model.export.discard() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Removes the exported files from this iPhone. Copies you already saved or sent elsewhere are not affected.")
        }
    }

    // MARK: - Idle

    @ViewBuilder private var idleSections: some View {
        if let notice = model.export.notice {
            noticeSection(notice)
        }
        dataSection
        seriesSection
        rangeSection
        formatSection
        exportButtonSection
    }

    private var dataSection: some View {
        @Bindable var export = model.export
        let count = export.draft.types.count
        let workouts = export.draft.types.contains(HealthTypeCatalog.workoutIdentifier)
        return CardSection(
            "Data",
            subtitle: "Written straight from Apple Health to files on this iPhone. No server is involved."
        ) {
            NavigationLink {
                ExportTypePickerView()
            } label: {
                HStack(spacing: 12) {
                    TypeIcon(symbol: "square.grid.2x2", color: .accentColor, size: .small)
                    Text("Data types")
                    Spacer()
                    Text(count == 0 ? "None" : "\(count) type\(count == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if workouts {
                Toggle("Workout routes", isOn: $export.draft.includeWorkoutRoutes)
                Toggle("Enhanced workout data", isOn: $export.draft.includeWorkoutEnhancedData)
                Text("Routes add the GPS path of each workout. Enhanced data adds the heart rate, power, cadence and speed curves, laps and splits.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var seriesSection: some View {
        Section {
            ForEach(model.export.draft.aggregates) { config in
                Button {
                    editing = .edit(config)
                } label: {
                    ExportSeriesRow(config: config)
                }
                .buttonStyle(.plain)
            }
            .onDelete { offsets in
                let ids = offsets.map { model.export.draft.aggregates[$0].id }
                for id in ids { model.export.removeAggregate(id: id) }
            }
            Button {
                editing = .new
            } label: {
                Label("Add Series", systemImage: "plus")
            }
        } header: {
            Text("Aggregate series")
        } footer: {
            if model.export.draft.aggregates.isEmpty {
                Text("Optional. A series is one value per hour, day, week or month for a quantity type, such as daily steps. Far smaller than the raw samples.")
            } else {
                Text("Swipe a series to remove it. Tap one to change it.")
            }
        }
    }

    private var rangeSection: some View {
        @Bindable var export = model.export
        return CardSection("Range") {
            Picker("Range", selection: rangeChoice) {
                ForEach(RangeChoice.allCases) { choice in
                    Text(choice.title).tag(choice)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if export.draft.customRange {
                DatePicker(
                    "Start",
                    selection: $export.draft.customStart,
                    in: ...export.draft.lastCustomDay(),
                    displayedComponents: .date)
                DatePicker(
                    "End",
                    selection: lastDayBinding,
                    in: export.draft.customStart...,
                    displayedComponents: .date)
                let days = export.draft.customDayCount()
                Text("\(days) day\(days == 1 ? "" : "s"), both dates included.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text(rangeFootnote(export.draft.range))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func rangeFootnote(_ range: ExportRange) -> String {
        if let note = range.sizeNote { return note }
        guard let start = range.startDate() else { return range.title }
        return "From \(start.formatted(date: .abbreviated, time: .omitted)) to now. The sync start date in Settings does not apply here."
    }

    private var formatSection: some View {
        @Bindable var export = model.export
        return CardSection("Format") {
            Picker("Format", selection: $export.draft.format) {
                ForEach([ExportFormat.csv, .jsonl], id: \.self) { format in
                    Text(format.title).tag(format)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text(export.draft.format.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var exportButtonSection: some View {
        let selection = model.exportSelection
        return Section {
            Button {
                model.startExport()
            } label: {
                Text("Export").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .disabled(selection.isEmpty || model.exportBlockedByBackfill)
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if selection.isEmpty {
                    Text("Nothing is selected. Choose data types or add a series above.")
                } else if model.exportBlockedByBackfill {
                    Text("A backfill is running. It reads the same Health data, and the two would slow each other to a crawl. Export once it has finished.")
                } else {
                    Text("iOS may ask for Health access first if any selected type has not been asked about yet.")
                }
                if model.exportLacksMedicationAccess {
                    Text("Medication Doses needs its own permission, which iOS asks for after Apply under Sync → Synced Data. Until that has been answered this export contains no doses.")
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    /// The segmented picker's choices: the presets, then Custom.
    private enum RangeChoice: Hashable, CaseIterable, Identifiable {
        case preset(ExportRange)
        case custom

        static let allCases: [RangeChoice] = ExportRange.allCases.map { .preset($0) } + [.custom]

        var id: String {
            switch self {
            case .preset(let range): range.rawValue
            case .custom: "custom"
            }
        }

        /// Short, so five fit on a phone.
        var title: String {
            switch self {
            case .preset(.last30Days): "30 days"
            case .preset(.last90Days): "90 days"
            case .preset(.lastYear): "Year"
            case .preset(.allTime): "All"
            case .custom: "Custom"
            }
        }
    }

    private var rangeChoice: Binding<RangeChoice> {
        Binding(
            get: { model.export.draft.customRange ? .custom : .preset(model.export.draft.range) },
            set: { choice in
                switch choice {
                case .preset(let range):
                    model.export.draft.customRange = false
                    model.export.draft.range = range
                case .custom:
                    model.export.draft.customRange = true
                }
            }
        )
    }

    /// The End picker shows the last day included; the draft stores the
    /// exclusive instant after it.
    private var lastDayBinding: Binding<Date> {
        Binding(
            get: { model.export.draft.lastCustomDay() },
            set: { model.export.draft.setLastCustomDay($0) }
        )
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
                        Text("and \(copy.issues.count - Self.issueLimit) more.")
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
        CardSection("Exporting") {
            // Up to `maxConcurrentTypes` types are read at once; the subtitle
            // is whichever wrote last, which is enough to show life. No
            // fraction: HealthKit does not say how many samples a type holds
            // before they have been read, so any percentage would be made up.
            ProgressBanner(
                title: progress.phase.label,
                subtitle: progress.currentType.map {
                    HealthTypeCatalog.descriptor(for: $0)?.displayName ?? $0
                },
                fraction: nil,
                onCancel: { model.export.cancel() })
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                StatTile(label: "Rows written", value: progress.rowsWritten.formatted())
                StatTile(label: "Size so far", value: Int(progress.bytesWritten).byteString)
            }
            Text("Keep PulsHealth open and the iPhone unlocked until this finishes. Health data is unreadable while the iPhone is locked, so an export that runs into a lock comes out incomplete. The screen stays awake while it runs. Cancelling keeps nothing.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Finished

    @ViewBuilder private func finishedSections(_ finished: ExportModel.Finished) -> some View {
        let result = finished.result
        let selection = finished.draft.selection()

        CardSection(
            result.isComplete ? "Export complete" : "Export incomplete",
            subtitle: result.isComplete
                ? nil
                : "Some of the selection could not be read, so these files are not all of your data. What is missing is listed below and recorded in the manifest file."
        ) {
            Image(systemName: result.isComplete ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .font(.title2)
                .foregroundStyle(result.isComplete ? Color.green : .orange)
                .accessibilityHidden(true)
        } content: {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                StatTile(label: "Rows", value: result.writtenRows.formatted())
                StatTile(label: "Size", value: Int(result.totalBytes).byteString)
                StatTile(label: "Took", value: result.duration.shortDuration)
                StatTile(label: "Files", value: "\(result.files.count)", unit: result.format.title)
            }
            VStack(alignment: .leading, spacing: 6) {
                detailRow("Range", finished.rangeLabel)
                detailRow("Data types", "\(selection.types.count)")
                if !selection.aggregates.isEmpty {
                    detailRow("Aggregate series", "\(selection.aggregates.count)")
                }
                if selection.types.contains(HealthTypeCatalog.workoutIdentifier) {
                    if selection.includeWorkoutRoutes { detailRow("Workout routes", "Included") }
                    if selection.includeWorkoutEnhancedData { detailRow("Enhanced workout data", "Included") }
                }
            }
        }

        shareSection(finished)

        // Written rows, not `rowCounts`: what CSV has no file for is listed
        // below as left out, and must not also be listed here as exported.
        let written = ExportDataset.allCases.filter { result.writtenRowCounts[$0, default: 0] > 0 }
        if !written.isEmpty {
            CardSection("What's in it") {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(written, id: \.self) { dataset in
                        detailRow(dataset.displayName, result.writtenRowCounts[dataset, default: 0].formatted())
                    }
                }
            }
        }

        if !result.isComplete {
            Section {
                ForEach(Array(result.failures.prefix(Self.issueLimit).enumerated()), id: \.offset) { _, issue in
                    IssueRow(issue: issue)
                }
                if result.failures.count > Self.issueLimit {
                    Text("and \(result.failures.count - Self.issueLimit) more, all listed in the manifest file.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(result.unmappableSamples.sorted(by: { $0.key < $1.key }), id: \.key) { type, count in
                    IssueRow(issue: ExportIssue(
                        type: type,
                        message: "\(count.formatted()) sample\(count == 1 ? "" : "s") could not be converted to the type's unit and are in no file. This is a bug in PulsHealth. Please report it."))
                }
            } header: {
                Text("Not exported")
            } footer: {
                if finished.wasBackgrounded {
                    Text("PulsHealth left the foreground during this export. If the iPhone locked, Health data became unreadable from that moment, which is the usual cause of the failures above. Keep the app open and export again.")
                } else {
                    Text("A type iOS never showed in the Health permission sheet fails here too. Check Settings → Privacy & Security → Health → PulsHealth, then export again.")
                }
            }
        }

        let left = ExportDataset.allCases.filter { result.notRepresented[$0, default: 0] > 0 }
        if !left.isEmpty {
            CardSection(
                "Not in a CSV export",
                subtitle: "These have no spreadsheet shape, so CSV leaves them out. Export as JSONL to include them."
            ) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(left, id: \.self) { dataset in
                        detailRow(dataset.displayName, result.notRepresented[dataset, default: 0].formatted())
                    }
                }
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
                Text("Exported, with a caveat. For example a workout whose route could not be read.")
            }
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
            Spacer()
            Text(value)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
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
                .controlSize(.large)
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

    /// Rows shown before "and N more". A selection of eighty types that all
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
