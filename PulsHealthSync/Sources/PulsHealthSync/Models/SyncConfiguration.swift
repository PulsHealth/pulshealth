import Foundation

/// The protocol's default user. The server seeds a `users` row with this same
/// `id` (`db/init/000_users.sql`) so a fresh install's very first batch has a
/// valid foreign-key target, and the ingest server falls back to it when a
/// batch carries no `X-User-ID` header. It is a constant rather than a
/// per-device value, so it survives reinstalls; it is shown read-only on the
/// Settings → User page. No name, email, date of birth or sex is assumed —
/// those are nil until the user enters them.
public enum PulsDefaultUser {
    public static let id = "5ea4d000-0000-4000-8000-000000000001"
}

/// User-controlled sync settings.
public struct SyncConfiguration: Codable, Sendable, Equatable {
    private enum CodingKeys: String, CodingKey {
        case enabledTypes, startDate, serverURL, authToken
        case maxConcurrentTypes, batchSize
        case observerCoalesceWindow, maxMergedBatchSamples
        case includeWorkoutRoutes, includeWorkoutEnhancedData
        case maxEnrichmentPointsPerBatch, aggregates
        case userID, userName, userEmail, userDateOfBirth, userBiologicalSex
    }

    /// Identifiers of the types to sync (keys into `HealthTypeCatalog`).
    public var enabledTypes: Set<String>
    /// Earliest date to export. Samples before this are never queried.
    public var startDate: Date
    /// Server batch upload endpoint, e.g. https://host:8080
    public var serverURL: URL?
    /// Bearer token for the ingest server. In-memory only: `encode(to:)` never
    /// writes it, `SyncStateStore` keeps it in its `TokenStore` (the Keychain)
    /// and fills it back in on load. The decoder still reads the key so a state
    /// file from before the Keychain store can be migrated.
    public var authToken: String?
    /// Max types exported concurrently during backfill. HealthKit's store handles
    /// 2-4 concurrent queries well; beyond that, XPC contention erodes throughput.
    public var maxConcurrentTypes: Int
    /// Max samples fetched per anchored-query page (also the upload batch size).
    /// 500-1,000 is the field-tested sweet spot (LoopKit uses 500, exporters 1,000).
    public var batchSize: Int
    /// How long to gather `HKObserverQuery` callbacks before running them as one
    /// wake. HealthKit does not hand you one callback per change: production
    /// telemetry recorded bursts of up to 93 callbacks inside five seconds, each
    /// previously becoming its own wake with its own queries and uploads, and
    /// 77% of all observer wakes arrived in clusters of five or more.
    ///
    /// The window is measured from the *first* callback of a burst and is not
    /// extended by later ones, so a continuous stream cannot starve the flush.
    /// Stragglers simply form the next (small) batch. Set to 0 to flush
    /// immediately and restore one-wake-per-callback behaviour.
    public var observerCoalesceWindow: TimeInterval
    /// Max samples packed into one merged multi-type upload. Uploading dominates
    /// sync wall time — 94% of it, against 6% for the HealthKit queries — because
    /// the median page carried 7 samples in 1.2 KB and still cost ~1.5s of
    /// round trip. Pages from different types are packed together up to this
    /// budget so one request carries real weight. Kept at `batchSize` so a
    /// merged batch is never larger than a single type's page already was.
    public var maxMergedBatchSamples: Int
    /// Attach GPS route points to exported workouts. When false, workout route
    /// read authorization is never requested and workout payloads upload without
    /// route lines. Only affects workouts synced after the change.
    public var includeWorkoutRoutes: Bool
    /// Attach enhanced data to exported workouts: intra-workout quantity-series
    /// streams (HR/power/cadence/speed curves), per-type min/avg/max/sum stats,
    /// lap/segment events and multi-sport sub-activities. When false, workouts
    /// upload only the basic payload (activity, duration, totals, flat stats).
    /// Only affects workouts synced after the change.
    public var includeWorkoutEnhancedData: Bool
    /// Max total points (route fixes or series datapoints) per workout-enrichment
    /// upload batch. Enrichment is chunked by *point budget*, not workout count:
    /// one long, high-frequency workout can carry an enormous stream, and a single
    /// oversized batch times out → rolls back → never advances → retries forever
    /// (the live stall this guards against). A single workout's points are split
    /// across as many ≤budget batches as needed; routes/series insert idempotently
    /// by workout UUID, so splitting is safe. ~1,000 raw samples upload in ~50 ms,
    /// so a few thousand points per batch stays well inside the request timeout.
    public var maxEnrichmentPointsPerBatch: Int
    /// On-device aggregate series (HKStatisticsCollectionQuery). Independent of
    /// `enabledTypes`: a type can have aggregates with raw-sample sync off.
    public var aggregates: [AggregateConfig]
    /// The user this device syncs as. `userID` is sent in the `X-User-ID` header
    /// on every batch and tags every stored row; the name/email/dob/sex ride the
    /// profile line and populate the server's `users` row. Editable on the
    /// Settings → User page (the id is stable). `userID` defaults to
    /// `PulsDefaultUser.id`; the identity fields default to nil and stay nil
    /// until the user fills them in.
    public var userID: String
    public var userName: String?
    public var userEmail: String?
    public var userDateOfBirth: Date?
    /// "female" | "male" | "other" | nil
    public var userBiologicalSex: String?

