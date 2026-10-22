import Foundation

/// One finished data file, as the manifest records it.
struct ExportedFile: Sendable, Equatable {
    var url: URL
    /// Nil for the JSONL file, which holds every dataset.
    var dataset: ExportDataset?
    var bytes: Int64
    var rows: Int? = nil
    var type: String? = nil
}

/// Turns batches into bytes on disk. Implementations are not thread-safe and
/// do not need to be: `ExportFileTransport` (an actor) owns exactly one and is
/// the only thing that calls it, which is also what keeps a batch's lines
/// contiguous while four type pipelines upload at once.
protocol ExportWriter: AnyObject {
    /// Append one batch. Returns the bytes written for it.
    func write(_ batch: SyncBatch) throws -> Int
    /// Flush whatever was held back, close every file and report them in
    /// their stable order. Files with no rows are never created.
    func finish() throws -> [ExportedFile]
    /// Close and delete everything written so far.
    func abort()
}

/// An append-only file, created on first use.
///
/// Protection is `.completeUntilFirstUserAuthentication`, set explicitly
/// rather than inherited: an export of years of heart rate runs for minutes,
/// and if the user locks the phone meanwhile a `.complete` file (the class an
/// app gets when it opts into full data protection) would start refusing
/// writes ten seconds later. It is deliberately *not* run through
/// `ProtectedStateFile`: that also excludes the file from backup and is the
/// policy for the package's private state, whereas these files exist to be
/// handed to a share sheet and leave the app. By default they are staged under
/// the temporary directory, which iOS neither backs up nor keeps.
final class ExportFile {
    let url: URL
    private let handle: FileHandle
    private(set) var bytesWritten: Int64 = 0

    init(url: URL, appending: Bool = false) throws {
        self.url = url
        if appending {
            handle = try FileHandle(forWritingTo: url)
            do { bytesWritten = Int64(try handle.seekToEnd()) }
            catch { try? handle.close(); throw error }
            return
        }
        let created = FileManager.default.createFile(
            atPath: url.path, contents: nil,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        guard created else {
            throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: url.path])
        }
        handle = try FileHandle(forWritingTo: url)
    }

    func append(_ data: Data) throws {
        guard !data.isEmpty else { return }
        try handle.write(contentsOf: data)
        bytesWritten += Int64(data.count)
    }

    func close() throws { try handle.close() }

    func delete() {
        try? handle.close()
        try? FileManager.default.removeItem(at: url)
    }
}

// MARK: - JSONL

/// Writes every batch as the uncompressed NDJSON the HTTP transport would have
/// gzipped and POSTed: the header line, then the batch's lines. The file is
/// therefore a concatenation of valid Puls Sync Protocol v1 batches —
/// specified in `docs/protocol/README.md`, schema-checked, fixture-tested —
/// and an export is *replayable*: split it on header lines (the only lines
/// whose top-level object has a `batchID`) and POST each piece to
/// `/v1/batches`. Nothing about the format is export-specific, so nothing
/// about it can drift from the wire.
///
/// One `write` per batch, so a batch is never interleaved with another and is
/// never held in memory alongside a second one; the export as a whole is never
/// in memory at all.
final class JSONLExportWriter: ExportWriter {
    private let url: URL
    private let clientVersion: String
    private var file: ExportFile?

    init(directory: URL, baseName: String, clientVersion: String = PulsProtocol.clientVersion) {
        url = directory.appendingPathComponent("\(baseName).jsonl")
        self.clientVersion = clientVersion
    }

    func write(_ batch: SyncBatch) throws -> Int {
        let data = try BatchSerializer.ndjson(for: batch, clientVersion: clientVersion)
        if file == nil { file = try ExportFile(url: url) }
        try file?.append(data)
        return data.count
    }

    func finish() throws -> [ExportedFile] {
        guard let file else { return [] }
        try file.close()
        return [ExportedFile(url: file.url, dataset: nil, bytes: file.bytesWritten)]
    }

