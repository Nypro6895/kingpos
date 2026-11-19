import UIKit
import WebKit

/// One network-free document is shared by web, Windows, iOS and Android.
/// Presentation is not a receipt/payment mutation or proof of physical printing.
@MainActor
final class ReylumiReceiptPrinter: NSObject, WKNavigationDelegate {
    private var document: WKWebView?
    private weak var source: WKWebView?
    private weak var presenter: UIViewController?
    private var jobID: String?
    private var jobTitle = "Receipt"
    private var acknowledged = false
    private var seen = Set<String>()
    private var authorization: (() async -> Bool)?
    var isBusy: Bool { jobID != nil }

    static func valid(_ job: [String: Any]) -> Bool {
        guard job["version"] as? Int == 1, let id = job["jobId"] as? String, UUID(uuidString: id) != nil,
              let kind = job["kind"] as? String, ["receipt", "provisional", "test"].contains(kind),
              let paper = job["paper"] as? String, ["58mm", "80mm", "a4"].contains(paper),
              let title = job["title"] as? String, !title.isEmpty, title.count <= 120,
              !title.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              let html = job["html"] as? String, html.utf8.count <= 1_048_576,
              html.contains("data-reylumi-receipt-document=\"1\""), html.contains("default-src 'none'"),
              html.range(of: "<\\s*(script|iframe|object|embed|link|base|form)\\b", options: [.regularExpression, .caseInsensitive]) == nil,
              html.range(of: "<[^>]+\\son[a-z]+\\s*=", options: [.regularExpression, .caseInsensitive]) == nil else { return false }
        if kind == "receipt" { guard let value = job["receiptId"] as? String, UUID(uuidString: value) != nil else { return false } }
        if kind == "provisional" {
            guard job["receiptId"] == nil, let id = job["operationId"] as? String, UUID(uuidString: id) != nil,
                  let scope = job["scope"] as? String, ReylumiPortableStore.validScope(scope) else { return false }
        }
        return true
    }
    func present(_ job: [String: Any], from controller: UIViewController, source: WKWebView, authorized: @escaping () async -> Bool) {
        let id = job["jobId"] as? String ?? ""
        guard Self.valid(job), !isBusy, !seen.contains(id), controller.presentedViewController == nil else {
            reply(source, id: id, status: "failed", error: "Receipt printing is unavailable or a print dialog is already open."); return
        }
        jobID = id; jobTitle = job["title"] as? String ?? "Receipt"; self.source = source; presenter = controller; authorization = authorized; acknowledged = false
        if seen.count >= 256 { seen.removeAll() }; seen.insert(id)
        let width: CGFloat = job["paper"] as? String == "58mm" ? 58 : job["paper"] as? String == "80mm" ? 80 : 210
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let printView = WKWebView(frame: CGRect(x: 0, y: 0, width: width * 72 / 25.4, height: 842), configuration: configuration)
        printView.isHidden = true; printView.navigationDelegate = self
        controller.view.addSubview(printView); document = printView
        let rules = "[{\"trigger\":{\"url-filter\":\"^(https?|file):\"},\"action\":{\"type\":\"block\"}}]"
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "ReylumiReceiptNoNetworkV1", encodedContentRuleList: rules) { [weak self, weak printView] list, _ in
            Task { @MainActor in
                guard let self, let printView, self.document === printView else { return }
                guard let list else { self.fail("Receipt document could not be secured."); return }
                configuration.userContentController.add(list)
                printView.loadHTMLString(job["html"] as? String ?? "", baseURL: nil)
            }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.scheme == "about" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor [weak self] in
            guard let self, self.document === webView, let id = self.jobID, let controller = self.presenter, let source = self.source,
                  controller.presentedViewController == nil, await self.authorization?() == true else { self?.fail("The POS session changed. Reopen the saved ticket before printing."); return }
            guard self.jobID == id, self.document === webView, self.source === source, controller.presentedViewController == nil else { return }
            let printer = UIPrintInteractionController.shared
            printer.printingItem = nil; printer.printingItems = nil; printer.printPageRenderer = nil; printer.printFormatter = webView.viewPrintFormatter()
            let info = UIPrintInfo(dictionary: nil); info.jobName = self.jobTitle; info.outputType = .general; info.duplex = .none; printer.printInfo = info
            let completion: UIPrintInteractionController.CompletionHandler = { [weak self] _, _, _ in Task { @MainActor in self?.clear() } }
            let presented: Bool
            if UIDevice.current.userInterfaceIdiom == .pad {
                presented = printer.present(from: CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1), in: controller.view, animated: true, completionHandler: completion)
            } else { presented = printer.present(animated: true, completionHandler: completion) }
            if presented { self.acknowledged = true; self.reply(source, id: id, status: "presented") }
            else { self.fail("The system print dialog could not open.") }
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("Receipt document could not load.") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("Receipt document could not load.") }
    func cancel() {
        if let id = jobID, let source, !acknowledged { reply(source, id: id, status: "cancelled") }
        if acknowledged { UIPrintInteractionController.shared.dismiss(animated: false) }
        clear()
    }
    private func fail(_ message: String) {
        if let id = jobID, let source, !acknowledged { reply(source, id: id, status: "failed", error: message) }
        clear()
    }
    private func clear() { document?.stopLoading(); document?.removeFromSuperview(); document = nil; source = nil; presenter = nil; jobID = nil; authorization = nil; acknowledged = false }
    private func reply(_ webView: WKWebView, id: String, status: String, error: String? = nil) {
        var value = ["jobId": id, "status": status]; if let error { value["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__reylumiReceiptPrintResult && window.__reylumiReceiptPrintResult(\(json));", completionHandler: nil)
    }
}
