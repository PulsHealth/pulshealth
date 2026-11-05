#if DEBUG
import Foundation
import Observation

/// Branch-only interaction model. Never creates a sync engine, reads HealthKit,
/// persists consent or authorizes a recipient. Release builds exclude this file.
struct PreviewGroup: Identifiable, Equatable {
    let id: String
    let name: String
    let organizer: String
    let purpose: String
    let metrics: [String]
    let window: String
    let ends: String
    let destination: String
    let retention: String

    static let examples: [Self] = [
        .init(id: "move-together", name: "Move Together", organizer: "Northside Movement Lab",
              purpose: "Help us understand how a weekly group class changes everyday activity.",
              metrics: ["Steps", "Workouts", "Resting heart rate"], window: "Nov 1 – Dec 13, 2026",
              ends: "December 13, 2026", destination: "PulsHealth · group access",
              retention: "The organizer retains previously received data for 90 days after the program ends."),
        .init(id: "sleep-study", name: "Rest & Recovery", organizer: "Example Sleep Research",
              purpose: "Explore the relationship between sleep and recovery over six weeks.",
              metrics: ["Sleep", "Resting heart rate"], window: "Nov 1 – Dec 13, 2026",
              ends: "December 13, 2026", destination: "Separate study database · research.example.org",
              retention: "Previously received data is retained for one year. Contact the study team to request deletion."),
        .init(id: "gym", name: "Everyday Strength", organizer: "Example Community Gym",
              purpose: "Share your activity with your coach between classes.", metrics: ["Steps", "Workouts"],
              window: "From the day you join", ends: "No end date · until you leave",
              destination: "Separate gym database · gym.example.org",
              retention: "Previously received data is retained for 30 days after you leave.")
    ]
}

struct PreviewMembership: Identifiable {
    let group: PreviewGroup
    var enabled: Set<String>
    var id: String { group.id }
}

@MainActor @Observable
final class GroupPreviewModel {
    var pending: PreviewGroup?
    var error: String?
    private(set) var memberships: [PreviewMembership] = []

    init(initialCode: String? = nil) {
        if let initialCode { pending = PreviewGroup.examples.first { $0.id == initialCode } }
    }

    /// Only fixed synthetic invitations are recognized. An untrusted link can
    /// never supply a destination, credentials, group policy or organizer name.
    @discardableResult func open(_ url: URL) -> Bool {
        guard url.scheme == "puls", url.host == "group-preview" else { return false }
        guard pending == nil else { return true }
        let fields = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let codes = fields.filter { $0.name == "code" }
        guard fields.count == 1, codes.count == 1,
              let group = PreviewGroup.examples.first(where: { $0.id == codes[0].value }) else {
            error = "This preview invitation is unavailable. Ask the organizer for a new invitation."
            return true
        }
        error = nil
        pending = group
        return true
    }

    func join(_ group: PreviewGroup, enabled: Set<String>) {
        let allowed = enabled.intersection(group.metrics)
        guard !allowed.isEmpty, !memberships.contains(where: { $0.id == group.id }) else { return }
        memberships.append(.init(group: group, enabled: allowed))
    }

    func setEnabled(_ metric: String, in id: String, enabled: Bool) {
        guard let index = memberships.firstIndex(where: { $0.id == id }),
              memberships[index].group.metrics.contains(metric) else { return }
        if enabled { memberships[index].enabled.insert(metric) }
        else { memberships[index].enabled.remove(metric) }
    }

    func leave(_ id: String) { memberships.removeAll { $0.id == id } }
}
#endif
