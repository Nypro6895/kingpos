import XCTest
import UIKit
import WebKit
import Network
@testable import Reylumi

private actor HostedReturnHTTP: ReylumiLocalHTTPClient {
    private var held: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var heldRequest: URLRequest?
    private var shouldHold = true
    private(set) var attempts = 0
    func isHeld() -> Bool { held != nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        attempts += 1
        guard request.url?.path == "/api/app-local/context" else { throw URLError(.badURL) }
        if shouldHold { heldRequest = request; return try await withCheckedThrowingContinuation { held = $0 } }
        return try response(request)
    }
    private func response(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
        let url = request.url!, generation = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "generation" }!.value!
        let value = AppLocalTestFixture.context(generation: generation)
        return (try JSONSerialization.data(withJSONObject: value), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
    func releaseFailure() { let value = held; held = nil; heldRequest = nil; value?.resume(throwing: URLError(.notConnectedToInternet)) }
    func releaseSuccess() throws { let value = held, request = heldRequest; held = nil; heldRequest = nil; if let request { value?.resume(returning: try response(request)) } }
    func allow() { shouldHold = false }
}

final class LocalHostedReturnTests: XCTestCase {
    @MainActor
    func testOrdinaryHostedPagesHaveNoTaskChromeAndIdentityTasksUseTextExit() async throws {
        let (bundle, directory) = try readyBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let server = try HostedReturnServer(); try await server.start(); defer { server.stop() }
        let container = ReylumiAppContainer(origin: try XCTUnwrap(server.origin), bundle: bundle)
        let window = makeWindow(container); defer { window.isHidden = true; window.rootViewController = nil }
        let local = try XCTUnwrap(container.local)
        for path in ["/staff/scan", "/staff/scan/", "/staff/scan?view=waiting", "/explore/salons/fixture#customer-experiences", "/beauty", "/payroll", "/pos", "/staff/appointments", "/settings", "/help", "/login"] {
            container.openOnline(path)
            let navigation = try XCTUnwrap(container.presentedViewController as? UINavigationController)
            let hosted = try XCTUnwrap(navigation.viewControllers.first as? ReylumiViewController)
            let ordinary = path != "/login"
            XCTAssertEqual(navigation.isNavigationBarHidden, ordinary, path)
            XCTAssertEqual(hosted.navigationItem.leftBarButtonItem == nil, ordinary, path)
            if ordinary {
                hosted.onNavigationFailure?()
                XCTAssertFalse(navigation.isNavigationBarHidden, "A failed hosted load must keep an explicit text exit")
                XCTAssertNotNil(hosted.navigationItem.leftBarButtonItem?.title)
                hosted.onUsableDestination?(try XCTUnwrap(URL(string: "/staff/scan", relativeTo: server.origin)))
                XCTAssertTrue(navigation.isNavigationBarHidden, "Recovery must remove temporary task chrome")
            }
            if !ordinary {
                XCTAssertNotNil(hosted.navigationItem.leftBarButtonItem?.title, "Use an explicit text exit instead of the system Done checkmark")
                hosted.onUsableDestination?(try XCTUnwrap(URL(string: "/staff/scan", relativeTo: server.origin)))
                XCTAssertTrue(navigation.isNavigationBarHidden, "Task chrome cannot follow the user onto an ordinary page")
                XCTAssertNil(hosted.navigationItem.leftBarButtonItem)
            }
            XCTAssertTrue(container.local === local, "Presenting a hosted tab must preserve the installed page and drafts")
            XCTAssertNotNil(hosted.onUsableDestination, "Later installed tabs must keep the verified return callback")
            for _ in 0..<100 { if !navigation.isBeingPresented { break }; try await Task.sleep(nanoseconds: 10_000_000) }
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                container.dismiss(animated: false) { continuation.resume() }
            }
        }
    }

    @MainActor
    func testAutomaticXCTestSceneCannotBootAProductionWebView() {
        XCTAssertTrue(ReylumiExecutionEnvironment.isXCTestHost)
        let roots = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).filter { !$0.isHidden }.compactMap(\.rootViewController)
        XCTAssertFalse(roots.isEmpty, "Verify the actual launched test-host scene, not an empty fixture")
        func hasProductionView(_ controller: UIViewController) -> Bool {
            controller is ReylumiAppContainer || controller is ReylumiLocalAppViewController || controller is ReylumiViewController || controller.children.contains(where: hasProductionView)
        }
        XCTAssertFalse(roots.contains(where: hasProductionView), "Explicit WK tests own their lifecycle; the automatic host must stay idle")
    }
    func testHostedReturnAcceptsOnlyCompleteOrdinaryBareRoutes() throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!
        XCTAssertEqual(bundle.hostedReturnPath(URL(string: "https://reylumi.com/help/check-in")!, origin: origin), "/help/check-in")
        for path in ["/help?token=private", "/help?payment=received", "/help?bookingStripe=returned", "/help?q=search", "/help#token", "/help/edit", "/help/setup", "/login", "/booking-payment/id", "/missing"] {
            XCTAssertNil(bundle.hostedReturnPath(URL(string: "https://reylumi.com" + path)!, origin: origin), path)
        }
        XCTAssertNil(bundle.hostedReturnPath(URL(string: "https://external.invalid/help")!, origin: origin))
    }

    @MainActor
    func testHostedSPAWaitsForNewRouteReadinessAndRejectsStaleNonce() async throws {
        let server = try HostedReturnServer(); try await server.start(); defer { server.stop() }
        let origin = try XCTUnwrap(server.origin), controller = ReylumiViewController(origin: origin, initialURL: origin.appendingPathComponent("login"))
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        var returned: [URL] = []; controller.onUsableDestination = { returned.append($0) }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        try await wait("document.getElementById('route') != null", in: web)
        for _ in 0..<100 { if returned.contains(where: { $0.path == "/login" }) { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        _ = try await web.evaluateJavaScript("history.pushState({},'', '/help');window.webkit.messageHandlers.reylumi.postMessage({action:'route-ready',nonce:'stale',generation:1,path:'/help'});true")
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertFalse(returned.contains { $0.path == "/help" }, "Changing history or an old nonce cannot dismiss authentication")
        _ = try await web.evaluateJavaScript("window.dispatchEvent(new Event('reylumi:screen-ready'));true")
        for _ in 0..<150 { if returned.contains(where: { $0.path == "/help" }) { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(returned.filter { $0.path == "/help" }.count, 1)
        _ = try await web.evaluateJavaScript("window.dispatchEvent(new Event('reylumi:screen-ready'));true")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(returned.filter { $0.path == "/help" }.count, 1, "A ready route is acknowledged once")
    }

    @MainActor
    func testHostedViewStaysUsableUntilFreshContextAndItsInstalledFrameAreReady() async throws {
        let (bundle, directory) = try readyBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let server = try HostedReturnServer(); try await server.start(); defer { server.stop() }
        let origin = try XCTUnwrap(server.origin), http = HostedReturnHTTP()
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.handoff." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests.handoff." + UUID().uuidString)!, cookies: { [] })
        let container = ReylumiAppContainer(origin: origin, bundle: bundle, transport: transport)
        let window = makeWindow(container); defer { window.isHidden = true; window.rootViewController = nil }
        let local = try XCTUnwrap(container.local); local.initializeWebContentIfNeeded()
        let installed = try XCTUnwrap(local.webView)
        try await wait("window.fixtureLocal===true", in: installed)
        _ = try await installed.evaluateJavaScript("window.retainedDraft=document.createElement('input');retainedDraft.value='44.25';document.body.append(retainedDraft);window.addEventListener('reylumi:app-local-context',e=>window.acceptedPath=e.detail.contextPath);window.addEventListener('reylumi:app-local-navigate',e=>{history.pushState({},'',e.detail.path);window.returnedPath=e.detail.path});true")
        container.openOnline("/login")
        let navigation = try XCTUnwrap(container.presentedViewController as? UINavigationController), hosted = try XCTUnwrap(navigation.viewControllers.first as? ReylumiViewController)
        var destinations: [String] = []
        let originalDestination = hosted.onUsableDestination
        hosted.onUsableDestination = { url in destinations.append(url.path); originalDestination?(url) }
        hosted.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(hosted.view.subviews.compactMap { $0 as? WKWebView }.first)
        try await wait("document.getElementById('route') != null", in: web)
        for _ in 0..<250 { if destinations.contains("/login"), !navigation.isBeingPresented { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertTrue(destinations.contains("/login"), "Wait for the actual hosted native usable callback before simulating user input")
        _ = try await web.evaluateJavaScript("document.getElementById('draft').value='Unsent login';document.getElementById('route').click();true")
        for _ in 0..<150 { if await http.isHeld() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let held = await http.isHeld(); XCTAssertTrue(held, "Automatic return must validate context; callbacks=\(destinations), current=\(hosted.hostedNavigationIdentity)"); XCTAssertTrue(container.presentedViewController === navigation)
        await http.releaseFailure()
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertTrue(container.presentedViewController === navigation)
        let usable = try await web.evaluateJavaScript("document.getElementById('draft').value==='Unsent login' && !document.getElementById('route').disabled") as? Bool
        XCTAssertEqual(usable, true)
        container.returnToInstalledApp(path: "/help", from: hosted)
        for _ in 0..<150 { if await http.isHeld() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        _ = try await web.evaluateJavaScript("history.replaceState({},'', '/login');true")
        try await http.releaseSuccess()
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertTrue(container.presentedViewController === navigation, "A late valid result cannot close a different current hosted route")
        container.returnToInstalledApp(path: "/help", from: hosted)
        for _ in 0..<150 { if await http.isHeld() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        _ = try await web.evaluateJavaScript("document.getElementById('draft').focus();true")
        try await http.releaseSuccess()
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertTrue(container.presentedViewController === navigation, "Typing started during the context check must not be dismissed")
        _ = try await web.evaluateJavaScript("document.getElementById('draft').blur();true")
        await http.allow(); container.returnToInstalledApp(path: "/help", from: hosted)
        for _ in 0..<250 { if container.presentedViewController == nil { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertNil(container.presentedViewController)
        let launch = try XCTUnwrap(local.view.subviews.compactMap { $0 as? ReylumiLaunchView }.first)
        for _ in 0..<150 { if !launch.isLoading { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertFalse(launch.isLoading, "The native public cover yields only after the returned installed view paints")
        let retained = try await installed.evaluateJavaScript("window.acceptedPath==='/help' && window.returnedPath==='/help' && window.retainedDraft.isConnected && window.retainedDraft.value==='44.25'") as? Bool
        XCTAssertEqual(retained, true)
        await transport.reset()
    }

    @MainActor
    func testColdLaunchIgnoresSavedRouteAndDoesNotOpenHostedModal() async throws {
        let (bundle, directory) = try readyBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, routes = ReylumiOfflineRouteStore(origin: origin, service: "reylumi.tests.hint." + UUID().uuidString)
        routes.save(try XCTUnwrap(ReylumiOfflineRoute(path: "/staff/my-work", expiresAt: Date().addingTimeInterval(3600)))); defer { routes.clear() }
        let container = ReylumiAppContainer(origin: origin, bundle: bundle, offlineRoutes: routes)
        let window = makeWindow(container); defer { window.isHidden = true; window.rootViewController = nil }
        let local = try XCTUnwrap(container.local); local.initializeWebContentIfNeeded()
        try await wait("window.fixtureLocal===true", in: XCTUnwrap(local.webView))
        XCTAssertEqual(local.currentPath, "/")
        XCTAssertNil(container.presentedViewController)
        _ = try await local.webView.evaluateJavaScript("history.pushState({}, '', '/help'); true")
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertEqual(local.currentPath, "/help", "Foreground must not apply the cold-start destination")
        XCTAssertEqual(routes.restored()?.path, "/staff/my-work", "Changing startup must not delete persisted work or leases")
    }

    @MainActor
    func testWarmPersonalCheckinUsesHostedOnlyRouteAndPreservesInstalledController() async throws {
        let (bundle, directory) = try readyBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertFalse(bundle.routeExists("/qr"), "The real QR capability is deliberately hosted, not a local route")
        let server = try HostedReturnServer(); try await server.start(); defer { server.stop() }
        let container = ReylumiAppContainer(origin: try XCTUnwrap(server.origin), bundle: bundle)
        let window = makeWindow(container); defer { window.isHidden = true; window.rootViewController = nil }
        let local = try XCTUnwrap(container.local)
        let entry = "00000000-0000-4000-8000-000000000001"
        container.openPersonalCheckin(path: "/qr?entry=" + entry, sequence: 1)
        let hosted = try await hostedCheckin(container, entry: entry)
        XCTAssertTrue(container.local === local, "Opening check-in must retain installed work behind the hosted task")
        XCTAssertFalse(try XCTUnwrap(hosted.navigationController).isNavigationBarHidden)
        XCTAssertNotNil(hosted.navigationItem.leftBarButtonItem?.title)
        container.openPersonalCheckin(path: "/qr?entry=00000000-0000-4000-8000-000000000002", sequence: 1)
        XCTAssertTrue((container.presentedViewController as? UINavigationController)?.viewControllers.first === hosted,
                      "A repeated delivery sequence must not replace the admitted task")
    }

    @MainActor
    func testColdPersonalCheckinWaitsForWindowThenOpensExactHostedEntry() async throws {
        let (bundle, directory) = try readyBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let server = try HostedReturnServer(); try await server.start(); defer { server.stop() }
        let container = ReylumiAppContainer(origin: try XCTUnwrap(server.origin), bundle: bundle)
        let entry = "00000000-0000-4000-8000-000000000003"
        container.openPersonalCheckin(path: "/qr?entry=" + entry, sequence: 1)
        XCTAssertNil(container.presentedViewController, "Do not lose the cold URL by presenting before a scene is attached")
        let window = makeWindow(container); defer { window.isHidden = true; window.rootViewController = nil }
        _ = try await hostedCheckin(container, entry: entry)
        XCTAssertNotNil(container.local, "The installed workspace remains available when leaving the task")
    }

    @MainActor
    private func hostedCheckin(_ container: ReylumiAppContainer, entry: String) async throws -> ReylumiViewController {
        for _ in 0..<250 {
            if let navigation = container.presentedViewController as? UINavigationController,
               let hosted = navigation.viewControllers.first as? ReylumiViewController {
                hosted.initializeWebContentIfNeeded()
                let web = try XCTUnwrap(hosted.view.subviews.compactMap { $0 as? WKWebView }.first)
                try await wait("location.pathname === '/qr' && new URLSearchParams(location.search).get('entry') === '" + entry + "' && document.getElementById('route') != null", in: web, timeout: 45)
                return hosted
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("Personal check-in disappeared instead of presenting its original hosted authority")
        throw URLError(.timedOut)
    }

    private func readyBundle() throws -> (ReylumiLocalBundle, URL) {
        let (_, directory) = try AppLocalTestFixture.bundle(), url = directory.appendingPathComponent("manifest.json")
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]); value["productionReady"] = true
        var routes = value["routes"] as! [[String: Any]]; routes.append(["path": "/", "adapter": "home", "access": "public"]); value["routes"] = routes
        try JSONSerialization.data(withJSONObject: value).write(to: url)
        return (try ReylumiLocalBundle(directory: directory), directory)
    }
    @MainActor private func makeWindow(_ controller: UIViewController) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = controller; window.isHidden = false; controller.loadViewIfNeeded(); return window
    }
    @MainActor private func wait(_ expression: String, in web: WKWebView, timeout: TimeInterval = 5) async throws {
        for _ in 0..<Int(timeout * 50) { if (try? await web.evaluateJavaScript(expression)) as? Bool == true { return }; try await Task.sleep(nanoseconds: 20_000_000) }
        XCTFail("Hosted handoff fixture did not become ready: \(expression)"); throw URLError(.timedOut)
    }
}

/// Loopback-only interactive HTML; no accounts, providers or real writes.
private final class HostedReturnServer {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "reylumi.tests.hosted-return")
    var origin: URL? { listener.port.flatMap { URL(string: "http://localhost:\($0.rawValue)") } }
    init() throws { let parameters = NWParameters.tcp; parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(IPv4Address("127.0.0.1")!), port: .any); listener = try NWListener(using: parameters) }
    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let completion = HostedReturnStart(continuation)
            listener.stateUpdateHandler = { state in if case .ready = state { completion.finish(nil) }; if case .failed(let error) = state { completion.finish(error) } }
            listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }; listener.start(queue: queue)
        }
    }
    func stop() { listener.cancel() }
    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 32768) { data, _, _, _ in
            guard data != nil else { connection.cancel(); return }
            let html = "<!doctype html><html><head><meta name='viewport' content='width=device-width'></head><body><h1>Hosted sign in</h1><input id='draft'><button id='route' onclick=\"history.pushState({},'','/help');window.dispatchEvent(new Event('reylumi:screen-ready'))\">Continue</button></body></html>"
            let bytes = Data(html.utf8), headers = Data("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(bytes.count)\r\nConnection: close\r\n\r\n".utf8)
            connection.send(content: headers + bytes, completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}
private final class HostedReturnStart {
    private let lock = NSLock(); private var continuation: CheckedContinuation<Void, Error>?
    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
    func finish(_ error: Error?) { lock.lock(); let value = continuation; continuation = nil; lock.unlock(); if let error { value?.resume(throwing: error) } else { value?.resume() } }
}
