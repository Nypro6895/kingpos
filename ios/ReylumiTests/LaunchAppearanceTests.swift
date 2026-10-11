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
        XCTAssertEqual(web.underPageBackgroundColor.resolvedColor(with: dark), .white)
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
