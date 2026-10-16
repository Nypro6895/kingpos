import XCTest
import WebKit
@testable import Reylumi

actor AppLocalFixtureHTTP: ReylumiLocalHTTPClient {
    private(set) var requests: [URLRequest] = []
    var scope = AppLocalTestFixture.scope
    var held: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    var holdRead = false
    private var contexts: [String: [String: String]] = [:]
    private var contextUnavailable = false
    private var readStatus = 200
    func configureHold() { holdRead = true }
    func configureContext(path: String, scope: String, kind: String, primaryScope: String? = nil) { contexts[path] = ["scope": scope, "kind": kind, "primaryScope": primaryScope ?? scope] }
    func configureContextUnavailable() { contextUnavailable = true }
    func configureReadStatus(_ value: Int) { readStatus = value }
    func isHeld() -> Bool { held != nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let url = request.url!
        if url.path == "/api/app-local/read", holdRead {
            holdRead = false
            return try await withCheckedThrowingContinuation { held = $0 }
        }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let object: [String: Any]
        if url.path == "/api/app-local/context" {
            if contextUnavailable { throw URLError(.notConnectedToInternet) }
            let config = contexts[query.first(where: { $0.name == "path" })?.value ?? ""]
            scope = config?["scope"] ?? scope
            object = AppLocalTestFixture.context(generation: query.first(where: { $0.name == "generation" })!.value!, scope: scope, kind: config?["kind"] ?? "owner", primaryScope: config?["primaryScope"])
        }
        else if request.httpMethod == "POST" { object = ["ok": true, "data": ["saved": true]] }
        else { object = ["schemaVersion": 1, "status": 200, "scope": scope, "etag": "fixture-etag", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["staff": [["name": "Mai"]]]] }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: url.path == "/api/app-local/read" ? readStatus : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
    func releaseHeld() throws {
        guard let continuation = held, let url = requests.last?.url else { return }; held = nil
        let body: [String: Any] = ["schemaVersion": 1, "status": 200, "scope": scope, "etag": "old", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["old": true]]
        continuation.resume(returning: (try JSONSerialization.data(withJSONObject: body), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!))
    }
}

final class LocalAppTransportTests: XCTestCase {
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
        _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: staffScope)
        _ = try await transport.freshContext(path: "/pos")
        let retainedStaff = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: staffScope)
        XCTAssertNotNil(retainedStaff)
        await http.configureContextUnavailable()
        let cachedStaff = try await transport.context(path: "/staff/my-work")
        XCTAssertEqual((cachedStaff["context"] as? [String: Any])?["scope"] as? String, staffScope)
        XCTAssertEqual(cachedStaff["offline"] as? Bool, true)
        await http.configureReadStatus(403)
        do { _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: staffScope); XCTFail("Denied data must not return a cached read") } catch {}
        let denied = await store.session(generation: transport.generation, scope: staffScope)
        let owner = await store.session(generation: transport.generation, scope: AppLocalTestFixture.scope, authority: "owner")
        XCTAssertNil(denied); XCTAssertNotNil(owner)
        await transport.reset()
    }
}
