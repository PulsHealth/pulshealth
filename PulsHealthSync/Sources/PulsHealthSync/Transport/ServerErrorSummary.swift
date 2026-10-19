import Foundation

/// Reads a small, non-executing excerpt of a proxy's HTML error page. Keep only
/// its title: a page's body can contain request headers and other diagnostics.
/// Credential scrubbing and the display/persistence caps still run afterwards.
enum ServerErrorSummary {
    static let htmlScanLimit = 16 * 1_024
    private static let plainBodyLimit = 512
    private static let fallback = "HTML error page (no readable title)"

    private static let comments = try! NSRegularExpression(pattern: #"(?s)<!--.*?(?:-->|$)"#)
    private static let nonText = try! NSRegularExpression(
        pattern: #"(?is)<(script|style)\b[^>]*>.*?(?:</\1\s*>|$)"#)
    private static let htmlStart = try! NSRegularExpression(
        pattern: #"(?is)^\s*\x{FEFF}?\s*(?:<!--|<!doctype\s+html\b|<(?:html|head|body|title)(?:\s|>))"#)
    private static let title = try! NSRegularExpression(pattern: #"(?is)<title\b[^>]*>(.*?)</title\s*>"#)
    private static let tags = try! NSRegularExpression(pattern: #"(?s)<[^>]*>"#)
    private static let entities = try! NSRegularExpression(
        pattern: #"&(?:#([0-9]{1,8})|#[xX]([0-9a-fA-F]{1,8})|(amp|lt|gt|quot|apos|nbsp));"#)

    /// Look past a proxy's boilerplate for HTML only. Plain text and JSON keep
    /// the existing 512-byte response excerpt, including its UTF-8 behavior.
    static func responseExcerpt(_ data: Data) -> String {
        let excerpt = String(decoding: data.prefix(htmlScanLimit), as: UTF8.self)
        return isHTML(excerpt) ? excerpt : String(data: data.prefix(plainBodyLimit), encoding: .utf8) ?? ""
    }

    static func summarize(_ body: String) -> String {
        let excerpt = String(decoding: body.utf8.prefix(htmlScanLimit), as: UTF8.self)
        guard isHTML(excerpt) else { return body }
        let cleaned = removeNonText(excerpt)
        guard let match = title.firstMatch(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)),
              let range = Range(match.range(at: 1), in: cleaned)
        else { return fallback }
        // Decode before the caller's scrubber so encoded credential schemes,
        // separators and URL query markers receive the same redaction.
        let decoded = decodeEntities(replace(tags, in: String(cleaned[range])))
        let text = replace(tags, in: removeNonText(decoded))
        // Drop embedded controls before redaction: otherwise `Bear&#0;er`
        // becomes a visible credential scheme only after the scrubber runs.
        // Whitespace controls stay as separators for its credential patterns.
        let normalized = String(String.UnicodeScalarView(text.unicodeScalars.filter {
            !CharacterSet.controlCharacters.contains($0) || CharacterSet.whitespacesAndNewlines.contains($0)
        }))
        guard !ErrorScrubber.scrub(normalized, limit: ErrorScrubber.displayLimit).isEmpty else { return fallback }
        return normalized
    }

    private static func isHTML(_ text: String) -> Bool {
        // A truncated leading HTML comment is still markup, not a useful
        // plain-text error. Do not retain its potentially private contents.
        if htmlStart.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil { return true }
        let cleaned = removeNonText(text)
        return htmlStart.firstMatch(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)) != nil
    }

    private static func removeNonText(_ text: String) -> String {
        replace(nonText, in: replace(comments, in: text))
    }

    private static func replace(_ pattern: NSRegularExpression, in text: String) -> String {
        pattern.stringByReplacingMatches(
            in: text, range: NSRange(text.startIndex..., in: text), withTemplate: " ")
    }

    private static func decodeEntities(_ text: String) -> String {
        var decoded = text
        // Work backwards to keep the ranges valid while replacing matches.
        for match in entities.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let range = Range(match.range, in: decoded) else { continue }
            let replacement: String?
            if let digits = Range(match.range(at: 1), in: text) {
                replacement = UInt32(text[digits]).flatMap(UnicodeScalar.init).map(String.init)
            } else if let digits = Range(match.range(at: 2), in: text) {
                replacement = UInt32(text[digits], radix: 16).flatMap(UnicodeScalar.init).map(String.init)
            } else if let name = Range(match.range(at: 3), in: text) {
                replacement = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " "][String(text[name])]
            } else {
                replacement = nil
            }
            if let replacement { decoded.replaceSubrange(range, with: replacement) }
        }
        return decoded
    }
}
