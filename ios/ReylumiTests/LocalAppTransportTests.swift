import XCTest
import WebKit
@testable import Reylumi

actor AppLocalCookieBox {
    private(set) var values: [HTTPCookie] = []
    func append(_ cookie: HTTPCookie) { values.append(cookie) }
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
            object = AppLocalTestFixture.context(generation: query.first(where: { $0.name == "generation" })!.value!, scope: scope, revision: config?["revision"] ?? "revision-a", kind: config?["kind"] ?? "owner", primaryScope: config?["primaryScope"])
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
}
