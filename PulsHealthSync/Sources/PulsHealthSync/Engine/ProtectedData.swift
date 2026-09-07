import Foundation
import UIKit

/// Whether HealthKit is readable right now.
///
/// The HealthKit store lives in a file-protection class that is unavailable
/// while the device is locked: every query fails with
/// `HKError.errorDatabaseInaccessible`. That matters because iOS runs
/// `BGProcessingTask` when the device is *idle*, which in practice means
/// overnight while it is locked.
///
/// Measured over 2026-06-14..2026-08-14 on the production device: 156
/// background-processing wakes produced 59 samples total, 154 of them were
/// completely empty, and every activity-ring refresh since 2026-08-11 failed
/// this way. Each locked wake ran ~80 doomed anchored queries and logged ~80
/// warnings — roughly 260 wasted queries a day. One boolean read replaces all
/// of it.
///
/// Callers should treat `false` as "come back later", never as an error: the
/// anchors and watermarks stay put, so the next unlocked wake picks up exactly
/// where this one would have.
enum ProtectedData {
    /// `UIApplication.shared` is main-actor isolated; this is a cheap property
    /// read, so hopping is fine even from a background task.
    static var isAvailable: Bool {
        get async { await MainActor.run { UIApplication.shared.isProtectedDataAvailable } }
    }
}
