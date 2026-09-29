import Foundation

/// The two file formats an on-device export can produce. See `HealthExporter`.
public enum ExportFormat: String, Sendable, Codable, CaseIterable {
    /// One `.jsonl` file: a concatenation of Puls Sync Protocol batches exactly
    /// as they would go over the wire, uncompressed. Complete — every field of
    /// every kind — and replayable into a server later.
    case jsonl
    /// One `.csv` file per dataset. A flattened view: the columns a spreadsheet
    /// wants, mirroring the product API's `/v1/export` where the two overlap.
    case csv
}

/// What to export. Build one from the app's `SyncConfiguration`; nothing about
/// the app's real sync state is read or changed (see `HealthExporter`).
public struct ExportRequest: Sendable {
    /// Supplies the type selection (`enabledTypes`), the aggregate configs, the
    /// workout route/enhanced-data switches, batch size, concurrency and the
    /// user ID. Its server URL, token, start date and the identity fields
    /// (name, e-mail, date of birth, sex) are ignored: an export has no server,
    /// takes its range from `startDate` below, and never writes a profile line
    /// — a file that is about to be handed to a share sheet should not carry
    /// an e-mail address nobody asked it to.
    public var configuration: SyncConfiguration
    /// Earliest sample start to export. Nil = all time — queried from
    /// 1 January 1900 rather than `.distantPast`, whose local calendar day is
    /// in 1 BC west of Greenwich (`ExportPlan.allTimeFloor`).
    public var startDate: Date?
    public var format: ExportFormat
    /// Where the files go. Nil = a fresh subdirectory of
    /// `HealthExporter.stagingRoot` (inside the temporary directory), which is
    /// what `HealthExporter.removeAllExports()` clears. A directory passed here
    /// is the caller's to clean up; the exporter only removes files it created
    /// there, and only when a run fails or is cancelled.
    public var outputDirectory: URL?
    /// Written as `deviceID` in every JSONL batch header and in the manifest.
    /// Pass the real engine's `store.deviceID` so a replayed export is
    /// attributed to this install. Nil = a random ID minted for this export
    /// (the throwaway state store's).
    public var deviceID: String?

    public init(
        configuration: SyncConfiguration,
        startDate: Date? = nil,
        format: ExportFormat,
        outputDirectory: URL? = nil,
        deviceID: String? = nil
    ) {
        self.configuration = configuration
        self.startDate = startDate
        self.format = format
        self.outputDirectory = outputDirectory
        self.deviceID = deviceID
    }
}

/// What a row is, independent of the format it is written in. Counts in
/// `ExportResult` and the manifest are keyed by this, so "how much was
/// exported" reads the same for a JSONL and a CSV export of the same data.
///
/// The raw values are the dataset names: the first four are the product API's
/// (`docs/export.md`), the rest exist only on the device.
public enum ExportDataset: String, Sendable, Codable, CaseIterable, Hashable {
    /// Quantity and category samples.
    case samples
    case workouts
    /// Daily activity rings.
    case activity
    case stateOfMind = "state_of_mind"
    /// On-device statistics buckets (`AggregateSampleRow`).
    case aggregates
    /// GPS fixes, one row per point.
    case workoutRoutes = "workout_routes"
    /// Intra-workout stream datapoints, one row per point.
    case workoutSeries = "workout_series"
    case medicationDoses = "medication_doses"
    /// Electrocardiograms. JSONL only: the row is a voltage trace.
    case ecg
    /// Beat-to-beat series. JSONL only: the row is a list of beat offsets.
    case heartbeatSeries = "heartbeat_series"
    /// HealthKit deletion tombstones. JSONL only: a deletion is an instruction
    /// to a receiver, not a row of data.
    case deletions

    /// Whether a CSV export writes this dataset. The three that it does not
    /// are counted in `ExportResult.notRepresented` instead of being dropped
    /// quietly.
    public var isWrittenToCSV: Bool { csvColumns != nil }

    /// Header row of the dataset's CSV file, or nil when it has no tabular
    /// shape. `samples`, `workouts`, `activity` and `state_of_mind` are the
    /// product API's column lists verbatim (`server/api/export.go`) —
    /// `ExportColumnTests` pins them — and the device-only files use the wire
    /// format's own keys in wire order.
    var csvColumns: [String]? {
        switch self {
        case .samples:
            return ["type", "unit", "uuid", "start", "end", "value", "label", "source"]
        case .workouts:
            return ["uuid", "activityType", "start", "end", "durationS", "distanceM",
                    "energyKcal", "hasRoute", "availableMetrics"]
        case .activity:
            return ["date", "moveKcal", "moveGoalKcal", "exerciseMin", "exerciseGoalMin",
                    "standHours", "standGoalHours", "moveMode", "moveTimeMin", "moveTimeGoalMin"]
        case .stateOfMind:
            return ["uuid", "date", "timestamp", "kind", "valence", "valenceClassification",
                    "labels", "associations"]
        case .aggregates:
            return ["type", "func", "intervalValue", "intervalUnit", "deviceFilter",
                    "bucketStart", "bucketEnd", "value", "unit"]
        case .workoutRoutes:
            return ["workoutUUID", "t", "lat", "lon", "alt", "hAcc", "vAcc", "speed", "course"]
        case .workoutSeries:
            return ["workoutUUID", "type", "unit", "t", "value"]
        case .medicationDoses:
            return ["uuid", "start", "end", "medication", "status", "scheduledAt",
                    "doseQuantity", "doseUnit", "source"]
        case .ecg, .heartbeatSeries, .deletions:
            return nil
        }
    }
}