    func abort() {
        file?.delete()
        file = nil
    }
}

// MARK: - JSON

/// One ordinary JSON document: an array of the exact objects emitted by the
/// protocol serializer. Only one batch is buffered, regardless of export size.
/// JSONL is still the directly replayable protocol representation.
final class JSONExportWriter: ExportWriter {
    private let url: URL
    private var file: ExportFile?
    private var hasRecords = false

    init(directory: URL, baseName: String) {
        url = directory.appendingPathComponent("\(baseName).json")
    }

    func write(_ batch: SyncBatch) throws -> Int {
        let ndjson = try BatchSerializer.ndjson(for: batch)
        var output = Data()
        if file == nil {
            file = try ExportFile(url: url)
            output.append(Data("[\n".utf8))
        }
        // The serializer emits compact JSON. Embedded newlines are escaped,
        // so an LF byte separates objects rather than splitting a string.
        for record in ndjson.split(separator: 0x0A) {
            if hasRecords { output.append(Data(",\n".utf8)) }
            output.append(contentsOf: record)
            hasRecords = true
        }
        try file?.append(output)
        return output.count
    }

    func finish() throws -> [ExportedFile] {
        guard let file else { return [] }
        try file.append(Data("\n]\n".utf8))
        try file.close()
        return [ExportedFile(url: file.url, dataset: nil, bytes: file.bytesWritten)]
    }

    func abort() {
        file?.delete()
        file = nil
        hasRecords = false
    }
}

// MARK: - CSV

/// Writes one CSV file per dataset, header first, rows appended as batches
/// arrive — so a dataset's header is written once however many batches feed
/// it, and a dataset with no rows gets no file.
///
/// A flattened view, on purpose: metadata, device, temporal context, workout
/// statistics and events have no column here, and three kinds have no file at
/// all (`ExportDataset.isWrittenToCSV`). JSONL is the complete format.
///
/// `workouts` is the one dataset held back until `finish`. Its `hasRoute` and
/// `availableMetrics` columns describe rows that arrive in *later* phases —
/// the sweep uploads workout rows first and their routes and streams last —
/// so the rows wait in memory (a few hundred bytes each, and workouts number
/// in the thousands, not the millions) while route and stream batches fill in
/// which workouts have what. The server computes the same two columns the
/// same way, from which route points and streams it holds.
final class CSVExportWriter: ExportWriter {
    private struct WorkoutRow {
        var uuid: UUID
        var activityType: String
        var start: Date
        var end: Date
        var duration: TimeInterval
        var details: [String]
        var distanceMeters: Double?
        var energyKcal: Double?
    }

    private let directory: URL
    private let baseName: String
    /// `state_of_mind.date` is the entry's local calendar day. The server
    /// derives it in `PULS_TIME_ZONE`, which is required to match the phone's
    /// zone; here it *is* the phone's zone. Gregorian regardless of the
    /// device's calendar, because the column is an ISO `YYYY-MM-DD`.
    private let dayCalendar: Calendar
    private let options: ExportCSVOptions
    private let categoryLabels: [String: [Int: String]]
    private var tables: [String: ExportCSVTable] = [:]
    private var summary: [String: [String: String]] = [:]
    private var summaryColumns: Set<String> = []
    private var summaryCells = 0
    private var typeColumnCache: [ExportDataset: [String]] = [:]
    private var typeFileKeys: [String: String] = [:]
    private var workouts: [WorkoutRow] = []
    private var workoutsWithRoute: Set<UUID> = []
    private var workoutMetrics: [UUID: Set<String>] = [:]

    init(directory: URL, baseName: String, timeZone: TimeZone = .current,
         options: ExportCSVOptions = .init(), categoryLabels: [String: [Int: String]] = [:]) {
        self.directory = directory
        self.baseName = baseName
        self.options = options
        self.categoryLabels = categoryLabels
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        dayCalendar = calendar
    }

