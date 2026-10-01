import Foundation
import HealthKit

// iOS 27 limited history access, engine side: asking HealthKit for each
// type's earliest readable date. The rules themselves, and why each pass is
// clamped, are in `ReadableHistory`.

/// What HealthKit says one type's earliest readable date is, for a pass
/// about to read it.
struct ReadableLimit: Sendable, Equatable {
    /// The date to stay at or after; nil = unlimited.
    var since: Date?
    /// False when HealthKit could not be asked (device locked, query failed)
    /// and `since` is what the pass last ran under instead. A widening is
    /// never inferred from a stale answer.
    var isFresh: Bool
}

extension HealthSyncEngine {
    /// For the enabled types — raw sync, aggregate series and the rings —
    /// the earliest date iOS 27's limited Health access lets this app read
    /// each one from, by catalog identifier. Only limited types are listed:
    /// empty means unlimited, and is always the answer before iOS 27 or when
    /// built with the iOS 26 SDK (`ReadableHistory.isSupported`).
    ///
    /// Never throws. A locked device or a failed HealthKit query answers with
    /// what the last successful look found, so a caller can show it but must
    /// not treat an empty answer as proof of full access.
    public func earliestAuthorizedDates() async -> [String: Date] {
        let identifiers = await store.configuration.observedTypeIdentifiers
        if let dates = await currentReadableHistory(for: identifiers) { return dates }
        return readableHistory.filter { identifiers.contains($0.key) }
    }

    /// One HealthKit round trip for `identifiers`, or nil when the answer is
    /// unknown: the device is locked, or HealthKit failed (logged, scrubbed).
    func currentReadableHistory(for identifiers: Set<String>) async -> [String: Date]? {
        guard ReadableHistory.isSupported, !identifiers.isEmpty else { return [:] }
        guard await ProtectedData.isAvailable else { return nil }
        do {
            return try await ReadableHistory.query(identifiers, in: healthStore)
        } catch {
            await eventLog.log(.warn, "Could not read how much Health history is readable: \(error)")
            return nil
        }
    }

    /// The limit a pass over `identifier` must stay within: HealthKit's
    /// answer now, or — when it cannot give one — `recorded`, the date the
    /// pass last ran under, so a pass that was clamped stays clamped.
    func readableLimit(for identifier: String, recorded: Date?) async -> ReadableLimit {
        guard let dates = await currentReadableHistory(for: [identifier]) else {
            return ReadableLimit(since: recorded, isFresh: false)
        }
        return ReadableLimit(since: dates[identifier], isFresh: true)
    }
}
