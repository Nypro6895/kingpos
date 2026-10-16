import UIKit
import WebKit
import SafariServices

final class ReylumiViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    private var marketReturnSequence = 0
    func returnToMarket(sequence: Int) {
        guard sequence > marketReturnSequence else { return }
        marketReturnSequence = sequence
        loadViewIfNeeded()
        openPublicDestination("/market")
    }
    private var webView: WKWebView!
    private var startupDisplayLink: CADisplayLink?
    private var firstPresentedFrame: CFTimeInterval?
    private lazy var startupFrameTarget = ReylumiStartupFrameTarget(self)
    private var progress = UIProgressView(progressViewStyle: .bar)
    private var progressObservation: NSKeyValueObservation?
    private var downloads: [ObjectIdentifier: URL] = [:]
    private let launchPanel = ReylumiLaunchView()
    private var startup = ReylumiStartupState()
    private var hasLoadedPage: Bool { startup.hasUsablePage }
    private var activeNavigation: WKNavigation?
    private var retiredNavigations: [WKNavigation] = []
    private var pendingRequest: URLRequest?
    var queuedStartupURL: URL? { webView == nil ? pendingRequest?.url : nil }
    private var navigationWatchdog: DispatchWorkItem?
    private let connectionNotice = UIStackView()
    private let connectionMessage = UILabel()
    private let connectionRetry = UIButton(type: .system)
    private let policy: NavigationPolicy
    private let offlineRoutes: ReylumiOfflineRouteStore
    private let initialURL: URL?
    private var offlineEpoch = 0
    var onUsableDestination: ((URL) -> Void)?
    private var notifiedDestination: String?
    var hostedNavigationIdentity: String { startup.nonce + "|" + (webView?.url?.absoluteString ?? "") }
    private func notifyUsableDestination() {
        guard startup.didCommit, startup.hasUsablePage, !startup.isWaiting, !startup.isSecurityChallenge,
              let url = webView?.url, policy.isInternal(url), !policy.isExcluded(url),
              notifiedDestination != hostedNavigationIdentity else { return }
        notifiedDestination = hostedNavigationIdentity
        onUsableDestination?(url)
    }
    func permitsHostedReturn() async throws -> Bool {
        guard let webView else { return false }
        // A visitor may start typing while fresh access is being checked.
        // Keep that hosted editor rather than dismissing its unsent input.
        return try await webView.evaluateJavaScript("(()=>{const e=document.activeElement;return !(e&&e.getClientRects().length&&(e.matches('input:not([type=button]):not([type=submit]):not([type=reset]),textarea')||e.isContentEditable))})()") as? Bool == true
    }

    init(origin: URL? = nil, offlineRoutes: ReylumiOfflineRouteStore? = nil, initialURL: URL? = nil) {
        let origin = origin ?? URL(string: Bundle.main.object(forInfoDictionaryKey: "ReylumiServerURL") as? String ?? "https://reylumi.com")!
        self.policy = NavigationPolicy(origin: origin)
        self.offlineRoutes = offlineRoutes ?? ReylumiOfflineRouteStore(origin: origin)
        self.initialURL = initialURL.flatMap { NavigationPolicy(origin: origin).isInternal($0) && !NavigationPolicy(origin: origin).isExcluded($0) ? $0 : nil }
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("Use init(origin:offlineRoutes:)") }

    override func viewDidLoad() {
        super.viewDidLoad()
        NotificationCenter.default.addObserver(self, selector: #selector(paymentForeground), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(cancelPendingWebStartup), name: UIApplication.willResignActiveNotification, object: nil)
        overrideUserInterfaceStyle = .light
        view.backgroundColor = .white
        launchPanel.translatesAutoresizingMaskIntoConstraints = false
        launchPanel.onRetry = { [weak self] in self?.retryLoad() }
        launchPanel.onNavigate = { [weak self] path, query in self?.openPublicDestination(path, query: query) }
        launchPanel.onEditingFinished = { [weak self] in
            guard let self, self.startup.hasUsablePage, !self.startup.isWaiting else { return }
            self.launchPanel.finishLoading()
        }
        view.addSubview(launchPanel)
        NSLayoutConstraint.activate([
            launchPanel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            launchPanel.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            launchPanel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            launchPanel.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        launchPanel.showLoading()
        configureConnectionNotice()
        let path = offlineRoutes.restored()?.path ?? "/explore"
        loadRequest(URLRequest(url: initialURL ?? policy.origin.appendingPathComponent(String(path.dropFirst())), cachePolicy: .useProtocolCachePolicy, timeoutInterval: 15))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        scheduleWebStartupAfterFirstFrame()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        cancelPendingWebStartup()
    }

    private func scheduleWebStartupAfterFirstFrame() {
        guard webView == nil, startupDisplayLink == nil, viewIfLoaded?.window != nil else { return }
        firstPresentedFrame = nil
        let link = CADisplayLink(target: startupFrameTarget, selector: #selector(ReylumiStartupFrameTarget.tick(_:)))
        startupDisplayLink = link
        link.add(to: .main, forMode: .common)
    }

    fileprivate func startupFrame(_ link: CADisplayLink) {
        guard webView == nil, viewIfLoaded?.window != nil,
              UIApplication.shared.applicationState == .active else { return }
        guard let firstPresentedFrame else {
            // This callback prepares the upcoming frame. Wait until that frame
            // was presented before doing WebKit construction on the main thread.
            self.firstPresentedFrame = link.targetTimestamp
            return
        }
        guard link.timestamp >= firstPresentedFrame else { return }
        initializeWebContentIfNeeded()
    }

    @objc private func cancelPendingWebStartup() {
        startupDisplayLink?.invalidate()
        startupDisplayLink = nil
        firstPresentedFrame = nil
    }

    // Kept explicit so native tests can inspect the first shell independently.
    // Production reaches this once after its first visible display frame.
    func initializeWebContentIfNeeded() {
        loadViewIfNeeded()
        guard webView == nil else { return }
        cancelPendingWebStartup()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // Enable persistent service workers only for our own top-level origin.
        // External browsing and hosted payment remain in Safari below.
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.applicationNameForUserAgent = "ReylumiIOS/1.0"
        configuration.allowsInlineMediaPlayback = true
        // The app uses a fixed, responsive viewport rather than browser page zoom.
        configuration.ignoresViewportScaleLimits = false
        // Register with the WebView and unregister when the controller is destroyed.
        configuration.userContentController.add(WeakMessageHandler(self), name: "reylumi")
        for resource in ["AppViewport", "NativeBridge"] {
            if let scriptURL = Bundle.main.url(forResource: resource, withExtension: "js"),
               var script = try? String(contentsOf: scriptURL, encoding: .utf8) {
                #if DEBUG
                if resource == "NativeBridge", policy.origin.scheme == "http", policy.origin.host == "localhost",
                   let data = try? JSONSerialization.data(withJSONObject: [policy.origin.absoluteString]),
                   let json = String(data: data, encoding: .utf8) {
                    script = "window.__reylumiDebugLocalOrigin = \(json)[0];\n" + script
                }
                #endif
                configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.underPageBackgroundColor = .white
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.pageZoom = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.scrollView.bouncesZoom = false
        webView.scrollView.alwaysBounceHorizontal = false
        // Safe areas are already applied by the constraints below.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.progressTintColor = ReylumiOrbitView.teal
        progress.trackTintColor = .clear
        progress.isHidden = true
        view.insertSubview(webView, at: 0)
        view.insertSubview(progress, belowSubview: launchPanel)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            // Resize the page when the keyboard opens so dialogs and actions stay reachable.
            webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progress.topAnchor.constraint(equalTo: webView.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            self?.progress.progress = Float(webView.estimatedProgress)
            self?.progress.isHidden = self?.hasLoadedPage != true || webView.estimatedProgress >= 1
        }
        let request = pendingRequest ?? URLRequest(url: policy.origin.appendingPathComponent("explore"), cachePolicy: .useProtocolCachePolicy, timeoutInterval: 15)
        loadRequest(request)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // On a short landscape viewport the indicator sits beside the bottom
        // navigation. Keep native scrolling, without that floating overlay.
        webView?.scrollView.showsVerticalScrollIndicator = view.bounds.width <= view.bounds.height
    }

    @objc private func retryLoad() {
        // Never reload a navigation that may have submitted a POST.
        if let request = startup.retryRequest(origin: policy.origin) { loadRequest(request) }
        else { openPublicDestination("/explore") }
    }

    private func openPublicDestination(_ path: String, query: [URLQueryItem] = []) {
        guard ["/explore", "/market"].contains(path),
              var components = URLComponents(url: policy.origin, resolvingAgainstBaseURL: false) else { return }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        components.fragment = nil
        guard let url = components.url else { return }
        view.endEditing(true)
        loadRequest(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 15))
    }

    private func loadRequest(_ request: URLRequest) {
        guard webView != nil else {
            // Public shell taps before WebKit starts replace the queued GET;
            // only the visitor's latest destination is loaded.
            pendingRequest = request
            launchPanel.showLoading()
            scheduleWebStartupAfterFirstFrame()
            return
        }
        navigationWatchdog?.cancel()
        retireCurrentNavigation()
        activeNavigation = nil
        webView.stopLoading()
        pendingRequest = request
        startup.begin(request)
        connectionNotice.isHidden = true
        if !hasLoadedPage { launchPanel.showLoading() }
        activeNavigation = webView.load(request)
        armNavigationWatchdog()
    }

    private func isCurrent(_ navigation: WKNavigation?) -> Bool {
        navigation == nil || navigation === activeNavigation
    }

    private func retireCurrentNavigation() {
        if let activeNavigation {
            retiredNavigations.append(activeNavigation)
            if retiredNavigations.count > 16 { retiredNavigations.removeFirst() }
        }
    }

    private func armNavigationWatchdog() {
        navigationWatchdog?.cancel()
        let generation = startup.generation
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.startup.generation == generation, self.startup.isWaiting else { return }
            // A POST may already have reached the server; do not cancel and replay it.
            if (self.startup.request?.httpMethod ?? "GET").uppercased() == "GET" { self.webView.stopLoading() }
            self.showNavigationError()
        }
        navigationWatchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 18, execute: work)
    }

    private func finishLoading() {
        navigationWatchdog?.cancel()
        progress.isHidden = true
        connectionNotice.isHidden = true
        launchPanel.finishLoading()
    }

    private func configureConnectionNotice() {
        connectionNotice.axis = .horizontal
        connectionNotice.alignment = .center
        connectionNotice.spacing = 10
        connectionNotice.isLayoutMarginsRelativeArrangement = true
        connectionNotice.layoutMargins = UIEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        connectionNotice.backgroundColor = .secondarySystemBackground
        connectionNotice.layer.cornerRadius = 14
        connectionNotice.translatesAutoresizingMaskIntoConstraints = false
        connectionNotice.isHidden = true
        connectionMessage.font = .preferredFont(forTextStyle: .footnote)
        connectionMessage.numberOfLines = 2
        connectionMessage.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        connectionRetry.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        let dismiss = UIButton(type: .system)
        dismiss.setImage(UIImage(systemName: "xmark"), for: .normal)
        dismiss.accessibilityLabel = "Dismiss connection message"
        dismiss.addAction(UIAction { [weak self] _ in self?.connectionNotice.isHidden = true }, for: .touchUpInside)
        [connectionMessage, connectionRetry, dismiss].forEach { connectionNotice.addArrangedSubview($0) }
        view.addSubview(connectionNotice)
        NSLayoutConstraint.activate([
            connectionNotice.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            connectionNotice.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            connectionNotice.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12)
        ])
    }

    private func showNavigationError(rejectCompletion: Bool = false) {
        navigationWatchdog?.cancel()
        startup.fail(rejectCompletion: rejectCompletion)
        progress.isHidden = true
        if hasLoadedPage {
            // A failed provisional navigation must not cover the working document.
            let vietnamese = Locale.preferredLanguages.first?.hasPrefix("vi") == true
            connectionMessage.text = vietnamese ? "Chưa mở được trang. Bạn vẫn có thể dùng trang hiện tại." : "Couldn't open this page. You can keep using the current page."
            let retry = startup.retryRequest(origin: policy.origin) != nil
            connectionRetry.setTitle(vietnamese ? (retry ? "Thử lại" : "Khám phá") : (retry ? "Try again" : "Explore"), for: .normal)
            connectionNotice.isHidden = false
        } else {
            connectionNotice.isHidden = true
            launchPanel.showError()
        }
    }

    private func alert(_ message: String) {
        guard presentedViewController == nil else { return }
        let controller = UIAlertController(title: "Reylumi", message: message, preferredStyle: .alert)
        controller.addAction(UIAlertAction(title: "OK", style: .default))
        present(controller, animated: true)
    }

    private func share(_ items: [Any]) {
        guard !items.isEmpty, presentedViewController == nil else { return }
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        controller.popoverPresentationController?.sourceView = view
        controller.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(controller, animated: true)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if policy.isExcluded(url) {
            decisionHandler(.cancel)
            if action.targetFrame?.isMainFrame != false { alert("Platform administration is available on the website only.") }
        } else if policy.isInternal(url) || url.scheme == "blob" || url.absoluteString == "about:blank" {
            if action.targetFrame?.isMainFrame == true && !action.shouldPerformDownload { pendingRequest = action.request }
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
        } else {
            decisionHandler(.cancel)
            // Never launch external applications for hidden iframe navigations.
            guard action.targetFrame?.isMainFrame != false, action.navigationType == .linkActivated,
                  policy.isExternalAllowed(url) else { return }
            if policy.isSafariPayment(url) {
                UIApplication.shared.open(url, options: [:]) { [weak self] opened in
                    if !opened { self?.alert("Secure payment could not open. Please try again.") }
                }
            }
            else if url.scheme == "https" { present(SFSafariViewController(url: url), animated: true) }
            else { UIApplication.shared.open(url) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponsePolicy(for: response.response, isForMainFrame: response.isForMainFrame, canShowMIMEType: response.canShowMIMEType))
    }

    func navigationResponsePolicy(for response: URLResponse, isForMainFrame: Bool, canShowMIMEType: Bool) -> WKNavigationResponsePolicy {
        if let http = response as? HTTPURLResponse,
           policy.isSecurityChallengeResponse(http, isMainFrame: isForMainFrame, canShowMIMEType: canShowMIMEType) {
            startup.acceptSecurityChallenge()
            return .allow
        }
        if isForMainFrame, let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            showNavigationError(rejectCompletion: true)
            return .cancel
        }
        let attachment = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") == true
        return !canShowMIMEType || attachment ? .download : .allow
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url {
            if !policy.isExcluded(url), policy.isInternal(url) || url.scheme == "blob" { webView.load(action.request) }
        }
        return nil
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard !retiredNavigations.contains(where: { $0 === navigation }) else { return }
        if navigation !== activeNavigation {
            retireCurrentNavigation()
            startup.begin(pendingRequest)
            activeNavigation = navigation
        }
        connectionNotice.isHidden = true
        if !hasLoadedPage { launchPanel.showLoading() }
        armNavigationWatchdog()
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard isCurrent(navigation) else { return }
        startup.commit()
        if startup.isSecurityChallenge {
            // A challenge may wait for interaction or keep resources open. It
            // must be visible without an app bridge message or window load.
            finishLoading()
            return
        }
        var origin = URLComponents(url: policy.origin, resolvingAgainstBaseURL: false)
        origin?.path = ""
        origin?.query = nil
        origin?.fragment = nil
        let context: [String: Any] = ["nonce": startup.nonce, "generation": startup.generation, "origin": origin?.string ?? ""]
        guard let data = try? JSONSerialization.data(withJSONObject: context),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__reylumiStartup?.setNavigationContext(\(json));", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard isCurrent(navigation), startup.finish() else { return }
        // WebKit may create its pinch recognizer only after the first document loads.
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        finishLoading()
        notifyUsableDestination()
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showLoadError(error, navigation: navigation) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showLoadError(error, navigation: navigation) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let recovery = startup.retryRequest(origin: policy.origin, currentURL: webView.url)
        navigationWatchdog?.cancel()
        retireCurrentNavigation()
        activeNavigation = nil
        startup.processTerminated()
        if let recovery, startup.allowProcessRecovery() { loadRequest(recovery) }
        else { showNavigationError(rejectCompletion: true) }
    }
    private func showLoadError(_ error: Error, navigation: WKNavigation?) {
        guard isCurrent(navigation), (error as NSError).code != NSURLErrorCancelled else { return }
        showNavigationError()
    }

    @objc private func paymentForeground() {
        if webView == nil { scheduleWebStartupAfterFirstFrame(); return }
        guard let url = webView?.url, policy.isInternal(url), !policy.isExcluded(url) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('reylumi:foreground'))", completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              policy.isInternal(url), !policy.isExcluded(url), let body = message.body as? [String: Any] else { return }
        switch body["action"] as? String {
        case "offline-ready":
            guard let nonce = body["nonce"] as? String, let generation = body["generation"] as? Int,
                  generation == startup.generation, nonce == startup.nonce, startup.didCommit,
                  let path = body["path"] as? String, let current = webView.url,
                  policy.isInternal(current), current.path == path, current.query == nil, current.fragment == nil,
                  body["version"] as? Int == 1,
                  let expiry = body["expiresAt"] as? String,
                  let expiresAt = ReylumiOfflineRoute.expiry(from: expiry),
                  let route = ReylumiOfflineRoute(path: path, expiresAt: expiresAt) else { return }
            offlineRoutes.save(route)
        case "offline-clear":
            guard body["nonce"] as? String == startup.nonce,
                  body["generation"] as? Int == startup.generation, startup.didCommit else { return }
            offlineRoutes.clear()
            offlineEpoch += 1
            ReylumiBackgroundSync.shared.clear()
            NotificationCenter.default.post(name: ReylumiLocalAppTransport.sessionResetNotification, object: nil)
        case "background-register":
            guard body["nonce"] as? String == startup.nonce, body["generation"] as? Int == startup.generation,
                  startup.didCommit, let scope = body["scope"] as? String, let key = body["key"] as? String,
                  let endpoint = body["endpoint"] as? String, let expiry = body["expiresAt"] as? String,
                  let expiresAt = ReylumiOfflineRoute.expiry(from: expiry),
                  let registration = ReylumiSyncRegistration(scope: scope, key: key, endpoint: endpoint, expiresAt: expiresAt, origin: policy.origin) else { return }
            let epoch = offlineEpoch
            Task { @MainActor [weak self] in
                guard let self, self.offlineEpoch == epoch else { return }
                await ReylumiBackgroundSync.shared.register(registration)
            }
        case "background-drain":
            guard body["nonce"] as? String == startup.nonce, body["generation"] as? Int == startup.generation,
                  startup.didCommit, let scope = body["scope"] as? String else { return }
            let nonce = startup.nonce
            let generation = startup.generation
            let epoch = offlineEpoch
            Task { @MainActor [weak self] in
                let snapshots = await ReylumiBackgroundSync.shared.drain(scope: scope)
                guard let self, self.offlineEpoch == epoch, self.startup.nonce == nonce, self.startup.generation == generation,
                      self.startup.didCommit, let current = self.webView?.url,
                      self.policy.isInternal(current), !self.policy.isExcluded(current), !snapshots.isEmpty,
                      let data = try? JSONSerialization.data(withJSONObject: ["scope": scope, "snapshots": snapshots]),
                      let json = String(data: data, encoding: .utf8) else { return }
                self.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('reylumi:native-snapshots', {detail:\(json)}));", completionHandler: nil)
            }
        case "screen-ready":
            guard let nonce = body["nonce"] as? String, let generation = body["generation"] as? Int,
                  startup.ready(nonce: nonce, generation: generation) else { return }
            finishLoading()
            notifyUsableDestination()
        case "route-ready":
            guard let nonce = body["nonce"] as? String, nonce == startup.nonce,
                  let generation = body["generation"] as? Int, generation == startup.generation,
                  let current = webView.url, let reportedPath = body["path"] as? String else { return }
            var currentPath: String = current.path
            if let query = current.query { currentPath += "?" + query }
            if let fragment = current.fragment { currentPath += "#" + fragment }
            guard reportedPath == currentPath else { return }
            notifyUsableDestination()
        case "open-market-website":
            UIApplication.shared.open(policy.origin.appendingPathComponent("market"), options: [:])
        case "open-payment":
            guard let value = body["url"] as? String, let paymentURL = URL(string: value), policy.isSafariPayment(paymentURL) else { return }
            UIApplication.shared.open(paymentURL, options: [:]) { [weak self] opened in
                if !opened { self?.alert("Secure payment could not open. Please try again.") }
            }
        case "print":
            let controller = UIPrintInteractionController.shared
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true, completionHandler: nil)
        case "share":
            if let text = body["text"] as? String { share([text]) }
        case "excluded": alert("Platform administration is available on the website only.")
        default: break
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard presentedViewController == nil else { completionHandler(); return }
        let controller = UIAlertController(title: "Reylumi", message: message, preferredStyle: .alert)
        controller.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(controller, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard presentedViewController == nil else { completionHandler(false); return }
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
            let filename = (suggestedFilename as NSString).lastPathComponent
            let destination = directory.appendingPathComponent(filename.isEmpty ? "Reylumi-export" : filename)
            downloads[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        } catch { completionHandler(nil); alert("Unable to save this file.") }
    }
    func downloadDidFinish(_ download: WKDownload) {
        if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) { share([url]) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        alert("Unable to download this file. Please try again.")
    }

    deinit { startupDisplayLink?.invalidate(); navigationWatchdog?.cancel() }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(_ delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

@MainActor
private final class ReylumiStartupFrameTarget: NSObject {
    weak var controller: ReylumiViewController?
    init(_ controller: ReylumiViewController) { self.controller = controller }
    @objc func tick(_ link: CADisplayLink) { controller?.startupFrame(link) }
}
