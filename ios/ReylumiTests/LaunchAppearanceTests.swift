import XCTest
import UIKit
import WebKit
@testable import Reylumi

final class LaunchAppearanceTests: XCTestCase {
    @MainActor
    func testWhiteCanvasBeforeNetworkResponseEvenInDarkMode() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        XCTAssertFalse(controller.view.subviews.contains { $0 is WKWebView })
        controller.initializeWebContentIfNeeded()
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
        controller.initializeWebContentIfNeeded()
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
    func testUsefulShellAndOrbitLayoutBeforeWebKitAtPhoneAndLandscapeSizes() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        let launch = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? ReylumiLaunchView }.first)
        let orbit = try XCTUnwrap(descendants(of: launch).compactMap { $0 as? ReylumiOrbitView }.first)
        let search = try XCTUnwrap(descendants(of: launch).compactMap { $0 as? UISearchTextField }.first)
        XCTAssertTrue(search.isEnabled)
        XCTAssertTrue(orbit.isLoading)
        XCTAssertEqual(orbit.accessibilityIdentifier, "reylumi.launch.orbit")
        XCTAssertGreaterThanOrEqual(descendants(of: launch).compactMap { $0 as? UIButton }.count, 6)
        for size in [CGSize(width: 320, height: 568), CGSize(width: 390, height: 844), CGSize(width: 412, height: 915), CGSize(width: 844, height: 390)] {
            controller.view.frame = CGRect(origin: .zero, size: size)
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            launch.layoutIfNeeded()
            let scroll = try XCTUnwrap(launch.subviews.compactMap { $0 as? UIScrollView }.first)
            XCTAssertLessThanOrEqual(scroll.contentSize.width, scroll.bounds.width + 1)
            XCTAssertGreaterThan(orbit.bounds.width, 0)
            XCTAssertGreaterThan(search.bounds.width, 0)
            XCTAssertFalse(controller.view.subviews.contains { $0 is WKWebView })
        }
    }

    @MainActor
    func testOrbitGeometryStaysInsideItsBoundsWhenResized() {
        let orbit = ReylumiOrbitView()
        for size in [CGFloat(32), 52, 64, 112, 220] {
            orbit.frame = CGRect(x: 0, y: 0, width: size, height: size)
            orbit.setNeedsLayout()
            orbit.layoutIfNeeded()
            for image in descendants(of: orbit).compactMap({ $0 as? UIImageView }) {
                let rectangle = image.convert(image.bounds, to: orbit)
                XCTAssertTrue(orbit.bounds.insetBy(dx: -0.01, dy: -0.01).contains(rectangle))
            }
            for shape in (orbit.layer.sublayers ?? []).compactMap({ $0 as? CAShapeLayer }) {
                if let box = shape.path?.boundingBoxOfPath { XCTAssertTrue(orbit.bounds.contains(box)) }
            }
        }
    }

    @MainActor
    func testLatestPublicIntentWinsBeforeWebKitStartsAndInitializationIsOnceOnly() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        let launch = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? ReylumiLaunchView }.first)
        let search = try XCTUnwrap(descendants(of: launch).compactMap { $0 as? UISearchTextField }.first)
        XCTAssertEqual(controller.queuedStartupURL?.path, "/explore")
        search.text = "  Nails & hair  "
        XCTAssertTrue(launch.textFieldShouldReturn(search))
        XCTAssertEqual(URLComponents(url: try XCTUnwrap(controller.queuedStartupURL), resolvingAgainstBaseURL: false)?.queryItems, [URLQueryItem(name: "q", value: "Nails & hair")])
        controller.returnToMarket(sequence: 1)
        XCTAssertEqual(controller.queuedStartupURL?.path, "/market")
        search.text = "Spa"
        XCTAssertTrue(launch.textFieldShouldReturn(search))
        XCTAssertEqual(controller.queuedStartupURL?.path, "/explore")
        XCTAssertEqual(URLComponents(url: try XCTUnwrap(controller.queuedStartupURL), resolvingAgainstBaseURL: false)?.queryItems, [URLQueryItem(name: "q", value: "Spa")])
        controller.returnToMarket(sequence: 1)
        XCTAssertEqual(controller.queuedStartupURL?.path, "/explore", "A duplicate Safari return cannot replace a later search")
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        web.stopLoading()
        controller.initializeWebContentIfNeeded()
        XCTAssertNil(controller.queuedStartupURL)
        XCTAssertEqual(controller.view.subviews.compactMap { $0 as? WKWebView }.count, 1)
        XCTAssertTrue(controller.view.subviews.compactMap { $0 as? WKWebView }.first === web)
    }

    @MainActor
    func testDisplayedShellStartsWebKitThroughFramesAndSurvivesEarlyBackground() async throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertFalse(controller.view.subviews.contains { $0 is WKWebView }, "A detached controller must not initialize WebKit on foreground")
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = controller
        window.isHidden = false
        defer { window.isHidden = true }
        XCTAssertFalse(controller.view.subviews.contains { $0 is WKWebView }, "The shell precedes WebKit construction")
        NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        let webReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in controller.view.subviews.contains { $0 is WKWebView } }, object: nil)
        await fulfillment(of: [webReady], timeout: 5)
        let web = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        web.stopLoading()
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertEqual(controller.view.subviews.compactMap { $0 as? WKWebView }.count, 1)
    }

    @MainActor
    func testReadinessStopsOrbitImmediatelyAndPreservesActiveSearch() throws {
        let launch = ReylumiLaunchView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let host = UIViewController()
        host.view.addSubview(launch)
        let window = UIWindow(frame: launch.frame)
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = host
        window.isHidden = false
        defer { window.isHidden = true }
        let search = try XCTUnwrap(descendants(of: launch).compactMap { $0 as? UISearchTextField }.first)
        let orbit = try XCTUnwrap(descendants(of: launch).compactMap { $0 as? ReylumiOrbitView }.first)
        launch.showLoading()
        search.text = "Unsent search"
        XCTAssertTrue(search.becomeFirstResponder())
        launch.finishLoading()
        XCTAssertFalse(launch.isLoading)
        XCTAssertFalse(orbit.isLoading)
        XCTAssertEqual(search.text, "Unsent search")
        XCTAssertEqual(launch.alpha, 1)
        XCTAssertFalse(launch.isHidden)
        search.resignFirstResponder()
        UIView.setAnimationsEnabled(false)
        defer { UIView.setAnimationsEnabled(true) }
        launch.finishLoading()
        XCTAssertEqual(launch.alpha, 0, "Readiness has no minimum branding delay")
    }

    @MainActor
    private func descendants(of view: UIView) -> [UIView] {
        view.subviews.flatMap { [$0] + descendants(of: $0) }
    }
}
