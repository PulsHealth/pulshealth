import Foundation

/// Makes error text safe to keep. Server error bodies, `URLError` descriptions
/// and anything else that ends up in `lastError` or the event log are written
/// to disk and offered through the diagnostics share sheet, so they must never
/// carry the bearer token, a URL query string, or raw control characters —
/// and a persisted `lastError` need not be a whole HTML error page.
public enum ErrorScrubber {
    /// Length cap for the per-type / per-series `lastError` fields.
    public static let persistedLimit = 120
    /// Length cap for an on-screen transport error.
    public static let displayLimit = 200
    /// Length cap for one event-log message.
    public static let eventLimit = 1_000

    // `Bearer <token>` / `Basic <credentials>`, as echoed from an
    // Authorization header. Runs first so the credential pattern below never
    // sees the header name with its value still attached.
    private static let bearerPattern = try! NSRegularExpression(
        pattern: #"(?i)\b(bearer|basic)\s+[^\s,;"'<>]+"#)
    // A URL's query and fragment: everything from the first `?` or `#` after
    // `scheme://` up to whitespace or a quote. Tokens travel in query strings
    // more often than anywhere else in an error string.
    private static let urlQueryPattern = try! NSRegularExpression(
        pattern: #"([a-zA-Z][a-zA-Z0-9+.-]*://[^\s?#"'<>]*)[?#][^\s"'<>]*"#)
    // `token=…`, `api_key: …` and friends outside a URL (form bodies, echoed
    // headers). `authorization` is deliberately absent: its value is the
    // scheme word, which the bearer pattern has already handled.
    private static let credentialPattern = try! NSRegularExpression(
        pattern: #"(?i)\b(token|secret|password|api[_-]?key)\s*[=:]\s*[^\s&,;"'<>]+"#)

    /// Redact credentials and URL queries, drop control characters, collapse
    /// whitespace, and cap the length (an ellipsis marks a cut). `secrets` are
    /// redacted verbatim wherever they appear — pass the configured token.
    public static func scrub(_ text: String, limit: Int, secrets: [String] = []) -> String {
        var s = text
        for secret in secrets where !secret.isEmpty {
            s = s.replacingOccurrences(of: secret, with: "[redacted]")
        }
        s = replace(bearerPattern, in: s, with: "$1 [redacted]")
        s = replace(urlQueryPattern, in: s, with: "$1?[redacted]")
        s = replace(credentialPattern, in: s, with: "$1=[redacted]")

        var cleaned = ""
        cleaned.reserveCapacity(s.count)
        var pendingSpace = false
        for scalar in s.unicodeScalars {
            let isSpace = scalar == " " || scalar == "\n" || scalar == "\r" || scalar == "\t"
            if isSpace {
                pendingSpace = !cleaned.isEmpty
                continue
            }
            if CharacterSet.controlCharacters.contains(scalar) { continue }
            if pendingSpace {
                cleaned.append(" ")
                pendingSpace = false
            }
            cleaned.unicodeScalars.append(scalar)
        }

        guard cleaned.count > limit else { return cleaned }
        return String(cleaned.prefix(max(0, limit - 1))) + "…"
    }

    /// The text to keep for an error: its localized description when it has
    /// one, else its debug description, scrubbed and capped for persistence.
    public static func describe(
        _ error: Error, limit: Int = persistedLimit, secrets: [String] = []
    ) -> String {
        let raw = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        return scrub(raw, limit: limit, secrets: secrets)
    }

    private static func replace(_ regex: NSRegularExpression, in text: String, with template: String) -> String {
        regex.stringByReplacingMatches(
            in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }
}
