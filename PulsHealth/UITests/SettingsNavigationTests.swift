import XCTest

final class SettingsNavigationTests: XCTestCase {
    func testSettingsGroupsAndNestedControls() {
        let app = XCUIApplication()
        app.launchArguments = ["-PulsInitialTab", "settings", "-onboardingCompleted", "YES"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 15))
        if app.buttons["Dismiss"].exists { app.buttons["Dismiss"].tap() }
        XCTAssertFalse(app.staticTexts["Concurrent types"].exists)
        XCTAssertFalse(app.buttons["Delete PulsHealth Account"].exists)
        XCTAssertFalse(app.buttons["Advanced"].exists)
        app.buttons["Performance"].tap()
        XCTAssertTrue(app.steppers.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Batch size"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertFalse(app.buttons["Data requests"].exists)
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Version"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Settings overview"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