    func write(_ batch: SyncBatch) throws -> Int {
        var rows: [ExportDataset: [[String]]] = [:]

        for sample in batch.samples {
            switch sample.kind {
            case .quantity, .category:
                rows[.samples, default: []].append(sampleRow(sample) + (try details(sample)))
            case .workout:
                guard let detail = sample.workout else { continue }
                workouts.append(WorkoutRow(
                    uuid: sample.uuid, activityType: detail.activityType,
                    start: sample.start, end: sample.end, duration: detail.duration,
                    details: try details(sample), distanceMeters: detail.totalDistanceMeters, energyKcal: detail.totalEnergyKcal))
            case .stateOfMind:
                guard let detail = sample.stateOfMind else { continue }
                rows[.stateOfMind, default: []].append(stateOfMindRow(sample, detail) + (try details(sample)))
            case .medicationDose:
                guard let detail = sample.medicationDose else { continue }
                rows[.medicationDoses, default: []].append(Self.medicationDoseRow(sample, detail) + (try details(sample)))
            case .ecg, .heartbeatSeries, .activitySummary:
                // No tabular shape. Not dropped silently: the transport counts
                // these per dataset and `ExportResult.notRepresented` reports
                // them. (`.activitySummary` never reaches a sample line.)
                continue
            }
        }
        for route in batch.routes where !route.points.isEmpty {
            workoutsWithRoute.insert(route.workoutUUID)
            let id = route.workoutUUID.uuidString.lowercased()
            rows[.workoutRoutes, default: []] += route.points.map { point in
                [
                    id, CSVField.epochMilliseconds(point.t),
                    CSVField.number(point.lat), CSVField.number(point.lon),
                    CSVField.number(point.alt), CSVField.number(point.hAcc),
                    CSVField.number(point.vAcc), CSVField.number(point.speed),
                    CSVField.number(point.course),
                ]
            }
        }
        for series in batch.series where !series.points.isEmpty {
            workoutMetrics[series.workoutUUID, default: []].insert(series.type)
            let id = series.workoutUUID.uuidString.lowercased()
            rows[.workoutSeries, default: []] += series.points.map { point in
                [
                    id, series.type, series.unit ?? "",
                    CSVField.epochMilliseconds(point.t), CSVField.number(point.value),
                ]
            }
        }
        for bucket in batch.aggregates {
            rows[.aggregates, default: []].append([
                bucket.type, bucket.function.rawValue, String(bucket.intervalValue),
                bucket.intervalUnit.rawValue, bucket.deviceFilter.rawValue,
                CSVField.epochMilliseconds(bucket.bucketStart),
                CSVField.epochMilliseconds(bucket.bucketEnd),
                CSVField.number(bucket.value), bucket.unit ?? "",
            ])
        }
        for day in batch.activitySummaries {
            rows[.activity, default: []].append([
                // The wire's own local day, never re-derived from the instant:
                // shifting it through another zone splits a day across two rows.
                day.localDate ?? Self.isoDay(day.date, calendar: dayCalendar),
                CSVField.number(day.moveKcal), CSVField.number(day.moveGoalKcal),
                CSVField.number(day.exerciseMin), CSVField.number(day.exerciseGoalMin),
                CSVField.number(day.standHours), CSVField.number(day.standGoalHours),
                CSVField.number(day.moveMode),
                CSVField.number(day.moveTimeMin), CSVField.number(day.moveTimeGoalMin),
            ])
        }
        // Deletions are not written: a tombstone is an instruction to a
        // receiver ("forget this UUID"), and a CSV reader has no store to
        // forget it from. Counted by the transport like the other kinds.

        var written = 0
        for dataset in ExportDataset.allCases {
            for row in rows[dataset] ?? [] {
                written += try append(row, to: dataset)
            }
        }
        return written
    }