    public init(
        enabledTypes: Set<String> = [],
        startDate: Date = Calendar.current.date(byAdding: .year, value: -1, to: Date()) ?? Date(),
        serverURL: URL? = nil,
        authToken: String? = nil,
        maxConcurrentTypes: Int = 4,
        batchSize: Int = 1_000,
        observerCoalesceWindow: TimeInterval = 2.0,
        maxMergedBatchSamples: Int = 1_000,
        includeWorkoutRoutes: Bool = true,
        includeWorkoutEnhancedData: Bool = true,
        maxEnrichmentPointsPerBatch: Int = 4_000,
        aggregates: [AggregateConfig] = [],
        userID: String = PulsDefaultUser.id,
        userName: String? = nil,
        userEmail: String? = nil,
        userDateOfBirth: Date? = nil,
        userBiologicalSex: String? = nil
    ) {
        self.enabledTypes = enabledTypes
        self.startDate = startDate
        self.serverURL = serverURL
        self.authToken = authToken
        self.maxConcurrentTypes = maxConcurrentTypes
        self.batchSize = batchSize
        self.observerCoalesceWindow = observerCoalesceWindow
        self.maxMergedBatchSamples = maxMergedBatchSamples
        self.includeWorkoutRoutes = includeWorkoutRoutes
        self.includeWorkoutEnhancedData = includeWorkoutEnhancedData
        self.maxEnrichmentPointsPerBatch = maxEnrichmentPointsPerBatch
        self.aggregates = aggregates
        self.userID = userID
        self.userName = userName
        self.userEmail = userEmail
        self.userDateOfBirth = userDateOfBirth
        self.userBiologicalSex = userBiologicalSex
    }

    /// The identity payload sent on the profile line.
    public var userProfilePayload: ProfilePayload {
        ProfilePayload(
            name: userName, email: userEmail,
            dateOfBirth: userDateOfBirth.map(Self.wireDateOfBirth),
            biologicalSex: userBiologicalSex
        )
    }

