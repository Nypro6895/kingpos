import XCTest
import Network
import WebKit
@testable import Reylumi

/// Real controller startup stays enabled, but its only server is this owned
/// ephemeral IPv4 loopback listener. It has no proxy or write handlers.
final class StartupLoopbackFixture: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "reylumi.tests.startup." + UUID().uuidString)
    private let lock = NSLock()
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private var methods: [String] = []
    private var stopped = false
    var origin: URL { URL(string: "http://localhost:\(listener.port!.rawValue)")! }
    var requestMethods: [String] { lock.lock(); defer { lock.unlock() }; return methods }

    init() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(IPv4Address("127.0.0.1")!), port: .any)
        listener = try NWListener(using: parameters)
    }
    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let completion = StartupFixtureCompletion(continuation)
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready: completion.finish()
                case .failed(let error): completion.finish(error)
                case .cancelled: completion.finish(URLError(.cancelled))
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            listener.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 5) { completion.finish(URLError(.timedOut)) }
        }
    }
    func stop() {
        listener.cancel()
        lock.lock(); stopped = true; let owned = Array(connections.values); connections.removeAll(); lock.unlock()
        owned.forEach { $0.cancel() }
    }
    private func accept(_ connection: NWConnection) {
        lock.lock()
        guard !stopped else { lock.unlock(); connection.cancel(); return }
        connections[ObjectIdentifier(connection)] = connection; lock.unlock()
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }
    private func finish(_ connection: NWConnection) {
        lock.lock(); connections.removeValue(forKey: ObjectIdentifier(connection)); lock.unlock()
        connection.cancel()
    }
    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
            guard let self else { connection.cancel(); return }
            guard let data, !data.isEmpty, buffer.count + data.count <= 8192 else { self.finish(connection); return }
            let request = buffer + data
            guard request.range(of: Data("\r\n\r\n".utf8)) != nil else { self.receive(connection, buffer: request); return }
            let parts = String(decoding: request, as: UTF8.self).components(separatedBy: " ")
            let method = parts.first ?? ""
            self.lock.lock(); self.methods.append(method); self.lock.unlock()
            let allowed = method == "GET" || method == "HEAD"
            let image = allowed && parts.count > 1 && parts[1].components(separatedBy: "?")[0] == "/canary.png"
            let body = image ? Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=")! : Data((allowed ? "<!doctype html><html><body><h1>Owned startup fixture</h1></body></html>" : "Writes forbidden").utf8)
            let status = allowed ? "200 OK" : "405 Method Not Allowed"
            let type = image ? "image/png" : "text/html; charset=utf-8"
            let headers = Data("HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".utf8)
            connection.send(content: headers + (method == "HEAD" ? Data() : body), completion: .contentProcessed { [weak self] _ in self?.finish(connection) })
        }
    }
}

private final class StartupFixtureCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
    func finish(_ error: Error? = nil) {
        lock.lock(); let next = continuation; continuation = nil; lock.unlock()
        guard let next else { return }
        if let error { next.resume(throwing: error) } else { next.resume() }
    }
}

