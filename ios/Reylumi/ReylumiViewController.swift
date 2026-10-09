import UIKit
import WebKit
import SafariServices

final class ReylumiViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    private var webView: WKWebView!
    private var progress = UIProgressView(progressViewStyle: .bar)
    private var progressObservation: NSKeyValueObservation?
    private var downloads: [ObjectIdentifier: URL] = [:]
    private let errorPanel = UIStackView()
    private let errorLabel = UILabel()
    private let policy = NavigationPolicy(origin: URL(string: Bundle.main.object(forInfoDictionaryKey: "ReylumiServerURL") as? String ?? "https://reylumi.com")!)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "ReylumiIOS/1.0"
        configuration.allowsInlineMediaPlayback = true
        // Register in viewDidLoad and unregister when the controller is destroyed.
        configuration.userContentController.add(WeakMessageHandler(self), name: "reylumi")
        if let scriptURL = Bundle.main.url(forResource: "NativeBridge", withExtension: "js"),
           let script = try? String(contentsOf: scriptURL, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        view.addSubview(progress)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progress.topAnchor.constraint(equalTo: webView.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            self?.progress.progress = Float(webView.estimatedProgress)
            self?.progress.isHidden = webView.estimatedProgress >= 1
        }
        errorPanel.axis = .vertical
        errorPanel.spacing = 16
        errorPanel.alignment = .center
        errorPanel.translatesAutoresizingMaskIntoConstraints = false
        errorPanel.backgroundColor = .systemBackground
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        let retry = UIButton(type: .system)
        retry.setTitle("Try again", for: .normal)
        retry.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        errorPanel.addArrangedSubview(errorLabel)
        errorPanel.addArrangedSubview(retry)
        view.addSubview(errorPanel)
        NSLayoutConstraint.activate([
            errorPanel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            errorPanel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            errorPanel.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.85)
        ])
        errorPanel.isHidden = true
        webView.load(URLRequest(url: policy.origin.appendingPathComponent("explore")))
    }

    @objc private func retryLoad() {
        errorPanel.isHidden = true
        if let url = webView.url, policy.isInternal(url), !policy.isExcluded(url) {
            webView.reload()
        } else {
            webView.load(URLRequest(url: policy.origin.appendingPathComponent("explore")))
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
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
        } else {
            decisionHandler(.cancel)
            // Never launch external applications for hidden iframe navigations.
            guard action.targetFrame?.isMainFrame != false, action.navigationType == .linkActivated,
                  policy.isExternalAllowed(url) else { return }
            if url.scheme == "https" { present(SFSafariViewController(url: url), animated: true) }
            else { UIApplication.shared.open(url) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") == true
        decisionHandler(!response.canShowMIMEType || attachment ? .download : .allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url {
            if !policy.isExcluded(url), policy.isInternal(url) || url.scheme == "blob" { webView.load(action.request) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { errorPanel.isHidden = true }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showLoadError(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showLoadError(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    private func showLoadError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        progress.isHidden = true
        errorLabel.text = "Unable to connect to Reylumi. Check your internet connection and try again."
        errorPanel.isHidden = false
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              policy.isInternal(url), !policy.isExcluded(url), let body = message.body as? [String: Any] else { return }
        switch body["action"] as? String {
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
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(_ delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}
