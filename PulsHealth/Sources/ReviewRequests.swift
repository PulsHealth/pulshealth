import Foundation
import Observation
import StoreKit
import SwiftUI
import UIKit

/// App-wide timing only. StoreKit owns presentation and never reports whether
/// someone submitted a rating. No health values, type IDs or telemetry are stored.
@MainActor
@Observable
final class ReviewRequests {
    enum Source: String, Codable, Hashable {
        case export, sync, explore
    }

    struct Opportunity: Equatable, Hashable {
        let id = UUID()
        let source: Source
    }

    private struct History: Codable {
        var activeDays = 0
        var lastActiveDay: String?
        var sessions = 0
        var successfulSyncDays = 0
        var lastSuccessfulSyncDay: String?
        var syncRecordedThrough: Date?
        var syncQualifiedAt: Date?
        var attemptedVersions: Set<String> = []
        var lastAttemptAt: Date?
        var lastAttemptSource: Source?
        var attemptCount = 0
    }

    static let writeReviewURL = URL(string: "https://apps.apple.com/app/id6757657354?action=write-review")!
    static let cooldown: TimeInterval = 120 * 24 * 60 * 60
    private static let historyKey = "reviewRequestHistory"
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let version: String
    @ObservationIgnored private let calendar: Calendar
    private var history: History
    private(set) var pending: Opportunity?
    private(set) var sessionStartedAt: Date?
    private var hadPreviousSession = false
    private var offeredSyncThisSession = false
    @ObservationIgnored private var foregroundSyncs: Set<UUID> = []
    private(set) var syncReturnReady = false

    init(defaults: UserDefaults = .standard, version: String? = nil, calendar: Calendar = .current) {
        self.defaults = defaults
        self.version = version ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        self.calendar = calendar
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        history = defaults.data(forKey: Self.historyKey)
            .flatMap { try? decoder.decode(History.self, from: $0) } ?? History()
    }

    /// Only a foreground visit counts. An inactive/active permission sheet is
    /// still the same session; background launches never call this method.
    func beginSession(now: Date = Date()) {
        guard sessionStartedAt == nil else { return }
        sessionStartedAt = now
        offeredSyncThisSession = false
        hadPreviousSession = history.sessions > 0
        history.sessions = min(2, history.sessions + 1)
        recordActiveDay(now)
        persist()
    }

    func endSession() {
        sessionStartedAt = nil
        foregroundSyncs.removeAll()
        syncReturnReady = false
        cancelPending()
    }

    /// Track all foreground catch-ups, including overlapping activations when
    /// a permission sheet makes the scene inactive and active in one visit.
    func beginForegroundSync() -> UUID {
        let id = UUID()
        foregroundSyncs.insert(id)
        syncReturnReady = false
        return id
    }

    func finishForegroundSync(_ id: UUID) {
        guard foregroundSyncs.remove(id) != nil, sessionStartedAt != nil else { return }
        syncReturnReady = foregroundSyncs.isEmpty
    }

    /// Dates of acknowledged uploads from the existing wake log, oldest first.
    /// This counts background successes as history, but never offers a prompt.
    func recordSuccessfulSyncs(at dates: [Date]) {
        let previous = history.syncRecordedThrough
        for date in dates.sorted() {
            guard history.syncRecordedThrough.map({ date > $0 }) ?? true else { continue }
            let day = dayKey(date)
            if history.lastSuccessfulSyncDay != day {
                history.successfulSyncDays = min(3, history.successfulSyncDays + 1)
                history.lastSuccessfulSyncDay = day
                if history.successfulSyncDays == 3, history.syncQualifiedAt == nil {
                    history.syncQualifiedAt = date
                }
            }
            history.syncRecordedThrough = date
        }
        if history.syncRecordedThrough != previous { persist() }
    }

    func offer(_ source: Source, now: Date = Date()) {
        guard sessionStartedAt != nil else { return }
        recordActiveDay(now)
        persist()
        guard isEligible(source, now: now) else { return }
        pending = Opportunity(source: source)
    }

    /// Called only by the foreground UI once startup/sync work has settled.
    /// A cancelled return opportunity waits for another visit, rather than
    /// reappearing after each interaction or dismissed sheet in this visit.
    func offerSyncOnReturn(now: Date = Date()) {
        guard !offeredSyncThisSession, pending == nil, isEligible(.sync, now: now) else { return }
        offeredSyncThisSession = true
        offer(.sync, now: now)
    }

    func cancelPending() {
        guard pending != nil else { return }
        pending = nil
    }

    func isEligible(_ source: Source, now: Date = Date()) -> Bool {
        guard let started = sessionStartedAt, !version.isEmpty,
              !history.attemptedVersions.contains(version),
              history.lastAttemptAt.map({ now.timeIntervalSince($0) >= Self.cooldown }) ?? true else { return false }
        switch source {
        case .export:
            return hadPreviousSession
        case .explore:
            return history.activeDays >= 3
        case .sync:
            // Background uploads count as use. Qualification must predate
            // this visit, even when the wake log loads after the view appears.
            return syncReturnReady && history.successfulSyncDays >= 3
                && history.syncQualifiedAt.map({ $0 < started }) == true
        }
    }

