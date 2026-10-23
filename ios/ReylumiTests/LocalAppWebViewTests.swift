import XCTest
import UIKit
import WebKit
@testable import Reylumi

private actor AppLocalUnavailableHTTP: ReylumiLocalHTTPClient {
    private(set) var attempts = 0
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { attempts += 1; throw URLError(.notConnectedToInternet) }
}

/// All authority and DTOs are synthetic. No request reaches a business server.
private actor InstalledPOSFixtureHTTP: ReylumiLocalHTTPClient {
    struct Command: Sendable { let name: String; let values: [Bool]?; let scope: String? }
    static let relayLoader = "action.5290c94f98ce780e04f5d9ad"
    let viewer = UUID().uuidString.lowercased()
    let salon = "00000000-0000-4000-8000-000000000002"
    private(set) var commands: [Command] = []
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        var object: [String: Any], status = 200
        if url.path == "/api/app-local/context" {
            let generation = query.first { $0.name == "generation" }?.value ?? ""
            object = AppLocalTestFixture.context(generation: generation, viewer: viewer, workspace: salon)
            var grant = object["grant"] as! [String: Any]; grant["workspaceId"] = salon; object["grant"] = grant
            object["display"] = ["name": "Fixture owner", "language": "en", "role": "OWNER"]
            object["access"] = ["ownerWorkspace": true, "staffWorkspace": false]
        } else if url.path == "/api/app-local/read", query.first(where: { $0.name == "name" })?.value == "owner.workspace" {
            let now = Date(), today = String(ISO8601DateFormatter().string(from: now).prefix(10))
            let turns: [String: Int] = ["queueTurns": 2, "largeTurns": 2, "smallTurns": 0, "totalTurns": 2, "receiptLargeTurns": 0]
            let staff: [String: Any] = ["id": "00000000-0000-4000-8000-000000000003", "display_name": "Alice", "is_active": true, "job_title": "Technician", "today_status": "working", "turns": turns]
            let defaults: [String: Any] = ["adsFooter": "", "largeTurnThreshold": 25, "showServiceName": true, "showStaffName": true, "staffCheckInEnabled": false, "taxEnabled": false, "tipSuggestions": [10, 15, 20]]
            let preferences: [String: Any] = ["showStaff": true, "showServices": true, "showCustomer": true, "showTip": true, "showDiscount": true, "idleMinutes": 3, "idleWarningSeconds": 60]
            let reference: [String: Any] = [
                "ownerScope": "owner:" + salon + ":" + viewer, "salonId": salon, "salonName": "Fixture salon", "timezone": "America/Chicago", "today": today,
                "staff": [staff], "services": [], "defaults": defaults, "preferences": preferences
            ]
            object = ["schemaVersion": 1, "status": 200, "scope": AppLocalTestFixture.scope, "etag": "fixture-owner-r1", "updatedAt": now.timeIntervalSince1970 * 1000, "data": ["view": "workspace", "props": reference]]
        } else if url.path == "/api/app-local/command" {
            let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
            let name = body?["name"] as? String ?? "", args = body?["args"] as? [String: Any]
            let values = args?["values"] as? [Bool], scope = body?["scope"] as? String
            commands.append(Command(name: name, values: values, scope: scope))
            // DeskRelay mounts its original loader once per WebView. Its real
            // server action may dispatch relay work; never call it in a test.
            // Simulate only its exact request with a noninstalled fixture.
            if request.httpMethod == "POST", name == Self.relayLoader, values == [true], scope == AppLocalTestFixture.scope {
                object = ["ok": true, "data": ["value": ["data": ["installed": false, "tickets": [], "services": []]]]]
            } else { status = 503; object = ["error": "Fixture forbids all other business commands"] }
        } else {
            status = 503; object = ["error": "Fixture has no other network or business actions"]
        }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
}

@MainActor
private final class LocalConfirmationProbe {
    var message: String?
    var reply: ((Bool) -> Void)?
}

