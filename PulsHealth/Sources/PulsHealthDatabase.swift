import AuthenticationServices
import Foundation
import PulsHealthSync

/// The PulsHealth database: the developer's own instance of the stack, which
/// anyone may ask to join (`web/README.md`, "Access requests"). Sync →
/// Database offers it next to a database of your own.
///
/// The app knows exactly one address for it, the viewer's, and this is the
/// only place it is written down. Everything a sync needs — the database URL,
/// a token for this iPhone, the user ID — comes back from the viewer's
/// account page as an ordinary `puls://pair?…` pairing code, so where the
/// database itself lives stays the operator's choice and is never compiled
/// in. That is also why the app recognizes it afterwards by how it was paired
/// (`SyncConfiguration.isSignedInDatabase`), not by its address.
enum PulsHealthDatabase {
    /// The viewer, in accounts mode with access requests on.
    static let viewerURL = URL(string: "https://app.pulshealth.com")!

    /// The account page: Connect this iPhone (which makes this iPhone's
    /// pairing code), the iPhones connected to the account, and Delete my
    /// account. Signed out, it sends the visitor to the sign-in page, which
    /// links to `requestAccessURL`.
    static var accountURL: URL { viewerURL.appending(path: "account") }

    /// The account page's Delete my account section, directly: App Review
    /// asks for a link straight to account deletion (5.1.1(v)). Signed out,
    /// the sign-in page comes first.
    static var deleteAccountURL: URL {
        var components = URLComponents(url: accountURL, resolvingAgainstBaseURL: false)!
        components.fragment = "delete-account"
        return components.url!
    }

    /// Where someone without an account asks for one; the developer approves
    /// it, and the invite to choose a password arrives by email. Opened in
    /// the sign-in sheet, like the account page: App Review expects an
    /// app's registration to happen in the app, not in Safari.
    static var requestAccessURL: URL { viewerURL.appending(path: "signup") }

    /// The privacy policy's section on what the developer holds for the
    /// people who use it.
    static let privacyURL = URL(string: "https://pulshealth.com/privacy#if-you-use-the-developers-viewer")!

    /// The sign-in sheet's callback scheme: the pairing code's own. The
    /// account page's Open in PulsHealth is a `puls://pair?…` link, and while
    /// the sheet is up it hands that link back to the app rather than iOS
    /// opening it.
    static let callbackScheme = PairingPayload.scheme

    /// How a sign-in sheet ended.
    enum SignInOutcome: Equatable {
        /// The account page sent this iPhone's pairing code.
        case paired(PairingPayload)
        /// The person closed the sheet — after signing in, after asking for
        /// access, or with nothing to connect (a household account, whose
        /// iPhones the developer pairs). Their call, so nothing is said.
        case cancelled
        /// Something to tell them, worded for the screen.
        case failed(String)
    }

    /// What the sheet's callback URL means. Only a pairing code is accepted,
    /// and it gets the same checks as one scanned or opened as a link
    /// (`PairingPayload.parse`): an https database URL, a UUID user.
    static func outcome(ofCallback url: URL) -> SignInOutcome {
        switch PairingPayload.parse(url.absoluteString) {
        case .success(let payload):
            return .paired(payload)
        case .failure(.notAPairingCode):
            return .failed("PulsHealth didn’t send a pairing code. Sign in again, tap Connect this iPhone, then Open in PulsHealth.")
        case .failure:
            // The token never appears here: no failure description carries one.
            return .failed("The pairing code from your PulsHealth account can’t be used. Sign in again and tap Connect this iPhone for a new one.")
        }
    }

    /// What an error from the sheet means. Closing it is not an error to the
    /// person who closed it.
    static func outcome(ofError error: Error) -> SignInOutcome {
        if let error = error as? ASWebAuthenticationSessionError {
            switch error.code {
            case .canceledLogin:
                return .cancelled
            case .presentationContextNotProvided, .presentationContextInvalid:
                return .failed("The sign-in sheet couldn’t open. Try again.")
            @unknown default:
                break
            }
        }
        return .failed("Sign-in didn’t finish: \(error.localizedDescription)")
    }
}
