import Foundation
import HealthKit

/// iOS 27's limited-history Health access, and the rules the sync keeps
/// because of it.
///
/// From iOS 27 the Health permission sheet has a second page, "How much data
/// would you like to share?", offering *Past 30 Days and Future Data* or *All
/// Recorded Data and Future Data*, and Settings → Privacy & Security → Health
/// → (app) → (type) offers *Limited Access* or *Full Access* per type
/// afterwards. Limited, HealthKit lets the app read a type only from an
/// earliest date on — 30 days before the moment it was chosen, fixed from
/// then — and says so in no query: history before it simply looks empty. A
/// whole-history backfill drains after a month and reports itself complete,
/// a statistics query returns empty buckets for every year before, and a
/// sample query for last spring finds nothing.
///
/// Measured on the iOS 27.0 simulator (24A434): the date is the same for
/// every type a sheet granted, and reported for the activity-summary type
/// too; a type with full access, or none decided yet, is simply absent from
/// the answer, and so is a per-object type; a sample is hidden only when it
/// *ends* before the date; narrowing access made an anchored query from an
/// older anchor report no deletions; and an anchor taken under the limit
/// returned none of the older samples once access was widened again.
///
/// Empty is not harmless on this pipeline, because some passes treat what
/// they read as the whole truth and the server overwrites or deletes to
/// match:
///
/// - aggregates upload an explicit `"value": null` for an empty bucket so a
///   recompute can clear a stale value — over unreadable history that would
///   null out years of real server buckets, and a bucket straddling the date
///   would be overwritten with a partial value;
/// - reconciliation deletes server rows the device does not have;
/// - the rings upsert by day.
///
/// So every one of those passes is clamped to what is readable
/// (`clampAggregateWindow`, `reconcileStart`, `firstWholeDay`) and the date
/// each one ran under is recorded (`readableSince` on the type, aggregate,
/// rings and enrichment states). When access widens later — the date moves
/// earlier, or the limit goes — the passes that ran under the old date start
/// over and read the history they missed (`HealthSyncEngine
/// .refreshReadableHistory`, and each pass's own check). The raw sweep needs
/// that most: its anchor sits past everything it has read, so the samples
/// that become readable would never be returned by it again. The raw sweep
/// itself needs no clamp: it only adds what HealthKit returns and deletes
/// what HealthKit lists as deleted.
///
/// HealthKit reports the date through `HKHealthStore
/// .earliestAuthorizedSampleDate(for:)`, an iOS 27 SDK API. This package also
/// builds with Xcode 26.5, whose SDK does not have it, so every use sits
/// behind `#if compiler(>=6.4)` as well as `#available(iOS 27.0, *)`:
/// Xcode 27.0 ships Swift 6.4 with the iOS 27 SDK, while Xcode 26.5 ships
/// Swift 6.3.2 (and 26.6, Swift 6.3.3) with the iOS 26.5 SDK. A compiler
/// version is the only thing `#if` can test that tells the two SDKs apart.
/// Built with the older SDK, or run before iOS 27, there is never a limit.
public enum ReadableHistory {
    /// True when this build can ask HealthKit for earliest readable dates
    /// and the running OS can answer: built with the iOS 27 SDK and running
    /// iOS 27 or later. Also when the permission sheet can ask how much
    /// history to share, as far as this app is concerned.
    public static var isSupported: Bool {
        #if compiler(>=6.4)
        if #available(iOS 27.0, *) { return true }
        #endif
        return false
    }

    /// How far a reported date may move before it counts as a new grant.
    /// HealthKit's date is fixed when the user answers the sheet, but a
    /// re-sweep is a whole backfill, so a jittering value must never be able
    /// to start one; a real change of answer moves it by days or removes it.
    static let tolerance: TimeInterval = 3_600

    /// How a type's earliest readable date moved between two looks.
    public enum Change: Sendable, Equatable {
        case unchanged
        /// The date moved earlier, or the limit went away: history the
        /// passes could not read before is readable now.
        case widened
        /// A limit appeared, or the date moved later. Nothing is reset —
        /// what was synced stays synced, and the clamps keep the passes off
        /// what can no longer be read.
        case narrowed
    }

    /// The change from the date a pass recorded to the one HealthKit reports
    /// now. Nil means unlimited on both sides.
    public static func change(from recorded: Date?, to current: Date?) -> Change {
        switch (recorded, current) {
        case (nil, nil):
            return .unchanged
        case (.some, nil):
            return .widened
        case (nil, .some):
            return .narrowed
        case let (recorded?, current?):
            if current < recorded.addingTimeInterval(-tolerance) { return .widened }
            if current > recorded.addingTimeInterval(tolerance) { return .narrowed }
            return .unchanged
        }
    }

    /// A limit that bites: `since` when it is later than where a pass starts
    /// reading anyway, else nil. A limit at or before the start cuts nothing
    /// off, so there is nothing to clamp, record, or later re-read.
    static func effectiveLimit(_ since: Date?, readingFrom start: Date) -> Date? {
        guard let since, since > start else { return nil }
        return since
    }

    // MARK: - Clamps