final class LocalAppWebViewTests: XCTestCase {
    @MainActor
    func testInstalledJavaScriptConfirmDeliversBothUserChoicesInsteadOfImplicitCancel() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help"), probe = LocalConfirmationProbe()
        controller.confirmationPresenterForTesting = { message, reply in probe.message = message; probe.reply = reply }
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded(); let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        for accepted in [true, false] {
            probe.message = nil; probe.reply = nil
            _ = try await web.evaluateJavaScript("window.confirmResult=null;setTimeout(()=>{window.confirmResult=window.confirm('Keep this draft?')},0);true")
            for _ in 0..<100 { if probe.reply != nil { break }; try await Task.sleep(nanoseconds: 10_000_000) }
            XCTAssertEqual(probe.message, "Keep this draft?")
            let reply = try XCTUnwrap(probe.reply); probe.reply = nil; reply(accepted)
            try await wait("window.confirmResult === \(accepted ? "true" : "false")", in: web)
        }
    }
    @MainActor
    func testNativeBackForwardRestoresActualHistoryWithoutReplacingTheDraftDocument() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded(); let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        XCTAssertTrue(web.allowsBackForwardNavigationGestures)
        _ = try await web.evaluateJavaScript("window.backDraft=document.createElement('input');backDraft.value='Unsent 44.25';document.body.append(backDraft);window.nativeNavigations=0;window.pops=0;window.addEventListener('reylumi:app-local-navigate',()=>nativeNavigations++);window.addEventListener('popstate',()=>pops++);history.pushState({},'','/help/one');history.pushState({},'','/help/two');true")
        XCTAssertTrue(web.canGoBack); web.goBack()
        try await wait("location.pathname==='/help/one'&&window.pops===1", in: web)
        web.goForward(); try await wait("location.pathname==='/help/two'&&window.pops===2", in: web)
        let retained = try await web.evaluateJavaScript("backDraft.isConnected&&backDraft.value==='Unsent 44.25'&&nativeNavigations===0") as? Bool
        XCTAssertEqual(retained, true)
    }
    @MainActor
    func testExplicitFreshContextDoesNotReplyWithPreviousCachedWorkspace() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP(), nextScope = "v3:" + String(repeating: "b", count: 64)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.fresh." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests.fresh." + UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/help")
        await http.configureContext(path: "/help", scope: nextScope, kind: "owner")
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help", transport: transport)
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded(); let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        let fresh = try await evaluateAsync("window.__reylumiAppLocalTransport.request({id:'00000000-0000-4000-8000-000000000098',kind:'context',name:'context',args:{path:'/help',fresh:true}}).then(reply=>reply.context.scope==='\(nextScope)'&&reply.offline===false&&reply.host.nonce===window.__reylumiAppLocalContext.nonce)", in: web) as? Bool
        XCTAssertEqual(fresh, true)
    }
    @MainActor
    func testProgrammaticLocalNavigationRetainsSameDocumentAndUnsentInput() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded(); let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        _ = try await web.evaluateJavaScript("window.retainedInput=document.createElement('input');retainedInput.value='Unsent 44.25';document.body.append(retainedInput);window.addEventListener('reylumi:app-local-navigate',e=>{window.retainedEvent=e.detail.path;history.pushState({},'',e.detail.path)});window.location.assign('/help/check-in?q=draft')")
        try await wait("window.retainedEvent==='/help/check-in?q=draft' && location.pathname==='/help/check-in'", in: web)
        let retained = try await web.evaluateJavaScript("window.retainedInput?.isConnected && window.retainedInput?.value==='Unsent 44.25'") as? Bool
        XCTAssertEqual(retained, true)
    }
    @MainActor
    func testProgrammaticHostedCheckoutAndSignInKeepTheirOriginalNativeBoundary() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        var external: URL?, online: String?
        controller.onOpenExternal = { external = $0 }; controller.onOpenOnline = { online = $0 }
        controller.initializeWebContentIfNeeded(); let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        _ = try await web.evaluateJavaScript("window.location.assign('https://checkout.stripe.com/c/pay/fixture-no-transaction')")
        for _ in 0..<100 { if external != nil { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(external?.host, "checkout.stripe.com"); XCTAssertEqual(web.url?.scheme, "reylumi-app")
        _ = try await web.evaluateJavaScript("window.location.assign('https://reylumi.com/login?next=%2Fmarket')")
        for _ in 0..<100 { if online != nil { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(online, "/login?next=%2Fmarket")
        external = nil
        _ = try await web.evaluateJavaScript("window.location.assign('http://unsafe.invalid/')")
        try await Task.sleep(nanoseconds: 100_000_000); XCTAssertNil(external)
    }
    @MainActor
    func testLogoutAcknowledgesNewMetadataAndClearsPrivateLeaseBeforeOfflineContext() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, http = AppLocalFixtureHTTP(), store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.logout." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: "reylumi.tests.logout." + UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/help")
        _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope)
        let oldGeneration = transport.generation
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help", transport: transport)
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded(); let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        _ = try await evaluateAsync("window.__reylumiAppLocalTransport.request({id:'00000000-0000-4000-8000-000000000099',kind:'command',name:'shell.logout',args:{scope:'\(AppLocalTestFixture.scope)'}}).then(reply=>{window.logoutReply=reply;return reply.signedOut===true&&reply.host.generation===window.__reylumiAppLocalContext.generation})", in: web)
        XCTAssertNotEqual(transport.generation, oldGeneration)
        await http.configureContextUnavailable()
        let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: AppLocalTestFixture.scope); XCTAssertNil(cached)
        do { _ = try await transport.context(path: "/help"); XCTFail("A successful logout must never restore its old private context") } catch {}
        let requests = await http.requests
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/app-local/command" }.count, 1)
    }
    @MainActor
    func testInstalledClassicClientWorksWithoutAnySuccessfulNetworkRead() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = AppLocalUnavailableHTTP()
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help",
            transport: ReylumiLocalAppTransport(origin: URL(string: "https://reylumi.com")!, manifest: bundle.manifest, client: http, cookies: { [] }))
        controller.loadViewIfNeeded()
        XCTAssertNil(controller.webView, "Native first frame must not synchronously construct WebKit")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true && !!window.__reylumiAppLocalTransport && document.querySelector('h1')?.textContent === 'Fixture Help'", in: web)
        _ = try await web.evaluateJavaScript("document.getElementById('next').click()")
        try await wait("document.getElementById('guide').textContent === 'A complete local guide'", in: web)
        let requests = try await web.evaluateJavaScript("performance.getEntriesByType('resource').map(x=>x.name)") as? [String] ?? []
        XCTAssertTrue(requests.allSatisfy { $0.hasPrefix("reylumi-app://bundle/") })
        let attempts = await http.attempts; XCTAssertEqual(attempts, 0)
        // The bridge exists on the app origin, but never on an arbitrary page.
        XCTAssertEqual(web.url?.scheme, "reylumi-app")
        XCTAssertTrue(web.configuration.limitsNavigationsToAppBoundDomains)
    }
    @MainActor
    func testActualPackagedHelpCatalogAndArticleAreUsableOfflineBeforeSignIn() async throws {
        // This intentionally fails when the release forgot its generated bundle;
        // it must never turn a generic fixture into proof of product coverage.
        let bundle = try ReylumiLocalBundle.installed()
        XCTAssertTrue(bundle.routeExists("/help"))
        let http = AppLocalUnavailableHTTP(), defaults = UserDefaults(suiteName: "reylumi.tests.actual-help." + UUID().uuidString)!
        let transport = ReylumiLocalAppTransport(origin: URL(string: "https://reylumi.com")!, manifest: bundle.manifest, client: http, defaults: defaults, cookies: { [] })
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help", transport: transport)
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.webView)
        try await wait("document.querySelectorAll('a[href^=\"/help/\"]').length > 3 && document.body.innerText.toLowerCase().includes('help')", in: web)
        let initial = try await web.evaluateJavaScript("document.querySelector('h1')?.textContent") as? String
        _ = try await web.evaluateJavaScript("document.querySelector('a[href^=\"/help/\"]').click()")
        try await wait("location.pathname.startsWith('/help/') && document.querySelectorAll('li').length > 3", in: web)
        let article = try await web.evaluateJavaScript("document.querySelector('h1')?.textContent") as? String
        XCTAssertNotNil(article); XCTAssertNotEqual(initial, article)
        let networkResources = try await web.evaluateJavaScript("performance.getEntriesByType('resource').map(x=>x.name).filter(x=>!x.startsWith('reylumi-app://bundle/'))") as? [String] ?? []
        XCTAssertTrue(networkResources.isEmpty, "Help text, CSS, images and runtime must come from the installed app: \(networkResources)")
    }
    @MainActor
    func testActualInstalledPOSInitializerRetainsMoneyAndOutboxAcrossColdWebView() async throws {
        let bundle = try ReylumiLocalBundle.installed(), http = InstalledPOSFixtureHTTP()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("reylumi-pos-init-" + UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let origin = URL(string: "https://reylumi.com")!, viewer = await http.viewer, salon = await http.salon
        let scope = "owner:" + salon + ":" + viewer, key = "kingpos:owner-cart:v1:" + scope, operation = UUID().uuidString
        let parameters = String(decoding: try JSONSerialization.data(withJSONObject: ["scope": scope, "key": key, "operation": operation]), as: UTF8.self)
        let defaults = UserDefaults(suiteName: "reylumi.tests.actual-pos." + UUID().uuidString)!
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.actual-pos." + UUID().uuidString)
        // Installed app.js, storage, checkpoint and cryptography stay real. Only
        // external network is disabled; the native transport above is synthetic.
        let isolation = """
        window.__posExternalAttempts=0;
        window.fetch=()=>{window.__posExternalAttempts++;return Promise.reject(new TypeError('Fixture blocks external fetch'))};
        window.WebSocket=class extends EventTarget{static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;readyState=3;constructor(){super();window.__posExternalAttempts++}send(){}close(){}};
        Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true,writable:true});
        window.__posUUIDAbsentBeforeEntry=typeof crypto.randomUUID==='undefined';
        """
        func makeController() -> ReylumiLocalAppViewController {
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: defaults, cookies: { [] })
            let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/pos", transport: transport)
            controller.configureWebViewForTesting = { configuration in
                configuration.userContentController.addUserScript(WKUserScript(source: isolation, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            return controller
        }
        var controller: ReylumiLocalAppViewController? = makeController()
        let window = makeWindow(controller!); defer { window.isHidden = true; window.rootViewController = nil }
        controller!.initializeWebContentIfNeeded()
        var web: WKWebView? = try XCTUnwrap(controller?.webView)
        let ready = "!!document.querySelector('.owner-amount-field input[aria-label=Amount]')"
        try await wait(ready, in: web!)
        let prepared = try await evaluateAsync("""
        (async()=>{
          const p=\(parameters),saved=JSON.parse(localStorage.getItem(p.key));
          if(!window.__posUUIDAbsentBeforeEntry||typeof crypto.randomUUID!=='function'||!/^[a-f0-9-]{36}$/i.test(saved?.cart?.id))throw Error('Actual bootstrap/cart initialization failed');
          const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('fixture-only'));
          if(digest.byteLength!==32)throw Error('Actual WebCrypto failed');
          window.__posInitialCartId=saved.cart.id;
          const input=document.querySelector('.owner-amount-field input[aria-label=Amount]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'44.25');input.dispatchEvent(new Event('input',{bubbles:true}));
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kingpos-portable-operations',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          await new Promise((resolve,reject)=>{const t=db.transaction(['operations','meta'],'readwrite',{durability:'strict'});t.objectStore('operations').add({id:p.operation,scope:p.scope,kind:'receipt',occurredAt:new Date().toISOString(),payload:{fixtureOnly:true,localDraftKey:p.key},state:'attention',error:'Fixture review'});t.objectStore('meta').put(1,`receipt:${p.scope}:${p.key}`);t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error)});
          db.close();return saved.cart.id;
        })()
        """, in: web!) as? String
        let cartID = try XCTUnwrap(prepared)
        try await wait("JSON.parse(localStorage.getItem(\(parameters).key))?.cart?.amount==='44.25'", in: web!)
        for _ in 0..<100 { if await http.commands.count >= 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let firstMountCommands = await http.commands; XCTAssertEqual(firstMountCommands.count, 1)
        weak var old = web
        window.rootViewController = nil; web?.stopLoading(); web?.removeFromSuperview(); web = nil; controller = nil
        for _ in 0..<100 { if old == nil { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertNil(old, "Cold initialization must construct a new WebView")
        let cold = makeController(); window.rootViewController = cold; cold.initializeWebContentIfNeeded()
        let restored = try XCTUnwrap(cold.webView); try await wait(ready, in: restored)
        let expectedID = String(decoding: try JSONSerialization.data(withJSONObject: [cartID]), as: UTF8.self)
        let durable = try await evaluateAsync("""
        (async()=>{
          const p=\(parameters),saved=JSON.parse(localStorage.getItem(p.key));
          const input=document.querySelector('.owner-amount-field input[aria-label=Amount]');
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kingpos-portable-operations',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          const rows=await new Promise((resolve,reject)=>{const r=db.transaction('operations').objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          const checkpoint=await new Promise((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').get(`receipt:${p.scope}:${p.key}`);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          const own=rows.filter(row=>row.id===p.operation&&row.scope===p.scope);
          const valid=saved.cart.id===\(expectedID)[0]&&saved.cart.amount==='44.25'&&input?.value==='44.25'&&checkpoint===1&&own.length===1&&own[0].state==='attention'&&!document.querySelector('[data-owner-cart-state=failed]');
          // Delete only this test's unique draft/row, never another outbox.
          if(own.length===1)await new Promise((resolve,reject)=>{const t=db.transaction(['operations','meta'],'readwrite',{durability:'strict'});t.objectStore('operations').delete(own[0].sequence);t.objectStore('meta').delete(`receipt:${p.scope}:${p.key}`);t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error)});
          db.close();localStorage.removeItem(p.key);return valid;
        })()
        """, in: restored) as? Bool
        XCTAssertEqual(durable, true, "Actual POS, submission checkpoint, cryptography and saved outbox must survive a cold installed origin")
        for _ in 0..<100 { if await http.commands.count >= 2 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let commands = await http.commands
        XCTAssertEqual(commands.map(\.name), [InstalledPOSFixtureHTTP.relayLoader, InstalledPOSFixtureHTTP.relayLoader], "One original DeskRelay loader per mount; no financial action or queued operation may be replayed")
        XCTAssertTrue(commands.allSatisfy { $0.values == [true] && $0.scope == AppLocalTestFixture.scope }, "The synthetic loader cannot stand in for a different action/arguments/workspace")
    }
    @MainActor
    func testNativeResetUpdatesBridgeEpochAndRejectsOldEnvelope() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.webView)
        try await wait("!!window.__reylumiAppLocalTransport", in: web)
        _ = try await web.evaluateJavaScript("window.oldAppContext={...window.__reylumiAppLocalContext}")
        await controller.transport.reset()
        try await wait("window.__reylumiAppLocalContext.scopeEpoch > window.oldAppContext.scopeEpoch", in: web)
        let accepted = try await evaluateAsync("window.webkit.messageHandlers.appLocal.postMessage({version:1,id:window.oldAppContext.nonce,kind:'cache',name:'ready',args:{},...window.oldAppContext}).then(x=>!x.__hostError)", in: web) as? Bool
        XCTAssertEqual(accepted, false)
    }
    @MainActor
    func testCustomOriginHasCryptographicRandomAndDurableStrictIndexedDBBeforeOutboxUse() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let name = "reylumi-local-storage-test-" + UUID().uuidString
        var controller: ReylumiLocalAppViewController? = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller!)
        defer { window.isHidden = true; window.rootViewController = nil }
        controller?.initializeWebContentIfNeeded()
        var web: WKWebView? = try XCTUnwrap(controller?.webView)
        try await wait("window.fixtureLocal === true", in: web!)
        let realm = try await web!.evaluateJavaScript("({origin:location.origin,href:location.href,isSecureContext:window.isSecureContext,cryptoRandom:typeof crypto.getRandomValues,cryptoSubtle:typeof crypto.subtle,indexedDB:typeof indexedDB,localStorage:typeof localStorage})")
        if let value = realm as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json"); attachment.name = "Actual installed WK custom-origin storage capabilities"; attachment.lifetime = .keepAlways; add(attachment)
        }
        let setup = """
        (async()=>{
          const name=\(String(decoding: try JSONSerialization.data(withJSONObject: [name]), as: UTF8.self))[0];
          const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);if(!bytes.some(Boolean))throw Error('Cryptographic random unavailable');
          localStorage.setItem(name,'draft-44.25');
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          await new Promise((resolve,reject)=>{const t=db.transaction('drafts','readwrite',{durability:'strict'});t.objectStore('drafts').put({id:'unsent',amount:'44.25',operationId:'same-id'});t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});
          db.close();return true;
        })()
        """
        let stored = try await evaluateAsync(setup, in: web!) as? Bool; XCTAssertEqual(stored, true)
        weak var old = web
        window.rootViewController = nil; web?.stopLoading(); web?.removeFromSuperview(); web = nil; controller = nil
        for _ in 0..<100 { if old == nil { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertNil(old, "Destroy the original WebView before testing persistence")
        let cold = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        window.rootViewController = cold; cold.initializeWebContentIfNeeded()
        let restored = try XCTUnwrap(cold.webView)
        try await wait("window.fixtureLocal === true", in: restored)
        let check = """
        (async()=>{
          const name=\(String(decoding: try JSONSerialization.data(withJSONObject: [name]), as: UTF8.self))[0];
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          const value=await new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').get('unsent');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();
          const valid=localStorage.getItem(name)==='draft-44.25'&&value?.amount==='44.25'&&value?.operationId==='same-id';
          localStorage.removeItem(name);await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error)});return valid;
        })()
        """
        let durable = try await evaluateAsync(check, in: restored) as? Bool
        XCTAssertEqual(durable, true, "A bundled shell is insufficient if the original financial draft storage cannot survive a cold WebView")
    }
    @MainActor
    func testCustomOriginSupportsActualOfflineStaffDigestPBKDF2AndRSAEncryption() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        let algorithms = """
        (async()=>{
          if(!crypto.subtle)throw Error('Offline staff requires actual WebCrypto on the installed origin');
          const bytes=s=>new TextEncoder().encode(s),hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
          if(hex(await crypto.subtle.digest('SHA-256',bytes('abc')))!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')throw Error('SHA-256 failed');
          const material=await crypto.subtle.importKey('raw',bytes('password'),'PBKDF2',false,['deriveBits']);
          const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes('salt'),iterations:1},material,256);
          if(hex(derived)!=='120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b')throw Error('PBKDF2 failed');
          const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
          const spki=await crypto.subtle.exportKey('spki',pair.publicKey),key=await crypto.subtle.importKey('spki',spki,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
          const sealed=await crypto.subtle.encrypt({name:'RSA-OAEP'},key,bytes('fixture-only'));
          return sealed.byteLength===256&&new TextDecoder().decode(await crypto.subtle.decrypt({name:'RSA-OAEP'},pair.privateKey,sealed))==='fixture-only';
        })()
        """
        let supported = try await evaluateAsync(algorithms, in: web) as? Bool
        XCTAssertEqual(supported, true, "Never enable offline staff financial commands with missing or substituted cryptography")
    }
    @MainActor
    func testCustomOriginHasActualExclusiveWebLocksForOriginalPOSWriterGuard() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        let script = """
        (async()=>{
          if(typeof navigator.locks?.request!=='function')throw Error('Original POS requires actual exclusive Web Locks');
          const name='reylumi-fixture-pos-writer';let release,entered;
          const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
          const first=navigator.locks.request(name,{mode:'exclusive'},async lock=>{if(!lock)throw Error('Missing first lock');entered();await held});
          await ready;
          const second=await navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>lock===null);
          release();await first;
          const third=await navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>!!lock);
          return second&&third;
        })()
        """
        let exclusive = try await evaluateAsync(script, in: web) as? Bool
        XCTAssertEqual(exclusive, true, "Do not replace the POS money-writer exclusion with a single-page JavaScript flag")
    }
    @MainActor
    func testOriginalLocalPhotoProcessingCanLoadItsTemporaryBlobImage() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        let supported = try await evaluateAsync("""
        (async()=>{
          const canvas=document.createElement('canvas');canvas.width=canvas.height=1;canvas.getContext('2d').fillRect(0,0,1,1);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
          if(!blob)throw Error('Photo fixture could not be created');
          const url=URL.createObjectURL(blob);
          try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth===1);image.onerror=()=>reject(Error('Local photo preview blocked'));image.src=url})}
          finally{URL.revokeObjectURL(url)}
        })()
        """, in: web) as? Bool
        XCTAssertEqual(supported, true)
    }
    @MainActor
    func testExistingMapProviderCanUseItsLocalBlobWorkerWithoutRemoteScripts() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(mapEnabled: true); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: "/help")
        let window = makeWindow(controller); defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let web = try XCTUnwrap(controller.webView)
        try await wait("window.fixtureLocal === true", in: web)
        let supported = try await evaluateAsync("""
        (async()=>{
          const url=URL.createObjectURL(new Blob(['self.onmessage=e=>self.postMessage(e.data+1)'],{type:'text/javascript'}));
          let worker;try{worker=new Worker(url);return await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data===2);worker.onerror=()=>reject(Error('Existing map worker blocked'));worker.postMessage(1)})}
          finally{worker?.terminate();URL.revokeObjectURL(url)}
        })()
        """, in: web) as? Bool
        XCTAssertEqual(supported, true)
    }
    @MainActor
    func testNotReadyManifestPreservesOriginalHTTPSController() throws {
        let container = ReylumiAppContainer(origin: URL(string: "https://reylumi.com")!)
        // The assembled app keeps productionReady=false until actual route
        // adapters pass; a compiled host alone must not switch the live UI.
        if (try? ReylumiLocalBundle.installed().manifest.productionReady) != true {
            container.loadViewIfNeeded()
            XCTAssertTrue(container.children.contains { $0 is ReylumiViewController })
        }
    }
    @MainActor
    private func evaluateAsync(_ source: String, in web: WKWebView) async throws -> Any? {
        // Never return a Promise as an Objective-C result. A per-test result
        // slot awaits the actual operation without linking the newer Swift
        // WebKit overlay absent from supported older Simulator runtimes.
        let key = "__reylumiTestResult" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let operation = "Promise.race([(\(source)),new Promise((_,reject)=>setTimeout(()=>reject(Error('Installed capability timed out')),12000))])"
        _ = try await web.evaluateJavaScript("window.\(key)={done:false};Promise.resolve().then(()=>\(operation)).then(value=>window.\(key)={done:true,value},error=>window.\(key)={done:true,error:String(error?.message??error)});true")
        defer { web.evaluateJavaScript("delete window.\(key)", completionHandler: nil) }
        for _ in 0..<700 {
            if let result = try await web.evaluateJavaScript("window.\(key)") as? [String: Any], result["done"] as? Bool == true {
                if let message = result["error"] as? String { throw NSError(domain: "InstalledWebKitCapability", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
                return result["value"]
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        throw URLError(.timedOut)
    }
    @MainActor
    private func makeWindow(_ controller: UIViewController) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = controller; window.isHidden = false; controller.loadViewIfNeeded()
        return window
    }
    @MainActor
    private func wait(_ expression: String, in web: WKWebView) async throws {
        var last: Error?
        for _ in 0..<200 {
            do { if try await web.evaluateJavaScript(expression) as? Bool == true { return } } catch { last = error }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("Local app did not become usable: \(last?.localizedDescription ?? expression)")
        throw URLError(.timedOut)
    }
}
