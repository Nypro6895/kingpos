import UIKit
import WebKit
import SafariServices

/// Owns the installed client app. Hosted authentication/payment is deliberately
/// handled by the original HTTPS controller, without replacing the local DOM.
@MainActor
final class ReylumiLocalAppViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, WKDownloadDelegate {
    let bundle: ReylumiLocalBundle
    let transport: ReylumiLocalAppTransport
    private let origin: URL
    private(set) var webView: WKWebView!
    private let launchPanel = ReylumiLaunchView()
    private let startPath: String
    private var pending: [String: (kind: String, task: Task<Void, Never>)] = [:]
    private var foregroundObserver: NSObjectProtocol?
    private var resetObserver: NSObjectProtocol?
    private var pendingNavigation: String?
    private var expectedDocumentNavigation: URL?
    private var documentCommitted = false
    private var downloads: [ObjectIdentifier: URL] = [:]
    private var startupFrameLink: CADisplayLink?
    private var firstFrame: CFTimeInterval?
    private var lastProcessRecovery: Date?
    private lazy var frameTarget = ReylumiLocalFrameTarget(self)
    var onOpenOnline: ((String) -> Void)?
    var onOpenExternal: ((URL) -> Void)?
    var onReady: (() -> Void)?
    #if DEBUG
    var confirmationPresenterForTesting: ((String, @escaping (Bool) -> Void) -> Void)?
    var configureWebViewForTesting: ((WKWebViewConfiguration) -> Void)?
    #endif
    private var reportedReady = false
    private var hostedReturnToken: String?
    private var hostedReturnEpoch: Int?
    var currentPath: String { webView?.url.map { $0.path + ($0.query.map { "?" + $0 } ?? "") } ?? startPath }
    private func reportReady() { if !reportedReady { reportedReady = true; onReady?() } }

