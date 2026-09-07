import Foundation

/// Outcome of one `HealthSyncEngine.reconcile(type:)` run.
public struct ReconciliationReport: Sendable, Equatable {
    public var type: String
    public var windowsChecked: Int = 0
    public var windowsMismatched: Int = 0
    public var samplesReuploaded: Int = 0
    public var orphanDeletionsSent: Int = 0

    public init(type: String) {
        self.type = type
    }

    public var summary: String {
        windowsMismatched == 0
            ? "\(windowsChecked) windows in sync"
            : "\(windowsMismatched)/\(windowsChecked) windows repaired: +\(samplesReuploaded) samples, -\(orphanDeletionsSent) orphans"
    }
}

/// Pure helpers shared with tests: the digest must XOR-fold UUID bytes exactly like
/// the server (per UTC month over sample start dates).
enum ReconcileDigest {
    struct MonthWindow: Sendable, Equatable {
        /// First instant of the UTC month. The server uses this as the digest key
        /// even when the requested range covers only part of that month.
        var monthStart: Date
        /// Exact query bounds, clamped to the configured reconciliation range.
        var start: Date
        var end: Date
    }

    /// Lowercase hex of the byte-wise XOR of all UUIDs (order independent).
    /// All-zero (the empty digest) when the sequence is empty.
    static func hexDigest(of uuids: some Sequence<UUID>) -> String {
        var acc = [UInt8](repeating: 0, count: 16)
        for uuid in uuids {
            withUnsafeBytes(of: uuid.uuid) { bytes in
                for i in 0..<16 { acc[i] ^= bytes[i] }
            }
        }
        return acc.map { String(format: "%02x", $0) }.joined()
    }

    static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    /// Consecutive UTC month windows covering exactly [from, to). The first and
    /// last windows are partial when the requested bounds fall inside a month.
    /// An upper bound on a month boundary does not create an empty terminal window.
    static func monthWindows(from: Date, to: Date) -> [MonthWindow] {
        guard from < to else { return [] }
        let calendar = utcCalendar
        var cursor = from
        var out: [MonthWindow] = []
        while cursor < to {
            let monthStart = calendar.date(
                from: calendar.dateComponents([.year, .month], from: cursor))!
            let nextMonth = calendar.date(byAdding: .month, value: 1, to: monthStart)!
            let end = min(nextMonth, to)
            out.append(MonthWindow(monthStart: monthStart, start: cursor, end: end))
            cursor = end
        }
        return out
    }
}
