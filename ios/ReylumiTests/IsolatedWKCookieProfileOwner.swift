import Foundation
import UIKit
import WebKit

// Diagnostic fixture: retain a real, foreground WK owner for the same unique
// persistent profile. The document is constant local HTML with no resources.
// This changes no cookie assertion, transport, authority rule or test budget.
@MainActor
final class IsolatedWKCookieProfileOwner: NSObject, WKNavigationDelegate {
    private let webView: WKWebView
    private let window: UIWindow
    private var continuation: CheckedContinuation<Void, Error>?
    private var timeout: Task<Void, Never>?

    init(store: WKWebsiteDataStore) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store
        configuration.limitsNavigationsToAppBoundDomains = true
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 16, height: 16), configuration: configuration)
        window = UIWindow(frame: CGRect(x: 0, y: 0, width: 16, height: 16))
        super.init()
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        let controller = UIViewController()
        controller.view.addSubview(webView)
        window.rootViewController = controller
        webView.navigationDelegate = self
    }

    func prepare() async throws {
        window.isHidden = false
        try await withCheckedThrowingContinuation { (pending: CheckedContinuation<Void, Error>) in
            continuation = pending
            timeout = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if !Task.isCancelled { self?.finish(URLError(.timedOut)) }
            }
            webView.loadHTMLString("<!doctype html><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'\"><title>Isolated cookie fixture</title>", baseURL: nil)
        }
    }

    private func finish(_ error: Error? = nil) {
        guard let pending = continuation else { return }
        continuation = nil
        timeout?.cancel(); timeout = nil
        if let error { pending.resume(throwing: error) } else { pending.resume() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(error) }

    func close() {
        finish(CancellationError())
        webView.stopLoading(); webView.navigationDelegate = nil
        window.isHidden = true; window.rootViewController = nil
    }
}
