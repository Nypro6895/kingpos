import XCTest
import UIKit
import WebKit
import Network
@testable import Reylumi

final class OfflineWebViewTests: XCTestCase {
    @MainActor
    func testExplicitPOSOpenRestoresDurableDraftAfterNewAppStartsAtHome() async throws {
        let server = try OfflineFixtureServer()
        try await server.start()
        defer { server.stop() }
        let origin = try XCTUnwrap(server.origin)
        let store = ReylumiOfflineRouteStore(origin: origin, service: "com.reylumi.tests.wk-offline.\(UUID().uuidString)")
        defer { store.clear() }
        var controller: ReylumiViewController? = ReylumiViewController(origin: origin, offlineRoutes: store)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = controller
        window.isHidden = false
        defer { window.isHidden = true; window.rootViewController = nil }
        controller?.loadViewIfNeeded()
        controller?.initializeWebContentIfNeeded()
        var warm: WKWebView? = controller?.view.subviews.compactMap { $0 as? WKWebView }.first
        XCTAssertTrue(try XCTUnwrap(warm).configuration.limitsNavigationsToAppBoundDomains)
        XCTAssertTrue(try XCTUnwrap(warm).configuration.websiteDataStore.isPersistent)
        warm?.load(URLRequest(url: origin.appendingPathComponent("pos/portable")))
        try await waitForJavaScript("document.body?.dataset.pos === 'ready' && window.fixtureDraft?.amount === '127.50'", in: XCTUnwrap(warm))
        try await waitForLease(store, path: "/pos/portable")
        XCTAssertEqual(server.postRequests, 0)
        let saved = try XCTUnwrap(store.restored())
        // Destroy the original native controller and its WebView. The new one
        // must navigate through persistent WebKit storage, not a retained DOM.
        weak var originalView = warm
        warm?.stopLoading()
        warm?.removeFromSuperview()
        window.rootViewController = nil
        controller = nil
        warm = nil
        for _ in 0..<100 {
            if originalView == nil { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertNil(originalView, "The original WKWebView must be destroyed before the cold offline launch")
        server.isOffline = true
        let cold = ReylumiViewController(origin: origin, offlineRoutes: store)
        cold.loadViewIfNeeded()
        XCTAssertTrue(["", "/"].contains(cold.queuedStartupURL?.path ?? "missing"))
        window.rootViewController = cold
        cold.initializeWebContentIfNeeded()
        let restored = try XCTUnwrap(cold.view.subviews.compactMap { $0 as? WKWebView }.first)
        restored.load(URLRequest(url: origin.appendingPathComponent("pos/portable")))
        try await waitForJavaScript("location.pathname === '/pos/portable' && navigator.serviceWorker.controller != null && document.body?.dataset.pos === 'ready' && window.fixtureAsset === 'cached-pos-code' && window.fixtureDraft?.id === 'pending-op-1' && window.fixtureDraft?.amount === '127.50'", in: restored)
        XCTAssertEqual(store.restored()?.expiresAt, saved.expiresAt, "Offline boot must not renew the server-issued preparation lease")
        XCTAssertEqual(server.postRequests, 0, "Cold boot must never upload/replay a financial operation")
        _ = try? await restored.evaluateJavaScript("navigator.serviceWorker.getRegistration().then(r=>r?.unregister()); caches.delete('reylumi-native-offline-fixture'); indexedDB.deleteDatabase('reylumi-native-offline-fixture');")
        restored.stopLoading()
    }

    @MainActor
    private func waitForLease(_ store: ReylumiOfflineRouteStore, path: String) async throws {
        for _ in 0..<300 {
            if store.restored()?.path == path { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Native did not accept the complete prepared shell ACK")
        throw FixtureError.timeout
    }

    @MainActor
    private func waitForJavaScript(_ expression: String, in webView: WKWebView) async throws {
        var lastError: Error?
        for _ in 0..<450 {
            do {
                if try await webView.evaluateJavaScript(expression) as? Bool == true { return }
            } catch { lastError = error }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("WK offline fixture did not become usable: \(lastError?.localizedDescription ?? expression)")
        throw FixtureError.timeout
    }
}

private enum FixtureError: Error { case timeout, missingPort }

/// A loopback-only HTTP fixture. No production API, login, remote image or real
/// money write is reachable. The service worker serves the prepared document
/// and script after every network request starts returning 503.
private final class OfflineFixtureServer {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "com.reylumi.tests.offline-http")
    private let lock = NSLock()
    private var offline = false
    private var posts = 0
    private let expiresAt = ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))
    var origin: URL? { listener.port.flatMap { URL(string: "http://localhost:\($0.rawValue)") } }
    var postRequests: Int { lock.lock(); defer { lock.unlock() }; return posts }
    var isOffline: Bool {
        get { lock.lock(); defer { lock.unlock() }; return offline }
        set { lock.lock(); offline = newValue; lock.unlock() }
    }

    init() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(IPv4Address("127.0.0.1")!), port: .any)
        listener = try NWListener(using: parameters)
    }

    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let completion = FixtureStartupCompletion(continuation)
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready: completion.finish()
                case .failed(let error): completion.finish(error: error)
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in self?.receive(connection) }
            listener.start(queue: queue)
        }
    }

    func stop() { listener.cancel() }

    private func receive(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(connection, buffer: Data())
    }

    private func receiveRequest(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 32 * 1024) { [weak self] data, _, _, _ in
            guard let self, let data, !data.isEmpty else { connection.cancel(); return }
            let request = buffer + data
            guard request.count <= 32 * 1024 else { connection.cancel(); return }
            guard request.range(of: Data("\r\n\r\n".utf8)) != nil else {
                self.receiveRequest(connection, buffer: request)
                return
            }
            guard let text = String(data: request, encoding: .utf8),
                  let first = text.components(separatedBy: "\r\n").first else { connection.cancel(); return }
            let parts = first.split(separator: " ")
            guard parts.count >= 2 else { connection.cancel(); return }
            self.lock.lock()
            if parts[0] != "GET" { self.posts += 1 }
            let offline = self.offline
            self.lock.unlock()
            let path = String(parts[1]).components(separatedBy: "?")[0]
            let body: String
            let type: String
            let status: String
            if offline { body = "Offline fixture"; type = "text/plain"; status = "503 Service Unavailable" }
            else if path == "/fixture-worker.js" { body = self.worker; type = "text/javascript"; status = "200 OK" }
            else if path == "/critical.js" { body = "window.fixtureAsset = 'cached-pos-code';"; type = "text/javascript"; status = "200 OK" }
            else { body = self.html(path: path); type = "text/html"; status = "200 OK" }
            let bytes = Data(body.utf8)
            let headers = Data("HTTP/1.1 \(status)\r\nContent-Type: \(type); charset=utf-8\r\nContent-Length: \(bytes.count)\r\nCache-Control: no-store\r\nService-Worker-Allowed: /\r\nConnection: close\r\n\r\n".utf8)
            connection.send(content: headers + bytes, completion: .contentProcessed { _ in connection.cancel() })
        }
    }

    private var worker: String { """
        self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', event => {
          if(event.request.method !== 'GET') return;
          event.respondWith(caches.open('reylumi-native-offline-fixture').then(async cache =>
            await cache.match(event.request) || fetch(event.request)));
        });
        """ }

    private func html(path: String) -> String {
        guard path == "/pos/portable" else { return "<!doctype html><html><body><a href='/pos/portable'>Open POS</a></body></html>" }
        return """
        <!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>
        <h1>POS fixture</h1><input id="amount" value="127.50"><output id="draft"></output>
        <script src="/critical.js"></script><script>
        (async () => {
          await navigator.serviceWorker.register('/fixture-worker.js').catch(() => navigator.serviceWorker.getRegistration());
          await navigator.serviceWorker.ready;
          if(!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
          const cache = await caches.open('reylumi-native-offline-fixture');
          if(!await cache.match('/pos/portable') || !await cache.match('/critical.js')) await cache.addAll(['/pos/portable','/critical.js']);
          const db = await new Promise((resolve,reject)=>{ const r=indexedDB.open('reylumi-native-offline-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('operations',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
          let draft = await new Promise((resolve,reject)=>{const r=db.transaction('operations').objectStore('operations').get('pending-op-1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          if(!draft) { draft={id:'pending-op-1',amount:'127.50'};await new Promise((resolve,reject)=>{const t=db.transaction('operations','readwrite');t.objectStore('operations').put(draft);t.oncomplete=resolve;t.onerror=()=>reject(t.error);}); }
          db.close(); window.fixtureDraft=draft;document.getElementById('draft').textContent=draft.id;
          document.body.dataset.pos='ready';
          window.dispatchEvent(new CustomEvent('reylumi:offline-ready',{detail:{path:'/pos/portable',version:1,expiresAt:'\(expiresAt)'}}));
          window.dispatchEvent(new Event('reylumi:screen-ready'));
        })().catch(error=>{document.body.dataset.error=String(error);});
        </script></body></html>
        """
    }
}

private final class FixtureStartupCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
    func finish(error: Error? = nil) {
        lock.lock()
        let next = continuation
        continuation = nil
        lock.unlock()
        guard let next else { return }
        if let error { next.resume(throwing: error) } else { next.resume() }
    }
}
