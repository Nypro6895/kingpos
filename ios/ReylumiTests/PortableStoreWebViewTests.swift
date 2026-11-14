import XCTest
import UIKit
import WebKit
import Security
@testable import Reylumi

private actor PortableVaultUnavailableHTTP: ReylumiLocalHTTPClient {
    private(set) var posts = 0
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if request.httpMethod == "POST" { posts += 1 }
        throw URLError(.notConnectedToInternet)
    }
}

/// Uses the production bridge, its synchronous WKUIDelegate prompt, the real
/// signed-resource scheme handler, and the native encrypted vault. All leases
/// and customer information are synthetic; networking is always unavailable.
final class PortableStoreWebViewTests: XCTestCase {
    private let scope = "00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003"

    @MainActor
    func testNewOfflineWebViewRestoresNativeDraftAndReceiptThenExplicitLockRevokesAccessWithoutDiscardingWork() async throws {
        let origin = URL(string: "https://portable-vault-wk-" + UUID().uuidString.lowercased() + ".invalid")!
        let (base, bundleDirectory) = try AppLocalTestFixture.bundle()
        let manifestFile = bundleDirectory.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestFile)) as? [String: Any])
        var routes = manifest["routes"] as! [[String: Any]]
        routes.append(["path": "/pos/portable", "adapter": "portable", "access": "scoped"])
        manifest["routes"] = routes
        try JSONSerialization.data(withJSONObject: manifest).write(to: manifestFile)
        let bundle = try ReylumiLocalBundle(directory: base.directory)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("portable-vault-wk-" + UUID().uuidString)
        let service = "com.reylumi.tests.portable-wk." + UUID().uuidString
        let readService = service + ".reads", suite = service + ".defaults"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let network = PortableVaultUnavailableHTTP()
        defer {
            try? FileManager.default.removeItem(at: directory)
            try? FileManager.default.removeItem(at: bundleDirectory)
            defaults.removePersistentDomain(forName: suite)
            for item in [service, readService] { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: item] as CFDictionary) }
        }
        let reads = ReylumiLocalReadStore(origin: origin, directory: directory.appendingPathComponent("reads"), service: readService)
        let firstTransport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: reads, client: network, defaults: defaults, cookies: { [] }, setCookie: { _ in })
        var envelope = AppLocalTestFixture.portableContext(generation: firstTransport.generation, localCommands: true)
        envelope["portable"] = ["scope": scope, "capabilities": ["portable.pos.use"], "offlineEnabled": true]
        let lease = try XCTUnwrap(ReylumiLocalSession.verified(envelope, generation: firstTransport.generation))
        await reads.accept(lease)

        let firstStore = ReylumiPortableStore(origin: origin, directory: directory.appendingPathComponent("vault"), service: service)
        var first: PortableVaultWKSession? = PortableVaultWKSession(bundle: bundle, bridge: ReylumiPortableBridge(origin: origin, transport: firstTransport, store: firstStore))
        var warm: WKWebView? = try XCTUnwrap(first?.web)
        try await wait("window.fixtureLocal===true&&!!window.__reylumiPortableDevice", in: XCTUnwrap(warm))
        let key = "kingpos:portable-draft:v1:" + scope + ":native-device"
        let keyJSON = try json(key), scopeJSON = try json(scope)
        let blockedBeforeAdmission = try await XCTUnwrap(warm).evaluateJavaScript("(()=>{try{window.__reylumiPortableDevice.storage.get(\(keyJSON));return false}catch(e){return e.code==='storage-locked'}})()") as? Bool
        XCTAssertEqual(blockedBeforeAdmission, true)
        _ = try await XCTUnwrap(warm).evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'storage.prepare',scope:\(scopeJSON)}).then(v=>window.fixtureAdmission=v).catch(e=>window.fixtureError=e.message)")
        try await wait("window.fixtureAdmission?.ok===true", in: XCTUnwrap(warm))
        _ = try await XCTUnwrap(warm).evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'writer.acquire',scope:\(scopeJSON),key:\(keyJSON)}).then(v=>window.fixtureWriter=v)")
        try await wait("window.fixtureWriter?.acquired===true", in: XCTUnwrap(warm))
        // The fixture deliberately has no cached business workspace. Native
        // draft access alone must not advertise complete offline preparation.
        let initiallyOfflineReady = try await XCTUnwrap(warm).evaluateJavaScript("window.fixtureAdmission.offlineReady") as? Bool
        XCTAssertEqual(initiallyOfflineReady, false)
        let savedAt = Date().timeIntervalSince1970 * 1000
        let draft = "{\"schema\":1,\"savedAt\":\(savedAt),\"recovery\":{\"amount\":\"127.50\",\"customerName\":\"Synthetic WK customer\"}}"
        let draftJSON = try json(draft)
        let savedSynchronously = try await XCTUnwrap(warm).evaluateJavaScript("(()=>{window.__reylumiPortableDevice.storage.set(\(keyJSON),\(draftJSON));return window.__reylumiPortableDevice.storage.get(\(keyJSON))===\(draftJSON)})()") as? Bool
        XCTAssertEqual(savedSynchronously, true)

        // A second independent native document shares the vault but must not
        // overwrite this cart, even though its own Web Locks origin is separate.
        let rivalTransport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: reads, client: network, defaults: defaults, cookies: { [] }, setCookie: { _ in })
        let rivalSession = PortableVaultWKSession(bundle: bundle, bridge: ReylumiPortableBridge(origin: origin, transport: rivalTransport, store: firstStore))
        defer { rivalSession.close() }
        let rival = try XCTUnwrap(rivalSession.web)
        try await wait("window.fixtureLocal===true&&!!window.__reylumiPortableDevice", in: rival)
        _ = try await rival.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'storage.prepare',scope:\(scopeJSON)}).then(v=>window.fixtureAdmission=v)")
        try await wait("window.fixtureAdmission?.ok===true", in: rival)
        _ = try await rival.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'writer.acquire',scope:\(scopeJSON),key:\(keyJSON)}).then(v=>window.fixtureWriter=v)")
        try await wait("window.fixtureWriter?.acquired===false", in: rival)
        let rivalWriteDenied = try await rival.evaluateJavaScript("(()=>{try{window.__reylumiPortableDevice.storage.set(\(keyJSON),'{\"replacement\":true}');return false}catch(e){return e.code==='writer-required'}})()") as? Bool
        XCTAssertEqual(rivalWriteDenied, true)
        XCTAssertEqual(try firstStore.get(key, scope: scope), draft)
        _ = try await XCTUnwrap(warm).evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'writer.release',key:\(keyJSON),token:window.fixtureWriter.token}).then(v=>window.fixtureReleased=v.released)")
        try await wait("window.fixtureReleased===true", in: XCTUnwrap(warm))
        _ = try await rival.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'writer.acquire',scope:\(scopeJSON),key:\(keyJSON)}).then(v=>window.fixtureWriter=v)")
        try await wait("window.fixtureWriter?.acquired===true", in: rival)
        let transferredWrite = try await rival.evaluateJavaScript("(()=>{window.__reylumiPortableDevice.storage.set(\(keyJSON),\(draftJSON));return true})()") as? Bool
        XCTAssertEqual(transferredWrite, true)
        _ = try await rival.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'writer.release',key:\(keyJSON),token:window.fixtureWriter.token}).then(v=>window.fixtureReleased=v.released)")
        try await wait("window.fixtureReleased===true", in: rival)
        _ = try await XCTUnwrap(warm).evaluateJavaScript("window.fixtureWriter=null;void window.__reylumiPortableDevice.request({action:'writer.acquire',scope:\(scopeJSON),key:\(keyJSON)}).then(v=>window.fixtureWriter=v)")
        try await wait("window.fixtureWriter?.acquired===true", in: XCTUnwrap(warm))
        let operation: [String: Any] = ["id": UUID().uuidString.lowercased(), "scope": scope, "kind": "receipt", "occurredAt": "2026-11-13T12:00:00.000Z", "state": "pending", "payload": ["localDraftKey": key, "lines": [["total": 127.5]]]]
        let operationJSON = try json(operation)
        _ = try await XCTUnwrap(warm).evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'operations.save',operation:\(operationJSON)}).then(v=>window.fixtureQueued=v.ok)")
        try await wait("window.fixtureQueued===true", in: XCTUnwrap(warm))
        XCTAssertEqual(try firstStore.list(scope: scope).count, 1)

        weak var original = first?.web
        first?.close(); first = nil
        warm?.stopLoading(); warm = nil
        for _ in 0..<100 {
            if original == nil { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertNil(original, "The old WebView must be destroyed before an offline restart")
        let secondReads = ReylumiLocalReadStore(origin: origin, directory: directory.appendingPathComponent("reads"), service: readService)
        let secondTransport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: secondReads, client: network, defaults: defaults, cookies: { [] }, setCookie: { _ in })
        let secondStore = ReylumiPortableStore(origin: origin, directory: directory.appendingPathComponent("vault"), service: service)
        let coldSession = PortableVaultWKSession(bundle: bundle, bridge: ReylumiPortableBridge(origin: origin, transport: secondTransport, store: secondStore))
        defer { coldSession.close() }
        let cold = try XCTUnwrap(coldSession.web)
        XCTAssertFalse(cold === original)
        try await wait("window.fixtureLocal===true&&!!window.__reylumiPortableDevice", in: cold)
        _ = try await cold.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'storage.prepare',scope:\(scopeJSON)}).then(v=>window.fixtureAdmission=v).catch(e=>window.fixtureError=e.message)")
        try await wait("window.fixtureAdmission?.ok===true", in: cold)
        let restoredDraft = try await cold.evaluateJavaScript("window.__reylumiPortableDevice.storage.get(\(keyJSON))") as? String
        XCTAssertEqual(restoredDraft, draft)
        _ = try await cold.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'operations.list',scope:\(scopeJSON)}).then(v=>window.fixtureRestoredRows=v)")
        try await wait("window.fixtureRestoredRows?.length===1", in: cold)
        let restoredID = try await cold.evaluateJavaScript("window.fixtureRestoredRows[0].id") as? String
        XCTAssertEqual(restoredID, operation["id"] as? String)
        XCTAssertGreaterThanOrEqual(try secondStore.checkpoint(scope: scope, key: key), savedAt)
        let restoredPending = try await cold.evaluateJavaScript("window.fixtureAdmission.pending") as? Int
        XCTAssertEqual(restoredPending, 1)

        _ = try await cold.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'storage.lock'}).then(()=>window.fixtureLocked=true)")
        try await wait("window.fixtureLocked===true", in: cold)
        let deniedAfterLock = try await cold.evaluateJavaScript("(()=>{try{window.__reylumiPortableDevice.storage.get(\(keyJSON));return false}catch(e){return e.code==='storage-locked'}})()") as? Bool
        XCTAssertEqual(deniedAfterLock, true)
        _ = try await cold.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'storage.prepare',scope:\(scopeJSON)}).then(()=>window.fixtureUnexpectedUnlock=true).catch(()=>window.fixtureUnlockDenied=true)")
        try await wait("window.fixtureUnlockDenied===true", in: cold)
        // The previously admitted second window must lose both vault and
        // writer authority immediately when another scene explicitly locks POS.
        let rivalReadDeniedAfterLock = try await rival.evaluateJavaScript("(()=>{try{window.__reylumiPortableDevice.storage.get(\(keyJSON));return false}catch(e){return e.code==='storage-locked'}})()") as? Bool
        let rivalWriteDeniedAfterLock = try await rival.evaluateJavaScript("(()=>{try{window.__reylumiPortableDevice.storage.set(\(keyJSON),'{\"replacement\":true}');return false}catch(e){return e.code==='storage-locked'}})()") as? Bool
        XCTAssertEqual(rivalReadDeniedAfterLock, true)
        XCTAssertEqual(rivalWriteDeniedAfterLock, true)
        _ = try await rival.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'writer.acquire',scope:\(scopeJSON),key:\(keyJSON)}).then(()=>window.fixtureUnexpectedWriter=true).catch(()=>window.fixtureWriterDeniedAfterLock=true)")
        try await wait("window.fixtureWriterDeniedAfterLock===true", in: rival)
        _ = try await rival.evaluateJavaScript("void window.__reylumiPortableDevice.request({action:'storage.prepare',scope:\(scopeJSON)}).then(()=>window.fixtureUnexpectedUnlock=true).catch(()=>window.fixtureUnlockDenied=true)")
        try await wait("window.fixtureUnlockDenied===true", in: rival)
        XCTAssertEqual(try secondStore.list(scope: scope).count, 1, "Lock revokes access without discarding unsynced work")
        XCTAssertEqual(try secondStore.get(key, scope: scope), draft, "Explicit lock preserves the encrypted draft without making it accessible to either WebView")
        let posts = await network.posts
        XCTAssertEqual(posts, 0, "Restart and local vault recovery must never replay a business mutation")
    }

    private func json(_ value: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]), as: UTF8.self)
    }

    @MainActor
    private func wait(_ expression: String, in web: WKWebView) async throws {
        var last: Error?
        for _ in 0..<250 {
            do { if try await web.evaluateJavaScript(expression) as? Bool == true { return } } catch { last = error }
            try await Task.sleep(nanoseconds: 40_000_000)
        }
        XCTFail("Portable native fixture did not become ready: \(last?.localizedDescription ?? expression)")
        throw URLError(.timedOut)
    }
}

@MainActor
private final class PortableVaultWKSession: NSObject, WKUIDelegate {
    let bridge: ReylumiPortableBridge
    private let handler: ReylumiLocalSchemeHandler
    private let window: UIWindow
    private(set) var web: WKWebView?
    init(bundle: ReylumiLocalBundle, bridge: ReylumiPortableBridge) {
        let handler = ReylumiLocalSchemeHandler(bundle: bundle)
        self.bridge = bridge; self.handler = handler
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(handler, forURLScheme: ReylumiLocalBundle.scheme)
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        bridge.install(in: config)
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 1024, height: 768), configuration: config)
        self.web = web
        window = UIWindow(frame: web.frame)
        super.init()
        web.uiDelegate = self; bridge.webView = web
        let controller = UIViewController(); controller.view.addSubview(web)
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = controller; window.isHidden = false
        web.load(URLRequest(url: URL(string: "reylumi-app://bundle/pos/portable")!))
    }
    func close() {
        web?.stopLoading()
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "portableDevice", contentWorld: .page)
        web?.uiDelegate = nil; web?.removeFromSuperview(); web = nil
        window.isHidden = true; window.rootViewController = nil
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        completionHandler(bridge.prompt(prompt, frame: frame))
    }
}
