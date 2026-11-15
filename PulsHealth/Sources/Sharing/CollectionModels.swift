import Foundation
import PulsHealthSync

struct CollectionMetric: Codable, Hashable, Identifiable, Sendable {
    var type: String
    var function: String
    var required: Bool
    var unit: String?
    var id: String { type + ":" + function }
    var name: String { HealthTypeCatalog.descriptor(for: type)?.displayName ?? type }
    var detail: String { function == "raw" ? "Individual records" : "Daily \(function)" }
}
struct CollectionRequest: Codable, Identifiable, Sendable {
    var id: UUID
    var title: String
    var organizer: String
    var kind: String
    var purpose: String
    var contact: String
    var consentText: String
    var mode: String
    var historyDays: Int
    var durationDays: Int
    var retentionDays: Int
    var metrics: [CollectionMetric]
    var version: Int
    var status: String
    var listing: String
    var startAt: Int64? = nil
    var endAt: Int64? = nil
    var sharingStart: Date? { startAt.map { Date(timeIntervalSince1970: Double($0) / 1000) } }
    var sharingEnd: Date? { endAt.map { Date(timeIntervalSince1970: Double($0) / 1000) } }
    func allowsHistory(_ policy: SyncAccessPolicy, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        if let start = sharingStart { return policy.allowsExport(start: start, now: now, calendar: calendar) }
        return policy.historyDays.map { historyDays <= $0 } ?? true
    }
}
struct CollectionEnrollment: Codable, Identifiable, Sendable {
    var id: UUID
    var request: CollectionRequest
    var status: String
    var metrics: [CollectionMetric]
    var start: Date
    var end: Date
    var generation: Int
    var lastReceived: Date?
    var consentedAt: Date
}
struct CollectionList: Decodable { var requests: [CollectionRequest]; var enrollments: [CollectionEnrollment] }
struct CollectionResponse<Value: Decodable>: Decodable { var result: Value; var token: String?; var invite: String? }
struct CollectionCommand: Encodable {
    var action: String
    var id: UUID?
    var invite: String?
    var accepted: Bool?
    var version: Int?
    var metrics: [CollectionMetric]?
    var startAt: Int64?
    var endAt: Int64?
}
struct CollectionInvitation: Identifiable {
    var id: UUID
    var code: String?
    init(url: URL) throws {
        if url.scheme == "https" {
            guard url.host == PulsHealthDatabase.viewerURL.host, url.user == nil,
                  url.password == nil, url.port == nil, url.query == nil,
                  url.pathComponents.count == 3, url.pathComponents[1] == "collect",
                  url.path == "/collect/" + url.lastPathComponent,
                  let id = UUID(uuidString: url.lastPathComponent)
            else { throw CollectionError("This request link is not valid.") }
            if let code = url.fragment, code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) == nil {
                throw CollectionError("This request link is not valid.")
            }
            self.id = id; self.code = url.fragment
            return
        }
        guard url.scheme == "puls", url.host == "collection", url.path.isEmpty,
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              items.allSatisfy({ ["id", "invite"].contains($0.name) }),
              items.filter({ $0.name == "id" }).count == 1,
              items.filter({ $0.name == "invite" }).count <= 1,
              let value = items.first(where: { $0.name == "id" })?.value, let id = UUID(uuidString: value)
        else { throw CollectionError("This invitation is not valid.") }
        let code = items.first(where: { $0.name == "invite" })?.value
        if let code, code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) == nil {
            throw CollectionError("This invitation is not valid.")
        }
        self.id = id; self.code = code
    }
    init(id: UUID, code: String? = nil) { self.id = id; self.code = code }
}
struct CollectionError: LocalizedError { var errorDescription: String?; init(_ message: String) { errorDescription = message } }

/// Both delivery methods enter the same review flow; parsing never starts sharing.
enum RequestInvitation {
    case file(DataRequest)
    case collection(CollectionInvitation)

    init(_ text: String) throws {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text) else { throw CollectionError("Enter a valid request link.") }
        if url.scheme == "puls", url.host == "request" {
            self = .file(try DataRequest.parse(text))
        } else {
            self = .collection(try CollectionInvitation(url: url))
        }
    }
}