    func finish() throws -> [ExportedFile] {
        if !workouts.isEmpty {
            for workout in workouts {
                _ = try append([
                    workout.uuid.uuidString.lowercased(), workout.activityType,
                    CSVField.epochMilliseconds(workout.start), CSVField.epochMilliseconds(workout.end),
                    CSVField.number(workout.duration), CSVField.number(workout.distanceMeters),
                    CSVField.number(workout.energyKcal),
                    workoutsWithRoute.contains(workout.uuid) ? "true" : "false",
                    // Sorted, like the server's array_agg(DISTINCT … ORDER BY …).
                    (workoutMetrics[workout.uuid] ?? []).sorted().joined(separator: ","),
                ] + workout.details, to: .workouts)
            }
            workouts = []
        }
        if !summary.isEmpty {
            let columns = summaryColumns.sorted()
            let table = try table(key: "daily-summary", dataset: .aggregates,
                                  columns: ["date", "timeZone", "bucketStart", "bucketEnd"] + columns)
            for key in summary.keys.sorted(by: {
                let lhs = Double($0.split(separator: "|")[0]) ?? 0
                let rhs = Double($1.split(separator: "|")[0]) ?? 0
                return lhs == rhs ? $0 < $1 : lhs < rhs
            }) {
                try Task.checkCancellation()
                let cells = summary[key]!
                _ = try table.append([cells["date"]!, dayCalendar.timeZone.identifier,
                                      cells["bucketStart"]!, cells["bucketEnd"]!]
                                     + columns.map { cells[$0] ?? "" })
            }
            summary = [:]
        }
        let order = ExportDataset.allCases
        let keys = tables.keys.sorted {
            let lhs = tables[$0]!.dataset.flatMap { order.firstIndex(of: $0) } ?? -1
            let rhs = tables[$1]!.dataset.flatMap { order.firstIndex(of: $0) } ?? -1
            return lhs == rhs ? $0 < $1 : lhs < rhs
        }
        return try keys.flatMap { try tables[$0]!.finish() }
    }

    func abort() {
        for table in tables.values { table.abort() }
        tables = [:]
        workouts = []
        summary = [:]
    }

    private var detailColumns: [String] {
        (options.includeSourceDetails ? ["sourceBundleID", "sourceVersion", "device"] : [])
            + (options.includeMetadata ? ["metadata"] : [])
    }

    private func details(_ sample: SyncSample) throws -> [String] {
        var fields: [String] = []
        if options.includeSourceDetails {
            fields += [sample.sourceBundleID ?? "", sample.sourceVersion ?? "", sample.device ?? ""]
        }
        if options.includeMetadata {
            let encoder = JSONEncoder.puls
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            fields.append(String(decoding: try encoder.encode(sample.metadata), as: UTF8.self))
        }
        return fields
    }

    private lazy var columnLists: [ExportDataset: [String]] = {
        let hasDetails: Set<ExportDataset> = [.samples, .workouts, .stateOfMind, .medicationDoses]
        return Dictionary(uniqueKeysWithValues: ExportDataset.allCases.map {
            ($0, ($0.csvColumns ?? []) + (hasDetails.contains($0) ? detailColumns : []))
        })
    }()

    private func columns(for dataset: ExportDataset) -> [String] { columnLists[dataset] ?? [] }

    private func typeColumns(for dataset: ExportDataset) -> [String] {
        if let cached = typeColumnCache[dataset] { return cached }
        let kinds: [ExportDataset]
        switch dataset {
        case .samples, .aggregates, .workoutSeries: kinds = [.samples, .aggregates, .workoutSeries]
        case .workouts, .workoutRoutes: kinds = [.workouts, .workoutRoutes]
        default: kinds = [dataset]
        }
        var names = ["dataset", "type"]
        for kind in kinds {
            for column in columns(for: kind) where !names.contains(column) { names.append(column) }
        }
        for kind in kinds { typeColumnCache[kind] = names }
        return names
    }

