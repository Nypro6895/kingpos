import XCTest
import UIKit
import WebKit
@testable import Reylumi

final class LaunchAppearanceTests: XCTestCase {
    @MainActor
    func testWhiteCanvasBeforeNetworkResponseEvenInDarkMode() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        let web = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        web.stopLoading()
        let dark = UITraitCollection(userInterfaceStyle: .dark)
        XCTAssertEqual(controller.overrideUserInterfaceStyle, .light)
        XCTAssertEqual(controller.view.backgroundColor?.resolvedColor(with: dark), .white)
        XCTAssertEqual(web.backgroundColor?.resolvedColor(with: dark), .white)
        XCTAssertEqual(web.scrollView.backgroundColor?.resolvedColor(with: dark), .white)
        // WebKit returns RGB white while UIColor.white uses grayscale storage.
        let underPage = web.underPageBackgroundColor.resolvedColor(with: dark)
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        XCTAssertTrue(underPage.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
        for channel in [red, green, blue, alpha] { XCTAssertEqual(channel, 1, accuracy: 0.001) }
        XCTAssertEqual(controller.preferredStatusBarStyle, .darkContent)
        let launch = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? ReylumiLaunchView }.first)
        XCTAssertTrue(launch.isLoading)
        XCTAssertFalse(launch.isHidden)
        XCTAssertNotNil(UIImage(named: "LoadingLogo"))
        XCTAssertNotNil(UIColor(named: "AppBackground"))
    }

    @MainActor
    func testErrorStopsLoadingAndRetryRestoresIt() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        let web = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        web.stopLoading()
        let launch = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? ReylumiLaunchView }.first)
        controller.webView(web, didFailProvisionalNavigation: nil, withError: NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet))
        XCTAssertFalse(launch.isLoading)
        XCTAssertFalse(launch.isHidden)
        launch.showLoading()
        XCTAssertTrue(launch.isLoading)
        controller.webView(web, didFailProvisionalNavigation: nil, withError: NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled))
        XCTAssertTrue(launch.isLoading)
        controller.webView(web, didFinish: nil)
        XCTAssertFalse(launch.isLoading)
    }
}
