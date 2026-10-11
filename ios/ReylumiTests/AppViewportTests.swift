import XCTest
import UIKit
import WebKit
@testable import Reylumi

final class AppViewportTests: XCTestCase {
    @MainActor
    func testNativePageZoomAndKeyboardLayout() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        let webView = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        webView.stopLoading()
        XCTAssertFalse(webView.configuration.ignoresViewportScaleLimits)
        XCTAssertEqual(webView.pageZoom, 1)
        XCTAssertNotEqual(webView.scrollView.pinchGestureRecognizer?.isEnabled, true)
        XCTAssertFalse(webView.scrollView.bouncesZoom)
        XCTAssertFalse(webView.scrollView.alwaysBounceHorizontal)
        XCTAssertEqual(webView.scrollView.contentInsetAdjustmentBehavior, .never)
        XCTAssertTrue(controller.view.constraints.contains { constraint in
            (constraint.firstItem as? WKWebView) === webView
                && constraint.firstAttribute == .bottom
                && (constraint.secondItem as? UILayoutGuide) === controller.view.keyboardLayoutGuide
                && constraint.secondAttribute == .top
        })
        XCTAssertEqual(webView.configuration.userContentController.userScripts.count, 2)
        for script in webView.configuration.userContentController.userScripts {
            XCTAssertEqual(script.injectionTime, .atDocumentStart)
            XCTAssertTrue(script.isForMainFrameOnly)
        }
    }

    @MainActor
    func testBundledViewportInWebKit() throws {
        let controller = ReylumiViewController()
        controller.loadViewIfNeeded()
        let webView = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        webView.stopLoading()
        controller.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        controller.view.layoutIfNeeded()
        let loaded = expectation(description: "Viewport fixture loaded")
        let navigation = ViewportNavigationDelegate(loaded: loaded)
        webView.navigationDelegate = navigation
        webView.loadHTMLString("""
            <!doctype html><html><head><meta name="viewport" content="width=980">
            <style>body{margin:0}input{font-size:12px}#amount{font-size:36px}</style>
            </head><body><input id="email" type="email"><input id="amount" type="number"></body></html>
            """, baseURL: URL(string: "https://reylumi.com"))
        wait(for: [loaded], timeout: 15)
        controller.webView(webView, didFinish: nil)
        XCTAssertNotEqual(webView.scrollView.pinchGestureRecognizer?.isEnabled, true)
        let checked = expectation(description: "WebKit viewport checked")
        webView.evaluateJavaScript("""
            ({viewport:document.querySelector('meta[name="viewport"]').content,
              scale:visualViewport.scale, width:innerWidth,
              emailFont:getComputedStyle(document.querySelector('#email')).fontSize,
              amountFont:getComputedStyle(document.querySelector('#amount')).fontSize})
            """) { result, error in
            XCTAssertNil(error)
            let values = result as? [String: Any]
            XCTAssertTrue((values?["viewport"] as? String)?.contains("maximum-scale=1, user-scalable=no") == true)
            XCTAssertEqual(values?["scale"] as? Double, 1)
            XCTAssertEqual(values?["width"] as? Int, 375)
            XCTAssertEqual(values?["emailFont"] as? String, "16px")
            XCTAssertEqual(values?["amountFont"] as? String, "36px")
            checked.fulfill()
        }
        wait(for: [checked], timeout: 10)
        withExtendedLifetime(navigation) {}
    }
}

private final class ViewportNavigationDelegate: NSObject, WKNavigationDelegate {
    let loaded: XCTestExpectation
    init(loaded: XCTestExpectation) { self.loaded = loaded }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded.fulfill() }
}
