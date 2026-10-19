import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct ServerErrorSummaryTests {
    @Test func proxyHTMLKeepsItsTitleBeyondTheOldBodyPrefix() {
        let html = "<!DOCTYPE html><!--" + String(repeating: "proxy boilerplate ", count: 100)
            + "--><html><head><title>Worker exceeded resource limits</title></head>"
            + "<body>Request diagnostics that should not be logged</body></html>"
        let error = TransportError.fromResponse(status: 503, body: Data(html.utf8))
        let description = error.errorDescription ?? ""
        #expect(description.contains("Worker exceeded resource limits"))
        #expect(!description.contains("<!DOCTYPE"))
        #expect(!description.contains("Request diagnostics"))
        #expect(error.isRetryable)
        #expect(!error.startsCooldown)
    }

    @Test func directHTMLServerErrorsAreReadableAndScrubbed() {
        let html = "<html><head><title>Unavailable: Bearer synthetic-token</title></head>"
            + "<body>Private request details</body></html>"
        let error = TransportError.serverError(status: 502, body: html)
        let description = error.errorDescription ?? ""
        #expect(description.contains("Unavailable: Bearer [redacted]"))
        #expect(!description.contains("synthetic-token"))
        #expect(!description.contains("<html>"))
        #expect(!description.contains("Private request"))
        #expect(String(describing: error) == description)
    }

    @Test func htmlEntitiesAreDecodedBeforeCredentialScrubbing() {
        let html = "<HTML><HEAD><TITLE>Unavailable &amp; retry &#x1F6A7;: "
            + "Bear&#101;r&#32;synthetic-token token&#61;other-secret "
            + "https://receiver.example/path&#63;key=private-value</TITLE></HEAD></HTML>"
        let description = TransportError.fromResponse(status: 503, body: Data(html.utf8)).errorDescription ?? ""
        #expect(description.contains("Unavailable & retry 🚧: Bearer [redacted] token=[redacted]"))
        #expect(description.contains("https://receiver.example/path?[redacted]"))
        #expect(!description.contains("synthetic-token"))
        #expect(!description.contains("other-secret"))
        #expect(!description.contains("private-value"))
    }

    @Test func commentsScriptsStylesAndTagsAreNotLogged() {
        let html = "<!-- <title>Comment diagnostics</title> --><html><head>"
            + "<script>const title = '<title>Script diagnostics</title>';</script>"
            + "<style><title>Style diagnostics</title></style>"
            + "<title><b>Service</b><!-- hidden --> unavailable"
            + "<script>privateScript()</script> &lt;i&gt;retry&lt;/i&gt;</title>"
            + "</head><body>Private request diagnostics</body></html>"
        let description = TransportError.serverError(status: 502, body: html).errorDescription ?? ""
        #expect(description == "Server returned 502: Service unavailable retry")
    }

    @Test func aLeadingCommentBeyondTheScanLimitUsesTheHTMLFallback() {
        let html = " \n<!-- Private comment diagnostics "
            + String(repeating: "x", count: ServerErrorSummary.htmlScanLimit)
            + "--><html><title>Outside the scan</title></html>"
        let error = TransportError.fromResponse(status: 503, body: Data(html.utf8))
        #expect(error.errorDescription == "Server returned 503: HTML error page (no readable title)")
    }

    @Test func decodedControlsAreNormalizedBeforeCredentialRedaction() {
        let html = "<html><title>Bear&#0;er synthetic-token "
            + "pass&#7;word=synthetic-password https://receiver.example/path&#0;?private-value "
            + "Basic&#9;synthetic-basic</title></html>"
        let description = TransportError.serverError(status: 503, body: html).errorDescription ?? ""
        #expect(description.contains("Bearer [redacted] password=[redacted]"))
        #expect(description.contains("https://receiver.example/path?[redacted] Basic [redacted]"))
        #expect(!description.contains("synthetic-token"))
        #expect(!description.contains("synthetic-password"))
        #expect(!description.contains("synthetic-basic"))
        #expect(!description.contains("private-value"))
    }

    @Test(arguments: [
        "<!doctype html><html><body>Private request diagnostics</body></html>",
        "<html><head><title>Incomplete private title",
        "<html><title> \n\t </title><body>Private details</body></html>",
    ])
    func missingIncompleteAndEmptyTitlesUseExplicitFallback(_ html: String) {
        let error = TransportError.fromResponse(status: 503, body: Data(html.utf8))
        #expect(error.errorDescription == "Server returned 503: HTML error page (no readable title)")
    }

    @Test func titleSearchIsBoundedAndDisplayedTextIsCapped() {
        let html = "<html><head><!--" + String(repeating: "x", count: ServerErrorSummary.htmlScanLimit)
            + "--><title>Outside the bounded excerpt</title></head></html>"
        let error = TransportError.fromResponse(status: 503, body: Data(html.utf8))
        #expect(error.errorDescription == "Server returned 503: HTML error page (no readable title)")
        guard case .serverError(_, let excerpt) = error else {
            Issue.record("Expected a server error")
            return
        }
        #expect(excerpt.utf8.count == ServerErrorSummary.htmlScanLimit)

        let longTitle = "<html><title>" + String(repeating: "Long title ", count: 100) + "</title></html>"
        let description = TransportError.serverError(status: 502, body: longTitle).errorDescription ?? ""
        #expect(description.count == "Server returned 502: ".count + ErrorScrubber.displayLimit)
        #expect(description.hasSuffix("…"))
    }

    @Test(arguments: ["token=synthetic-secret rejected", #"{"error":"overloaded","retry":true}"#])
    func plainAndJSONResponsesKeepTheirExistingExcerpts(_ body: String) {
        let longBody = body + String(repeating: "x", count: 600)
        let error = TransportError.fromResponse(status: 503, body: Data(longBody.utf8))
        guard case .serverError(_, let excerpt) = error else {
            Issue.record("Expected a server error")
            return
        }
        #expect(excerpt == String(longBody.prefix(512)))
        #expect(error.errorDescription == "Server returned 503: \(ErrorScrubber.scrub(excerpt, limit: ErrorScrubber.displayLimit))")
    }

    @Test func HTMLPresentationDoesNotChangeResponseClassification() {
        let html = Data("<html><title>Unavailable</title></html>".utf8)
        #expect(TransportError.fromResponse(status: 503, body: html).isRetryable)
        #expect(!TransportError.fromResponse(status: 503, body: html).startsCooldown)
        #expect(!TransportError.fromResponse(status: 401, body: html).isRetryable)
        #expect(TransportError.fromResponse(status: 401, body: html).startsCooldown)
        #expect(TransportError.fromResponse(status: 429, body: html).isRetryable)
        #expect(!TransportError.fromResponse(status: 429, body: html).startsCooldown)
        let rejection = Data(#"{"error":"unsupported protocol version","supportedVersions":[2]}"#.utf8)
        guard case .unsupportedProtocol(let versions) = TransportError.fromResponse(status: 400, body: rejection) else {
            Issue.record("Expected the existing protocol rejection classification")
            return
        }
        #expect(versions == [2])
    }
}