    private func fileKey(for type: String) -> String {
        if let key = typeFileKeys[type] { return key }
        let safe = type.unicodeScalars.map {
            CharacterSet.alphanumerics.contains($0) ? String($0) : "_"
        }.joined()
        let key = "type-" + safe
        typeFileKeys[type] = key
        return key
    }

    private func table(key: String, dataset: ExportDataset?, columns: [String], type: String? = nil) throws -> ExportCSVTable {
        if let table = tables[key] { return table }
        let table = ExportCSVTable(directory: directory, stem: "\(baseName)-\(key)",
                                   dataset: dataset, columns: columns, rowsPerFile: options.rowsPerFile, type: type)
        tables[key] = table
        return table
    }

    private lazy var combinedColumns: [String] = {
        var union = ["dataset"]
        for kind in ExportDataset.allCases where kind.isWrittenToCSV {
            for column in columns(for: kind) where !union.contains(column) { union.append(column) }
        }
        return union
    }()

    private func append(_ row: [String], to dataset: ExportDataset) throws -> Int {
        if options.layout == .dailySummary && dataset == .aggregates {
            // The full identity and unit prevent different series from sharing a column.
            let series = [row[0], row[1], row[2], row[3], row[4], row[8]].joined(separator: "|")
            let key = row[5] + "|" + row[6]
            if summary[key] == nil {
                let date = Date(timeIntervalSince1970: (Double(row[5]) ?? 0) / 1_000)
                summary[key] = ["date": Self.isoDay(date, calendar: dayCalendar),
                                "bucketStart": row[5], "bucketEnd": row[6]]
            }
            if summary[key]?[series] == nil { summaryCells += 1 }
            guard summaryCells <= 1_000_000 else {
                throw HealthExportError.invalidOptions("Daily summary is too large. Choose a shorter range or Separate datasets.")
            }
            summary[key]?[series] = row[7]
            summaryColumns.insert(series)
            return 0
        }
        let columns = columns(for: dataset)
        if options.layout == .combined || options.layout == .dataTypes {
            var cells = Dictionary(uniqueKeysWithValues: zip(columns, row))
            let type: String
            if let recorded = cells["type"] { type = recorded }
            else {
                switch dataset {
                case .workouts, .workoutRoutes: type = HealthTypeCatalog.workoutIdentifier
                case .activity: type = HealthTypeCatalog.activitySummaryIdentifier
                case .stateOfMind: type = HealthTypeCatalog.stateOfMindIdentifier
                case .medicationDoses: type = HealthTypeCatalog.medicationDoseIdentifier
                default: type = dataset.rawValue
                }
            }
            cells["type"] = type
            let union: [String]
            let key: String
            if options.layout == .combined {
                union = combinedColumns
                key = "records"
            } else {
                // Keep raw, aggregate and workout-stream rows for the same health
                // type together. Compatible groups have fixed, modest-width headers.
                union = typeColumns(for: dataset)
                key = fileKey(for: type)
            }
            let table = try table(key: key, dataset: nil, columns: union,
                                  type: options.layout == .dataTypes ? type : nil)
            return try table.append([dataset.rawValue] + union.dropFirst().map { cells[$0] ?? "" })
        }
        return try table(key: dataset.rawValue, dataset: dataset, columns: columns).append(row)
    }

    // MARK: Rows

    /// `uuid` is lowercased in every CSV: the server's export prints
    /// PostgreSQL's `uuid::text`, which is lowercase, while Swift (and so the
    /// wire, and the JSONL export) spells a UUID in capitals.
    private func sampleRow(_ sample: SyncSample) -> [String] {
        [
            sample.type, sample.unit ?? "", sample.uuid.uuidString.lowercased(),
            CSVField.epochMilliseconds(sample.start), CSVField.epochMilliseconds(sample.end),
            // A category sample's value is its raw HealthKit integer, as on the
            // server (`category_samples.value`).
            sample.kind == .category ? CSVField.number(sample.category) : CSVField.number(sample.value),
            sample.category.flatMap { categoryLabels[sample.type]?[$0] } ?? "",
            sample.sourceName ?? "",
        ]
    }

