import Foundation
import PulsHealthSync

/// Where Sync → Database sends the data: the two choices at the top of the
/// screen.
enum DatabaseDestination: Hashable {
    /// The developer's hosted database, paired by signing in
    /// (`PulsHealthDatabase`).
    case pulsHealth
    /// One the person runs, paired with its code or typed in.
    case own
}

/// Sync → Database's state and decisions, kept out of the view so they can
/// be tested (`DatabaseSetupTests`): what the screen starts from, which
/// fields Save & Apply commits, and when a sign-in's pairing code has been
/// applied and stops asking to be.
struct DatabaseSetup: Equatable {
    /// The choice at the top. Nil until one is made on an install with no
    /// database: the screen asks rather than picking for the person.
    var destination: DatabaseDestination?
    /// Your own database's fields.
    var own: ServerFieldsDraft
    /// The pairing code the PulsHealth sign-in sheet handed back this visit,
    /// until it is applied (`settle(applied:)`).
    private(set) var signedIn: ServerFieldsDraft?

    /// Starts from the *applied* configuration, what is actually syncing, not
    /// the staged draft. The two differ after a Save & Apply whose
    /// server-change prompt was cancelled: the draft keeps the values that
    /// were not applied. Starting from those would show one database while
    /// another keeps syncing, and the next Save & Apply would commit them
    /// unseen — emptied fields, say, disconnecting the database that works.
    ///
    /// Your own database's fields never start with the PulsHealth database's
    /// URL and token in them.
    ///
    /// `preferred` is the choice the person already made before arriving (the
    /// Sync tab's first-time screen); it applies only on an install with no
    /// database, where the screen would otherwise ask.
    init(applied: SyncConfiguration, scanOnArrival: Bool = false, preferred: DatabaseDestination? = nil) {
        if PulsHealthDatabase.isSignedIn(applied) {
            destination = .pulsHealth
            own = ServerFieldsDraft()
        } else {
            destination = applied.serverURL != nil || scanOnArrival ? .own : preferred
            own = ServerFieldsDraft(configuration: applied)
        }
    }

    /// Returns whether the choice changed.
    @discardableResult
    mutating func choose(_ choice: DatabaseDestination) -> Bool {
        guard destination != choice else { return false }
        destination = choice
        return true
    }

    /// A pairing code scanned, pasted, typed into the URL field or accepted as
    /// a link: always your own database's, whatever it points at — only the
    /// sign-in sheet can say a code came from a PulsHealth account.
    mutating func receivePairing(_ payload: PairingPayload) {
        destination = .own
        own.fill(from: payload)
    }

    /// The pairing code the PulsHealth sign-in sheet handed back. Returns
    /// false when its database is not under the viewer's domain
    /// (`PulsHealthDatabase.domain`): any page the sheet reached could have
    /// sent a `puls://pair` link, so such a code is taken as an ordinary
    /// pairing code for your own database instead — filled in and shown with
    /// its host, never called the PulsHealth database.
    @discardableResult
    mutating func receiveSignIn(_ payload: PairingPayload) -> Bool {
        var draft = ServerFieldsDraft()
        guard draft.fill(fromSignIn: payload, domain: PulsHealthDatabase.domain) else {
            receivePairing(payload)
            return false
        }
        signedIn = draft
        destination = .pulsHealth
        return true
    }

    /// The database a sign-in's code points at, `host[:port][/path]`, shown
    /// with it: the person sees where it leads before applying it.
    var signedInDatabaseLabel: String? {
        Self.databaseLabel(signedIn?.validatedURL)
    }

    /// `host[:port][/path]` for a database URL, the way the screen names a
    /// database — the PulsHealth one included, so its label always says
    /// where the data goes.
    static func databaseLabel(_ url: URL?) -> String? {
        url.flatMap { ServerIdentity(url: $0, userID: "")?.serverLabel }
    }

    /// The fields the current choice would test and commit.
    var fieldsForChoice: ServerFieldsDraft? {
        switch destination {
        case .pulsHealth: signedIn
        case .own: own
        case nil: nil
        }
    }

    /// Save & Apply: writes the current choice's fields into the
    /// configuration draft. False, and nothing written, when the choice has
    /// nothing to commit (none made, or no sign-in yet).
    mutating func commit(to configuration: inout SyncConfiguration) -> Bool {
        switch destination {
        case .pulsHealth:
            guard var draft = signedIn else { return false }
            draft.commit(to: &configuration)
            // The paired user ID is in the configuration draft now, whichever
            // way a server-change prompt goes; holding on to it would
            // overwrite a later edit on the User page.
            draft.markCommitted()
            signedIn = draft
        case .own:
            own.commit(to: &configuration)
            own.markCommitted()
        case nil:
            return false
        }
        return true
    }

    /// Drops the sign-in's code once the applied configuration is that
    /// database with that token: after this screen's Save & Apply, or after
    /// the server-change prompt it raised was confirmed. Until then the
    /// screen keeps asking for Save & Apply — and stops as soon as it is done.
    mutating func settle(applied: SyncConfiguration) {
        guard let signedIn, PulsHealthDatabase.isSignedIn(applied),
              applied.serverURL == signedIn.validatedURL,
              applied.authToken == signedIn.token
        else { return }
        self.signedIn = nil
    }
}

/// A test result belongs to the exact fields tested. Editing them invalidates
/// both a displayed result and a still-running request, including edit/revert.
struct DatabaseConnectionTest {
    private(set) var result: ConnectionTestResult?
    private(set) var running = false
    private var fields: ServerFieldsDraft?
    private var generation = 0

    mutating func begin(for fields: ServerFieldsDraft) -> Int {
        generation += 1
        self.fields = fields
        result = nil
        running = true
        return generation
    }

    mutating func invalidate(for fields: ServerFieldsDraft?) {
        guard self.fields != fields else { return }
        cancel()
    }

    mutating func cancel() {
        generation += 1
        fields = nil
        result = nil
        running = false
    }

    mutating func finish(_ result: ConnectionTestResult, run: Int) {
        guard generation == run else { return }
        self.result = result
        running = false
    }
}
