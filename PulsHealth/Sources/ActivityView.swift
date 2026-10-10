import SwiftUI

/// Sync → Activity: the event log and the background-wake study, one segment
/// each. The diagnostics export is shared by both segments; LogView adds its
/// filter menu. This view owns the files so switching segments keeps them alive.
struct ActivityView: View {
    @Environment(AppModel.self) private var model
    private enum Segment: Hashable { case log, background }
    private struct DiagnosticsRevision: Equatable {
        var wakeCount: Int
        var latestEventID: UUID?
    }
    @State private var segment: Segment = .log
    @State private var exportURLs: [URL] = []

    var body: some View {
        Group {
            switch segment {
            case .log: LogView()
            case .background: BackgroundActivityView()
            }
        }
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Activity", selection: $segment) {
                    Text("Log").tag(Segment.log)
                    Text("Background").tag(Segment.background)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 240)
            }
            ToolbarItem(placement: .topBarTrailing) {
                if exportURLs.isEmpty {
                    ProgressView()
                } else {
                    ShareLink(items: exportURLs) {
                        Label("Export", systemImage: "square.and.arrow.up")
                    }
                }
            }
        }
        .task(id: DiagnosticsRevision(wakeCount: model.wakeRecords.count,
                                     latestEventID: model.events.last?.id)) {
            let urls = await model.writeDiagnosticsBundle()
            guard !Task.isCancelled else { return }
            exportURLs = urls
        }
        .onDisappear {
            exportURLs = []
            model.removeDiagnosticsBundle()
        }
    }
}
