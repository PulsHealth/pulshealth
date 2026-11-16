import Foundation
import PulsHealthSync

struct ConnectionDraft: Codable {
    var title = ""
    var organizer = ""
    var kind = "group"
    var purpose = ""
    var contact = ""
    var consent = ""
    var mode = "ongoing"
    var delivery = "hosted"
    var history = 30
    var startDate = Date()
    var endDate = Calendar.current.date(byAdding: .day, value: 90, to: Date()) ?? Date()
    var retention = 90
    var metrics: [CollectionMetric] = []
    var file: FileConnectionDraft? = nil
    var hasContent: Bool { !title.isEmpty || !purpose.isEmpty || !metrics.isEmpty }
}

struct ConnectionPresentation {
    var label: String
    var symbol: String
    static func sharing(_ e: CollectionEnrollment, running: Bool, enabled: Bool, now: Date = Date()) -> Self {
        if e.status == "stopped" { return .init(label: "Withdrawn", symbol: "stop.circle") }
        if e.status == "complete" { return .init(label: "Completed", symbol: "checkmark.circle") }
        if e.end <= now && e.request.mode == "ongoing" { return .init(label: "Ended", symbol: "clock") }
        if e.status == "paused" { return .init(label: "Paused", symbol: "pause.circle") }
        if !enabled { return .init(label: "Not enabled on this iPhone", symbol: "iphone") }
        if e.start > now { return .init(label: "Scheduled", symbol: "calendar") }
        if running { return .init(label: "Syncing", symbol: "arrow.triangle.2.circlepath") }
        return .init(label: e.lastReceived == nil ? "Active" : "Synced", symbol: e.lastReceived == nil ? "circle" : "checkmark.circle")
    }
}

struct FileConnectionDraft: Codable {
    var start = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    var end = Date()
    var metrics: [DataRequest.Metric] = []
    var format: ExportFormat = .csv
    var sends = false
    var destinationName = ""
    var endpoint = ""
}
