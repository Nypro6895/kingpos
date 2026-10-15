import XCTest
import UIKit
import WebKit
@testable import Reylumi

final class SecurityChallengeWebViewTests: XCTestCase {
    @MainActor
    func testProviderDocumentIsVisibleAtCommitWithoutAppReadinessOrDidFinish() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        let webView = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        let launch = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? ReylumiLaunchView }.first)
        webView.stopLoading()
        let loaded = expectation(description: "Provider fixture rendered")
        let delegate = ChallengeFixtureDelegate(controller: controller, launch: launch, loaded: loaded)
        webView.navigationDelegate = delegate
        // Supply the response at the policy boundary so this test requires no
        // live firewall, credentials, challenge solution or account creation.
        // The actual document still loads and executes in the app's WKWebView.
        delegate.expectedNavigation = webView.loadHTMLString("""
            <!doctype html><html><head><meta name="viewport" content="width=device-width"></head>
            <body><h1>Security check fixture</h1>
            <button id="action" onclick="document.getElementById('result').textContent='Responding'">Continue</button>
            <output id="result"></output></body></html>
            """, baseURL: URL(string: "https://reylumi.com/security-check"))
        wait(for: [loaded], timeout: 15)
        XCTAssertTrue(delegate.revealedAtCommit, "Provider UI must be revealed before window load completes")
        XCTAssertEqual(launch.alpha, 0, accuracy: 0.001)
        let interactive = expectation(description: "Provider fixture accepts interaction")
        webView.evaluateJavaScript("document.getElementById('action').click(); document.getElementById('result').textContent") { result, error in
            XCTAssertNil(error)
            XCTAssertEqual(result as? String, "Responding")
            interactive.fulfill()
        }
        wait(for: [interactive], timeout: 10)
        webView.stopLoading()
        withExtendedLifetime(delegate) {}
    }

    @MainActor
    func testOrdinaryErrorStillCancelsAndCannotRevealThroughLateCompletion() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        let webView = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        let launch = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? ReylumiLaunchView }.first)
        webView.stopLoading()
        controller.webView(webView, didStartProvisionalNavigation: nil)
        let response = HTTPURLResponse(url: URL(string: "https://reylumi.com/security-check")!, statusCode: 429, httpVersion: nil, headerFields: ["Content-Type": "text/html"])!
        XCTAssertEqual(controller.navigationResponsePolicy(for: response, isForMainFrame: true, canShowMIMEType: true), .cancel)
        controller.webView(webView, didFinish: nil)
        XCTAssertEqual(launch.alpha, 1, accuracy: 0.001)
        XCTAssertFalse(launch.isHidden)
    }
}

@MainActor
private final class ChallengeFixtureDelegate: NSObject, WKNavigationDelegate {
    let controller: ReylumiViewController
    let launch: ReylumiLaunchView
    let loaded: XCTestExpectation
    var expectedNavigation: WKNavigation?
    var revealedAtCommit = false

    init(controller: ReylumiViewController, launch: ReylumiLaunchView, loaded: XCTestExpectation) {
        self.controller = controller
        self.launch = launch
        self.loaded = loaded
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard navigation === expectedNavigation else { return }
        controller.webView(webView, didStartProvisionalNavigation: navigation)
        let response = HTTPURLResponse(url: URL(string: "https://reylumi.com/security-check")!, statusCode: 429, httpVersion: nil, headerFields: ["Content-Type": "text/html", "x-vercel-mitigated": "challenge"])!
        XCTAssertEqual(controller.navigationResponsePolicy(for: response, isForMainFrame: true, canShowMIMEType: true), .allow)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard navigation === expectedNavigation else { return }
        controller.webView(webView, didCommit: navigation)
        revealedAtCommit = launch.alpha == 0
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard navigation === expectedNavigation else { return }
        // Deliberately omit the controller's didFinish fallback. Its overlay
        // must already have been removed for this provider-owned document.
        loaded.fulfill()
    }
}