/// Native HTTP is separately injected by every installed-bundle test. This
/// precreation fence also closes browser subresource and direct-JS lanes.
@MainActor
final class InstalledBundleNetworkFence {
    private let identifier = "reylumi.tests.no-network." + UUID().uuidString
    private var rules: WKContentRuleList?
    func prepare() async throws {
        rules = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<WKContentRuleList, Error>) in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: """
            [{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},
             {"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}}]
            """) { list, error in
                if let list { continuation.resume(returning: list) }
                else { continuation.resume(throwing: error ?? URLError(.cannotLoadFromNetwork)) }
            }
        }
    }
    func install(on controller: ReylumiLocalAppViewController) throws {
        let rules = try XCTUnwrap(rules, "Prepare the resource fence before constructing WebKit")
        let previous = controller.configureWebViewForTesting
        controller.configureWebViewForTesting = { configuration in
            Self.configure(configuration, rules: rules)
            // Preserve each test's own counters and compatibility probes.
            previous?(configuration)
        }
    }
    func apply(to configuration: WKWebViewConfiguration) throws {
        Self.configure(configuration, rules: try XCTUnwrap(rules))
    }
    private static func configure(_ configuration: WKWebViewConfiguration, rules: WKContentRuleList) {
        configuration.userContentController.add(rules)
        configuration.userContentController.addUserScript(WKUserScript(source: """
            window.fetch=()=>Promise.reject(new TypeError('XCTest browser network blocked'));
            XMLHttpRequest.prototype.open=function(){throw new TypeError('XCTest XHR blocked')};
            window.WebSocket=class extends EventTarget{static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;readyState=3;send(){}close(){}};
            window.EventSource=class extends EventTarget{static CONNECTING=0;static OPEN=1;static CLOSED=2;readyState=2;close(){}};
            navigator.sendBeacon=()=>false;
            """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    }
    func close() { WKContentRuleListStore.default().removeContentRuleList(forIdentifier: identifier) { _ in }; rules = nil }
}

final class TestNetworkIsolationTests: XCTestCase {
    func testOwnedStartupListenerAllowsReadsAndRejectsWrites() async throws {
        let fixture = try StartupLoopbackFixture(); defer { fixture.stop() }; try await fixture.start()
        let session = URLSession(configuration: .ephemeral); defer { session.invalidateAndCancel() }
        for (method, status) in [("GET", 200), ("HEAD", 200), ("POST", 405)] {
            var request = URLRequest(url: fixture.origin.appendingPathComponent("api/campaigns/delivery"))
            request.httpMethod = method
            let (_, response) = try await session.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, status)
        }
        XCTAssertEqual(fixture.requestMethods, ["GET", "HEAD", "POST"])
    }

    @MainActor
    func testInstalledBrowserFenceDeniesDirectAPIs() async throws {
        let fixture = try StartupLoopbackFixture(); defer { fixture.stop() }; try await fixture.start()
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = ReylumiLocalAppTransport(origin: fixture.origin, manifest: bundle.manifest, client: IsolationUnavailableHTTP(), cookies: { [] })
        let controller = ReylumiLocalAppViewController(bundle: bundle, origin: fixture.origin, startPath: "/help", transport: transport)
        let fence = InstalledBundleNetworkFence(); defer { fence.close() }; try await fence.prepare()
        try fence.install(on: controller)
        let window = makeWindow(controller)
        defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.webView)
        defer { web.stopLoading() }
        try await wait("window.fixtureLocal===true", in: web)
        let target = String(decoding: try JSONSerialization.data(withJSONObject: fixture.origin.absoluteString, options: .fragmentsAllowed), as: UTF8.self)
        _ = try await web.evaluateJavaScript("""
        (()=>{
          const target=\(target);window.isolationProbe={};
          fetch(target).then(()=>isolationProbe.fetch=false,()=>isolationProbe.fetch=true);
          try{const x=new XMLHttpRequest();x.open('GET',target);x.send();isolationProbe.xhr=false}catch{isolationProbe.xhr=true}
          isolationProbe.beacon=navigator.sendBeacon(target,'fixture')===false;
          const ws=new WebSocket(target.replace('http:','ws:'));isolationProbe.ws=ws.readyState===3;ws.close();
          const es=new EventSource(target);isolationProbe.events=es.readyState===2;es.close();
          return true;
        })()
        """)
        try await wait("Object.keys(isolationProbe).length===5&&Object.values(isolationProbe).every(Boolean)", in: web)
        XCTAssertTrue(fixture.requestMethods.isEmpty, "Even the owned canary must not receive browser traffic")
    }

    @MainActor
    func testResourceFenceBlocksImageAfterOwnedPositiveControl() async throws {
        let fixture = try StartupLoopbackFixture(); defer { fixture.stop() }; try await fixture.start()
        let fence = InstalledBundleNetworkFence(); defer { fence.close() }; try await fence.prepare()
        let host = UIViewController(), window = makeWindow(nil)
        window.rootViewController = host
        defer { window.isHidden = true; window.rootViewController = nil }
        let target = fixture.origin.appendingPathComponent("canary.png").absoluteString
        for blocked in [false, true] {
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            if blocked { try fence.apply(to: configuration) }
            let web = WKWebView(frame: window.bounds, configuration: configuration)
            host.view.addSubview(web)
            defer { web.stopLoading(); web.removeFromSuperview() }
            // Inline HTML has no LocalScheme response CSP. The unfenced case
            // proves this exact owned image can load before testing the rules.
            web.loadHTMLString("""
            <!doctype html><html><body><img src="\(target)?blocked=\(blocked)" onload="window.imageLoaded=true" onerror="window.imageDenied=true"></body></html>
            """, baseURL: fixture.origin)
            try await wait(blocked ? "window.imageDenied===true" : "window.imageLoaded===true", in: web)
            XCTAssertEqual(fixture.requestMethods, ["GET"], "Only the unfenced positive control may reach the listener")
        }
    }

    @MainActor
    private func makeWindow(_ controller: UIViewController?) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = controller; window.isHidden = false
        return window
    }
    @MainActor
    private func wait(_ expression: String, in web: WKWebView) async throws {
        for _ in 0..<600 {
            if (try? await web.evaluateJavaScript(expression)) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("Owned network fixture did not finish: \(expression)")
        throw URLError(.timedOut)
    }
}

private actor IsolationUnavailableHTTP: ReylumiLocalHTTPClient {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { throw URLError(.notConnectedToInternet) }
}
