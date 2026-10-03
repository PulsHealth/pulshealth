import AuthenticationServices
import Foundation
import XCTest
import PulsHealthSync
@testable import PulsHealth

/// The PulsHealth database option's fixed facts and its sign-in sheet's
/// callback handling (`PulsHealthDatabase`). Hosted in the app so the
/// callback scheme can be checked against the Info.plist the app ships.
final class PulsHealthDatabaseTests: XCTestCase {
    private let user = "5ea4d000-0000-4000-8000-0000000000aa"

    /// The one developer-controlled address in the binary, and the pages
    /// derived from it.
    func testAddressesDeriveFromTheViewer() {
        XCTAssertEqual(PulsHealthDatabase.viewerURL.absoluteString, "https://app.pulshealth.com")
        XCTAssertEqual(PulsHealthDatabase.accountURL.absoluteString, "https://app.pulshealth.com/account")
        XCTAssertEqual(PulsHealthDatabase.requestAccessURL.absoluteString, "https://app.pulshealth.com/signup")
        // Straight to the account page's Delete my account section
        // (web/app/account/page.tsx, id="delete-account").
        XCTAssertEqual(PulsHealthDatabase.deleteAccountURL.absoluteString, "https://app.pulshealth.com/account#delete-account")
        // The privacy policy's section on the developer's viewer, as the site
        // slugs its heading.
        XCTAssertEqual(PulsHealthDatabase.privacyURL.host(), "pulshealth.com")
        XCTAssertEqual(PulsHealthDatabase.privacyURL.fragment(), "if-you-use-the-developers-viewer")
    }

    /// The sheet returns the account page's Open in PulsHealth link, a
    /// pairing code, so its callback is the pairing scheme — the one the app
    /// registers.
    func testTheCallbackIsThePairingSchemeTheAppRegisters() throws {
        XCTAssertEqual(PulsHealthDatabase.callbackScheme, "puls")
        XCTAssertEqual(PulsHealthDatabase.callbackScheme, PairingPayload.scheme)
        let types = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]])
        let schemes = types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        XCTAssertTrue(schemes.contains(PulsHealthDatabase.callbackScheme))
    }

    func testAPairingCodeIsTheOnlyCallbackThatPairs() throws {
        let link = "puls://pair?url=https%3A%2F%2Fingest.example.test&token=s3cr3t&user=\(user)"
        XCTAssertEqual(
            PulsHealthDatabase.outcome(ofCallback: try XCTUnwrap(URL(string: link))),
            .paired(PairingPayload(
                serverURL: try XCTUnwrap(URL(string: "https://ingest.example.test")),
                token: "s3cr3t", userID: user)))

        // Not a pairing code at all.
        guard case .failed = PulsHealthDatabase.outcome(ofCallback: try XCTUnwrap(URL(string: "puls://somewhere?x=1"))) else {
            return XCTFail("a puls:// URL that is not a pairing code must not pair")
        }
    }

    /// A pairing code the app would refuse from a scan is refused from the
    /// sheet too, and the message never carries the token.
    func testAnUnusableCodeIsRefusedWithoutEchoingTheToken() throws {
        let cases = [
            // Plain http to a public host.
            "puls://pair?url=http%3A%2F%2Fingest.example.com&token=s3cr3t&user=\(user)",
            "puls://pair?url=https%3A%2F%2Fingest.example.test&token=s3cr3t&user=not-a-uuid",
            "puls://pair?url=https%3A%2F%2Fingest.example.test&user=\(user)",
        ]
        for link in cases {
            switch PulsHealthDatabase.outcome(ofCallback: try XCTUnwrap(URL(string: link))) {
            case .failed(let message):
                XCTAssertFalse(message.contains("s3cr3t"), link)
            default:
                XCTFail("\(link) must not pair")
            }
        }
    }

    /// Closing the sheet is the person's answer, not an error to show.
    func testClosingTheSheetIsQuietAndOtherFailuresAreSaid() {
        XCTAssertEqual(
            PulsHealthDatabase.outcome(ofError: ASWebAuthenticationSessionError(.canceledLogin)),
            .cancelled)
        for code in [ASWebAuthenticationSessionError.Code.presentationContextInvalid, .presentationContextNotProvided] {
            guard case .failed = PulsHealthDatabase.outcome(ofError: ASWebAuthenticationSessionError(code)) else {
                return XCTFail("\(code) must be reported")
            }
        }
        guard case .failed = PulsHealthDatabase.outcome(ofError: URLError(.notConnectedToInternet)) else {
            return XCTFail("any other error must be reported")
        }
    }
}
