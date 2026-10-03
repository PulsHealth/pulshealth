import Foundation
import XCTest
import PulsHealthSync
@testable import PulsHealth

/// Sync → Database's decisions (`DatabaseSetup`): what the screen starts
/// from, what Save & Apply commits, and when a sign-in's code is done.
final class DatabaseSetupTests: XCTestCase {
    private let user = "5ea4d000-0000-4000-8000-0000000000aa"
    private let mine = URL(string: "https://mine.example.test")!
    /// Under the viewer's domain (`PulsHealthDatabase.domain`), as a
    /// sign-in's database must be to count as the PulsHealth database.
    private let hosted = URL(string: "https://ingest.example.pulshealth.com:8443")!

    private func ownConfiguration() -> SyncConfiguration {
        SyncConfiguration(serverURL: mine, authToken: "own-token")
    }

    private func signInPayload(token: String = "hosted-token") -> PairingPayload {
        PairingPayload(serverURL: hosted, token: token, userID: user)
    }

    /// The configuration Save & Apply of a sign-in leaves applied.
    private func hostedConfiguration() -> SyncConfiguration {
        var setup = DatabaseSetup(applied: SyncConfiguration())
        setup.receiveSignIn(signInPayload())
        var config = SyncConfiguration()
        XCTAssertTrue(setup.commit(to: &config))
        return config
    }

    func testStartsFromWhatIsApplied() {
        let none = DatabaseSetup(applied: SyncConfiguration())
        XCTAssertNil(none.destination, "no database: the screen asks")
        XCTAssertEqual(DatabaseSetup(applied: SyncConfiguration(), scanOnArrival: true).destination, .own)

        let own = DatabaseSetup(applied: ownConfiguration())
        XCTAssertEqual(own.destination, .own)
        XCTAssertEqual(own.own.urlText, mine.absoluteString)
        XCTAssertEqual(own.own.tokenText, "own-token")

        let pulsHealth = DatabaseSetup(applied: hostedConfiguration())
        XCTAssertEqual(pulsHealth.destination, .pulsHealth)
        XCTAssertEqual(pulsHealth.own, ServerFieldsDraft(), "your own fields never start with the hosted token")
        XCTAssertNil(pulsHealth.signedIn)
    }

    /// Your own database is applied; Save & Apply on the PulsHealth path
    /// raises the server-change prompt, which is cancelled, so the staged
    /// draft now holds the PulsHealth values. Coming back must show the
    /// database that is still syncing, and saving must keep it — not commit
    /// empty fields and disconnect it.
    func testACancelledServerChangeDoesNotHideTheAppliedDatabase() throws {
        let applied = ownConfiguration()
        var draft = applied
        var first = DatabaseSetup(applied: applied)
        first.choose(.pulsHealth)
        first.receiveSignIn(signInPayload())
        XCTAssertTrue(first.commit(to: &draft))
        XCTAssertEqual(draft.serverURL, hosted, "staged, then the prompt is cancelled")

        var again = DatabaseSetup(applied: applied)
        XCTAssertEqual(again.destination, .own)
        XCTAssertEqual(again.own.urlText, mine.absoluteString)
        XCTAssertTrue(again.commit(to: &draft))
        XCTAssertEqual(draft.serverURL, mine)
        XCTAssertEqual(draft.authToken, "own-token")
        XCTAssertFalse(draft.isSignedInDatabase)
    }

    /// Once the sign-in's code is applied — by this screen, or by the
    /// server-change prompt it raised — the screen stops asking for Save &
    /// Apply. Not before.
    func testASignInIsDoneOnceItIsApplied() {
        var setup = DatabaseSetup(applied: ownConfiguration())
        setup.receiveSignIn(signInPayload())
        var draft = ownConfiguration()
        XCTAssertTrue(setup.commit(to: &draft))

        // The prompt is still up, or was cancelled: what is applied is unchanged.
        setup.settle(applied: ownConfiguration())
        XCTAssertNotNil(setup.signedIn)

        // Another code for the same database (a new token) is not this one.
        var otherToken = SyncConfiguration()
        var other = DatabaseSetup(applied: SyncConfiguration())
        other.receiveSignIn(signInPayload(token: "another-token"))
        XCTAssertTrue(other.commit(to: &otherToken))
        setup.settle(applied: otherToken)
        XCTAssertNotNil(setup.signedIn)

        // Applied.
        setup.settle(applied: draft)
        XCTAssertNil(setup.signedIn)
        XCTAssertEqual(setup.destination, .pulsHealth)
    }

