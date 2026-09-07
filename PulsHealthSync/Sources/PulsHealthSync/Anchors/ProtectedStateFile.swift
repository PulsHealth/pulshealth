import Foundation
import os

/// Writes the package's on-disk state (`sync-state.json`, `event-log.json`,
/// `wake-log.json`, quarantined copies) with the protection every one of those
/// files needs:
///
/// - `FileProtectionType.completeUntilFirstUserAuthentication`: unreadable at
///   rest until the first unlock after a reboot, which is also the earliest a
///   background wake can run — so the engine can still load its anchors from a
///   `BGProcessingTask` or observer launch while the device is locked.
/// - Excluded from backup: anchors are `HKQueryAnchor` blobs specific to this
///   device's Health database and meaningless anywhere else, and the event log
///   is diagnostics. Nothing here should ride an iCloud or Finder backup.
///
/// Atomic writes replace the file's inode, so the resource values are reapplied
/// after every write rather than once at creation.
enum ProtectedStateFile {
    static let protection: FileProtectionType = .completeUntilFirstUserAuthentication
    private static let logger = Logger(subsystem: PulsLog.subsystem, category: "state")

    /// Create the state directory (if needed) and mark it protected and
    /// backup-excluded. The directory's protection class is inherited by files
    /// created inside it, and its backup exclusion covers the whole subtree.
    static func prepareDirectory(_ directory: URL) {
        try? FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: protection])
        protect(directory)
    }

    /// Atomic write plus protection and backup exclusion. Throws only when the
    /// data itself could not be written.
    static func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        protect(url)
    }

    /// Apply protection and backup exclusion to an existing file or directory.
    static func protect(_ url: URL) {
        do {
            try FileManager.default.setAttributes(
                [.protectionKey: protection], ofItemAtPath: url.path)
        } catch {
            logger.warning("Could not set file protection on \(url.lastPathComponent): \(error)")
        }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = url
        do {
            try mutable.setResourceValues(values)
        } catch {
            logger.warning("Could not exclude \(url.lastPathComponent) from backup: \(error)")
        }
    }
}
