import XCTest

final class ConnectionsNavigationTests: XCTestCase {
    private func launchConnections() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-PulsInitialTab", "sync", "-onboardingCompleted", "YES"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Connections"].waitForExistence(timeout: 15))
        if app.buttons["Dismiss"].exists { app.buttons["Dismiss"].tap() }
        XCTAssertTrue(app.tabBars.buttons["Connections"].exists)
        return app
    }
    func testFullSelectionReviewKeepsApplyVisible() {
        let app = XCUIApplication()
        app.launchArguments = ["-PulsPreviewSyncReview", "YES", "-onboardingCompleted", "YES"]
        app.launch()
        let apply = app.buttons["syncReview.apply"]
        XCTAssertTrue(apply.waitForExistence(timeout: 15))
        XCTAssertTrue(apply.isHittable)
        Thread.sleep(forTimeInterval: 1) // Let the presentation finish before capturing the action bar.
        let overview = XCTAttachment(screenshot: app.screenshot())
        overview.name = "Full selection review"; overview.lifetime = .keepAlways; add(overview)
        app.buttons["syncReview.raw"].firstMatch.tap()
        XCTAssertTrue(apply.isHittable)
        Thread.sleep(forTimeInterval: 2) // Capture the expanded list after its transition.
        let expanded = XCTAttachment(screenshot: app.screenshot())
        expanded.name = "Expanded raw samples"; expanded.lifetime = .keepAlways; add(expanded)
        app.buttons["syncReview.raw"].firstMatch.tap()
        app.buttons["syncReview.aggregates"].firstMatch.tap()
        XCTAssertTrue(apply.isHittable)
        Thread.sleep(forTimeInterval: 2)
        let aggregates = XCTAttachment(screenshot: app.screenshot())
        aggregates.name = "Expanded daily aggregates"; aggregates.lifetime = .keepAlways; add(aggregates)
    }

    func testPulsHealthSetupWaitsForExplicitSignIn() {
        let app = launchConnections()
        app.navigationBars.buttons["Add a connection"].tap()
        XCTAssertTrue(app.navigationBars["Add a connection"].waitForExistence(timeout: 5))
        let choices = XCTAttachment(screenshot: app.screenshot())
        choices.name = "Add connection cards"; choices.lifetime = .keepAlways; add(choices)
        app.buttons["PulsHealth database"].tap()
        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["PulsHealth"].exists)
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
        let url = app.textFields["Database URL"]
        XCTAssertTrue(url.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Saved Databases"].exists)
        XCTAssertFalse(app.staticTexts["Your Own Server"].exists)
        XCTAssertFalse(app.staticTexts["PulsHealth Managed Server"].exists)
        url.tap(); url.typeText("https://example.invalid")
        let token = app.secureTextFields["Token"]
        token.tap(); token.typeText("synthetic-test-token")
        let addDatabase = app.buttons["Continue"]
        for _ in 0..<5 where !addDatabase.isHittable { app.swipeUp() }
        XCTAssertTrue(addDatabase.isHittable)
        addDatabase.tap()
        XCTAssertTrue(app.staticTexts["Ready for your first sync"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Review connection"].exists)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Database review"; capture.lifetime = .keepAlways; add(capture)
    }
    func testManualSetupAndDataRequestChoicesUseTheRootRouteRegistration() {
        let app = launchConnections()
        app.navigationBars.buttons["Add a connection"].tap()
        app.buttons["Your database"].tap()
        XCTAssertTrue(app.textFields["Database URL"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Add a connection"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Connections"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["Add a connection"].tap()
        app.buttons["Data requests"].tap()
        XCTAssertTrue(app.navigationBars["Data requests"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Open request"].exists)
        XCTAssertTrue(app.buttons["Create request"].exists)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Data request choices"; capture.lifetime = .keepAlways; add(capture)

    }
    func testExploreOffersExportWithoutConnectionChanges() {
        let app = XCUIApplication()
        app.launchArguments = ["-PulsInitialTab", "explore", "-onboardingCompleted", "YES", "-PulsFixtureProfiles", "YES"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Explore"].waitForExistence(timeout: 15))
        if app.buttons["Dismiss"].exists { app.buttons["Dismiss"].tap() }
        let search = app.textFields["Search data types"]
        search.tap(); search.typeText("Heart Rate")
        app.buttons.containing(.staticText, identifier: "Heart Rate").firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Heart Rate"].waitForExistence(timeout: 5))
        let exportMenu = app.buttons["typeActions.menu"]
        XCTAssertEqual(exportMenu.label, "Export")
        exportMenu.tap()
        XCTAssertTrue(app.buttons["Add to Export"].waitForExistence(timeout: 5))
        for title in ["Add to Sync…", "Manage Sync…", "Edit Sync Draft…", "Sync Details"] {
            XCTAssertFalse(app.buttons[title].exists)
        }
        app.buttons["Add to Export"].tap()
        XCTAssertTrue(app.buttons["typeActions.selectExport"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["typeActions.stageSync"].exists)
        app.buttons["typeActions.selectExport"].tap()
        XCTAssertTrue(app.buttons["Open Export"].waitForExistence(timeout: 5))
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Explore export selection"; capture.lifetime = .keepAlways; add(capture)
        app.buttons["Open Export"].tap()
        XCTAssertTrue(app.tabBars.buttons["Export"].isSelected)
    }

}
