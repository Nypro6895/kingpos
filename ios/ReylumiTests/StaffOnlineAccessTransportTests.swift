import XCTest
import Foundation
import CryptoKit
import UIKit
import WebKit
@testable import Reylumi

/// Synthetic HTTPS responses only; no account, binding or business mutation.
private actor StaffOnlineHTTP: ReylumiLocalHTTPClient {
    enum Mode: Equatable, Sendable { case approved, online, plain503, unconfirmed }
    private var mode = Mode.online
    private var patch: [String: Any] = [:]
    private var proofPatch: [String: Any] = [:]
    private var contextPatch: [String: Any] = [:]
    private var networkDown = false
    private var readStatus = 200
    private var commandStatus = 200
    private var heldContext: (URL, [String: Any], CheckedContinuation<(Data, HTTPURLResponse), Error>)?
    private var holdSignal: XCTestExpectation?
    private(set) var contexts = 0
    private(set) var reads = 0
    private(set) var commands: [String] = []
    private(set) var contextCapabilities: [String?] = []
    private(set) var otherCapabilities: [String?] = []
    func configure(_ mode: Mode = .online, patch: [String: Any] = [:], proof: [String: Any] = [:], context: [String: Any] = [:]) {
        self.mode = mode; self.patch = patch; proofPatch = proof; contextPatch = context
    }
    func configureNetworkDown() { networkDown = true }
    func configureReadStatus(_ status: Int) { readStatus = status }
    func configureCommandStatus(_ status: Int) { commandStatus = status }
    func holdNextContext(_ signal: XCTestExpectation) { holdSignal = signal }
    func releaseContext() throws {
        let (url, object, continuation) = try XCTUnwrap(heldContext); heldContext = nil
        continuation.resume(returning: try response(url, object: object))
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if url.path == "/api/app-local/context" {
            contexts += 1
            contextCapabilities.append(request.value(forHTTPHeaderField: "X-Reylumi-Staff-Online-Access"))
            if networkDown { throw URLError(.notConnectedToInternet) }
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            var object = AppLocalTestFixture.context(generation: generation, kind: "staff")
            var context = object["context"] as! [String: Any]
            context.merge(contextPatch) { _, new in new }; object["context"] = context
            object["access"] = ["ownerWorkspace": false, "staffWorkspace": true]
            object["grantStatus"] = 200
            if mode != .approved {
                object["grant"] = NSNull(); object["grantStatus"] = 503
                if mode == .unconfirmed { object["offlineState"] = "unconfirmed" }
                if mode == .online {
                    object["offlineState"] = "online-only"
                    var proof: [String: Any] = ["version": 1, "staffId": "00000000-0000-4000-8000-000000000003", "viewerId": context["viewerId"]!, "salonId": context["salonId"]!, "scope": context["scope"]!]
                    proof.merge(proofPatch) { _, new in new }; object["staffOnlineAccess"] = proof
                }
            }
            object.merge(patch) { _, new in new }
            if let signal = holdSignal {
                holdSignal = nil
                return try await withCheckedThrowingContinuation { heldContext = (url, object, $0); signal.fulfill() }
            }
            return try response(url, object: object)
        }
        otherCapabilities.append(request.value(forHTTPHeaderField: "X-Reylumi-Staff-Online-Access"))
        if url.path == "/api/app-local/command" {
            let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            commands.append(body?["name"] as? String ?? "")
            return try response(url, object: ["ok": commandStatus == 200, "data": ["saved": true]], status: commandStatus)
        }
        guard url.path == "/api/app-local/read" else { throw URLError(.unsupportedURL) }
        reads += 1
        if networkDown { throw URLError(.notConnectedToInternet) }
        let scope = query.first { $0.name == "scope" }?.value ?? AppLocalTestFixture.scope
        return try response(url, object: ["schemaVersion": 1, "status": 200, "scope": scope, "etag": "staff-online-r1", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["value": "fresh"]], status: readStatus)
    }
    private func response(_ url: URL, object: [String: Any], status: Int = 200) throws -> (Data, HTTPURLResponse) {
        (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
}

final class StaffOnlineAccessTransportTests: XCTestCase {
    private let origin = URL(string: "https://reylumi.com")!
    private let path = "/staff/my-work"
    private let scope = AppLocalTestFixture.scope
    private let otherScope = "v3:" + String(repeating: "b", count: 64)
    private func action(_ module: String, _ name: String) -> String {
        "action." + String(SHA256.hash(data: Data((module + "#" + name).utf8)).map { String(format: "%02x", $0) }.joined().prefix(24))
    }
    private func fixtureBundle() throws -> (ReylumiLocalBundle, URL) {
        let (_, directory) = try AppLocalTestFixture.bundle()
        let file = directory.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        var routes = manifest["routes"] as! [[String: Any]]
        for path in ["/staff/my-work", "/staff/workday", "/staff/appointments", "/staff/today", "/pos", "/market"] { routes.append(["path": path, "adapter": "fixture", "access": "scoped"]) }
        manifest["routes"] = routes
        manifest["reads"] = ["staff.my-work", "fixture.roster"].map { ["name": $0, "path": "/api/app-local/read", "argumentKeys": ["date"], "access": "scoped", "cacheable": true] as [String: Any] }
        var commands = manifest["commands"] as! [[String: Any]]
        for name in ["http.staff.confirm-booking", action("app/staff/workday/actions.ts", "checkInStaffWorkday"), "shell.switch-workspace", "http.owner.save", action("app/service-relay/actions.ts", "setServiceRelayPlugin")] {
            commands.append(["name": name, "path": "/api/app-local/command", "argumentKeys": []])
        }
        manifest["commands"] = commands
        try JSONSerialization.data(withJSONObject: manifest).write(to: file)
        return (try ReylumiLocalBundle(directory: directory), directory)
    }
    @MainActor
    private func makeTransport(_ bundle: ReylumiLocalBundle, directory: URL, http: StaffOnlineHTTP, origin: URL? = nil) -> (ReylumiLocalAppTransport, ReylumiLocalReadStore) {
        let target = origin ?? self.origin
        let store = ReylumiLocalReadStore(origin: target, directory: directory, service: UUID().uuidString)
        return (ReylumiLocalAppTransport(origin: target, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] }), store)
    }
    private func key(_ date: String, name: String = "staff.my-work") throws -> String {
        let data = try JSONSerialization.data(withJSONObject: ["date": date], options: [.sortedKeys])
        return name + ":" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    private func payload(_ scope: String) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "status": 200, "scope": scope, "data": ["value": "old"]])
    }

    @MainActor
    func testExplicitStaffOnlineProofReadsFreshWithoutOfflineOrBackgroundAuthority() async throws {
        let (bundle, directory) = try fixtureBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = StaffOnlineHTTP(), (transport, store) = makeTransport(bundle, directory: directory, http: http)
        let value = try await transport.freshContext(path: path)
        XCTAssertEqual(value["offlineState"] as? String, "online-only")
        XCTAssertEqual(value["offline"] as? Bool, false)
        let read = try await transport.read(name: "staff.my-work", args: ["date": "today"], etag: nil, requestedScope: scope)
        XCTAssertEqual((read["data"] as? [String: String])?["value"], "fresh")
        let lease = await store.session(generation: transport.generation), cached = try await transport.cached(name: "staff.my-work", args: ["date": "today"], requestedScope: scope)
        XCTAssertNil(lease); XCTAssertNil(cached); XCTAssertFalse(transport.backgroundDrainAllowed(scope))
        do { _ = try await transport.backgroundRegistration(["scope": scope]); XCTFail("Online identity cannot register offline/background access") } catch { XCTAssertEqual((error as NSError).code, 403) }
        await http.configureNetworkDown()
        do { _ = try await transport.context(path: path); XCTFail("Online-only identity cannot restore a cached Staff context") } catch { XCTAssertTrue(error is URLError) }
        do { _ = try await transport.read(name: "staff.my-work", args: ["date": "today"], etag: nil, requestedScope: scope); XCTFail("Online-only identity cannot restore Staff data offline") } catch { XCTAssertTrue(error is URLError) }
        await transport.reset()
    }

    @MainActor
    func testExplicitOnlineOnlyPurgesSameScopeStaffLeaseAndSnapshotInsteadOfTemporaryOutageReuse() async throws {
        let (bundle, directory) = try fixtureBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = StaffOnlineHTTP(), (transport, store) = makeTransport(bundle, directory: directory, http: http)
        await http.configure(.approved)
        _ = try await transport.freshContext(path: path)
        _ = try await transport.read(name: "staff.my-work", args: ["date": "today"], etag: nil, requestedScope: scope)
        let before = try await transport.cached(name: "staff.my-work", args: ["date": "today"], requestedScope: scope)
        XCTAssertNotNil(before)
        await http.configure(.online)
        _ = try await transport.freshContext(path: path)
        let lease = await store.session(generation: transport.generation, scope: scope, authority: "staff")
        let after = try await transport.cached(name: "staff.my-work", args: ["date": "today"], requestedScope: scope)
        XCTAssertNil(lease); XCTAssertNil(after)
        XCTAssertFalse(transport.backgroundDrainAllowed(scope))
        await http.configure(.approved)
        _ = try await transport.freshContext(path: path)
        let renewed = try await transport.cached(name: "staff.my-work", args: ["date": "today"], requestedScope: scope)
        XCTAssertNil(renewed, "An unchanged approval revision cannot revive the withdrawn Staff snapshot")
        await transport.reset()
    }

    @MainActor
    func testMalformedStaleWrongIdentityAndWrongRouteOnlineProofsRemainDenied() async throws {
        let cases: [(String, [String: Any], [String: Any], [String: Any], String)] = [
            ("missing proof", ["staffOnlineAccess": NSNull()], [:], [:], path),
            ("explicit403", ["grantStatus": 403], [:], [:], path),
            ("explicit unconfirmed", ["offlineState": "unconfirmed"], [:], [:], path),
            ("wrong viewer", [:], ["viewerId": "00000000-0000-4000-8000-000000000009"], [:], path),
            ("wrong salon", [:], ["salonId": "00000000-0000-4000-8000-000000000009"], [:], path),
            ("wrong scope", [:], ["scope": otherScope], [:], path),
            ("malformed staff", [:], ["staffId": "invalid"], [:], path),
            ("boolean version", [:], ["version": true], [:], path),
            ("fractional version", [:], ["version": 1.5], [:], path),
            ("stale", ["onlineValidatedAt": Date().addingTimeInterval(-31).timeIntervalSince1970 * 1000], [:], [:], path),
            ("future", ["onlineValidatedAt": Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000], [:], [:], path),
            ("missing capability", ["access": ["staffWorkspace": false]], [:], [:], path),
            ("numeric capability", ["access": ["staffWorkspace": 1]], [:], [:], path),
            ("unauthenticated", [:], [:], ["authenticated": false], path),
            ("owner route", [:], [:], [:], "/staff/today"),
            ("account route", [:], [:], [:], "/market")
        ]
        for (label, patch, proof, context, route) in cases {
            let (bundle, directory) = try fixtureBundle(); defer { try? FileManager.default.removeItem(at: directory) }
            let http = StaffOnlineHTTP(), (transport, store) = makeTransport(bundle, directory: directory, http: http)
            await http.configure(.approved); _ = try await transport.freshContext(path: path)
            await http.configure(.online, patch: patch, proof: proof, context: context)
            _ = try await transport.freshContext(path: route)
            let lease = await store.session(generation: transport.generation, authority: "staff")
            let removal = await transport.matchesCacheRemovalScope(scope)
            XCTAssertNil(lease, label); XCTAssertFalse(removal, label)
            do { _ = try await transport.read(name: "staff.my-work", args: [:], etag: nil, requestedScope: scope); XCTFail(label) } catch { XCTAssertEqual((error as NSError).code, 503, label) }
            let commands = await http.commands; XCTAssertTrue(commands.isEmpty, label)
            await transport.reset()
        }
    }

    @MainActor
    func testOnlineOnlyCommandsUseFreshBoundedStaffPreflightAndNeverReplayServerDenial() async throws {
        let (bundle, directory) = try fixtureBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = StaffOnlineHTTP(), (transport, _) = makeTransport(bundle, directory: directory, http: http)
        _ = try await transport.freshContext(path: path)
        let before = await http.contexts
        _ = try await transport.command(name: "http.staff.confirm-booking", args: [:], requestID: UUID().uuidString, path: path, requestedScope: scope)
        _ = try await transport.command(name: action("app/staff/workday/actions.ts", "checkInStaffWorkday"), args: [:], requestID: UUID().uuidString, path: "/staff/workday", requestedScope: scope)
        let after = await http.contexts
        XCTAssertEqual(after, before + 2, "Every command requires its own fresh read")
        for name in ["fixture.save", "http.owner.save", action("app/service-relay/actions.ts", "setServiceRelayPlugin")] {
            do { _ = try await transport.command(name: name, args: name == "fixture.save" ? ["id": "never"] : [:], requestID: UUID().uuidString, path: path, requestedScope: scope); XCTFail("Other command acquired Staff proof: \(name)") } catch { XCTAssertEqual((error as NSError).code, 503) }
        }
        do { _ = try await transport.command(name: "http.staff.confirm-booking", args: [:], requestID: UUID().uuidString, path: path, requestedScope: otherScope); XCTFail("Wrong scope") } catch { XCTAssertEqual((error as NSError).code, 409) }
        do { _ = try await transport.command(name: "http.staff.confirm-booking", args: [:], requestID: UUID().uuidString, path: path); XCTFail("Online-only command has no displayed scope") } catch { XCTAssertEqual((error as NSError).code, 409) }
        await http.configureCommandStatus(403)
        do { _ = try await transport.command(name: "http.staff.confirm-booking", args: [:], requestID: UUID().uuidString, path: path, requestedScope: scope); XCTFail("Server denied command") } catch { XCTAssertEqual((error as NSError).code, 403) }
        let commands = await http.commands
        XCTAssertEqual(commands.count, 3, "Two allowed commands and one denied POST; no other command or replay")
        let contextCapabilities = await http.contextCapabilities, otherCapabilities = await http.otherCapabilities
        XCTAssertTrue(contextCapabilities.allSatisfy { $0 == "1" }, "Only this native protocol opts into new Staff online mode")
        XCTAssertTrue(otherCapabilities.allSatisfy { $0 == nil }, "Capability header is not added to command or resource requests")
        await transport.reset()
    }

    @MainActor
    func testGeneric503UnconfirmedAndNonHTTPSCannotAcquireNewStaffCommandOrRemovalAuthority() async throws {
        for mode in [StaffOnlineHTTP.Mode.plain503, .unconfirmed, .online] {
            let (bundle, directory) = try fixtureBundle(); defer { try? FileManager.default.removeItem(at: directory) }
            let http = StaffOnlineHTTP(), (transport, _) = makeTransport(bundle, directory: directory, http: http, origin: mode == .online ? URL(string: "http://localhost")! : nil)
            await http.configure(mode)
            _ = try await transport.freshContext(path: path)
            let removal = await transport.matchesCacheRemovalScope(scope)
            XCTAssertFalse(removal)
            do { _ = try await transport.command(name: "http.staff.confirm-booking", args: [:], requestID: UUID().uuidString, path: path, requestedScope: scope); XCTFail("No new Staff proof authority") } catch { XCTAssertEqual((error as NSError).code, 503) }
            let commands = await http.commands; XCTAssertTrue(commands.isEmpty)
            await transport.reset()
        }
    }

    @MainActor
    func testOnlineOnlyResourceDenialsAndEvictionNeverRequireOrCreateAReadLease() async throws {
        let (bundle, directory) = try fixtureBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = StaffOnlineHTTP(), (transport, store) = makeTransport(bundle, directory: directory, http: http)
        _ = try await transport.freshContext(path: path)
        let issued = Date(), generation = transport.generation
        var envelope = AppLocalTestFixture.context(generation: generation, kind: "customer")
        var grant = envelope["grant"] as! [String: Any]; grant["expiresAt"] = issued.addingTimeInterval(2).timeIntervalSince1970 * 1000; envelope["grant"] = grant
        let owned = try XCTUnwrap(ReylumiLocalSession.verified(envelope, generation: generation))
        await store.accept(owned)
        let first = try key("first"), second = try key("second")
        await store.put(first, payload: try payload(scope), session: owned)
        await store.put(second, payload: try payload(scope), session: owned)
        let deniedKey = try key("denied", name: "fixture.roster"), otherKey = try key("other", name: "fixture.roster")
        await store.put(deniedKey, payload: try payload(scope), session: owned)
        await store.put(otherKey, payload: try payload(scope), session: owned)
        await store.remove(first, generation: "another-generation", scope: scope)
        await store.remove(first, generation: generation, scope: otherScope)
        let retained = await store.get(first, session: owned, now: issued)
        XCTAssertNotNil(retained, "Wrong generation/scope must not evict the owned row")
        let remaining = max(0, owned.expiresAt.timeIntervalSinceNow + 0.05)
        try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
        let cachedScope = await transport.matchesCachedScope(scope), removal = await transport.matchesCacheRemovalScope(scope)
        XCTAssertFalse(cachedScope); XCTAssertTrue(removal, "Fresh proof permits eviction even after the unrelated display lease expires")
        let pending = await store.beginRead(first, scope: scope), pendingOther = await store.beginRead(second, scope: scope)
        await http.configureReadStatus(404)
        do { _ = try await transport.read(name: "staff.my-work", args: ["date": "first"], etag: nil, requestedScope: scope); XCTFail("Authoritative missing resource") } catch { XCTAssertEqual((error as NSError).code, 404) }
        let deleted = await store.get(first, session: owned, now: issued), other = await store.get(second, session: owned, now: issued)
        XCTAssertNil(deleted); XCTAssertNotNil(other, "Only the denied resource is evicted")
        let permitsOld = await store.permitsRead(pending, key: first, scope: scope), permitsOther = await store.permitsRead(pendingOther, key: second, scope: scope)
        XCTAssertFalse(permitsOld); XCTAssertTrue(permitsOther, "Exact eviction cancels the old DTO, not unrelated pending reads")
        await store.finishRead(pending); await store.finishRead(pendingOther)
        await http.configureReadStatus(403)
        do { _ = try await transport.read(name: "fixture.roster", args: ["date": "denied"], etag: nil, requestedScope: scope); XCTFail("Feature denied") } catch { XCTAssertEqual((error as NSError).code, 403) }
        let featureDeleted = await store.get(deniedKey, session: owned, now: issued), featureOther = await store.get(otherKey, session: owned, now: issued)
        let featureRemoval = await transport.matchesCacheRemovalScope(scope)
        XCTAssertNil(featureDeleted); XCTAssertNotNil(featureOther); XCTAssertTrue(featureRemoval, "Feature denial must preserve the account's online proof")
        do { _ = try await transport.read(name: "staff.my-work", args: ["date": "second"], etag: nil, requestedScope: scope); XCTFail("Staff relationship denied") } catch { XCTAssertEqual((error as NSError).code, 403) }
        let deniedRemoval = await transport.matchesCacheRemovalScope(scope)
        XCTAssertFalse(deniedRemoval, "Explicit403 withdraws the fresh proof")
        await transport.reset()
    }

    @MainActor
    func testPreResetHeldOnlineProofCannotRestoreStaffAuthorityOrRemoveNewScopeData() async throws {
        let (bundle, directory) = try fixtureBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = StaffOnlineHTTP(), (transport, _) = makeTransport(bundle, directory: directory, http: http)
        let held = expectation(description: "Staff HTTPS response held before reset")
        await http.holdNextContext(held)
        let contextPath = path
        let old = Task { @MainActor in try await transport.freshContext(path: contextPath) }
        await fulfillment(of: [held], timeout: 5)
        let oldGeneration = transport.generation
        await transport.reset()
        await http.configure(.online, context: ["scope": otherScope])
        _ = try await transport.freshContext(path: path)
        try await http.releaseContext()
        do { _ = try await old.value; XCTFail("Pre-reset proof escaped lifecycle fence") } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertNotEqual(oldGeneration, transport.generation)
        let oldRemoval = await transport.matchesCacheRemovalScope(scope), currentRemoval = await transport.matchesCacheRemovalScope(otherScope)
        XCTAssertFalse(oldRemoval); XCTAssertTrue(currentRemoval)
        await transport.reset()
    }

    @MainActor
    func testActualCacheBridgeAllowsOnlyRemovalWithFreshOnlineStaffProof() async throws {
        let (bundle, directory) = try fixtureBundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let http = StaffOnlineHTTP(), (transport, _) = makeTransport(bundle, directory: directory, http: http)
        _ = try await transport.freshContext(path: path)
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: path, transport: transport)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = controller; window.isHidden = false; controller.loadViewIfNeeded()
        defer { window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded(); let web = try XCTUnwrap(controller.webView)
        for _ in 0..<200 {
            if (try? await web.evaluateJavaScript("window.fixtureLocal===true")) as? Bool == true { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let ready = try await web.evaluateJavaScript("window.fixtureLocal===true") as? Bool; XCTAssertEqual(ready, true)
        let result = try await evaluateAsync("""
            (async () => {
            let calls=0;
            const request = (op, scope) => window.__reylumiAppLocalTransport.request({id:'00000000-0000-4000-8000-'+String(++calls).padStart(12,'0'),kind:'cache',name:'staff.my-work',args:{op,scope,arguments:{date:'today'}}});
            let getDenied=false, wrongDenied=false;
            try { await request('get', '\(scope)'); } catch (error) { getDenied=error.status===403; }
            const removal=await request('remove', '\(scope)');
            try { await request('remove', '\(otherScope)'); } catch (error) { wrongDenied=error.status===403; }
            return getDenied && removal.ok===true && wrongDenied;
            })()
            """, in: web) as? Bool
        XCTAssertEqual(result, true)
        let reads = await http.reads, commands = await http.commands
        XCTAssertEqual(reads, 0, "Cache eviction never issues a named read"); XCTAssertTrue(commands.isEmpty)
        await transport.reset()
    }

    @MainActor
    private func evaluateAsync(_ source: String, in web: WKWebView) async throws -> Any? {
        // Match the installed-app tests: await the actual bridge Promise through
        // an Objective-C result slot, without the Swift WebKit overlay that is
        // absent from the supported iOS 18 Simulator runtime.
        let key = "__staffOnlineTestResult" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let operation = "Promise.race([(\(source)),new Promise((_,reject)=>setTimeout(()=>reject(Error('Staff cache bridge timed out')),12000))])"
        _ = try await web.evaluateJavaScript("window.\(key)={done:false};Promise.resolve().then(()=>\(operation)).then(value=>window.\(key)={done:true,value},error=>window.\(key)={done:true,error:String(error?.message??error)});true")
        defer { web.evaluateJavaScript("delete window.\(key)", completionHandler: nil) }
        for _ in 0..<700 {
            if let result = try await web.evaluateJavaScript("window.\(key)") as? [String: Any], result["done"] as? Bool == true {
                if let message = result["error"] as? String { throw NSError(domain: "StaffOnlineCacheBridge", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
                return result["value"]
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        throw URLError(.timedOut)
    }

    func testPinnedStaffActionIDsExistInActuallyInstalledManifest() throws {
        let installed = try ReylumiLocalBundle.installed(), names = Set(installed.manifest.commands.map(\.name))
        let actions = [
            ("app/staff/workday/actions.ts", "checkInStaffWorkday"), ("app/staff/workday/actions.ts", "checkOutStaffWorkday"), ("app/staff/workday/actions.ts", "updateStaffWorkdayStatus"),
            ("app/staff/actions.ts", "updateOwnStaffPasscodeAction"), ("app/staff/actions.ts", "updateStaffPublicProfileAction"), ("app/staff/actions.ts", "getStaffProfileAvatarUploadSessionAction"),
            ("app/staff/appointments/staff-preferences-actions.ts", "staffBookingPreferencesAction"),
            ("app/service-relay/actions.ts", "loadServiceRelay"), ("app/service-relay/actions.ts", "respondServiceRelay"), ("app/service-relay/actions.ts", "saveServiceRelay"), ("app/service-relay/actions.ts", "findServiceRelay")
        ]
        for (module, name) in actions { XCTAssertTrue(names.contains(action(module, name)), "Pinned Staff action missing from signed manifest: \(name)") }
        for name in ["http.staff.create-appointment", "http.staff.report-no-show", "http.staff.confirm-booking", "http.staff.booking-preferences"] { XCTAssertTrue(names.contains(name)) }
        // The denied fixture must be a registered configuration action outside
        // the Staff list; loadServiceRelay is an expressly allowed Staff read.
        let excluded = action("app/service-relay/actions.ts", "setServiceRelayPlugin")
        XCTAssertTrue(names.contains(excluded), "The negative fixture must exercise a registered action")
        XCTAssertNotEqual(excluded, action("app/service-relay/actions.ts", "loadServiceRelay"))
        XCTAssertFalse(Set(actions.map { action($0.0, $0.1) }).contains(excluded), "The negative fixture must remain outside the Staff action list")
    }
}
