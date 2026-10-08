import Foundation

/// A self-contained, untrusted request. Opening it never authorizes data access.
public struct DataRequest: Codable, Sendable, Equatable, Identifiable {
    public struct Metric: Codable, Sendable, Equatable, Identifiable {
        public var type: String
        /// Nil requests samples; otherwise one complete local-day aggregate.
        public var function: AggregateFunction?
        public var id: String { type }
        public init(type: String, function: AggregateFunction? = nil) {
            self.type = type; self.function = function
        }
    }
    public struct Destination: Codable, Sendable, Equatable {
        public var name: String
        public var url: URL
        public init(name: String, url: URL) { self.name = name; self.url = url }
    }
    public var version = 1
    public var id: UUID
    public var title: String
    public var requester: String
    public var purpose: String
    public var contact: String
    public var startDay: String
    public var endDay: String
    public var expiresAt: Date
    public var metrics: [Metric]
    public var format: ExportFormat
    public var destination: Destination?

    public init(title: String, requester: String, purpose: String, contact: String,
                startDay: String, endDay: String, metrics: [Metric], format: ExportFormat = .csv,
                destination: Destination? = nil, now: Date = Date()) {
        id = UUID(); self.title = title; self.requester = requester; self.purpose = purpose
        self.contact = contact; self.startDay = startDay; self.endDay = endDay
        self.metrics = metrics; self.format = format; self.destination = destination
        expiresAt = now.addingTimeInterval(30 * 86_400)
    }

    public struct Invalid: LocalizedError, Sendable {
        public let message: String
        public init(_ message: String) { self.message = message }
        public var errorDescription: String? { message }
    }

    public static func day(_ date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone; formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// Inclusive calendar dates resolved on the participant's phone, including DST.
    public func bounds(timeZone: TimeZone = .current) throws -> (start: Date, end: Date) {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        func parse(_ text: String) throws -> Date {
            let formatter = DateFormatter(); formatter.calendar = calendar
            formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = timeZone
            formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
            guard text.count == 10, let date = formatter.date(from: text),
                  formatter.string(from: date) == text else { throw Invalid("The request has an invalid date.") }
            return date
        }
        let start = try parse(startDay), last = try parse(endDay)
        guard start <= last, let end = calendar.date(byAdding: .day, value: 1, to: last) else {
            throw Invalid("The end date must be on or after the start date.")
        }
        return (start, end)
    }

    public func validate(now: Date = Date()) throws {
        guard version == 1 else { throw Invalid("This request needs a newer version of PulsHealth.") }
        for (value, limit) in [(title, 80), (requester, 80), (purpose, 300), (contact, 120)] {
            guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  value.utf8.count <= limit, !value.unicodeScalars.contains(where: { $0.value < 32 }) else {
                throw Invalid("Add a short title, requester, purpose and contact without line breaks.")
            }
        }
        guard expiresAt > now, expiresAt < now.addingTimeInterval(366 * 86_400) else {
            throw Invalid("This request has expired or has an invalid expiry date. Ask for a new link.")
        }
        let range = try bounds()
        guard startDay >= "1900-01-01", endDay <= Self.day(now), range.end > range.start else {
            throw Invalid("Choose dates from 1900 through today. Requests cannot collect future data.")
        }
        guard !metrics.isEmpty, metrics.count <= 30, Set(metrics.map(\.type)).count == metrics.count else {
            throw Invalid("Choose between 1 and 30 different data types.")
        }
        for metric in metrics {
            guard HealthTypeCatalog.all.contains(where: { $0.identifier == metric.type }) else {
                throw Invalid("A requested data type isn't available on this version of iOS.")
            }
            if let function = metric.function {
                guard HealthTypeCatalog.allowedAggregateFunctions(for: metric.type).contains(function) else {
                    throw Invalid("An aggregate isn't supported for the requested data type.")
                }
            }
            if format == .csv && [HealthTypeCatalog.electrocardiogramIdentifier, HealthTypeCatalog.heartbeatSeriesIdentifier].contains(metric.type) {
                throw Invalid("Choose JSONL to include ECG or heartbeat series.")
            }
        }
        if let destination {
            guard !destination.name.trimmingCharacters(in: .whitespaces).isEmpty,
                  destination.name.utf8.count <= 80,
                  !destination.name.unicodeScalars.contains(where: { $0.value < 32 }) else { throw Invalid("Add a short destination name.") }
            try Self.validateDestination(destination.url)
        }
    }

    public static func validateDestination(_ url: URL) throws {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              c.scheme == "https", let host = c.host, !host.isEmpty,
              c.user == nil, c.password == nil, c.query == nil, c.fragment == nil,
              url.absoluteString.utf8.count <= 400 else {
            throw Invalid("Use an HTTPS upload endpoint without credentials, query parameters or a fragment.")
        }
    }

    public func selection() -> ExportSelection {
        ExportSelection(types: Set(metrics.filter { $0.function == nil }.map(\.type)),
            aggregates: metrics.compactMap { metric in
                metric.function.map { AggregateConfig(typeIdentifier: metric.type, function: $0, settleDelay: 0) }
            })
    }

    /// Bounded so the actual QR can be rendered and untrusted input cannot allocate without limit.
    public static let maximumLinkBytes = 2_800
    public func link(now: Date = Date()) throws -> URL {
        try validate(now: now)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        let token = try encoder.encode(self).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let text = "puls://request?data=" + token
        guard text.utf8.count <= Self.maximumLinkBytes, let url = URL(string: text) else {
            throw Invalid("This request is too large for a QR code. Shorten its text or select fewer types.")
        }
        return url
    }

    public static func parse(_ text: String, now: Date = Date()) throws -> DataRequest {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.utf8.count <= maximumLinkBytes,
              let c = URLComponents(string: text), c.scheme == "puls", c.host == "request",
              c.path.isEmpty, c.fragment == nil, c.user == nil, c.password == nil, c.port == nil,
              c.queryItems?.count == 1, let item = c.queryItems?.first, item.name == "data",
              let encoded = item.value, !encoded.isEmpty,
              encoded.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }) else {
            throw Invalid("That isn't a supported PulsHealth request link.")
        }
        var base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64) else { throw Invalid("The request link is damaged.") }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
        let request: DataRequest
        do { request = try decoder.decode(DataRequest.self, from: data) }
        catch { throw Invalid("The request link is damaged or unsupported.") }
        try request.validate(now: now)
        return request
    }
}