    /// Recheck after the pause. Cancellation consumes no cooldown, while an
    /// actual API call counts as an attempt even if Apple displays nothing.
    func requestAfterPause(
        _ opportunity: Opportunity,
        pause: @MainActor () async throws -> Void = { try await Task.sleep(for: .seconds(2)) },
        now: @MainActor () -> Date = { Date() },
        canPresent: @MainActor () -> Bool,
        request: @MainActor () -> Void
    ) async {
        do { try await pause() } catch {
            if pending == opportunity { cancelPending() }
            return
        }
        guard pending == opportunity else { return }
        guard !Task.isCancelled else { cancelPending(); return }
        pending = nil
        let date = now()
        guard isEligible(opportunity.source, now: date), canPresent() else { return }
        history.lastAttemptAt = date
        history.lastAttemptSource = opportunity.source
        history.attemptedVersions.insert(version)
        history.attemptCount += 1
        persist()
        request()
    }

    private func recordActiveDay(_ date: Date) {
        let day = dayKey(date)
        if history.lastActiveDay != day {
            history.activeDays = min(3, history.activeDays + 1)
            history.lastActiveDay = day
        }
    }

    private func dayKey(_ date: Date) -> String {
        let parts = calendar.dateComponents([.era, .year, .month, .day], from: date)
        return "\(parts.era ?? 0)-\(parts.year ?? 0)-\(parts.month ?? 0)-\(parts.day ?? 0)"
    }

    private func persist() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        if let data = try? encoder.encode(history) { defaults.set(data, forKey: Self.historyKey) }
    }
}

/// Attached to the task's result screen, so pushing another page, switching
/// tabs, tapping/scrolling, or presenting an alert cancels the opportunity.
private struct ReviewRequestModifier: ViewModifier {
    let source: ReviewRequests.Source
    let blocked: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.requestReview) private var requestReview
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .onAppear { visible = true }
            .onDisappear {
                visible = false
                if model.reviews.pending?.source == source { model.reviews.cancelPending() }
            }
            .onChange(of: blocked) { _, blocked in
                if blocked { model.reviews.cancelPending() }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { model.reviews.cancelPending() }
            }
            // Observe touches without making this ancestor a gesture target.
            // SwiftUI drag/tap gestures here can swallow List NavigationLinks.
            .background {
                ReviewInteractionObserver(active: visible) { model.reviews.cancelPending() }
            }
            .task(id: model.reviews.pending) {
                guard let opportunity = model.reviews.pending, opportunity.source == source else { return }
                await model.reviews.requestAfterPause(opportunity, canPresent: {
                    visible && !blocked && scenePhase == .active && !model.reviewRequestsBlocked
                        && !hasPresentedController
                }, request: { requestReview() })
            }
    }

    /// Covers sheets outside SwiftUI's state, including HealthKit and sharing.
    private var hasPresentedController: Bool {
        func isPresenting(_ controller: UIViewController) -> Bool {
            controller.presentedViewController != nil || controller.children.contains(where: isPresenting)
        }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows).filter(\.isKeyWindow)
            .contains { $0.rootViewController.map(isPresenting) ?? false }
    }
}

extension View {
    func reviewRequestOpportunity(_ source: ReviewRequests.Source, blocked: Bool = false) -> some View {
        modifier(ReviewRequestModifier(source: source, blocked: blocked))
    }
}

/// Observes touch-down without ever recognizing a gesture or participating in
/// SwiftUI's hit testing. The content keeps all of its normal taps and drags.
private struct ReviewInteractionObserver: UIViewRepresentable {
    let active: Bool
    let onInteraction: () -> Void

    func makeUIView(context: Context) -> ReviewInteractionView {
        let view = ReviewInteractionView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: ReviewInteractionView, context: Context) {
        view.active = active
        view.onInteraction = onInteraction
    }

    static func dismantleUIView(_ view: ReviewInteractionView, coordinator: ()) {
        view.detach()
    }
}

private final class ReviewInteractionView: UIView, UIGestureRecognizerDelegate {
    var active = false
    var onInteraction: (() -> Void)?
    private weak var observedWindow: UIWindow?
    private lazy var observer: UITapGestureRecognizer = {
        let recognizer = UITapGestureRecognizer()
        recognizer.delegate = self
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        return recognizer
    }()

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard observedWindow !== window else { return }
        detach()
        observedWindow = window
        window?.addGestureRecognizer(observer)
    }

    func detach() {
        observedWindow?.removeGestureRecognizer(observer)
        observedWindow = nil
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if active, window != nil, bounds.contains(touch.location(in: self)) {
            onInteraction?()
        }
        // Reject every touch: this observer can never win, cancel, delay, or
        // impose a failure dependency on a row's own gesture recognizers.
        return false
    }
}