    init(bundle: ReylumiLocalBundle, origin: URL = URL(string: "https://reylumi.com")!, startPath: String = "/explore", transport: ReylumiLocalAppTransport? = nil) {
        self.bundle = bundle; self.origin = origin; self.startPath = bundle.routeExists(startPath) ? startPath : "/explore"
        self.transport = transport ?? ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest)
        super.init(nibName: nil, bundle: nil)
        self.transport.diagnostics.record(.controllerCreate)
    }
    required init?(coder: NSCoder) { fatalError("Use init(bundle:)") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        launchPanel.translatesAutoresizingMaskIntoConstraints = false
        launchPanel.onRetry = { [weak self] in if self?.webView == nil { self?.initializeWebContentIfNeeded() } else { self?.loadBundle() } }
        view.addSubview(launchPanel); launchPanel.showLoading()
        NSLayoutConstraint.activate([
            launchPanel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), launchPanel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor), launchPanel.leadingAnchor.constraint(equalTo: view.leadingAnchor), launchPanel.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if hostedReturnToken != nil { webView?.evaluateJavaScript("window.dispatchEvent(new Event('reylumi:app-local-return-visible'))", completionHandler: nil) }
        guard webView == nil, startupFrameLink == nil else { return }
        let link = CADisplayLink(target: frameTarget, selector: #selector(ReylumiLocalFrameTarget.tick(_:)))
        startupFrameLink = link; firstFrame = nil; link.add(to: .main, forMode: .common)
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); startupFrameLink?.invalidate(); startupFrameLink = nil; firstFrame = nil }
    fileprivate func startupFrame(_ link: CADisplayLink) {
        guard webView == nil, viewIfLoaded?.window != nil, UIApplication.shared.applicationState == .active else { return }
        guard let firstFrame else { self.firstFrame = link.targetTimestamp; return }
        if link.timestamp >= firstFrame { initializeWebContentIfNeeded() }
    }
    func initializeWebContentIfNeeded() {
        loadViewIfNeeded()
        guard webView == nil else { return }
        let creationStarted = ProcessInfo.processInfo.systemUptime
        transport.diagnostics.record(.webViewCreateStart, outcome: .started)
        startupFrameLink?.invalidate(); startupFrameLink = nil
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.applicationNameForUserAgent = "ReylumiIOS/1.0"
        configuration.setURLSchemeHandler(ReylumiLocalSchemeHandler(bundle: bundle), forURLScheme: ReylumiLocalBundle.scheme)
        configuration.userContentController.addScriptMessageHandler(ReylumiWeakLocalMessageHandler(self), contentWorld: .page, name: "appLocal")
        configuration.userContentController.add(ReylumiWeakLocalUIHandler(self), name: "reylumi")
        let metadata = (try? JSONSerialization.data(withJSONObject: transport.metadata)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        var script = "window.__reylumiAppLocalContext=\(metadata);\n"
        if transport.diagnostics.isEnabled { script += "window.__reylumiDiagnosticsEnabled=true;\n" }
        for name in ["AppViewport", "AppLocalBridge"] {
            if let url = Bundle.main.url(forResource: name, withExtension: "js"), let resource = try? String(contentsOf: url, encoding: .utf8) { script += resource + "\n" }
        }
        configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #if DEBUG
        configureWebViewForTesting?(configuration)
        #endif
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false; webView.backgroundColor = .white; webView.scrollView.backgroundColor = .white
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        view.insertSubview(webView, belowSubview: launchPanel)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor), webView.leadingAnchor.constraint(equalTo: view.leadingAnchor), webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        transport.onEvent = { [weak self] name, detail in self?.emit(name, detail) }
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.foreground() }
        }
        resetObserver = NotificationCenter.default.addObserver(forName: ReylumiLocalAppTransport.sessionResetNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.transport.reset() }
        }
        transport.diagnostics.record(.webViewCreateEnd, durationMs: (ProcessInfo.processInfo.systemUptime - creationStarted) * 1000)
        loadBundle()
    }
    private func loadBundle(path: String? = nil) {
        let destination = path ?? startPath
        guard let url = URL(string: "\(ReylumiLocalBundle.scheme)://\(ReylumiLocalBundle.host)\(destination)"), bundle.owns(url), bundle.routeExists(url.path) else { return }
        expectedDocumentNavigation = url; documentCommitted = false
        transport.diagnostics.record(.bundleLoad, category: ReylumiLocalDiagnostics.category(path: destination), outcome: .started)
        webView.load(URLRequest(url: url))
    }
    func navigate(_ path: String) {
        guard let url = URL(string: path, relativeTo: URL(string: "reylumi-app://bundle")), bundle.owns(url), bundle.routeExists(url.path) else { return }
        let destination = url.path + (url.query.map { "?" + $0 } ?? "")
        if webView?.isLoading != false { pendingNavigation = destination; return }
        emit("reylumi:app-local-navigate", ["path": destination])
    }
    func foreground() {
        guard webView != nil else { return }
        transport.diagnostics.record(.foreground)
        emit("reylumi:foreground", [:])
        let path = webView.url?.path ?? startPath
        Task { @MainActor [weak self] in _ = try? await self?.transport.freshContext(path: path) }
    }
    func prepareHostedReturn(path: String, context: [String: Any]) async throws {
        guard let webView, let host = context["host"] as? [String: Any], host["nonce"] as? String == transport.nonce,
              let data = try? JSONSerialization.data(withJSONObject: ["context": context, "path": path]),
              let json = String(data: data, encoding: .utf8) else { throw URLError(.cancelled) }
        let token = UUID().uuidString
        hostedReturnToken = token; hostedReturnEpoch = transport.scopeEpoch; launchPanel.showLoading()
        // A covered WKWebView may pause RAF. Keep the bundled public cover
        // until its first visible frame, rather than awaiting a hidden frame.
        _ = try await webView.evaluateJavaScript("""
        (()=>{
          const v=\(json),token='\(token)';
          window.__reylumiHostedReturnCleanup?.();
          window.__reylumiAppLocalContext=v.context.host;
          window.dispatchEvent(new CustomEvent('reylumi:app-local-context',{detail:v.context}));
          window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path:v.path}}));
          window.__reylumiHostedReturn=token;
          let scheduled=false;
          const cleanup=()=>{document.removeEventListener('visibilitychange',visible);window.removeEventListener('reylumi:app-local-return-visible',visible)};
          const visible=()=>{
            if(window.__reylumiHostedReturn!==token){cleanup();return}
            if(document.visibilityState==='hidden'||scheduled)return;
            scheduled=true;
            requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>{
              scheduled=false;
              if(document.visibilityState==='hidden'||window.__reylumiHostedReturn!==token)return;
              cleanup();
              void window.__reylumiAppLocalTransport.request({id:token,kind:'cache',name:'hosted-return-ready',args:{token}}).catch(()=>{});
            },0)));
          };
          window.__reylumiHostedReturnCleanup=cleanup;
          document.addEventListener('visibilitychange',visible);
          window.addEventListener('reylumi:app-local-return-visible',visible);
          return true;
        })()
        """)
    }
    private func emit(_ name: String, _ detail: [String: Any]) {
        guard webView != nil, let data = try? JSONSerialization.data(withJSONObject: ["name": name, "detail": detail]), let json = String(data: data, encoding: .utf8) else { return }
        // Context promises and DOM events travel on separate WebKit queues.
        // A late old event must never restore an obsolete nonce/authority.
        webView.evaluateJavaScript("(()=>{const e=\(json);const host=e.name==='reylumi:app-local-reset'?e.detail:e.detail.host;if(host&&host.scopeEpoch<window.__reylumiAppLocalContext?.scopeEpoch)return;if(e.name==='reylumi:app-local-reset')window.__reylumiAppLocalContext=e.detail;if(e.name==='reylumi:app-local-context'&&e.detail.host)window.__reylumiAppLocalContext=e.detail.host;window.dispatchEvent(new CustomEvent(e.name,{detail:e.detail}));})()", completionHandler: nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, bundle.owns(url),
              let body = message.body as? [String: Any], body["version"] as? Int == 1,
              body["nonce"] as? String == transport.nonce, body["scopeEpoch"] as? Int == transport.scopeEpoch,
              let id = body["id"] as? String, UUID(uuidString: id) != nil, let kind = body["kind"] as? String,
              pending[id] == nil, pending.count < 100 else { replyHandler(["__hostError": ["status": 403, "message": "App request is not available."]], nil); return }
        let name = body["name"] as? String ?? "", args = body["args"] as? [String: Any] ?? [:]
        if kind == "cache", name == "hosted-return-ready" {
            guard let token = args["token"] as? String, token == hostedReturnToken, hostedReturnEpoch == transport.scopeEpoch else { replyHandler(["ok": false], nil); return }
            hostedReturnToken = nil; hostedReturnEpoch = nil; launchPanel.finishLoading(); replyHandler(["ok": true], nil); return
        }
        if kind == "cache", name == "ready" { transport.diagnostics.record(.surfaceReady); launchPanel.finishLoading(); reportReady(); replyHandler(["ok": true], nil); return }
        if kind == "cache", name == "cancel", let target = args["requestId"] as? String {
            if let operation = pending[target], operation.kind == "read" || operation.kind == "context" { operation.task.cancel() }
            replyHandler(["ok": true], nil); return
        }
        let epoch = transport.scopeEpoch
        let task = Task { @MainActor [weak self] in
            guard let self else { replyHandler(nil, "App view closed."); return }
            defer { self.pending[id] = nil }
            do {
                let result: Any
                var acknowledgedLogout = false
                switch kind {
                case "context":
                    let path = args["path"] as? String ?? self.webView.url?.path ?? self.startPath
                    guard let parsed = URL(string: path, relativeTo: URL(string: "reylumi-app://bundle")), self.bundle.owns(parsed), self.bundle.routeExists(parsed.path) else { throw NSError(domain: "ReylumiLocalApp", code: 400) }
                    if args["fresh"] as? Bool == true { result = try await self.transport.freshContext(path: parsed.path) }
                    else { result = try await self.transport.context(path: parsed.path) }
                case "read":
                    var original = args; original.removeValue(forKey: "etag"); original.removeValue(forKey: "scope")
                    result = try await self.transport.read(name: name, args: original, etag: body["etag"] as? String ?? args["etag"] as? String, requestedScope: args["scope"] as? String)
                case "command":
                    var original = args; original.removeValue(forKey: "scope")
                    let reply = try await self.transport.command(name: name, args: original, requestID: id, path: self.webView.url?.path ?? self.startPath, requestedScope: args["scope"] as? String)
                    guard reply["ok"] as? Bool == true else { throw NSError(domain: "ReylumiLocalApp", code: 400, userInfo: [NSLocalizedDescriptionKey: reply["error"] as? String ?? "The change could not be confirmed."]) }
                    if name == "shell.logout", var wire = reply["data"] as? [String: Any], let status = wire["status"] as? Int, (200..<300).contains(status) {
                        // Clear encrypted display authority before delivering a
                        // successful logout, even if the next context GET fails.
                        // Existing JS receipt drafts/outbox are never touched.
                        await self.transport.reset(reason: .signOut)
                        wire["signedOut"] = true; wire["host"] = self.transport.metadata
                        result = wire; acknowledgedLogout = true
                    } else { result = reply["data"] ?? NSNull() }
                case "cache":
                    if name == "portable.lock" { await self.transport.lockPortable(); result = ["ok": true]; break }
                    if name == "background.register" {
                        let registration = try await self.transport.backgroundRegistration(args)
                        await ReylumiBackgroundSync.shared.register(registration); result = ["ok": true]; break
                    }
                    if name == "background.drain" {
                        guard let scope = args["scope"] as? String, await self.transport.matchesCachedScope(scope) else { throw NSError(domain: "ReylumiLocalApp", code: 403) }
                        _ = try await self.transport.freshContext(path: self.webView.url?.path ?? self.startPath)
                        guard self.transport.backgroundDrainAllowed(scope) else { throw NSError(domain: "ReylumiLocalApp", code: 403) }
                        let snapshots = await ReylumiBackgroundSync.shared.drain(scope: scope)
                        guard self.transport.scopeEpoch == epoch else { throw CancellationError() }
                        self.emit("reylumi:native-snapshots", ["scope": scope, "snapshots": snapshots]); result = ["ok": true]; break
                    }
                    if let scope = args["scope"] as? String, !scope.isEmpty {
                        let allowed: Bool
                        if args["op"] as? String == "remove" { allowed = await self.transport.matchesCacheRemovalScope(scope) }
                        else { allowed = await self.transport.matchesCachedScope(scope) }
                        guard allowed else { throw NSError(domain: "ReylumiLocalApp", code: 403) }
                    }
                    let original = args["arguments"] as? [String: Any] ?? [:]
                    if args["op"] as? String == "get" { result = (try await self.transport.cached(name: name, args: original, requestedScope: args["scope"] as? String)) as Any? ?? NSNull() }
                    else if args["op"] as? String == "remove" { try await self.transport.removeCached(name: name, args: original, requestedScope: args["scope"] as? String); result = ["ok": true] }
                    else { throw NSError(domain: "ReylumiLocalApp", code: 400) }
                case "online":
                    guard let path = args["path"] as? String, path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("\\"), path.utf8.count <= 8192 else { throw NSError(domain: "ReylumiLocalApp", code: 400) }
                    self.onOpenOnline?(path); result = ["ok": true]
                default: throw NSError(domain: "ReylumiLocalApp", code: 400)
                }
                guard kind == "context" || acknowledgedLogout || kind == "cache" && name == "portable.lock" || self.transport.scopeEpoch == epoch, !Task.isCancelled else { throw CancellationError() }
                replyHandler(result, nil)
            } catch {
                let cancelled = error is CancellationError || (error as NSError).code == NSURLErrorCancelled
                let message = cancelled ? (kind == "command" ? "The result could not be confirmed. Check the latest record before making another change." : "This request was superseded. Please try again.") : error.localizedDescription
                // Failed read/context association remains native-only. Do not
                // wrap/reclassify errors to add diagnostic IDs to this bridge.
                let reason = (error as NSError).userInfo["reason"] as? String
                replyHandler(["__hostError": ["status": cancelled ? NSURLErrorCancelled : (error as NSError).code, "message": message, "reason": cancelled ? "cancelled" : reason == "stale-scope" ? "stale-scope" : "unknown"]], nil)
            }
        }
        pending[id] = (kind, task)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if bundle.owns(url) {
            if action.shouldPerformDownload { decisionHandler(.download); return }
            if action.targetFrame?.isMainFrame == true {
                if expectedDocumentNavigation == url { expectedDocumentNavigation = nil; decisionHandler(.allow); return }
                if action.navigationType == .backForward, bundle.routeExists(url.path), (action.request.httpMethod ?? "GET") == "GET" {
                    // Let WebKit restore its real history item/popstate instead
                    // of converting Back into a fresh pushState navigation.
                    decisionHandler(.allow); return
                }
                if documentCommitted, action.sourceFrame.isMainFrame, let source = action.sourceFrame.request.url, bundle.owns(source) {
                    decisionHandler(.cancel)
                    let path = url.path + (url.query.map { "?" + $0 } ?? "") + (url.fragment.map { "#" + $0 } ?? "")
                    if bundle.routeExists(url.path) { emit("reylumi:app-local-navigate", ["path": path]) }
                    else if !NavigationPolicy(origin: origin).isExcluded(origin.appendingPathComponent(url.path)) { onOpenOnline?(path) }
                    return
                }
            }
            decisionHandler(.allow); return
        }
        if url.absoluteString.hasPrefix("blob:reylumi-app://bundle/") || url.absoluteString == "about:blank" { decisionHandler(action.shouldPerformDownload ? .download : .allow); return }
        decisionHandler(.cancel)
        let policy = NavigationPolicy(origin: origin)
        let installedSource = action.sourceFrame.isMainFrame && action.sourceFrame.request.url.map(bundle.owns) == true
        guard action.targetFrame?.isMainFrame != false, (action.navigationType == .linkActivated || installedSource), !policy.isExcluded(url), policy.isExternalAllowed(url), presentedViewController == nil else { return }
        if policy.isInternal(url) { onOpenOnline?(url.path + (url.query.map { "?" + $0 } ?? "")) }
        else if let onOpenExternal { onOpenExternal(url) }
        else if policy.isSafariPayment(url) || url.scheme != "https" { UIApplication.shared.open(url) }
        else { present(SFSafariViewController(url: url), animated: true) }
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { transport.diagnostics.record(.documentCommit); documentCommitted = true }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        transport.diagnostics.record(.documentFinish)
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        launchPanel.finishLoading()
        reportReady()
        if let path = pendingNavigation { pendingNavigation = nil; navigate(path) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { if (error as NSError).code != NSURLErrorCancelled { transport.diagnostics.record(.navigationFailure, outcome: .failed, status: (error as NSError).code); launchPanel.showError() } }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { self.webView(webView, didFail: navigation, withError: error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        transport.diagnostics.record(.processTermination, outcome: .invalidated)
        let path = webView.url.map { $0.path + ($0.query.map { "?" + $0 } ?? "") } ?? startPath
        for operation in pending.values where operation.kind != "command" { operation.task.cancel() }
        transport.invalidatePage()
        webView.configuration.userContentController.removeAllUserScripts()
        let metadata = (try? JSONSerialization.data(withJSONObject: transport.metadata)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        var script = "window.__reylumiAppLocalContext=\(metadata);\n"
        if transport.diagnostics.isEnabled { script += "window.__reylumiDiagnosticsEnabled=true;\n" }
        for name in ["AppViewport", "AppLocalBridge"] { if let url = Bundle.main.url(forResource: name, withExtension: "js"), let resource = try? String(contentsOf: url, encoding: .utf8) { script += resource + "\n" } }
        webView.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        guard lastProcessRecovery.map({ Date().timeIntervalSince($0) >= 60 }) ?? true else { launchPanel.showError(); return }
        lastProcessRecovery = Date()
        loadBundle(path: path)
    }
    fileprivate func nativeUI(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, bundle.owns(url),
              let value = message.body as? [String: Any], presentedViewController == nil else { return }
        switch value["action"] as? String {
        case "diagnostics-export":
            shareDiagnosticReport(javascript: value["entries"])
        case "print":
            let controller = UIPrintInteractionController.shared
            controller.printFormatter = webView.viewPrintFormatter(); controller.present(animated: true, completionHandler: nil)
        case "share":
            guard let text = value["text"] as? String, text.utf8.count <= 64000 else { return }
            let controller = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            controller.popoverPresentationController?.sourceView = view
            controller.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            present(controller, animated: true)
        case "open-payment":
            guard let text = value["url"] as? String, let url = URL(string: text), NavigationPolicy(origin: origin).isSafariPayment(url) else { return }
            UIApplication.shared.open(url)
        case "open-market-website": UIApplication.shared.open(origin.appendingPathComponent("market"))
        case "offline-clear": Task { @MainActor in await transport.reset() }
        default: break
        }
    }
    private func shareDiagnosticReport(javascript: Any?) {
        guard transport.diagnostics.isEnabled, presentedViewController == nil else { return }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Reylumi-diagnostics-" + UUID().uuidString, isDirectory: true)
        do {
            let report = try transport.diagnostics.report(javascript: javascript,
                appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "", bundleBuild: bundle.manifest.buildId)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            let file = directory.appendingPathComponent("Reylumi-diagnostics.json")
            try report.write(to: file, options: [.atomic, .completeFileProtection])
            let controller = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            controller.popoverPresentationController?.sourceView = view
            controller.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            controller.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: directory) }
            // No automatic upload: the user chooses Save to Files or a share target.
            present(controller, animated: true)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            let notice = UIAlertController(title: "Reylumi", message: "The diagnostic report could not be saved. Please try again.", preferredStyle: .alert)
            notice.addAction(UIAlertAction(title: "OK", style: .default))
            present(notice, animated: true)
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard frame.isMainFrame, let url = frame.request.url, bundle.owns(url), presentedViewController == nil else { completionHandler(); return }
        let controller = UIAlertController(title: "Reylumi", message: message, preferredStyle: .alert)
        controller.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }); present(controller, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame, let url = frame.request.url, bundle.owns(url), presentedViewController == nil else { completionHandler(false); return }
        #if DEBUG
        if let presenter = confirmationPresenterForTesting { presenter(message, completionHandler); return }
        #endif
        let controller = UIAlertController(title: "Reylumi", message: message, preferredStyle: .alert)
        controller.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        controller.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(controller, animated: true)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let name = (suggestedFilename as NSString).lastPathComponent
            let destination = directory.appendingPathComponent(name.isEmpty ? "Reylumi-export" : name)
            downloads[ObjectIdentifier(download)] = destination; completionHandler(destination)
        } catch { completionHandler(nil) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)), presentedViewController == nil else { return }
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.popoverPresentationController?.sourceView = view
        controller.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(controller, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { downloads.removeValue(forKey: ObjectIdentifier(download)) }
    deinit {
        startupFrameLink?.invalidate()
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
        if let resetObserver { NotificationCenter.default.removeObserver(resetObserver) }
    }
}

@MainActor
private final class ReylumiLocalFrameTarget: NSObject {
    weak var controller: ReylumiLocalAppViewController?
    init(_ controller: ReylumiLocalAppViewController) { self.controller = controller }
    @objc func tick(_ link: CADisplayLink) { controller?.startupFrame(link) }
}

@MainActor
final class ReylumiAppContainer: UIViewController {
    private let origin: URL
    private let installedBundle: ReylumiLocalBundle?
    private let offlineRoutes: ReylumiOfflineRouteStore
    private let localTransport: ReylumiLocalAppTransport?
    private(set) var local: ReylumiLocalAppViewController?
    private var hosted: ReylumiViewController?
    private var handoffTask: Task<Void, Never>?
    private var handoffID: UUID?
    private var marketReturnSequence = 0
    init(origin: URL = URL(string: "https://reylumi.com")!, bundle: ReylumiLocalBundle? = nil, offlineRoutes: ReylumiOfflineRouteStore? = nil, transport: ReylumiLocalAppTransport? = nil) {
        self.origin = origin; self.installedBundle = bundle; self.offlineRoutes = offlineRoutes ?? ReylumiOfflineRouteStore(origin: origin); self.localTransport = transport
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(origin:)") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .white
        if let bundle = installedBundle ?? (try? ReylumiLocalBundle.installed()), bundle.manifest.productionReady == true {
            // A new process starts at the role home. Foreground resumes this
            // controller in place; explicit auth/payment returns keep their path.
            let hint = "/"
            let controller = ReylumiLocalAppViewController(bundle: bundle, origin: origin, startPath: hint, transport: localTransport)
            local = controller; controller.onOpenOnline = { [weak self] path in self?.openOnline(path) }
            embed(controller)
        } else { let controller = ReylumiViewController(origin: origin); hosted = controller; embed(controller) }
    }
    private func embed(_ controller: UIViewController) {
        addChild(controller); controller.view.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(controller.view)
        NSLayoutConstraint.activate([controller.view.topAnchor.constraint(equalTo: view.topAnchor), controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor), controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        controller.didMove(toParent: self)
    }
    func openOnline(_ path: String) {
        guard presentedViewController == nil, let url = URL(string: path, relativeTo: origin)?.absoluteURL,
              NavigationPolicy(origin: origin).isInternal(url), !NavigationPolicy(origin: origin).isExcluded(url) else { return }
        let controller = ReylumiViewController(origin: origin, initialURL: url)
        controller.onUsableDestination = { [weak self, weak controller] url in
            guard let self, let controller, let destination = self.local?.bundle.hostedReturnPath(url, origin: self.origin) else { return }
            self.returnToInstalledApp(path: destination, from: controller)
        }
        let navigation = UINavigationController(rootViewController: controller)
        controller.navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(closeOnline))
        navigation.modalPresentationStyle = .fullScreen
        present(navigation, animated: true)
    }
    @objc private func closeOnline() {
        guard let controller = (presentedViewController as? UINavigationController)?.viewControllers.first as? ReylumiViewController, let local else { return }
        returnToInstalledApp(path: local.currentPath, from: controller)
    }
    func returnToInstalledApp(path: String, from controller: ReylumiViewController) {
        guard let local, let navigation = presentedViewController as? UINavigationController,
              navigation.viewControllers.first === controller else { return }
        let identity = controller.hostedNavigationIdentity, id = UUID()
        handoffTask?.cancel(); handoffID = id
        handoffTask = Task { @MainActor [weak self, weak controller, weak navigation] in
            guard let self else { return }
            defer { if self.handoffID == id { self.handoffTask = nil; self.handoffID = nil } }
            do {
                let contextPath = URLComponents(string: path)?.path ?? path
                let value = try await local.transport.freshContext(path: contextPath)
                guard let context = value["context"] as? [String: Any], context["scope"] as? String != nil,
                      self.handoffID == id, !Task.isCancelled,
                      value["offline"] as? Bool == false, let checked = value["onlineValidatedAt"] as? Double,
                      abs(Date().timeIntervalSince1970 * 1000 - checked) <= 30000,
                      context["authenticated"] as? Bool == true || ReylumiOfflineRoute.publicPaths.contains(path) || path == "/help" || path.hasPrefix("/help/") || ["/legal", "/terms", "/privacy", "/community", "/business-terms"].contains(path) || ReylumiLocalSession.verified(value, generation: local.transport.generation)?.compatible(path: path) == true,
                      let controller, let navigation, self.presentedViewController === navigation,
                      controller.hostedNavigationIdentity == identity else { return }
                guard try await controller.permitsHostedReturn() else { return }
                try await local.prepareHostedReturn(path: path, context: value)
                guard self.handoffID == id, !Task.isCancelled, self.presentedViewController === navigation, controller.hostedNavigationIdentity == identity,
                      try await controller.permitsHostedReturn() else { return }
                self.dismiss(animated: true)
            } catch { /* Keep the working hosted flow visible when verification fails. */ }
        }
    }
    func returnToMarket(sequence: Int) {
        guard sequence > marketReturnSequence else { return }; marketReturnSequence = sequence
        loadViewIfNeeded()
        if let local { if presentedViewController != nil { dismiss(animated: true) }; local.navigate("/market") }
        else { hosted?.returnToMarket(sequence: sequence) }
    }
}

@MainActor
private final class ReylumiWeakLocalMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var delegate: ReylumiLocalAppViewController?
    init(_ delegate: ReylumiLocalAppViewController) { self.delegate = delegate }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let delegate else { replyHandler(nil, "App view closed."); return }
        delegate.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}

@MainActor
private final class ReylumiWeakLocalUIHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: ReylumiLocalAppViewController?
    init(_ delegate: ReylumiLocalAppViewController) { self.delegate = delegate }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { delegate?.nativeUI(message) }
}
