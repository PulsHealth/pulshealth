#if DEBUG
import XCTest
@testable import PulsHealth

@MainActor final class GroupPreviewModelTests: XCTestCase {
    func testInvitationsAreFixedAndFirstInvitationWins() {
        let model = GroupPreviewModel()
        XCTAssertFalse(model.open(URL(string: "puls://pair?code=gym")!))
        XCTAssertTrue(model.open(URL(string: "puls://group-preview?code=gym")!))
        model.open(URL(string: "puls://group-preview?code=sleep-study")!)
        XCTAssertEqual(model.pending?.id, "gym")
        model.pending = nil
        model.open(URL(string: "puls://group-preview?code=gym&recipient=evil.example.org")!)
        XCTAssertNil(model.pending)
        XCTAssertNotNil(model.error)
        model.open(URL(string: "puls://group-preview?code=gym&code=sleep-study")!)
        XCTAssertNil(model.pending)
    }

    func testOptOutAndLeaveAreScopedToOneGroup() {
        let model = GroupPreviewModel()
        let gym = PreviewGroup.examples[2]
        let study = PreviewGroup.examples[1]
        model.join(gym, enabled: ["Steps", "Workouts", "Unrequested"])
        model.join(study, enabled: Set(study.metrics))
        XCTAssertEqual(model.memberships[0].enabled, ["Steps", "Workouts"])
        model.setEnabled("Steps", in: gym.id, enabled: false)
        model.setEnabled("Workouts", in: gym.id, enabled: false)
        XCTAssertTrue(model.memberships[0].enabled.isEmpty)
        XCTAssertEqual(model.memberships[1].enabled, Set(study.metrics))
        model.setEnabled("Unrequested", in: gym.id, enabled: true)
        XCTAssertTrue(model.memberships[0].enabled.isEmpty)
        model.leave(gym.id)
        XCTAssertEqual(model.memberships.map(\.id), [study.id])
    }

    func testEmptyConsentNeverJoinsAndDuplicateJoinNeverExpandsConsent() {
        let model = GroupPreviewModel()
        let group = PreviewGroup.examples[0]
        model.join(group, enabled: [])
        XCTAssertTrue(model.memberships.isEmpty)
        model.join(group, enabled: ["Steps"])
        model.join(group, enabled: Set(group.metrics))
        XCTAssertEqual(model.memberships.count, 1)
        XCTAssertEqual(model.memberships[0].enabled, ["Steps"])
    }
}
#endif