/// Progress of a running export. Delivered on an arbitrary executor, once per
/// written batch and once per phase change — hop to the main actor before
/// touching UI state.
public struct ExportProgress: Sendable, Equatable {
    public enum Phase: String, Sendable, Codable {
        case preparing
        case activity
        case samples
        case aggregates
        case workoutRoutes
        case workoutStreams
        case finishing
    }

    public var phase: Phase
    /// Type identifier of the batch just written. Up to `maxConcurrentTypes`
    /// types are read at once, so this is "one of the types in flight".
    public var currentType: String?
    /// Rows written so far, summed over every dataset the format writes.
    public var rowsWritten: Int
    public var bytesWritten: Int64

    public init(phase: Phase, currentType: String? = nil, rowsWritten: Int = 0, bytesWritten: Int64 = 0) {
        self.phase = phase
        self.currentType = currentType
        self.rowsWritten = rowsWritten
        self.bytesWritten = bytesWritten
    }
}

public typealias ExportProgressHandler = @Sendable (ExportProgress) -> Void

/// Something the export could not do, or did with a caveat. `type` is the
/// HealthKit identifier it concerns, when there is one.
public struct ExportIssue: Sendable, Codable, Equatable {
    public var type: String?
    public var message: String

    public init(type: String? = nil, message: String) {
        self.type = type
        self.message = message
    }
}

/// The outcome of a finished export. A result is only ever returned with at
/// least one row on disk; "nothing came out" is a thrown `HealthExportError`.
///
/// **Check `isComplete` before presenting the files as the user's data.** The
/// sync engine survives a type it cannot read — that is right for a background
/// sync, which retries — so an export can finish with some types missing
/// (access never granted for them, the device locked part-way through). Those
/// are listed in `failures`, recorded in the manifest as `"complete": false`,
/// and the files are kept so the user can decide; they are never silent.
public struct ExportResult: Sendable {
    public var format: ExportFormat
    /// The directory holding `files`.
    public var directory: URL
    /// Everything to hand to a share sheet, in a stable order: the data files
    /// (for CSV, in `ExportDataset.allCases` order) and then the manifest.
    public var files: [URL]
    /// `…-manifest.json`: user ID, range, format, protocol and app version,
    /// counts, and every failure below. Also the last element of `files`.
    public var manifestURL: URL
    /// Rows exported per dataset (route and series datasets count points).
    /// Datasets with no rows are absent.
    public var rowCounts: [ExportDataset: Int]
    /// CSV only: rows HealthKit returned that the format has no file for —
    /// ECG traces, heartbeat series, deletion tombstones. Always empty for
    /// JSONL, which carries everything. Offer JSONL when this is non-empty.
    public var notRepresented: [ExportDataset: Int]
    /// Samples HealthKit returned that could not be converted to the type's
    /// canonical unit, per type identifier. Non-empty means a catalog bug
    /// (a wrong `unitString`), and that those samples are in no file.
    public var unmappableSamples: [String: Int]
    /// Types, aggregate series or workout phases that did not finish.
    public var failures: [ExportIssue]
    /// Things that went wrong without losing a whole type: an unreadable ECG
    /// trace exported without its voltages, a workout whose route query
    /// failed. Capped; the last entry says how many were left out.
    public var warnings: [ExportIssue]
    /// Size of everything in `files`.
    public var totalBytes: Int64
    public var duration: TimeInterval

    public var totalRows: Int { rowCounts.values.reduce(0, +) }

    /// True when every selected type, series and phase was read to the end
    /// and every sample HealthKit returned was written.
    public var isComplete: Bool { failures.isEmpty && unmappableSamples.isEmpty }
}

public enum HealthExportError: Error, LocalizedError, Sendable, Equatable {
    /// HealthKit does not exist on this device (an iPad without Health, a Mac).
    case healthDataUnavailable
    /// The device is locked, so every HealthKit query would fail with
    /// `errorDatabaseInaccessible`. Nothing was written.
    case deviceLocked
    /// The configuration enables no types and no aggregate series.
    case nothingSelected
    /// Every read succeeded and returned nothing. HealthKit answers a *denied*
    /// read exactly like an empty one, by design, so this is also what a
    /// refused permission looks like.
    case noData
    /// Nothing could be read at all; the issues say why, per type.
    case failed([ExportIssue])
    /// A file could not be created or written (out of space, most likely).
    /// The partial files were removed.
    case writeFailed(String)

    public var errorDescription: String? {
        switch self {
        case .healthDataUnavailable:
            return "HealthKit is not available on this device"
        case .deviceLocked:
            return "Health data cannot be read while the device is locked — unlock it and try again"
        case .nothingSelected:
            return "No data types are selected to export"
        case .noData:
            return "No data was found to export. If you expected some, check this app's access under Settings → Privacy & Security → Health."
        case .failed(let issues):
            let first = issues.first.map { ": \($0.message)" } ?? ""
            return "Nothing could be exported\(first)"
        case .writeFailed(let reason):
            return "The export could not be written: \(reason)"
        }
    }
}