    private func stateOfMindRow(_ sample: SyncSample, _ detail: StateOfMindDetail) -> [String] {
        [
            sample.uuid.uuidString.lowercased(),
            Self.isoDay(sample.start, calendar: dayCalendar),
            CSVField.epochMilliseconds(sample.start),
            detail.kind, CSVField.number(detail.valence), detail.valenceClassification,
            detail.labels.joined(separator: ","), detail.associations.joined(separator: ","),
        ]
    }

    private static func medicationDoseRow(_ sample: SyncSample, _ detail: MedicationDoseDetail) -> [String] {
        [
            sample.uuid.uuidString.lowercased(),
            CSVField.epochMilliseconds(sample.start), CSVField.epochMilliseconds(sample.end),
            detail.medication ?? "", detail.medicationID ?? "", detail.status,
            CSVField.epochMilliseconds(detail.scheduledAt),
            CSVField.number(detail.doseQuantity), detail.doseUnit ?? "",
            sample.sourceName ?? "",
        ]
    }

    private static func isoDay(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

/// Streams complete CSV records, rotating only between records and repeating
/// the header in each part. Embedded newlines in a cell never affect splitting.
final class ExportCSVTable {
    private let directory: URL
    private let stem: String
    let dataset: ExportDataset?
    private let columns: [String]
    private let rowsPerFile: Int?
    private let type: String?
    private var currentURL: URL?
    private var buffer = Data()
    private var rowCount = 0
    private var partBytes: Int64 = 0
    private var finished: [ExportedFile] = []

    init(directory: URL, stem: String, dataset: ExportDataset?, columns: [String], rowsPerFile: Int?, type: String? = nil) {
        self.directory = directory
        self.stem = stem
        self.dataset = dataset
        self.columns = columns
        self.rowsPerFile = rowsPerFile
        self.type = type
    }

    func append(_ cells: [String]) throws -> Int {
        try Task.checkCancellation()
        if let limit = rowsPerFile, rowCount >= max(1, limit) { try closePart() }
        var bytes = 0
        if currentURL == nil {
            let part = rowsPerFile == nil ? "" : String(format: "-part-%04d", finished.count + 1)
            let url = directory.appendingPathComponent("\(stem)\(part).csv")
            let file = try ExportFile(url: url)
            currentURL = url
            try file.close()
            let header = Data(CSVField.row(columns).utf8)
            buffer.append(header)
            bytes += header.count
        }
        let row = Data(CSVField.row(cells).utf8)
        buffer.append(row)
        bytes += row.count
        partBytes += Int64(bytes)
        rowCount += 1
        if buffer.count >= 65_536 { try flush() }
        return bytes
    }

    private func flush() throws {
        guard let currentURL, !buffer.isEmpty else { return }
        // Per-type exports may have hundreds of tables. Open only while flushing,
        // rather than holding a descriptor for every selected type and dataset.
        let file = try ExportFile(url: currentURL, appending: true)
        do {
            try file.append(buffer)
            try file.close()
            buffer.removeAll(keepingCapacity: true)
        } catch {
            try? file.close()
            throw error
        }
    }

    private func closePart() throws {
        guard let currentURL else { return }
        try flush()
        finished.append(ExportedFile(url: currentURL, dataset: dataset, bytes: partBytes, rows: rowCount, type: type))
        self.currentURL = nil
        rowCount = 0
        partBytes = 0
    }

    func finish() throws -> [ExportedFile] {
        try closePart()
        return finished
    }

    func abort() {
        if let currentURL { try? FileManager.default.removeItem(at: currentURL) }
        for part in finished { try? FileManager.default.removeItem(at: part.url) }
        currentURL = nil
        finished = []
        buffer = Data()
    }
}