    func testSaveAndApplyCommitsOnlyTheChosenFields() {
        let before = ownConfiguration()
        var config = before
        var nothingChosen = DatabaseSetup(applied: SyncConfiguration())
        XCTAssertFalse(nothingChosen.commit(to: &config))
        nothingChosen.choose(.pulsHealth)
        XCTAssertFalse(nothingChosen.commit(to: &config), "no sign-in yet")
        XCTAssertEqual(config, before, "nothing written")

        var setup = DatabaseSetup(applied: before)
        setup.receiveSignIn(signInPayload())
        XCTAssertTrue(setup.commit(to: &config))
        XCTAssertEqual(config.serverURL, hosted)
        XCTAssertEqual(config.userID, user)
        XCTAssertTrue(config.isSignedInDatabase)
    }

    /// Only the sign-in sheet can say a code came from a PulsHealth account:
    /// a scanned, pasted or linked one is your own database's, even when it
    /// names the same address.
    func testAPairingCodeIsAlwaysYourOwnDatabase() {
        var setup = DatabaseSetup(applied: hostedConfiguration())
        setup.receivePairing(signInPayload())
        XCTAssertEqual(setup.destination, .own)
        var config = hostedConfiguration()
        XCTAssertTrue(setup.commit(to: &config))
        XCTAssertEqual(config.serverURL, hosted)
        XCTAssertFalse(config.isSignedInDatabase)
    }

    /// The returned code's database is shown with it.
    func testTheSignedInDatabaseIsNamed() {
        var setup = DatabaseSetup(applied: SyncConfiguration())
        XCTAssertNil(setup.signedInDatabaseLabel)
        setup.receiveSignIn(signInPayload())
        XCTAssertEqual(setup.signedInDatabaseLabel, "ingest.example.pulshealth.com:8443")
    }

    /// The sheet is a browser: a code it hands back for a database outside
    /// the viewer's domain is an ordinary pairing code for your own
    /// database — filled in, applicable, never the PulsHealth database.
    func testASignInCodeForAnotherDomainIsYourOwnDatabase() {
        let elsewhere = PairingPayload(
            serverURL: URL(string: "https://ingest.attacker.example")!, token: "other-token", userID: user)
        var setup = DatabaseSetup(applied: SyncConfiguration())
        XCTAssertFalse(setup.receiveSignIn(elsewhere))
        XCTAssertEqual(setup.destination, .own)
        XCTAssertNil(setup.signedIn)
        XCTAssertEqual(setup.own.urlText, "https://ingest.attacker.example")
        var config = SyncConfiguration()
        XCTAssertTrue(setup.commit(to: &config))
        XCTAssertEqual(config.serverURL, URL(string: "https://ingest.attacker.example"))
        XCTAssertNil(config.signedInDatabaseURL)
        XCTAssertFalse(PulsHealthDatabase.isSignedIn(config))

        // A configuration marked signed-in for another host (a 1.6 build
        // marked any sign-in code) is not the PulsHealth database either.
        let legacy = SyncConfiguration(
            serverURL: URL(string: "https://ingest.attacker.example"), authToken: "other-token",
            signedInDatabaseURL: URL(string: "https://ingest.attacker.example"))
        XCTAssertTrue(legacy.isSignedInDatabase)
        XCTAssertFalse(PulsHealthDatabase.isSignedIn(legacy))
        XCTAssertEqual(DatabaseSetup(applied: legacy).destination, .own)
    }
}
