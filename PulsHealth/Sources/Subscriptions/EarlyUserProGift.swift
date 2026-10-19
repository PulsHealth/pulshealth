import Foundation
import StoreKit
import PulsHealthSync

/// A device-local thank-you, separate from an auto-renewing subscription.
/// Keep the fixed dates even after expiry; a later launch must never restart it.
/// Temporary launch transition: retirement is tracked in issue #290 and
/// docs/appstore/subscriptions.md#retiring-the-gift. Review within 90 days of
/// the first public 2.2 release; do not remove active grants on that review date.
@MainActor
final class EarlyUserProGift {
    nonisolated static let duration: TimeInterval = 30 * 24 * 60 * 60
    // 2.1 shipped as build 22. Build 23 introduced Pro in 2.2.
    nonisolated static let firstProBuild = "23"
    typealias EligibilityReader = @Sendable () async -> Bool?
    struct Record: Codable {
        let startedAt: TimeInterval
        let expiresAt: TimeInterval
        var acknowledged = false
    }
    private let storage: any TokenStore
    private let eligibilityReader: EligibilityReader

    init(storage: any TokenStore = KeychainTokenStore(
        service: (Bundle.main.bundleIdentifier ?? "PulsHealth") + ".early-user-pro",
        account: "gift-v1"),
        eligibilityReader: @escaping EligibilityReader = EarlyUserProGift.readEligibility
    ) {
        self.storage = storage
        self.eligibilityReader = eligibilityReader
    }

    nonisolated static func isEligible(originalBuild: String) -> Bool {
        let components = originalBuild.split(separator: ".", omittingEmptySubsequences: false)
        guard !components.isEmpty, components.allSatisfy({
            !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber }
        }), let first = Int(components[0]), first > 0 else { return false }
        return originalBuild.compare(firstProBuild, options: .numeric) == .orderedAscending
    }

    nonisolated static func readEligibility() async -> Bool? {
        // Never prompt for authentication just to grant the gift. Failure is
        // retryable on a later foreground visit, without consuming any days.
        guard let result = try? await AppTransaction.shared,
              case .verified(let transaction) = result,
              transaction.bundleID == Bundle.main.bundleIdentifier else { return nil }
        return isEligible(originalBuild: transaction.originalAppVersion)
    }

    func record() throws -> Record? {
        guard let value = try storage.token() else { return nil }
        let record = try JSONDecoder().decode(Record.self, from: Data(value.utf8))
        guard record.startedAt.isFinite, record.expiresAt.isFinite,
              abs(record.expiresAt - record.startedAt - Self.duration) < 1 else {
            throw CocoaError(.coderReadCorrupt)
        }
        return record
    }

    func activate(now: Date) async {
        do {
            guard try record() == nil, await eligibilityReader() == true else { return }
            // Another foreground call may have completed during verification.
            guard try record() == nil else { return }
            try save(Record(startedAt: now.timeIntervalSince1970,
                            expiresAt: now.timeIntervalSince1970 + Self.duration))
        } catch {
            // Locked/unavailable storage and corrupt records never grant access
            // or replace a previous deadline. A later visit can retry safely.
        }
    }

    func activeRecord(now: Date) -> Record? {
        guard let record = try? record(), record.startedAt <= now.timeIntervalSince1970,
              record.expiresAt > now.timeIntervalSince1970 else { return nil }
        return record
    }

    func acknowledge() {
        guard var record = try? record() else { return }
        record.acknowledged = true
        try? save(record)
    }

    private func save(_ record: Record) throws {
        try storage.setToken(String(decoding: JSONEncoder().encode(record), as: UTF8.self))
    }
}
