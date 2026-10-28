import XCTest
import UIKit
import WebKit
import CryptoKit
@testable import Reylumi

actor AppLocalCookieBox {
    private(set) var values: [HTTPCookie] = []
    func append(_ cookie: HTTPCookie) { values.append(cookie) }
}

private actor CachedFirstContextHTTP: ReylumiLocalHTTPClient {
    private var held: (URL, String, CheckedContinuation<(Data, HTTPURLResponse), Error>)?
    private(set) var reads = 0
    func isContextHeld() -> Bool { held != nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        if url.path == "/api/app-local/context" {
            let generation = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "generation" }!.value!
            return try await withCheckedThrowingContinuation { held = (url, generation, $0) }
        }
        reads += 1
        let value: [String: Any] = ["schemaVersion": 1, "status": 200, "scope": AppLocalTestFixture.scope, "etag": "current", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["staff": [["name": "Current fixture roster"]]]]
        return (try JSONSerialization.data(withJSONObject: value), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
    func releaseContext(status: Int = 200) throws {
        guard let (url, generation, continuation) = held else { return }; held = nil
        let value = AppLocalTestFixture.context(generation: generation)
        continuation.resume(returning: (try JSONSerialization.data(withJSONObject: value), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!))
    }
}

/// The packaged client and native bridge stay real; this is the entire network
/// boundary, with no credentials, remote server or business command permitted.
private actor InstalledExploreRecoveryHTTP: ReylumiLocalHTTPClient {
    let timeout: Bool
    private var contextAvailable = false
    private(set) var contextRequests = 0
    private(set) var reads: [String] = []
    private(set) var commands = 0
    init(timeout: Bool) { self.timeout = timeout }
    func allowContext() { contextAvailable = true }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        var object: [String: Any], status = 200
        if url.path == "/api/app-local/context" {
            contextRequests += 1
            if !contextAvailable {
                if timeout { throw URLError(.timedOut) }
                status = 503; object = ["error": "Synthetic context service unavailable"]
            } else {
                let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
                object = AppLocalTestFixture.context(generation: generation, kind: "public")
                var context = object["context"] as! [String: Any], grant = object["grant"] as! [String: Any]
                context["authenticated"] = false; context["viewerId"] = NSNull(); context["salonId"] = NSNull(); context["workspaceId"] = "public"
                grant["viewerId"] = NSNull(); grant["salonId"] = NSNull(); grant["workspaceId"] = "public"; grant["path"] = "/explore"
                object["context"] = context; object["grant"] = grant
                object["display"] = ["name": "", "language": "en", "role": "guest"]
                object["access"] = ["ownerWorkspace": false, "staffWorkspace": false]
            }
        } else if url.path == "/api/app-local/read" {
            let name = query.first { $0.name == "name" }?.value ?? ""
            reads.append(name)
            let scope = AppLocalTestFixture.scope
            let data: [String: Any]
            switch name {
            case "page.explore": data = Self.exploreCore()
            case "shell.navigation": data = ["scope": scope, "authenticated": false, "navigation": NSNull(), "ownerQueueScope": NSNull(), "audience": "guest"]
            case "shell.configuration": data = ["scope": scope, "language": ["enabled": false, "portableEnabled": false, "expiresAt": NSNull()], "campaign": ["installed": false, "runtime": NSNull()]]
            case "shell.notice": data = ["scope": scope, "mode": NSNull()]
            default: status = 503; data = ["error": "Optional fixture read unavailable"]
            }
            object = ["schemaVersion": 1, "status": 200, "scope": scope, "etag": "fixture-explore", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": data]
        } else {
            if url.path == "/api/app-local/command" { commands += 1 }
            status = 503; object = ["error": "All commands and other network requests are forbidden"]
        }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
    private static func exploreCore() -> [String: Any] {
        let empty = NSNull()
        return [
            "commentViewer": ["identity": ["name": "Guest", "role": "personal", "salonId": empty, "avatarUrl": empty], "canModerate": false, "canReplyAsSalon": false, "isAuthenticated": false, "userId": empty],
            "discoveryContent": ["shortcuts": []], "hasUrlLocation": true,
            "homeContent": ["error": empty, "inspiration": ["error": empty, "hasMore": false, "items": [], "nextCursor": empty], "newSalons": [], "popularServices": [], "recommendedSalons": []],
            "initialFeed": ["items": [], "hasMore": false, "nextCursor": empty, "sessionCursor": empty],
            "initialLocationSource": "manual",
            "initialResponse": ["query": "fixture-recovery", "displayQuery": "fixture-recovery", "category": "", "location": "Chicago", "locationSource": "manual", "locationOrigin": "manual", "page": 1, "pageSize": 12, "results": [], "sections": ["bestMatches": [], "nearby": [], "recommended": []], "totalCount": 0, "totalPages": 1, "hasMore": false, "nextCursor": empty, "groupCounts": ["bestMatches": 0, "nearby": 0, "recommended": 0], "target": "salons", "sort": "relevance"],
            "initialSearchMode": true, "quickActions": [], "workspaceLocation": ["label": "Chicago", "source": "manual"],
            "deferred": ["extras": false, "feed": false, "showcase": false]
        ]
    }
}

@MainActor
private final class CachedReadProbe { var completed = false }

private actor RotationCookieJar {
    private(set) var values: [HTTPCookie]
    init(_ values: [HTTPCookie]) { self.values = values }
    func put(_ cookie: HTTPCookie) {
        values.removeAll { $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() && $0.path == cookie.path && $0.name == cookie.name }
        if (cookie.expiresDate ?? .distantFuture) > Date(), String(describing: cookie.properties?[.maximumAge] ?? "") != "0" { values.append(cookie) }
    }
    func removeAll() { values = [] }
}

private actor ConcurrentRotationHTTP: ReylumiLocalHTTPClient {
    static let updates = "sb-access-token=refreshed-access; Path=/; Secure; SameSite=Lax, sb-refresh-token=refreshed-refresh; Path=/; Secure; SameSite=Lax, sb-old-chunk=; Path=/; Max-Age=0; Secure"
    private var held: [(URLRequest, CheckedContinuation<(Data, HTTPURLResponse), Error>)] = []
    private(set) var readRequests = 0
    private(set) var commandRequests = 0
    private var workspaceCommit = false
    func configureWorkspaceCommit() { workspaceCommit = true }
    func heldCount() -> Int { held.count }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!, query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let object: [String: Any]
        if url.path == "/api/app-local/read" { readRequests += 1; return try await withCheckedThrowingContinuation { held.append((request, $0)) } }
        if url.path == "/api/app-local/context" { object = AppLocalTestFixture.context(generation: query.first { $0.name == "generation" }!.value!) }
        else { commandRequests += 1; object = ["ok": true, "data": ["saved": true]] }
        var fields = ["Content-Type": "application/json"]
        if workspaceCommit, url.path == "/api/app-local/command" { fields["Set-Cookie"] = "kingpos-selected-workspace=manage:two; Path=/; Secure" }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: fields)!)
    }
    func releaseAll() throws {
        let pending = held; held = []
        for (request, continuation) in pending {
            let value: [String: Any] = ["schemaVersion": 1, "status": 200, "scope": AppLocalTestFixture.scope, "etag": "refreshed", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["staff": [["name": "Mai"]]]]
            continuation.resume(returning: (try JSONSerialization.data(withJSONObject: value), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json", "Set-Cookie": Self.updates])!))
        }
    }
}

actor AppLocalFixtureHTTP: ReylumiLocalHTTPClient {
    private(set) var requests: [URLRequest] = []
    var scope = AppLocalTestFixture.scope
    var held: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var heldURL: URL?
    var holdRead = false
    private var contexts: [String: [String: String]] = [:]
    private var contextUnavailable = false
    private var readStatus = 200
    private var partialGrant = false
    private var unconfirmed = false
    private var permissionsChanged = false
    func configurePartialGrant(unconfirmed: Bool = false, permissionsChanged: Bool = false) { partialGrant = true; self.unconfirmed = unconfirmed; self.permissionsChanged = permissionsChanged }
    func configureHold() { holdRead = true }
    func configureContext(path: String, scope: String, kind: String, primaryScope: String? = nil, revision: String = "revision-a") { contexts[path] = ["scope": scope, "kind": kind, "primaryScope": primaryScope ?? scope, "revision": revision] }
    func configureContextUnavailable() { contextUnavailable = true }
    func configureReadStatus(_ value: Int) { readStatus = value }
    func isHeld() -> Bool { held != nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let url = request.url!
        if url.path == "/api/app-local/read", holdRead {
            holdRead = false
            heldURL = url
            return try await withCheckedThrowingContinuation { held = $0 }
        }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let object: [String: Any]
        if url.path == "/api/app-local/context" {
            if contextUnavailable { throw URLError(.notConnectedToInternet) }
            let config = contexts[query.first(where: { $0.name == "path" })?.value ?? ""]
            scope = config?["scope"] ?? scope
            var envelope = AppLocalTestFixture.context(generation: query.first(where: { $0.name == "generation" })!.value!, scope: scope, revision: config?["revision"] ?? "revision-a", kind: config?["kind"] ?? "owner", primaryScope: config?["primaryScope"])
            if partialGrant { envelope["grant"] = NSNull(); envelope["grantStatus"] = 503; if unconfirmed { envelope["offlineState"] = "unconfirmed" } }
            if permissionsChanged { var context = envelope["context"] as! [String: Any]; context["permissionRevision"] = "changed-permissions"; envelope["context"] = context }
            object = envelope
        }
        else if url.path == "/api/app-local/command" {
            let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
            if body?["name"] as? String == "shell.logout" { object = ["ok": true, "data": ["status": 200, "headers": [:], "body": "{\"redirectTo\":\"/login\"}"]] }
            else { object = ["ok": true, "data": ["saved": true]] }
        }
        else { object = ["schemaVersion": 1, "status": 200, "scope": scope, "etag": "fixture-etag", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["staff": [["name": "Mai"]]]] }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: url.path == "/api/app-local/read" ? readStatus : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
    func releaseHeld() throws {
        guard let continuation = held, let url = heldURL else { return }; held = nil; heldURL = nil
        let body: [String: Any] = ["schemaVersion": 1, "status": 200, "scope": scope, "etag": "old", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["old": true]]
        continuation.resume(returning: (try JSONSerialization.data(withJSONObject: body), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!))
    }
}

final class LocalAppTransportTests: XCTestCase {
    @MainActor
    func testActualInstalledExploreBoundsTransientContextRecoveryBeforeUserRetry() async throws {
        let bundle = try ReylumiLocalBundle.installed()
        XCTAssertEqual(bundle.manifest.productionReady, true); XCTAssertTrue(bundle.routeExists("/explore"))
        let blockerID = "reylumi.tests.explore-no-network." + UUID().uuidString
        let rules = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<WKContentRuleList, Error>) in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: blockerID, encodedContentRuleList: """
            [{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}}]
            """) { list, error in
                if let list { continuation.resume(returning: list) }
                else { continuation.resume(throwing: error ?? URLError(.cannotLoadFromNetwork)) }
            }
        }
        defer { WKContentRuleListStore.default().removeContentRuleList(forIdentifier: blockerID) { _ in } }
        for timeout in [true, false] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("reylumi-explore-retry-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let http = InstalledExploreRecoveryHTTP(timeout: timeout), origin = URL(string: "https://reylumi.com")!
            let defaults = UserDefaults(suiteName: "reylumi.tests.actual-explore-retry." + UUID().uuidString)!
            let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.actual-explore-retry." + UUID().uuidString)
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: defaults, cookies: { [] })
            let path = "/explore?q=fixture-recovery&location=Chicago&locationSource=manual&type=salons"
            let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: path, transport: transport)
            // Filter canonicalization belongs to the installed router. Starting
            // a second, unmatched request before that router runs wastes an auth
            // round trip and must not extend its automatic recovery budget.
            try await Task.sleep(nanoseconds: 100_000_000)
            let speculativeAttempts = await http.contextRequests
            XCTAssertEqual(speculativeAttempts, 0)
            controller.configureWebViewForTesting = { configuration in
                configuration.userContentController.add(rules)
                // Original adapters may wrap this fetch, but every unhandled
                // request remains blocked. Resource rules also block remote
                // images/scripts; no live account or business is contacted.
                configuration.userContentController.addUserScript(WKUserScript(source: """
                window.fetch=()=>Promise.reject(new TypeError('External fixture network blocked'));
                window.WebSocket=class extends EventTarget{static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;readyState=3;send(){}close(){}};
                navigator.sendBeacon=()=>false;
                """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
            window.rootViewController = controller; window.isHidden = false
            defer { controller.webView?.stopLoading(); window.isHidden = true; window.rootViewController = nil }
            controller.initializeWebContentIfNeeded()
            let web = try XCTUnwrap(controller.webView)
            let retry = "[...document.querySelectorAll('.app-local-body button')].find(x=>x.textContent.trim()==='Try again'&&x.getClientRects().length)"
            try await waitForInstalledExplore("Boolean(\(retry)) && Boolean(document.querySelector('[data-context-failure]'))", in: web)
            try await Task.sleep(nanoseconds: 300_000_000)
            let failedAttempts = await http.contextRequests, beforeReads = await http.reads
            XCTAssertEqual(failedAttempts, 2, "A transient cold context gets one automatic retry, then stops at user recovery")
            XCTAssertFalse(beforeReads.contains("page.explore"), "Explore data requires an admitted scope")
            await http.allowContext()
            if timeout {
                let clicked = try await web.evaluateJavaScript("(()=>{const button=\(retry);if(!button)return false;button.click();return true})()") as? Bool
                XCTAssertEqual(clicked, true)
            } else {
                // Native menu selection uses this event, even when the chosen
                // Explore URL is exactly the failed page already displayed.
                _ = try await web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path:location.pathname+location.search}}));true")
            }
            try await waitForInstalledExplore("!document.querySelector('[data-explore-startup]') && [...document.querySelectorAll('input')].some(x=>x.value==='fixture-recovery'&&x.getClientRects().length) && !document.body.innerText.includes('Please open this page again')", in: web)
            let reads = await http.reads, attempts = await http.contextRequests, commands = await http.commands
            XCTAssertEqual(attempts, 3); XCTAssertEqual(reads.filter { $0 == "page.explore" }.count, 1)
            XCTAssertEqual(commands, 0, "Recovery must never replay a business command")
            let blank = try await web.evaluateJavaScript("!document.querySelector('.app-local-body')?.innerText.trim()") as? Bool
            XCTAssertEqual(blank, false)
            let external = try await web.evaluateJavaScript("performance.getEntriesByType('resource').map(x=>x.name).filter(x=>/^https?:/.test(x))") as? [String] ?? []
            XCTAssertTrue(external.isEmpty, "All test UI/resources must stay local: \(external)")
            await transport.reset()
        }
    }
    @MainActor
    func testColdCachedContextWaitsForFreshAuthorityWhenPrivateReadFinishesFirst() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = CachedFirstContextHTTP()
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.cached-first." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.cached-first." + UUID().uuidString)!, cookies: { [] })
        let lease = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: transport.generation), generation: transport.generation))
        await store.accept(lease)
        var resets = 0; transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
        let cached = try await transport.context(path: "/help"); XCTAssertEqual(cached["offline"] as? Bool, true)
        for _ in 0..<200 { if await http.isContextHeld() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let held = await http.isContextHeld(); XCTAssertTrue(held)
        let probe = CachedReadProbe()
        let read = Task { @MainActor in defer { probe.completed = true }; return try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: lease.scope) }
        for _ in 0..<200 { if await http.reads == 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertFalse(probe.completed, "A cached display lease is not a fresh online read authorization")
        XCTAssertEqual(resets, 0, "An ordinary response ordering cannot clear menus/drafts")
        try await http.releaseContext()
        let response = try await read.value
        XCTAssertEqual(response["status"] as? Int, 200); XCTAssertEqual(resets, 0)
        let saved = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: lease.scope); XCTAssertNotNil(saved)
        await transport.reset()
    }
    @MainActor
    func testUnavailableContextKeepsCachedReadButExplicitDenialStillRevokesIt() async throws {
        for status in [503, 403] {
            let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
            let origin = URL(string: "https://reylumi.com")!, http = CachedFirstContextHTTP()
            let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.cached-denial." + UUID().uuidString)
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.cached-denial." + UUID().uuidString)!, cookies: { [] })
            let lease = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: transport.generation), generation: transport.generation))
            await store.accept(lease)
            let key = "fixture.roster:" + SHA256.hash(data: Data("{}".utf8)).map { String(format: "%02x", $0) }.joined()
            let payload: [String: Any] = ["schemaVersion": 1, "status": 200, "scope": lease.scope, "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["draft": "Unsent 44.25"]]
            await store.put(key, payload: try JSONSerialization.data(withJSONObject: payload), session: lease)
            var resets = 0; transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
            _ = try await transport.context(path: "/help")
            for _ in 0..<200 { if await http.isContextHeld() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
            let read = Task { @MainActor in try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: lease.scope) }
            for _ in 0..<200 { if await http.reads == 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
            try await http.releaseContext(status: status)
            do { _ = try await read.value; XCTFail("Unconfirmed or revoked authority cannot deliver a fresh private payload") }
            catch { XCTAssertEqual((error as NSError).code, status) }
            let saved = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: lease.scope)
            if status == 503 { XCTAssertNotNil(saved); XCTAssertEqual(resets, 0) }
            else { XCTAssertNil(saved); XCTAssertEqual(resets, 1) }
            await transport.reset()
        }
    }
    @MainActor
    func testConcurrentExactResponseCookieRotationsPreserveReadsAndHonorRemovedChunks() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = ConcurrentRotationHTTP()
        let original = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "sb-access-token=original-access; Path=/; Secure, sb-refresh-token=original-refresh; Path=/; Secure, sb-old-chunk=old; Path=/; Secure, kingpos-workspace=one; Path=/; Secure"], for: origin)
        XCTAssertEqual(original.count, 4); XCTAssertEqual(HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": ConcurrentRotationHTTP.updates], for: origin).count, 3)
        let jar = RotationCookieJar(original)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.rotation." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests.rotation." + UUID().uuidString)!, cookies: { await jar.values }, setCookie: { cookie in try? await Task.sleep(nanoseconds: 5_000_000); await jar.put(cookie) })
        var resets = 0; transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
        _ = try await transport.freshContext(path: "/help")
        let first = Task { @MainActor in try await transport.read(name: "fixture.roster", args: ["date": "one"], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        let second = Task { @MainActor in try await transport.read(name: "fixture.roster", args: ["date": "two"], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        for _ in 0..<150 { if await http.heldCount() == 2 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let held = await http.heldCount(); XCTAssertEqual(held, 2)
        try await http.releaseAll()
        let a = try await first.value, b = try await second.value
        XCTAssertEqual(a["status"] as? Int, 200); XCTAssertEqual(b["status"] as? Int, 200); XCTAssertEqual(resets, 0)
        let cookies = await jar.values
        XCTAssertEqual(cookies.first { $0.name == "sb-access-token" }?.value, "refreshed-access")
        XCTAssertEqual(cookies.first { $0.name == "sb-refresh-token" }?.value, "refreshed-refresh")
        XCTAssertNil(cookies.first { $0.name == "sb-old-chunk" })
        XCTAssertEqual(cookies.first { $0.name == "kingpos-workspace" }?.value, "one")
        _ = try await transport.command(name: "fixture.save", args: ["id": "one-attempt"], requestID: UUID().uuidString, path: "/help", requestedScope: AppLocalTestFixture.scope)
        let commandRequests = await http.commandRequests; XCTAssertEqual(commandRequests, 1)
        await transport.reset()
    }
    @MainActor
    func testResponseCookieProofRejectsUnrelatedWorkspaceAccountAndLogoutChanges() async throws {
        for change in ["workspace", "account", "logout", "commit-workspace"] {
            let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
            let origin = URL(string: "https://reylumi.com")!, http = ConcurrentRotationHTTP()
            let original = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "sb-access-token=original-access; Path=/; Secure, sb-refresh-token=original-refresh; Path=/; Secure, kingpos-workspace=one; Path=/; Secure"], for: origin)
            let jar = RotationCookieJar(original)
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.rotation-deny." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests.rotation-deny." + UUID().uuidString)!, cookies: { await jar.values }, setCookie: { cookie in
                await jar.put(cookie)
                if change == "commit-workspace", cookie.name == "sb-access-token" {
                    for external in HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "kingpos-workspace=two; Path=/; Secure"], for: origin) { await jar.put(external) }
                }
            })
            _ = try await transport.freshContext(path: "/help")
            var resets = 0; transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
            let read = Task { @MainActor in try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope) }
            for _ in 0..<150 { if await http.heldCount() == 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
            if change == "logout" { await jar.removeAll() }
            else if change != "commit-workspace" {
                let header = change == "workspace" ? "kingpos-workspace=two; Path=/; Secure" : "sb-access-token=different-account; Path=/; Secure"
                for cookie in HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: origin) { await jar.put(cookie) }
            }
            try await http.releaseAll()
            do { _ = try await read.value; XCTFail("An exact response refresh must not forgive an unrelated \(change) change") }
            catch { XCTAssertEqual((error as NSError).code, 409, change) }
            XCTAssertEqual(resets, 1, change)
            let values = await jar.values
            if change == "commit-workspace" { XCTAssertEqual(values.first { $0.name == "kingpos-workspace" }?.value, "two", "The final guard must catch an external change during cookie delivery") }
            else { XCTAssertFalse(values.contains { $0.value == "refreshed-access" }, "Rejected old responses cannot overwrite current identity") }
            let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: AppLocalTestFixture.scope); XCTAssertNil(cached)
        }
    }
    @MainActor
    func testLateReadAfterConfirmedWorkspaceCookieCommitIsDiscardedWithoutReset() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = ConcurrentRotationHTTP()
        let original = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "sb-access-token=original-access; Path=/; Secure, sb-refresh-token=original-refresh; Path=/; Secure, kingpos-selected-workspace=personal; Path=/; Secure"], for: origin)
        let jar = RotationCookieJar(original)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.workspace-commit." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests.workspace-commit." + UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
        _ = try await transport.freshContext(path: "/help")
        var resets = 0; transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
        let read = Task { @MainActor in try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        for _ in 0..<150 { if await http.heldCount() == 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        await http.configureWorkspaceCommit()
        _ = try await transport.command(name: "fixture.save", args: ["id": "single-role-write"], requestID: UUID().uuidString, path: "/help", requestedScope: AppLocalTestFixture.scope)
        try await http.releaseAll()
        do { _ = try await read.value; XCTFail("An old response must not be delivered after a confirmed workspace commit") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(resets, 0)
        let values = await jar.values
        XCTAssertEqual(values.first { $0.name == "kingpos-selected-workspace" }?.value, "manage:two")
        XCTAssertEqual(values.first { $0.name == "sb-access-token" }?.value, "original-access", "The stale refresh response cannot overwrite cookies")
        let count = await http.commandRequests; XCTAssertEqual(count, 1)
        await transport.reset()
    }
    @MainActor
    func testRequestedContextPathProofAndCachedPortableDisplayAuthorityAreExact() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP(), store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.path-proof." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.path-proof." + UUID().uuidString)!, cookies: { [] })
        var eventPath: String?
        transport.onEvent = { name, value in if name == "reylumi:app-local-context" { eventPath = value["contextPath"] as? String } }
        let fresh = try await transport.freshContext(path: "/help/check-in")
        XCTAssertEqual(fresh["contextPath"] as? String, "/help/check-in"); XCTAssertEqual(eventPath, "/help/check-in")
        let cached = try await transport.context(path: "/explore")
        XCTAssertEqual(cached["contextPath"] as? String, "/explore"); XCTAssertEqual(cached["offline"] as? Bool, true)
        await http.configureContextUnavailable()
        let portable = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.portableContext(generation: transport.generation), generation: transport.generation))
        await store.accept(portable)
        let display = try await transport.context(path: "/pos/customer-display")
        XCTAssertEqual(display["contextPath"] as? String, "/pos/customer-display")
        XCTAssertEqual((display["displayAuthority"] as? [String: String])?["kind"], "portable")
        XCTAssertEqual((display["context"] as? [String: Any])?["scope"] as? String, portable.scope)
        await transport.reset()
    }
    @MainActor
    func testSameScopeStaffMarketStaffRetainsDOMAuthorityAndStaffCacheUntilBindingChanges() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP(), store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.additive." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.additive." + UUID().uuidString)!, cookies: { [] })
        var resets = 0; transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
        await http.configureContext(path: "/staff/my-work", scope: AppLocalTestFixture.scope, kind: "staff", revision: "binding-a")
        await http.configureContext(path: "/market", scope: AppLocalTestFixture.scope, kind: "customer", revision: "base-a")
        _ = try await transport.freshContext(path: "/staff/my-work")
        await http.configureHold()
        let held = Task { @MainActor in try await transport.read(name: "staff.my-work", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        for _ in 0..<100 { if await http.isHeld() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        _ = try await transport.freshContext(path: "/market")
        try await http.releaseHeld(); _ = try await held.value
        let cached = try await transport.cached(name: "staff.my-work", args: [:], requestedScope: AppLocalTestFixture.scope); XCTAssertNotNil(cached)
        let epoch = transport.scopeEpoch
        _ = try await transport.context(path: "/staff/my-work")
        _ = try await transport.freshContext(path: "/staff/my-work")
        XCTAssertEqual(resets, 0); XCTAssertEqual(transport.scopeEpoch, epoch)
        _ = try await transport.freshContext(path: "/market")
        await http.configureContext(path: "/staff/my-work", scope: AppLocalTestFixture.scope, kind: "staff", revision: "binding-b")
        _ = try await transport.freshContext(path: "/staff/my-work")
        XCTAssertEqual(resets, 1, "A changed existing staff binding must still invalidate deliveries and the old staff read")
        let revoked = try await transport.cached(name: "staff.my-work", args: [:], requestedScope: AppLocalTestFixture.scope); XCTAssertNil(revoked)
        await transport.reset()
    }
    @MainActor
    func testCachedAuthorityRotationAdmitsSelectedLeaseWithoutCancellingItsOwnContextRead() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP(), staffScope = "v3:" + String(repeating: "b", count: 64)
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.cached-rotation." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.cached-rotation." + UUID().uuidString)!, cookies: { [] })
        await http.configureContext(path: "/pos", scope: AppLocalTestFixture.scope, kind: "owner")
        await http.configureContext(path: "/staff/my-work", scope: staffScope, kind: "staff", primaryScope: AppLocalTestFixture.scope)
        _ = try await transport.freshContext(path: "/pos")
        _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope)
        _ = try await transport.freshContext(path: "/staff/my-work")
        _ = try await transport.freshContext(path: "/pos")
        let oldEpoch = transport.scopeEpoch, oldNonce = transport.nonce, generation = transport.generation
        await http.configureHold()
        let oldRead = Task { @MainActor in try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        for _ in 0..<100 { if await http.isHeld() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let held = await http.isHeld(); XCTAssertTrue(held)
        await http.configureContextUnavailable()
        var resets: [[String: Any]] = [], contextRead: Task<[String: Any], Error>?
        transport.onEvent = { name, detail in
            guard name == "reylumi:app-local-reset" else { return }
            resets.append(detail)
            // The entry cancels outstanding reads on revocation, but a context
            // rotation must be allowed to finish delivering its selected lease.
            if detail["reason"] as? String != "context" { contextRead?.cancel() }
        }
        let operation = Task { @MainActor in
            let value = try await transport.context(path: "/staff/my-work")
            try Task.checkCancellation()
            return value
        }
        contextRead = operation
        let selection = await operation.result
        try await http.releaseHeld()
        let previousDelivery = await oldRead.result
        let selected = try selection.get()
        XCTAssertEqual(selected["contextPath"] as? String, "/staff/my-work")
        XCTAssertEqual(selected["offline"] as? Bool, true)
        XCTAssertEqual((selected["context"] as? [String: Any])?["scope"] as? String, staffScope)
        XCTAssertEqual((selected["grant"] as? [String: Any])?["kind"] as? String, "staff")
        XCTAssertEqual(resets.count, 1); XCTAssertEqual(resets.first?["reason"] as? String, "context")
        XCTAssertEqual(transport.scopeEpoch, oldEpoch + 1); XCTAssertNotEqual(transport.nonce, oldNonce)
        XCTAssertEqual(transport.generation, generation)
        let host = selected["host"] as? [String: Any]
        XCTAssertEqual(host?["scopeEpoch"] as? Int, transport.scopeEpoch)
        XCTAssertEqual(host?["nonce"] as? String, transport.nonce); XCTAssertEqual(host?["generation"] as? String, generation)
        do { _ = try previousDelivery.get(); XCTFail("A context rotation must still reject deliveries for the previous authority") }
        catch { XCTAssertTrue(error is CancellationError) }
        let owner = await store.session(generation: generation, scope: AppLocalTestFixture.scope, authority: "owner")
        let staff = await store.session(generation: generation, scope: staffScope, authority: "staff")
        XCTAssertNotNil(owner); XCTAssertNotNil(staff)
        let roster = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: AppLocalTestFixture.scope)
        XCTAssertNotNil(roster, "An authority switch must retain the other role's unexpired display cache")
        await transport.reset()
    }
    @MainActor
    func testFullSessionResetStillRevokesCachedAuthorityAndRejectsOldGeneration() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP()
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.cached-generation." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.cached-generation." + UUID().uuidString)!, cookies: { [] })
        let original = try await transport.freshContext(path: "/explore")
        let oldGeneration = transport.generation, oldEpoch = transport.scopeEpoch, oldNonce = transport.nonce
        let oldLease = try XCTUnwrap(ReylumiLocalSession.verified(original, generation: oldGeneration))
        var resetDetail: [String: Any]?
        transport.onEvent = { name, detail in if name == "reylumi:app-local-reset" { resetDetail = detail } }
        await transport.reset()
        XCTAssertNotEqual(transport.generation, oldGeneration)
        XCTAssertEqual(transport.scopeEpoch, oldEpoch + 1); XCTAssertNotEqual(transport.nonce, oldNonce)
        XCTAssertNotNil(resetDetail); XCTAssertEqual(resetDetail?["generation"] as? String, transport.generation)
        XCTAssertEqual(resetDetail?["reason"] as? String, "explicitReset", "A full reset must retain its typed non-context reason so outstanding admission is cancelled")
        XCTAssertNil(resetDetail?["status"], "An explicit local reset must not fabricate an HTTP authorization status")
        let cleared = await store.session(generation: oldGeneration); XCTAssertNil(cleared)
        // Even a leftover encrypted lease cannot admit the previous generation.
        await store.accept(oldLease)
        await http.configureContextUnavailable()
        do { _ = try await transport.context(path: "/explore"); XCTFail("The new session cannot restore the previous account generation") } catch {}
        let matches = await transport.matchesCachedScope(oldLease.scope); XCTAssertFalse(matches)
        await transport.reset()
    }
    @MainActor
    func testPortableLockPersistsOriginalHTTPSCookieAndOnlyRevokesDeviceDisplayLease() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.local-lock." + UUID().uuidString), http = AppLocalFixtureHTTP(), cookieBox = AppLocalCookieBox()
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.local-lock." + UUID().uuidString)!, cookies: { await cookieBox.values }, setCookie: { await cookieBox.append($0) })
        let owner = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: transport.generation), generation: transport.generation)), portable = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.portableContext(generation: transport.generation), generation: transport.generation))
        await store.accept(owner); await store.accept(portable)
        await store.put("owner-roster", payload: Data("{\"data\":{\"amount\":44.25}}".utf8), session: owner)
        await http.configureContextUnavailable()
        _ = try await transport.context(path: "/pos/portable")
        await transport.lockPortable()
        let denied = await store.session(generation: transport.generation, path: "/pos/portable"), retained = await store.session(generation: transport.generation, authority: "owner")
        XCTAssertNil(denied); XCTAssertNotNil(retained)
        let cookies = await cookieBox.values, lock = try XCTUnwrap(cookies.first { $0.name == "kingpos-portable-local-lock" })
        XCTAssertEqual(lock.domain, "reylumi.com"); XCTAssertEqual(lock.path, "/"); XCTAssertEqual(lock.value, "1"); XCTAssertTrue(lock.isSecure); XCTAssertFalse(lock.isHTTPOnly)
        let roster = await store.get("owner-roster", session: owner); XCTAssertNotNil(roster)
        do { _ = try await transport.context(path: "/pos/portable"); XCTFail("Cold access cannot reuse a locked Portable lease") } catch {}
        await store.clear()
    }
    @MainActor
    func testUnusedDefaultTransportsReleaseWithoutCreatingADeinitializingSessionDelegate() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        for _ in 0..<20 {
            weak var released: ReylumiLocalAppTransport?
            autoreleasepool {
                let value = ReylumiLocalAppTransport(origin: URL(string: "https://reylumi.com")!, manifest: bundle.manifest, cookies: { [] })
                released = value
            }
            XCTAssertNil(released)
        }
        // URLSession's invalidation callback is asynchronous; the previous
        // lazy/delegate-self bug crashed here after an unused client released.
        try await Task.sleep(nanoseconds: 300_000_000)
    }
    @MainActor
    func testOnlyNamedReadsUseFixedEndpointAndCommandsAreSingleAttempt() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = AppLocalFixtureHTTP(), defaults = UserDefaults(suiteName: "reylumi.tests." + UUID().uuidString)!
        let store = ReylumiLocalReadStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: "reylumi.tests." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: URL(string: "https://reylumi.com")!, manifest: bundle.manifest, store: store, client: http, defaults: defaults, cookies: { [] })
        _ = try await transport.freshContext(path: "/help")
        let read = try await transport.read(name: "fixture.roster", args: ["date": "2026-10-16"], etag: "version-a", requestedScope: AppLocalTestFixture.scope)
        XCTAssertEqual(read["status"] as? Int, 200)
        let cached = try await transport.cached(name: "fixture.roster", args: ["date": "2026-10-16"])
        XCTAssertEqual(cached?["offline"] as? Bool, true)
        do { _ = try await transport.read(name: "https://evil.invalid", args: [:], etag: nil); XCTFail("An arbitrary URL is not a resource name") } catch {}
        do { _ = try await transport.read(name: "fixture.roster", args: ["url": "https://evil.invalid"], etag: nil); XCTFail("Unknown argument accepted") } catch {}
        _ = try await transport.command(name: "fixture.save", args: ["id": "fixture"], requestID: UUID().uuidString, path: "/help", requestedScope: AppLocalTestFixture.scope)
        let requests = await http.requests
        XCTAssertEqual(requests.filter { $0.httpMethod == "POST" }.count, 1)
        XCTAssertTrue(requests.allSatisfy { $0.url?.host == "reylumi.com" && $0.url?.path.hasPrefix("/api/app-local/") == true })
        XCTAssertEqual(requests.first(where: { $0.url?.path == "/api/app-local/read" })?.value(forHTTPHeaderField: "If-None-Match"), "version-a")
        await transport.reset()
        let removed = try await transport.cached(name: "fixture.roster", args: ["date": "2026-10-16"]); XCTAssertNil(removed)
    }
    @MainActor
    func testLateReadAfterResetCannotReturnOrPersistOldAccountData() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = AppLocalFixtureHTTP(), defaults = UserDefaults(suiteName: "reylumi.tests." + UUID().uuidString)!
        let transport = ReylumiLocalAppTransport(origin: URL(string: "https://reylumi.com")!, manifest: bundle.manifest,
            store: ReylumiLocalReadStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: "reylumi.tests." + UUID().uuidString), client: http, defaults: defaults, cookies: { [] })
        _ = try await transport.freshContext(path: "/help")
        await http.configureHold()
        let pending = Task { @MainActor in try await transport.read(name: "fixture.roster", args: [:], etag: nil) }
        for _ in 0..<100 { if await http.isHeld() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let held = await http.isHeld(); XCTAssertTrue(held)
        let previousGeneration = transport.generation
        await transport.reset()
        XCTAssertNotEqual(transport.generation, previousGeneration)
        try await http.releaseHeld()
        do { _ = try await pending.value; XCTFail("An old read escaped the session reset") } catch {}
        let cached = try await transport.cached(name: "fixture.roster", args: [:]); XCTAssertNil(cached)
    }
    @MainActor
    func testStaffAndOwnerContextsSelectMatchingLeaseAndDeniedScopeDoesNotEraseOtherRole() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP(), staffScope = "v3:" + String(repeating: "b", count: 64)
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.multirole." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests." + UUID().uuidString)!, cookies: { [] })
        await http.configureContext(path: "/pos", scope: AppLocalTestFixture.scope, kind: "owner")
        await http.configureContext(path: "/staff/my-work", scope: staffScope, kind: "staff", primaryScope: AppLocalTestFixture.scope)
        _ = try await transport.freshContext(path: "/pos")
        _ = try await transport.freshContext(path: "/staff/my-work")
        _ = try await transport.read(name: "staff.my-work", args: [:], etag: nil, requestedScope: staffScope)
        _ = try await transport.freshContext(path: "/pos")
        let retainedStaff = try await transport.cached(name: "staff.my-work", args: [:], requestedScope: staffScope)
        XCTAssertNotNil(retainedStaff)
        await http.configureContextUnavailable()
        let cachedStaff = try await transport.context(path: "/staff/my-work")
        XCTAssertEqual((cachedStaff["context"] as? [String: Any])?["scope"] as? String, staffScope)
        XCTAssertEqual(cachedStaff["offline"] as? Bool, true)
        await http.configureReadStatus(403)
        do { _ = try await transport.read(name: "staff.my-work", args: [:], etag: nil, requestedScope: staffScope); XCTFail("Denied data must not return a cached read") } catch {}
        let denied = await store.session(generation: transport.generation, scope: staffScope)
        let owner = await store.session(generation: transport.generation, scope: AppLocalTestFixture.scope, authority: "owner")
        XCTAssertNil(denied); XCTAssertNotNil(owner)
        await transport.reset()
    }
    @MainActor
    func testAuthoritative404EvictsOnlyExactReadBut503RetainsOtherSnapshot() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP()
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest,
            store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.missing." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests." + UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/help")
        for date in ["2026-10-15", "2026-10-16"] { _ = try await transport.read(name: "fixture.roster", args: ["date": date], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        await http.configureReadStatus(404)
        do { _ = try await transport.read(name: "fixture.roster", args: ["date": "2026-10-15"], etag: nil, requestedScope: AppLocalTestFixture.scope); XCTFail("A deleted relationship must not return its cached data") } catch {}
        let missing = try await transport.cached(name: "fixture.roster", args: ["date": "2026-10-15"], requestedScope: AppLocalTestFixture.scope)
        let other = try await transport.cached(name: "fixture.roster", args: ["date": "2026-10-16"], requestedScope: AppLocalTestFixture.scope)
        XCTAssertNil(missing); XCTAssertNotNil(other)
        await http.configureReadStatus(503)
        do { _ = try await transport.read(name: "fixture.roster", args: ["date": "2026-10-16"], etag: nil, requestedScope: AppLocalTestFixture.scope) } catch {}
        let retained = try await transport.cached(name: "fixture.roster", args: ["date": "2026-10-16"], requestedScope: AppLocalTestFixture.scope); XCTAssertNotNil(retained)
        await transport.reset()
    }
    @MainActor
    func testPartialLeaseFailurePreservesOnlyUnchangedAuthorityAndNeverAllowsCommands() async throws {
        for scenario in ["temporary", "scope-change", "unconfirmed", "permission-change"] {
            let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
            let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP()
            let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.partial." + UUID().uuidString)
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.partial." + UUID().uuidString)!, cookies: { [] })
            _ = try await transport.freshContext(path: "/help")
            _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope)
            let original = await store.session(generation: transport.generation)
            var resets = 0; transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
            if scenario == "scope-change" { await http.configureContext(path: "/help", scope: "v3:" + String(repeating: "b", count: 64), kind: "owner") }
            await http.configurePartialGrant(unconfirmed: scenario == "unconfirmed", permissionsChanged: scenario == "permission-change")
            let fresh = try await transport.freshContext(path: "/help")
            XCTAssertEqual(fresh["grantStatus"] as? Int, 503)
            XCTAssertEqual(fresh["offline"] as? Bool, false)
            if scenario == "temporary" {
                let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: AppLocalTestFixture.scope)
                let retained = await store.session(generation: transport.generation)
                XCTAssertNotNil(cached); XCTAssertEqual(resets, 0)
                XCTAssertEqual(retained?.expiresAt, original?.expiresAt, "A failed refresh must never extend an offline lease")
                do { _ = try await transport.command(name: "fixture.save", args: ["id": "one-attempt"], requestID: UUID().uuidString, path: "/help", requestedScope: AppLocalTestFixture.scope); XCTFail("Commands require fresh authority") } catch {}
                let requests = await http.requests; XCTAssertFalse(requests.contains { $0.url?.path == "/api/app-local/command" })
            } else { XCTAssertEqual(resets, 1, "A real authority change still invalidates the old visible session") }
            await transport.reset()
        }
    }

    @MainActor
    func testForbiddenReadEvictsOnlyItsSnapshotWithoutResettingOtherPages() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP()
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.forbidden." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests.forbidden." + UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/help")
        for date in ["one", "two"] { _ = try await transport.read(name: "fixture.roster", args: ["date": date], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        var resets = 0; transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
        await http.configureReadStatus(403)
        do { _ = try await transport.read(name: "fixture.roster", args: ["date": "one"], etag: nil, requestedScope: AppLocalTestFixture.scope); XCTFail("Forbidden data must not be returned") }
        catch { XCTAssertEqual((error as NSError).code, 403) }
        let denied = try await transport.cached(name: "fixture.roster", args: ["date": "one"], requestedScope: AppLocalTestFixture.scope)
        let other = try await transport.cached(name: "fixture.roster", args: ["date": "two"], requestedScope: AppLocalTestFixture.scope)
        XCTAssertNil(denied); XCTAssertNotNil(other); XCTAssertEqual(resets, 0)
        await transport.reset()
    }

    @MainActor
    func testLongNamedReadUsesBoundedSameOriginJSONPostWithoutCommandReplay() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP()
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest,
            store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.longread." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests." + UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/help")
        let filters = String(repeating: "fixture-filter", count: 160)
        _ = try await transport.read(name: "fixture.roster", args: ["date": filters], etag: "read-only-r1", requestedScope: AppLocalTestFixture.scope)
        let requests = await http.requests, request = try XCTUnwrap(requests.last)
        XCTAssertEqual(request.url?.path, "/api/app-local/read"); XCTAssertNil(request.url?.query); XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://reylumi.com"); XCTAssertEqual(request.value(forHTTPHeaderField: "If-None-Match"), "read-only-r1")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["name"] as? String, "fixture.roster"); XCTAssertEqual((body["args"] as? [String: Any])?["date"] as? String, filters); XCTAssertEqual(body["scope"] as? String, AppLocalTestFixture.scope)
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/app-local/read" }.count, 1); XCTAssertEqual(requests.filter { $0.url?.path == "/api/app-local/command" }.count, 0)
        do { _ = try await transport.read(name: "fixture.roster", args: ["date": String(repeating: "x", count: 32769)], etag: nil, requestedScope: AppLocalTestFixture.scope); XCTFail("Oversized filters must fail before sending") } catch {}
        let bounded = await http.requests; XCTAssertEqual(bounded.count, requests.count)
        await transport.reset()
    }
    @MainActor
    private func waitForInstalledExplore(_ expression: String, in web: WKWebView) async throws {
        var lastError: Error?
        for _ in 0..<400 {
            do { if try await web.evaluateJavaScript(expression) as? Bool == true { return } }
            catch { lastError = error }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("Actual installed Explore did not recover: \(lastError?.localizedDescription ?? expression)")
        throw URLError(.timedOut)
    }
}
