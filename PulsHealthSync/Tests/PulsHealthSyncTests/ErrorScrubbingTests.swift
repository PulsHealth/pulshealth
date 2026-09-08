import Foundation
import Testing
@testable import PulsHealthSync

private func makeDir() -> URL {
    FileManager.default.temporaryDirectory
        .appendingPathComponent("puls-tests-\(UUID())", isDirectory: true)
}

// MARK: - Error scrubbing

@Suite struct ErrorScrubberTests {
    @Test func dropsControlCharactersAndCollapsesWhitespace() {
        // Newlines/tabs become single spaces; other control characters vanish.
        let raw = "line one\n\tline \u{0}two\r\n   done\u{7}"
        #expect(ErrorScrubber.scrub(raw, limit: 120) == "line one line two done")
    }

    @Test func redactsBearerTokensQueriesAndCredentialPairs() {
        let bearer = ErrorScrubber.scrub("401 Authorization: Bearer abc.DEF-123 rejected", limit: 120)
        #expect(bearer == "401 Authorization: Bearer [redacted] rejected")
        #expect(!bearer.contains("abc.DEF"))
        let basic = ErrorScrubber.scrub("Authorization: Basic dXNlcjpwYXNz", limit: 120)
        #expect(basic == "Authorization: Basic [redacted]")

        let query = ErrorScrubber.scrub(
            "could not connect to https://h.test:8080/v1/batches?token=sekrit&x=1 (timeout)", limit: 120)
        #expect(query == "could not connect to https://h.test:8080/v1/batches?[redacted] (timeout)")

        let pair = ErrorScrubber.scrub("bad request: token=sekrit, api_key: k123", limit: 120)
        #expect(!pair.contains("sekrit") && !pair.contains("k123"))
        #expect(pair == "bad request: token=[redacted], api_key=[redacted]")
    }

    @Test func redactsKnownSecretsVerbatimAndCapsLength() {
        let secret = "s3cr3t-value"
        let s = ErrorScrubber.scrub("body mentions \(secret) twice: \(secret)", limit: 120, secrets: [secret])
        #expect(!s.contains(secret))
        #expect(s == "body mentions [redacted] twice: [redacted]")

        let long = String(repeating: "x", count: 500)
        let capped = ErrorScrubber.scrub(long, limit: 120)
        #expect(capped.count == 120)
        #expect(capped.hasSuffix("…"))
        #expect(ErrorScrubber.scrub("short", limit: 120) == "short")
        #expect(ErrorScrubber.scrub("", limit: 120, secrets: [""]) == "")
    }

    @Test func transportErrorTextIsScrubbedInBothDescriptions() {
        let body = "<html>\n<body>Bearer sekrit-token\n" + String(repeating: "z", count: 400)
        let error = TransportError.serverError(status: 502, body: body)
        let described = error.errorDescription ?? ""
        #expect(described.hasPrefix("Server returned 502: <html> <body>Bearer [redacted] "))
        #expect(!described.contains("sekrit-token"))
        #expect(!described.contains("\n"))
        #expect(described.count <= "Server returned 502: ".count + ErrorScrubber.displayLimit)
        // "\(error)" must not fall back to the enum dump with the raw body.
        #expect("\(error)" == described)
        #expect(String(describing: error) == described)

        // The protocol rejection carries integers only, but it must take the
        // same scrubbed path when interpolated.
        let rejected = TransportError.unsupportedProtocol(supportedVersions: [2, 3])
        #expect("\(rejected)" == rejected.errorDescription)
        #expect("\(rejected)".contains("server protocol 2, 3"))
        #expect(!"\(rejected)".contains("supportedVersions"))
    }

    @Test func persistedLastErrorIsScrubbedAndRedactsTheConfiguredToken() async throws {
        let store = SyncStateStore(directory: makeDir(), tokenStore: InMemoryTokenStore())
        var config = await store.configuration
        config.authToken = "configured-secret"
        await store.setConfiguration(config)

        let body = "denied for configured-secret\n" + String(repeating: "y", count: 300)
        await store.recordError(
            identifier: "type-a", error: TransportError.serverError(status: 401, body: body))
        let text = try #require(await store.state(for: "type-a").lastError)
        #expect(!text.contains("configured-secret"))
        #expect(!text.contains("\n"))
        #expect(text.count <= ErrorScrubber.persistedLimit)
        #expect(text.hasPrefix("Server returned 401: denied for [redacted]"))

        struct Plain: Error {}
        await store.recordAggregateError(configID: UUID(), error: Plain())
        await store.recordActivitySummaryError(error: Plain())
        await store.recordWorkoutEnrichmentError(.routes, error: Plain())
        #expect(await store.activitySummaryState.lastError?.contains("Plain") == true)
        #expect(await store.workoutEnrichmentState(.routes).lastError?.contains("Plain") == true)
    }

    @Test func eventLogScrubsMessagesBeforeKeepingThem() async {
        let log = SyncEventLog(directory: makeDir())
        await log.log(.error, "Upload failed: Authorization: Bearer sekrit at https://h.test/v1?t=1\n<html>")
        let message = await log.recent(limit: 1).first?.message ?? ""
        #expect(message == "Upload failed: Authorization: Bearer [redacted] at https://h.test/v1?[redacted] <html>")
    }
}