    /// A date of birth is a calendar day, but the wire carries an instant and
    /// the server keeps the UTC calendar day of that instant. The picker yields
    /// local midnight, which in any zone east of UTC is still the *previous*
    /// UTC day — the stored DOB (and every HR-zone age derived from it) came out
    /// one day early there. Send local noon instead: the same day in UTC for
    /// every zone from UTC−12 to UTC+11.
    static func wireDateOfBirth(_ dob: Date) -> Date {
        Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: dob) ?? dob
    }

    /// Types referenced by an enabled aggregate config.
    public var aggregateTypeIdentifiers: Set<String> {
        Set(aggregates.lazy.filter(\.enabled).map(\.typeIdentifier))
    }

    /// Union of raw-sync and aggregate types — what authorization requests and
    /// observer/background-delivery registration must cover.
    public var observedTypeIdentifiers: Set<String> {
        enabledTypes.union(aggregateTypeIdentifiers)
    }

    /// Encode profile optionals explicitly, including `null`, so a deliberately
    /// cleared field round-trips as cleared rather than silently disappearing.
    /// (State files from the first user-aware schema used synthesized encoding
    /// and therefore omitted nil values; decoding treats an absent key as nil.)
    ///
    /// `authToken` is deliberately absent: the token belongs in the Keychain,
    /// and every encoding of this struct lands on disk.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(enabledTypes, forKey: .enabledTypes)
        try c.encode(startDate, forKey: .startDate)
        try c.encodeIfPresent(serverURL, forKey: .serverURL)
        try c.encode(maxConcurrentTypes, forKey: .maxConcurrentTypes)
        try c.encode(batchSize, forKey: .batchSize)
        try c.encode(observerCoalesceWindow, forKey: .observerCoalesceWindow)
        try c.encode(maxMergedBatchSamples, forKey: .maxMergedBatchSamples)
        try c.encode(includeWorkoutRoutes, forKey: .includeWorkoutRoutes)
        try c.encode(includeWorkoutEnhancedData, forKey: .includeWorkoutEnhancedData)
        try c.encode(maxEnrichmentPointsPerBatch, forKey: .maxEnrichmentPointsPerBatch)
        try c.encode(aggregates, forKey: .aggregates)
        try c.encode(userID, forKey: .userID)
        try Self.encodeNullable(userName, forKey: .userName, into: &c)
        try Self.encodeNullable(userEmail, forKey: .userEmail, into: &c)
        try Self.encodeNullable(userDateOfBirth, forKey: .userDateOfBirth, into: &c)
        try Self.encodeNullable(userBiologicalSex, forKey: .userBiologicalSex, into: &c)
    }

    private static func encodeNullable<T: Encodable>(
        _ value: T?, forKey key: CodingKeys,
        into container: inout KeyedEncodingContainer<CodingKeys>
    ) throws {
        if let value {
            try container.encode(value, forKey: key)
        } else {
            try container.encodeNil(forKey: key)
        }
    }

    // Custom decode so state files written before a field existed still load
    // (a synthesized decoder would throw keyNotFound, and SyncStateStore's
    // `try?` load would silently reset the whole configuration).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabledTypes = try c.decode(Set<String>.self, forKey: .enabledTypes)
        startDate = try c.decode(Date.self, forKey: .startDate)
        serverURL = try c.decodeIfPresent(URL.self, forKey: .serverURL)
        authToken = try c.decodeIfPresent(String.self, forKey: .authToken)
        maxConcurrentTypes = try c.decode(Int.self, forKey: .maxConcurrentTypes)
        batchSize = try c.decode(Int.self, forKey: .batchSize)
        observerCoalesceWindow = try c.decodeIfPresent(TimeInterval.self, forKey: .observerCoalesceWindow) ?? 2.0
        maxMergedBatchSamples = try c.decodeIfPresent(Int.self, forKey: .maxMergedBatchSamples) ?? 1_000
        includeWorkoutRoutes = try c.decodeIfPresent(Bool.self, forKey: .includeWorkoutRoutes) ?? true
        includeWorkoutEnhancedData = try c.decodeIfPresent(Bool.self, forKey: .includeWorkoutEnhancedData) ?? true
        maxEnrichmentPointsPerBatch = try c.decodeIfPresent(Int.self, forKey: .maxEnrichmentPointsPerBatch) ?? 4_000
        aggregates = try c.decodeIfPresent([AggregateConfig].self, forKey: .aggregates) ?? []
        // Absent identity keys — whether from a pre-user state file or from the
        // first user-aware schema, whose synthesized encoder omitted nil
        // optionals — decode to nil; nothing about the person is assumed. Only
        // `userID` has a fallback, the protocol default user, so a pre-user
        // file keeps syncing as the user the server already holds its rows under.
        userID = try c.decodeIfPresent(String.self, forKey: .userID) ?? PulsDefaultUser.id
        userName = try c.decodeIfPresent(String.self, forKey: .userName)
        userEmail = try c.decodeIfPresent(String.self, forKey: .userEmail)
        userDateOfBirth = try c.decodeIfPresent(Date.self, forKey: .userDateOfBirth)
        userBiologicalSex = try c.decodeIfPresent(String.self, forKey: .userBiologicalSex)
    }
}
