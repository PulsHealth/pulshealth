import XCTest

final class ConnectionsNavigationTests: XCTestCase {
    private func launchConnections() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-PulsInitialTab", "sync", "-onboardingCompleted", "YES"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Connections"].waitForExistence(timeout: 15))
        if app.buttons["Dismiss"].exists { app.buttons["Dismiss"].tap() }
        return app
    }
    func testPulsHealthSetupWaitsForExplicitSignIn() {
        let app = launchConnections()
        app.navigationBars.buttons["Add a connection"].tap()
        XCTAssertTrue(app.navigationBars["Add a connection"].waitForExistence(timeout: 5))
        let choices = XCTAttachment(screenshot: app.screenshot())
        choices.name = "Add connection cards"; choices.lifetime = .keepAlways; add(choices)
        app.buttons["PulsHealth database"].tap()
        XCTAssertTrue(app.buttons["Sign in & continue"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["PulsHealth database"].exists)
        XCTAssertEqual(app.state, .runningForeground)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "PulsHealth setup"; capture.lifetime = .keepAlways; add(capture)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Add a connection"].waitForExistence(timeout: 5))
    }
    func testNewDatabaseOpensReviewWithoutPoppingItAgain() {
        let app = launchConnections()
        app.navigationBars.buttons["Add a connection"].tap()
        app.buttons["Your database"].tap()
        app.buttons["Enter details manually"].tap()
        let url = app.textFields["Database URL"]
        XCTAssertTrue(url.waitForExistence(timeout: 5))
        url.tap(); url.typeText("https://example.invalid")
        let token = app.secureTextFields["Token"]
        token.tap(); token.typeText("synthetic-test-token")
        let addDatabase = app.buttons["Add Database"]
        for _ in 0..<5 where !addDatabase.isHittable { app.swipeUp() }
        XCTAssertTrue(addDatabase.isHittable)
        addDatabase.tap()
        XCTAssertTrue(app.staticTexts["Ready for your first sync"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Database"].exists)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Database review"; capture.lifetime = .keepAlways; add(capture)
    }
    func testManualSetupAndGroupChoicesUseTheRootRouteRegistration() {
        let app = launchConnections()
        app.navigationBars.buttons["Add a connection"].tap()
        app.buttons["Your database"].tap()
        XCTAssertTrue(app.navigationBars["Your database"].waitForExistence(timeout: 5))
        app.buttons["Enter details manually"].tap()
        XCTAssertTrue(app.textFields["Database URL"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Your database"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Add a connection"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Connections"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["Add a connection"].tap()
        app.buttons["Group connection"].tap()
        XCTAssertTrue(app.buttons["Join a group"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Create a group"].exists)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Group choices"; capture.lifetime = .keepAlways; add(capture)

    }
}
