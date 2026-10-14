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

    @MainActor
    func testBundledPublicNavigationAndSearchExistBeforeAnyNetworkResponse() throws {
        let launch = ReylumiLaunchView()
        var destinations: [(String, [URLQueryItem])] = []
        launch.onNavigate = { destinations.append(($0, $1)) }
        func descendants(_ view: UIView) -> [UIView] {
            view.subviews.flatMap { [$0] + descendants($0) }
        }
        let views = descendants(launch)
        let explore = try XCTUnwrap(views.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "reylumi.launch.explore" })
        let market = try XCTUnwrap(views.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "reylumi.launch.market" })
        let search = try XCTUnwrap(views.compactMap { $0 as? UISearchTextField }.first)
        explore.sendActions(for: .touchUpInside)
        market.sendActions(for: .touchUpInside)
        search.text = "  Hair in Chicago  "
        XCTAssertTrue(launch.textFieldShouldReturn(search))
        XCTAssertEqual(destinations.map { $0.0 }, ["/explore", "/market", "/explore"])
        XCTAssertEqual(destinations.last?.1, [URLQueryItem(name: "q", value: "Hair in Chicago")])
        launch.showError()
        XCTAssertFalse(explore.isHidden)
        XCTAssertTrue(explore.isEnabled)
        XCTAssertTrue(market.isEnabled)
    }

    @MainActor
    func testReadinessDoesNotReplaceNativeSearchWhileTheUserIsEditing() throws {
        let controller = UIViewController()
        let launch = ReylumiLaunchView()
        launch.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        controller.view.addSubview(launch)
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow(frame: launch.frame)
        window.frame = launch.frame
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        func findSearch(_ view: UIView) -> UISearchTextField? {
            if let input = view as? UISearchTextField { return input }
            return view.subviews.compactMap { findSearch($0) }.first
        }
        let input = try XCTUnwrap(findSearch(launch))
        launch.showLoading()
        XCTAssertTrue(input.becomeFirstResponder())
        input.text = "Unsent native search"
        launch.finishLoading()
        XCTAssertFalse(launch.isLoading, "web readiness is already complete and its watchdog can stop")
        XCTAssertFalse(launch.isHidden)
        XCTAssertEqual(launch.alpha, 1)
        XCTAssertTrue(input.isFirstResponder)
        XCTAssertEqual(input.text, "Unsent native search")
        var editingEnded = false
        launch.onEditingFinished = { editingEnded = true }
        input.resignFirstResponder()
        XCTAssertTrue(editingEnded, "the controller then validates the current generation before revealing")
        XCTAssertFalse(launch.isHidden, "editing alone must not bypass the controller's current readiness check")
    }
}
