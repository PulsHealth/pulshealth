import Foundation

/// One knowledge-base article, decoded from the bundled `knowledge.json`
/// (rendered by `scripts/gen-knowledge-json.py` from `knowledge-base/`).
///
/// Only the fields the type page shows are modelled; every one of them is
/// optional because the generator writes `null` for anything a YAML file
/// leaves out, and a missing article must never take the page down with it.
/// `clinicalRanges` rows are free-form per population, so they decode into a
/// loose value rather than a fixed struct.
struct TypeKnowledge: Decodable, Sendable {
    struct TypicalRange: Decodable, Sendable {
        var min: Double?
        var max: Double?
        var unit: String?
        var notes: String?
    }

    struct CategoryValue: Decodable, Sendable {
        var value: Int?
        var name: String?
        var description: String?
    }

    struct Device: Decodable, Sendable {
        var name: String?
        var capability: String?
    }

    struct MetadataKey: Decodable, Sendable {
        var key: String?
        var description: String?
    }

    struct RelatedType: Decodable, Sendable {
        var identifier: String?
        var relationship: String?
    }

    struct Reference: Decodable, Sendable {
        var title: String?
        var url: String?
        var type: String?
    }

    var identifier: String?
    var humanReadableName: String?
    var shortDescription: String?
    var description: String?
    var defaultUnit: String?
    var unitDescription: String?
    var typicalRange: TypicalRange?
    var clinicalRanges: [[String: LooseValue]]?
    var categoryValues: [CategoryValue]?
    var devices: [Device]?
    var primarySource: String?
    var metadataKeys: [MetadataKey]?
    var relatedTypes: [RelatedType]?
    var references: [Reference]?

    enum CodingKeys: String, CodingKey {
        case identifier
        case humanReadableName = "human_readable_name"
        case shortDescription = "short_description"
        case description
        case defaultUnit = "default_unit"
        case unitDescription = "unit_description"
        case typicalRange = "typical_range"
        case clinicalRanges = "clinical_ranges"
        case categoryValues = "category_values"
        case devices
        case primarySource = "primary_source"
        case metadataKeys = "metadata_keys"
        case relatedTypes = "related_types"
        case references
    }

    /// The label the knowledge base gives a category type's raw value, when
    /// the article lists its values.
    func categoryLabel(for rawValue: Int) -> String? {
        categoryValues?.first { $0.value == rawValue }?.name
    }

    /// Clinical range rows as (population, [(label, value)]) for a plain list.
    /// Keys other than `population` are the columns; their order is the
    /// alphabetical one the generator wrote.
    var clinicalRangeRows: [(population: String, entries: [(String, String)])] {
        (clinicalRanges ?? []).compactMap { row in
            let population = row["population"]?.text ?? "General"
            let entries = row.keys.sorted()
                .filter { $0 != "population" }
                .compactMap { key -> (String, String)? in
                    guard let text = row[key]?.text, !text.isEmpty else { return nil }
                    return (key.replacingOccurrences(of: "_", with: " ").capitalized, text)
                }
            return entries.isEmpty ? nil : (population, entries)
        }
    }

    // MARK: - Lookup

    /// The article for a catalog identifier, or nil when the knowledge base
    /// has none.
    static func article(for identifier: String) -> TypeKnowledge? {
        articles[identifier]
    }

    /// Kick off the one-time decode away from the main actor so the first
    /// type page does not pay for it.
    static func preload() {
        Task.detached(priority: .utility) { _ = articles }
    }

    /// Decoded once; ~1 MB of JSON, so the first access is the slow one and
    /// `preload` moves it off the screen's path.
    private static let articles: [String: TypeKnowledge] = {
        guard let url = Bundle.main.url(forResource: "knowledge", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([String: TypeKnowledge].self, from: data)
        else { return [:] }
        return decoded
    }()
}

/// Any JSON value, for the free-form rows the knowledge base keeps as
/// written. `text` flattens it for display.
enum LooseValue: Decodable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([LooseValue])
    case object([String: LooseValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([LooseValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: LooseValue].self))
        }
    }

    var text: String? {
        switch self {
        case .string(let value): value
        case .number(let value):
            value == value.rounded() ? String(Int(value)) : String(value)
        case .bool(let value): value ? "yes" : "no"
        case .null: nil
        case .array(let values): values.compactMap(\.text).joined(separator: ", ")
        case .object(let values):
            values.keys.sorted().compactMap { key in
                values[key]?.text.map { "\(key): \($0)" }
            }.joined(separator: "; ")
        }
    }
}
