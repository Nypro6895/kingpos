import XCTest

final class StoreScreenshots: XCTestCase {
    @MainActor
    func testCaptureExploreAfterClosingPromotion() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.reylumi.ios")
        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 60))
        // Exercise the same close button a user sees; leave the app and its data unchanged.
        let closePromotion = app.buttons["Close promotion"].firstMatch
        if closePromotion.waitForExistence(timeout: 45) {
            closePromotion.tap()
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: closePromotion)
            XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed)
        }
        XCTAssertTrue(app.staticTexts["Fresh looks"].firstMatch.waitForExistence(timeout: 60))
        Thread.sleep(forTimeInterval: 3)
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "Reylumi Explore"
        attachment.lifetime = .keepAlways
        add(attachment)
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try screenshot.pngRepresentation.write(to: documents.appendingPathComponent("reylumi-explore.png"), options: .atomic)
    }
}
