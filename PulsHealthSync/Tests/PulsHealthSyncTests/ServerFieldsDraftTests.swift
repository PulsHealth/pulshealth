import Foundation
import Testing
@testable import PulsHealthSync

/// The server fields as typed, shared by Settings → Server and the first-run
/// flow — and the one way a pairing code lands in them.
@Suite struct ServerFieldsDraftTests {
    private let user = "5ea4d000-0000-4000-8000-000000000001"

    private func pairing(_ url: String = "https://puls.example.test:8443") -> PairingPayload {
        PairingPayload(serverURL: URL(string: url)!, token: "s3cr3t", userID: user)
    }

    @Test func startsFromTheConfiguration() {
        var config = SyncConfiguration()
        config.serverURL = URL(string: "https://puls.example.test")
        config.authToken = "tok"
        let draft = ServerFieldsDraft(configuration: config)
        #expect(draft.urlText == "https://puls.example.test")
        #expect(draft.tokenText == "tok")
        #expect(draft.pairedUserID == nil)
        #expect(draft.isTestable)
    }

    @Test func anEmptyURLIsAllowedAndAnUnusableOneIsExplained() {
        var draft = ServerFieldsDraft()
        #expect(draft.urlValidation == nil)
        #expect(draft.urlIssue == nil)
        #expect(!draft.isTestable)

        draft.urlText = "puls.example.test:8080"
        #expect(draft.validatedURL == nil)
        #expect(draft.urlIssue == ServerURLValidation.Failure.missingScheme.errorDescription)

        draft.urlText = " https://puls.example.test/ "
        #expect(draft.validatedURL == URL(string: "https://puls.example.test"))
        #expect(draft.urlIssue == nil)
    }

    @Test func acceptsAPastedEnvLineAsTheToken() {
        var draft = ServerFieldsDraft(urlText: "https://puls.example.test")
        draft.tokenText = "  PULS_TOKEN=abc=def\n"
        #expect(draft.token == "abc=def")
        draft.tokenText = " bare "
        #expect(draft.token == "bare")
        draft.tokenText = "   "
        #expect(draft.token.isEmpty)
        #expect(!draft.isTestable)
    }

    /// People paste the whole pairing string into the first field they see.
    @Test func aPairingCodeInTheURLFieldIsRecognized() {
        var draft = ServerFieldsDraft()
        draft.urlText = "puls://pair?url=https%3A%2F%2Fpuls.example.test%3A8443&token=s3cr3t&user=\(user)"
        #expect(draft.pairingCodeInURLField == pairing())
        #expect(draft.urlIssue == nil, "not a URL validation error")

        draft.urlText = "https://puls.example.test"
        #expect(draft.pairingCodeInURLField == nil)
    }

    /// A pairing code that does not parse is reported as one, not as
    /// "Unsupported scheme puls://".
    @Test func aBrokenPairingCodeInTheURLFieldIsExplainedAsOne() {
        var draft = ServerFieldsDraft()
        draft.urlText = "puls://pair?url=https%3A%2F%2Fpuls.example.test&user=\(user)"
        #expect(draft.pairingCodeInURLField == nil)
        #expect(draft.urlIssue == PairingPayload.Failure.missingField("token").errorDescription)
        #expect(draft.validatedURL == nil)
    }

    @Test func fillReplacesAllThreeValues() {
        var draft = ServerFieldsDraft(urlText: "https://old.example.test", tokenText: "old")
        draft.fill(from: pairing())
        #expect(draft.urlText == "https://puls.example.test:8443")
        #expect(draft.tokenText == "s3cr3t")
        #expect(draft.pairedUserID == user)
        #expect(draft.connectionTestUserID(fallback: "someone-else") == user)
        #expect(ServerFieldsDraft().connectionTestUserID(fallback: "someone-else") == "someone-else")
    }

    /// Filling is not committing: the configuration — user ID included — is
    /// untouched until the screen says so.
    @Test func nothingReachesTheConfigurationBeforeCommit() {
        var config = SyncConfiguration(enabledTypes: ["HKQuantityTypeIdentifierStepCount"])
        let before = config
        var draft = ServerFieldsDraft(configuration: config)
        draft.fill(from: pairing())
        #expect(config == before)

        draft.commit(to: &config)
        #expect(config.serverURL == URL(string: "https://puls.example.test:8443"))
        #expect(config.authToken == "s3cr3t")
        #expect(config.userID == user)
        #expect(config.enabledTypes == before.enabledTypes)
        #expect(config.startDate == before.startDate)
    }

