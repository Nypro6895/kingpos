import UIKit
import WebKit

/// Exercises the final web React/auth/cache implementation inside iOS WebKit.
/// The fixture's transport is fully simulated; no business API is written.
@MainActor
final class ReloadLoopWebKitTests: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private var window: UIWindow!
    private var hasLoadedFixture = false
    private let fixtureURL = URL(string: "http://127.0.0.1:8765/wkwebview-fixture.html")!

    func testFinalWebScopeInIPhoneWebKit() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.applicationNameForUserAgent = "ReylumiIOS/1.0"
        configuration.ignoresViewportScaleLimits = false
        configuration.userContentController.add(self, name: "reylumi")
        for resource in ["AppViewport", "NativeBridge"] {
            let url = try XCTUnwrap(Bundle.main.url(forResource: resource, withExtension: "js"))
            configuration.userContentController.addUserScript(WKUserScript(source: try String(contentsOf: url, encoding: .utf8), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        configuration.userContentController.addUserScript(WKUserScript(source: "window.fixtureErrors=[];window.addEventListener('error',e=>window.fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.fixtureErrors.push(String(e.reason)));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        web.navigationDelegate = self
        let host = UIViewController()
        host.view.addSubview(web)
        window = UIWindow(frame: web.frame)
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = host
        window.isHidden = false
        defer {
            web.stopLoading()
            configuration.userContentController.removeScriptMessageHandler(forName: "reylumi")
            window.isHidden = true
        }

        try await openFixture(clearStorage: false)
        _ = try await js("sessionStorage.clear();document.querySelector('[aria-label=Draft]').value='unsaved edit';window.originalContent=document.querySelector('[data-content]');document.querySelector('[data-scroll]').scrollTop=345;window.nativeSoak=setInterval(()=>{void window.requestSearch();void window.requestFeed('events')},2500);true")
        try await Task.sleep(nanoseconds: 15_000_000_000)
        _ = try await js("clearInterval(window.nativeSoak);true")
        try await check("window.diag.requests.filter(r=>r.action==='salon-love').length===1", "Favorite read must not restart its own effect")
        try await check("window.diag.requests.filter(r=>r.action==='campaign-prompt').length===1", "Campaign timer must run once")
        try await check("window.diag.effectCleanups===0&&window.diag.mutations===0&&window.diag.reloads===0", "Passive work must not reload or hide the route")
        try await assertRetained()

        _ = try await js("document.querySelector('button[aria-label=\"Love Fixture Salon\"]').click();true")
        try await until("document.querySelector('[data-resource]')?.textContent==='2'")
        try await check("window.diag.mutations===1&&window.diag.effectCleanups===0&&window.diag.reloads===0", "A real data mutation refreshes data without hiding the route")
        try await assertRetained()

        _ = try await js("window.contextStatus=503;void window.writeData();true")
        try await until("document.querySelector('[data-resource]')?.textContent==='3'")
        try await Task.sleep(nanoseconds: 500_000_000)
        try await check("window.diag.effectCleanups===0&&window.diag.reloads===0", "Temporary background auth error must not flicker or reload")
        try await assertRetained()
        _ = try await js("window.contextStatus=200;window.dispatchEvent(new Event('online'));true")
        try await Task.sleep(nanoseconds: 300_000_000)

        // A confirmed identity/grant change hides the existing account before recovery.
        _ = try await js("window.serverContext={...window.currentContext,scope:'revoked-grants',permissionRevision:'revoked'};window.dispatchEvent(new Event('reylumi:experience-scope-changed'));true")
        try await until("window.diag.reloads===1")
        try await check("document.querySelector('[data-content]')?.getClientRects().length===0", "Confirmed identity change must hide retained private DOM")
        print("RELOAD_FIX_NATIVE_FIRST_DOCUMENT " + String(describing: try await js("JSON.stringify(window.diag)")))

        // A new document in the same WebView retains the automatic reload budget.
        try await openFixture(clearStorage: false)
        _ = try await js("window.serverContext={...window.currentContext,scope:'revoked-grants',permissionRevision:'revoked'};window.dispatchEvent(new Event('reylumi:experience-scope-changed'));true")
        try await until("Array.from(document.querySelectorAll('p[role=status]')).some(p=>p.textContent==='Your access has changed. Reload to continue.'&&p.getClientRects().length>0)")
        try await check("window.diag.reloads===0&&document.querySelector('[data-content]')?.getClientRects().length===0", "Repeated invalid identity must remain blocked without an automatic reload loop")
        _ = try await js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reload').click();true")
        try await check("window.diag.reloads===1", "Explicit user reload remains available after the cap")

        // Storage failure must fail closed instead of allowing an unbounded reload.
        try await openFixture(clearStorage: true)
        _ = try await js("Object.defineProperty(window,'sessionStorage',{configurable:true,get(){throw new Error('Storage unavailable')}});window.serverContext={...window.currentContext,scope:'revoked-grants',permissionRevision:'revoked'};window.dispatchEvent(new Event('reylumi:experience-scope-changed'));true")
        try await until("Array.from(document.querySelectorAll('p[role=status]')).some(p=>p.textContent==='Your access has changed. Reload to continue.'&&p.getClientRects().length>0)")
        try await check("window.diag.reloads===0&&document.querySelector('[data-content]')?.getClientRects().length===0", "Storage failure cannot permit repeated automatic navigation")
        try await check("window.fixtureErrors.length===0", "Fixture has no JavaScript runtime errors")
        print("RELOAD_FIX_NATIVE_RESULT passed; actual iOS Simulator WKWebView; 15s passive traffic, mutation retention, 503, identity blocking, reload budget, manual reload, unavailable storage")
    }

    private func openFixture(clearStorage: Bool) async throws {
        if clearStorage { _ = try await js("sessionStorage.clear();true") }
        if hasLoadedFixture {
            try await check("window.fixtureErrors.length===0", "Each fixture document has no JavaScript runtime errors")
            _ = try? await js("window.ready=false;true")
        }
        web.load(URLRequest(url: fixtureURL))
        hasLoadedFixture = true
        try await until("window.ready===true&&document.querySelector('[data-content]')?.getClientRects().length>0", timeout: 30)
    }

    private func assertRetained() async throws {
        try await check("document.querySelector('[data-content]')===window.originalContent&&window.originalContent.getClientRects().length>0", "The same live DOM remains visible")
        try await check("document.querySelector('[aria-label=Draft]').value==='unsaved edit'", "Unsaved form input is retained")
        try await check("document.querySelector('[data-scroll]').scrollTop===345", "Reading position is retained")
    }

    private func check(_ expression: String, _ message: String) async throws {
        let result = try await js("Boolean(\(expression))")
        guard result as? Bool == true else { throw NSError(domain: "ReloadFixtureAssertion", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }

    private func until(_ expression: String, timeout: TimeInterval = 15) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if (try? await js("Boolean(\(expression))")) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let diagnostics = try? await js("JSON.stringify({url:location.href,ready:window.ready,errors:window.fixtureErrors,diag:window.diag,text:document.body?.textContent?.slice(0,500)})")
        print("Timed out: \(expression); \(String(describing: diagnostics))")
        throw NSError(domain: "ReloadLoopFixture", code: 1)
    }

    private func js(_ script: String) async throws -> Any {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any, Error>) in
            var completed = false
            let timeout = DispatchWorkItem {
                guard !completed else { return }
                completed = true
                continuation.resume(throwing: NSError(domain: "ReloadLoopJavaScriptTimeout", code: 1, userInfo: [NSLocalizedDescriptionKey: "WebKit did not finish evaluating: " + String(script.prefix(160))]))
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
            web.evaluateJavaScript(script) { result, error in
                guard !completed else { return }
                completed = true
                timeout.cancel()
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: result ?? NSNull()) }
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.host == "127.0.0.1" ? .allow : .cancel)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {}
}

func XCTUnwrap<T>(_ value: T?) throws -> T {
    guard let value else { throw NSError(domain: "FixtureMissingResource", code: 1) }
    return value
}

@main
@MainActor
final class FixtureAppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var harness: ReloadLoopWebKitTests?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("RELOAD_FIX_NATIVE_DIRECT_STARTED " + UIDevice.current.systemVersion)
        let runner = ReloadLoopWebKitTests()
        harness = runner
        Task { @MainActor in
            var result: [String: Any] = ["engine": "iOS Simulator WKWebView", "iOS": UIDevice.current.systemVersion, "device": UIDevice.current.model, "debugger": false, "transport": "simulated", "nativeAppSourceChanged": false, "runToken": ProcessInfo.processInfo.environment["RELOAD_FIX_TOKEN"] ?? "missing"]
            do {
                try await runner.testFinalWebScopeInIPhoneWebKit()
                result["status"] = "passed"
            } catch {
                result["status"] = "failed"
                result["error"] = String(describing: error)
                print("RELOAD_FIX_NATIVE_DIRECT_FAILED " + String(describing: error))
            }
            let data = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("result.json")
            try! data.write(to: url, options: .atomic)
            print("RELOAD_FIX_NATIVE_DIRECT_RESULT " + String(data: data, encoding: .utf8)!)
        }
        return true
    }
}
