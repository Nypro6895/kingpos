import XCTest
import UIKit
import WebKit
@testable import Reylumi

private actor AppLocalUnavailableHTTP: ReylumiLocalHTTPClient {
    private(set) var attempts = 0
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { attempts += 1; throw URLError(.notConnectedToInternet) }
}

final class LocalAppWebViewTests: XCTestCase {
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