    /// The first bucket boundary at or after `limit`. A bucket starting
    /// there holds only samples HealthKit lets the app read; every earlier
    /// bucket either ends before the limit or straddles it, and would be
    /// computed from part of its data.
    static func firstWholeBucket(atOrAfter limit: Date, bucketing: AggregateBucketing) -> Date {
        let index = bucketing.index(of: limit)
        let start = bucketing.start(ofBucket: index)
        return start == limit ? limit : bucketing.start(ofBucket: index + 1)
    }

    /// An aggregate window with every bucket before `firstWholeBucket` cut
    /// off, or nil when nothing readable is left in it. Nil `readableSince`
    /// is no limit, and the window comes back as it went in.
    ///
    /// A clamped bucket is not computed and not uploaded — not even as
    /// `"value": null`, which is what would overwrite real history on the
    /// server.
    static func clampAggregateWindow(
        _ window: (from: Date, to: Date), readableSince limit: Date?, bucketing: AggregateBucketing
    ) -> (from: Date, to: Date)? {
        guard let limit else { return window }
        let from = max(window.from, firstWholeBucket(atOrAfter: limit, bucketing: bucketing))
        guard from < window.to else { return nil }
        return (from, window.to)
    }

    /// Local midnight of the first day that starts at or after `limit`: the
    /// first ring day whose whole activity is readable.
    static func firstWholeDay(atOrAfter limit: Date, calendar: Calendar) -> Date {
        let day = calendar.startOfDay(for: limit)
        guard day < limit else { return day }
        return calendar.date(byAdding: .day, value: 1, to: day) ?? day.addingTimeInterval(86_400)
    }

    /// Where reconciliation may start. It deletes what the server has and the
    /// device does not, so it must never compare a range the device cannot
    /// read. HealthKit hides a sample only when it *ends* before the date
    /// (measured on the iOS 27.0 simulator: a sample starting three hours
    /// before it and ending three hours after is returned), so every sample
    /// that starts at or after the date is readable, and the comparison —
    /// by start date, like the server's digests — is complete from there.
    static func reconcileStart(syncStart: Date, readableSince limit: Date?) -> Date {
        guard let limit else { return syncStart }
        return max(syncStart, limit)
    }

    // MARK: - Re-sweep

    /// Whether a raw type has progress a widened grant should redo: an
    /// anchor (either stream), a finished backfill, or samples sent.
    static func hasRawProgress(_ state: TypeSyncState) -> Bool {
        state.anchorData != nil || state.recentAnchorData != nil
            || state.backfillComplete || state.totalSamplesExported > 0
    }

    /// The re-sweep decision for one raw type: its access widened since the
    /// date it was last synced under, and it has synced something under it.
    static func needsResweep(_ state: TypeSyncState, readableSince current: Date?) -> Bool {
        change(from: state.readableSince, to: current) == .widened && hasRawProgress(state)
    }

    // MARK: - HealthKit

    /// The HealthKit object types to ask about for `identifiers`, mapped back
    /// to the identifier each answers for. Medication doses are left out:
    /// per-object types raise an Objective-C exception in HealthKit's bulk
    /// authorization APIs, and this is one of them as far as anyone knows.
    static func objectTypes(for identifiers: some Sequence<String>) -> [HKObjectType: String] {
        var types: [HKObjectType: String] = [:]
        let identifiers = Array(identifiers)
        for identifier in identifiers {
            if HealthTypeCatalog.isActivitySummary(identifier) {
                types[HKObjectType.activitySummaryType()] = identifier
                continue
            }
            guard !HealthTypeCatalog.usesPerObjectAuthorization(identifier),
                  let type = HealthTypeCatalog.descriptor(for: identifier)?.sampleType
            else { continue }
            types[type] = identifier
        }
        // HealthKit's authorization APIs refuse the heartbeat series without
        // HRV SDNN beside it (an uncatchable exception — see
        // `HealthSyncEngine.readAuthorizationTypes`); ask for the pair here
        // too rather than find out whether this one does.
        if identifiers.contains(HealthTypeCatalog.heartbeatSeriesIdentifier) {
            let hrv = HKQuantityType(.heartRateVariabilitySDNN)
            if types[hrv] == nil { types[hrv] = hrv.identifier }
        }
        return types
    }

    /// One HealthKit round trip: the earliest readable date of each of
    /// `identifiers` that iOS 27 limits, by identifier. Empty when none is
    /// limited — and always empty when built with the iOS 26 SDK or run
    /// before iOS 27. Throws what HealthKit throws; callers decide what an
    /// unknown answer means for them.
    static func query(
        _ identifiers: some Collection<String>, in healthStore: HKHealthStore
    ) async throws -> [String: Date] {
        #if compiler(>=6.4)
        if #available(iOS 27.0, *) {
            let types = objectTypes(for: identifiers)
            guard !types.isEmpty else { return [:] }
            let dates = try await healthStore.earliestAuthorizedSampleDate(for: Set(types.keys))
            let asked = Set(identifiers)
            var byIdentifier: [String: Date] = [:]
            for (type, date) in dates {
                if let identifier = types[type], asked.contains(identifier) {
                    byIdentifier[identifier] = date
                }
            }
            return byIdentifier
        }
        #endif
        return [:]
    }
}