    @Test func handTypedFieldsLeaveTheUserIDAlone() {
        var config = SyncConfiguration()
        config.userID = user
        var draft = ServerFieldsDraft(urlText: "https://puls.example.test", tokenText: "tok")
        draft.commit(to: &config)
        #expect(config.userID == user)

        // Emptied fields un-configure the server.
        draft.urlText = ""
        draft.tokenText = ""
        draft.commit(to: &config)
        #expect(config.serverURL == nil)
        #expect(config.authToken == nil)
        #expect(config.userID == user)
    }

    /// Once applied, the paired ID must not come back to overwrite a later
    /// edit made on the User page.
    @Test func aCommittedPairingStopsCarryingItsUserID() {
        var config = SyncConfiguration()
        var draft = ServerFieldsDraft()
        draft.fill(from: pairing())
        draft.commit(to: &config)
        draft.markCommitted()
        #expect(draft.pairedUserID == nil)

        config.userID = "5ea4d000-0000-4000-8000-000000000009"
        draft.commit(to: &config)
        #expect(config.userID == "5ea4d000-0000-4000-8000-000000000009")
    }

    // MARK: - A database paired by signing in

    /// The PulsHealth database option: the code an account sign-in hands back
    /// fills the fields like any other, and committing it records where it
    /// came from — the app cannot tell that database by its address.
    @Test func aSignInPairingIsRecordedOnCommit() {
        var config = SyncConfiguration()
        var draft = ServerFieldsDraft()
        draft.fill(fromSignIn: pairing())
        #expect(draft.isSignedIn)
        #expect(draft.pairedUserID == user)
        #expect(draft.tokenText == "s3cr3t")

        draft.commit(to: &config)
        #expect(config.serverURL == URL(string: "https://puls.example.test:8443"))
        #expect(config.signedInDatabaseURL == config.serverURL)
        #expect(config.isSignedInDatabase)

        // Loaded back onto the screen and saved unchanged, it stays one.
        let reloaded = ServerFieldsDraft(configuration: config)
        #expect(reloaded.isSignedIn)
        reloaded.commit(to: &config)
        #expect(config.isSignedInDatabase)
    }

    /// Any other way the fields change ends it: a URL typed over it, a code
    /// that was scanned, pasted or linked (even one naming the same address),
    /// or emptied fields — the way the app disconnects a database.
    @Test func anyOtherPairingEndsTheSignIn() {
        func signedInConfiguration() -> SyncConfiguration {
            var config = SyncConfiguration()
            var draft = ServerFieldsDraft()
            draft.fill(fromSignIn: pairing())
            draft.commit(to: &config)
            return config
        }

        var typedOver = signedInConfiguration()
        var typed = ServerFieldsDraft(configuration: typedOver)
        typed.urlText = "https://mine.example.test"
        #expect(!typed.isSignedIn)
        typed.commit(to: &typedOver)
        #expect(typedOver.signedInDatabaseURL == nil)
        #expect(!typedOver.isSignedInDatabase)

        var scannedOver = signedInConfiguration()
        var scanned = ServerFieldsDraft(configuration: scannedOver)
        scanned.fill(from: pairing())
        #expect(!scanned.isSignedIn)
        scanned.commit(to: &scannedOver)
        #expect(!scannedOver.isSignedInDatabase)

        var disconnected = signedInConfiguration()
        ServerFieldsDraft().commit(to: &disconnected)
        #expect(disconnected.serverURL == nil)
        #expect(disconnected.authToken == nil)
        #expect(disconnected.signedInDatabaseURL == nil)
        #expect(!disconnected.isSignedInDatabase)
    }

    /// The marker only counts while the configured URL is the one it names,
    /// so a path that sets the URL without knowing about it cannot leave a
    /// different database labelled as the signed-in one.
    @Test func theMarkerOnlyCountsForItsOwnURL() {
        var config = SyncConfiguration()
        var draft = ServerFieldsDraft()
        draft.fill(fromSignIn: pairing())
        draft.commit(to: &config)

        var moved = config
        moved.serverURL = URL(string: "https://other.example.test")
        #expect(moved.signedInDatabaseURL != nil)
        #expect(!moved.isSignedInDatabase)
        #expect(!ServerFieldsDraft(configuration: moved).isSignedIn)

        // A pairing code applied directly is not a sign-in, even for the
        // same address, and clears the marker outright.
        pairing().apply(to: &config)
        #expect(config.signedInDatabaseURL == nil)
        #expect(!config.isSignedInDatabase)

        #expect(!SyncConfiguration(signedInDatabaseURL: URL(string: "https://puls.example.test")).isSignedInDatabase,
                "no database configured at all")
    }
}
