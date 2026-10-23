import XCTest
@testable import Reylumi

private let scopeA = "v3:" + String(repeating: "a", count: 64)
private let scopeB = "v3:" + String(repeating: "b", count: 64)

final class BackgroundSyncTests: XCTestCase {
    let origin = URL(string: "https://reylumi.com")!

    private func registration(_ scope: String = scopeA, key: String = "today", endpoint: String? = nil) throws -> ReylumiSyncRegistration {
        try XCTUnwrap(ReylumiSyncRegistration(scope: scope, key: key, endpoint: endpoint ?? "/api/experience/today?scope=\(scope)", expiresAt: Date().addingTimeInterval(3600), origin: origin))
    }

    func testOnlyCompleteKnownReadEndpointsAndExactScopeAreAccepted() throws {
        XCTAssertNotNil(try registration())
        XCTAssertNotNil(try registration(endpoint: "https://reylumi.com/api/experience/my-work?scope=\(scopeA)&staffId=fixture&tab=payroll&payPeriodStart=2026-10-01"))
        for endpoint in ["https://evil.invalid/api/experience/today?scope=\(scopeA)", "http://reylumi.com/api/experience/today?scope=\(scopeA)",
                         "/api/pos/commands?scope=\(scopeA)", "/api/auth/logout?scope=\(scopeA)", "/api/experience/context?scope=\(scopeA)",
                         "/api/experience/today?scope=\(scopeB)", "/api/experience/today?scope=\(scopeA)&scope=\(scopeA)",
                         "/api/experience/today?scope=\(scopeA)&sections=%7B%7D", "/api/experience/today?scope=\(scopeA)#secret"] {
            XCTAssertNil(ReylumiSyncRegistration(scope: scopeA, key: "today", endpoint: endpoint, expiresAt: Date().addingTimeInterval(3600), origin: origin), endpoint)
        }
        XCTAssertNil(ReylumiSyncRegistration(scope: scopeA, key: "today", endpoint: "/api/experience/today?scope=\(scopeA)", expiresAt: Date(timeIntervalSince1970: 0), origin: origin))
        let capped = try XCTUnwrap(ReylumiSyncRegistration(scope: scopeA, key: "today", endpoint: "/api/experience/today?scope=\(scopeA)", expiresAt: Date().addingTimeInterval(7 * 86400), origin: origin))
        XCTAssertLessThanOrEqual(capped.expiresAt.timeIntervalSinceNow, 86400)
    }

    func testSnapshotValidatorRejectsPartialInvalidFutureOrOversizedPayloads() throws {
        XCTAssertNotNil(ReylumiBackgroundSync.payloadUpdatedAt(payload()))
        for extra in [["partial": true], ["revision": "invalid"], ["sections": ["salary": "invalid"]],
                      ["updatedAt": "not-a-date"], ["updatedAt": ISO8601DateFormatter().string(from: Date().addingTimeInterval(120))]] as [[String: Any]] {
            XCTAssertNil(ReylumiBackgroundSync.payloadUpdatedAt(payload(overrides: extra)))
        }
        XCTAssertNil(ReylumiBackgroundSync.payloadUpdatedAt(Data(repeating: 1, count: ReylumiSyncStore.maximumBytes + 1)))
    }

    @MainActor
    func testFreshScopedReadCanBeDrainedWithoutAnyWriteOrCredentialPersistence() async throws {
        let (store, directory) = makeStore()
        defer { store.clear(); try? FileManager.default.removeItem(at: directory) }
        let transport = SyncFixtureTransport(scope: scopeA)
        let sync = ReylumiBackgroundSync(origin: origin, store: store, transport: transport, cookies: { [Self.cookie] })
        let reg = try registration()
        await sync.register(reg)
        await sync.register(reg)
        let deduplicatedContextReads = await transport.contextReads
        XCTAssertEqual(deduplicatedContextReads, 1, "Unchanged registration is deduplicated")
        let refreshed = await sync.refresh()
        XCTAssertTrue(refreshed)
        let drained = await sync.drain(scope: scopeA)
        XCTAssertEqual(drained.count, 1)
        XCTAssertEqual(drained.first?["key"] as? String, "today")
        XCTAssertEqual((drained.first?["payload"] as? [String: Any])?["partial"] as? Bool, false)
        let wrongScope = await sync.drain(scope: scopeB)
        XCTAssertTrue(wrongScope.isEmpty)
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        let encrypted = try Data(contentsOf: file)
        XCTAssertNil(String(data: encrypted, encoding: .utf8), "Snapshot file must be encrypted rather than raw JSON")
        XCTAssertFalse(encrypted.range(of: Data("fixture-salary-value".utf8)) != nil)
        XCTAssertFalse(encrypted.range(of: Data(Self.cookie.value.utf8)) != nil)
        XCTAssertEqual(store.load()?.snapshots.count, 1)
        await transport.setScope(scopeB)
        let revoked = await sync.drain(scope: scopeA)
        XCTAssertTrue(revoked.isEmpty)
        XCTAssertNil(store.load(), "A fresh different account/grant scope removes old native snapshots")
    }

    @MainActor
    func testLateOldAccountUnauthorizedResponseCannotClearNewAccountRegistration() async throws {
        let (store, directory) = makeStore()
        defer { store.clear(); try? FileManager.default.removeItem(at: directory) }
        let transport = SyncFixtureTransport(scope: scopeA)
        let sync = ReylumiBackgroundSync(origin: origin, store: store, transport: transport, cookies: { [Self.cookie] })
        await transport.holdNextContext()
        let oldRegistration = try registration()
        let old = Task { @MainActor in await sync.register(oldRegistration) }
        try await waitUntilHeld(transport)
        await transport.setScope(scopeB)
        await sync.register(try registration(scopeB, key: "new-scope"))
        await transport.releaseHeld(status: 401)
        await old.value
        XCTAssertEqual(store.load()?.scope, scopeB)
        XCTAssertEqual(store.load()?.registrations.map(\.key), ["new-scope"])
        let refreshed = await sync.refresh()
        XCTAssertTrue(refreshed)
    }

    @MainActor
    func testLateReadAfterLogoutOrTaskCancellationNeverRestoresSnapshot() async throws {
        for cancel in [false, true] {
            let (store, directory) = makeStore()
            defer { store.clear(); try? FileManager.default.removeItem(at: directory) }
            let transport = SyncFixtureTransport(scope: scopeA)
            let sync = ReylumiBackgroundSync(origin: origin, store: store, transport: transport, cookies: { [Self.cookie] })
            await sync.register(try registration())
            await transport.holdNextResource()
            let pending = Task { @MainActor in await sync.refresh() }
            try await waitUntilHeld(transport)
            if cancel { pending.cancel() } else { sync.clear() }
            await transport.releaseHeld(status: 200)
            let result = await pending.value
            XCTAssertFalse(result)
            XCTAssertTrue(store.load()?.snapshots.isEmpty ?? true)
        }
    }

    @MainActor
    func testUnavailableOrNoCookieDoesNotInventOrUploadDataAndBoundedStoreRejectsOverflow() async throws {
        let (store, directory) = makeStore()
        defer { store.clear(); try? FileManager.default.removeItem(at: directory) }
        let transport = SyncFixtureTransport(scope: scopeA)
        let sync = ReylumiBackgroundSync(origin: origin, store: store, transport: transport, cookies: { [] })
        await sync.register(try registration())
        XCTAssertNil(store.load())
        let contextReads = await transport.contextReads
        XCTAssertEqual(contextReads, 0)
        let registrations = try (0..<5).map { try registration(key: "view-\($0)") }
        store.save(ReylumiSyncState(scope: scopeA, registrations: registrations, snapshots: []))
        XCTAssertNil(store.load(), "More than four native resources must not be written")
        let large = ReylumiSyncSnapshot(key: "large", endpoint: "fixture", payload: Data(repeating: 1, count: ReylumiSyncStore.maximumBytes + 1), updatedAt: Date(), receivedAt: Date())
        store.save(ReylumiSyncState(scope: scopeA, registrations: [try registration()], snapshots: [large]))
        XCTAssertNil(store.load())
    }

    @MainActor
    func testAuthCookieRotationIsDeliveredToWebKitAndLateOldCookieReadIsIgnored() async throws {
        let (store, directory) = makeStore()
        defer { store.clear(); try? FileManager.default.removeItem(at: directory) }
        let jar = SyncFixtureCookies(values: [Self.cookie])
        let transport = SyncFixtureTransport(scope: scopeA)
        await transport.rotateNextCookie()
        let sync = ReylumiBackgroundSync(origin: origin, store: store, transport: transport,
                                        cookies: { jar.values }, setCookies: { jar.values = $0 })
        await sync.register(try registration())
        XCTAssertEqual(jar.values.first?.value, "rotated-fixture-cookie")
        await transport.holdNextResource()
        let pending = Task { @MainActor in await sync.refresh() }
        try await waitUntilHeld(transport)
        jar.values = [Self.cookie]
        await transport.releaseHeld(status: 200)
        let refreshed = await pending.value
        XCTAssertFalse(refreshed, "A response fetched with a previous cookie jar cannot become a saved current read")
        XCTAssertTrue(store.load()?.snapshots.isEmpty ?? true)
        XCTAssertEqual(jar.values.first?.value, Self.cookie.value)
    }

    private func makeStore() -> (ReylumiSyncStore, URL) {
        let id = UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-snapshot-tests-\(id)", isDirectory: true)
        return (ReylumiSyncStore(origin: origin, directory: directory, service: "com.reylumi.tests.snapshot.\(id)"), directory)
    }

    @MainActor
    private func waitUntilHeld(_ transport: SyncFixtureTransport) async throws {
        for _ in 0..<100 {
            if await transport.hasHeld { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("Expected delayed read did not start")
        throw URLError(.timedOut)
    }

    private static var cookie: HTTPCookie {
        HTTPCookie(properties: [.domain: "reylumi.com", .path: "/", .name: "fixture-session", .value: "fixture-cookie-not-a-real-secret", .secure: "TRUE"])!
    }
}

private func payload(overrides: [String: Any] = [:]) -> Data {
    var value: [String: Any] = ["data": ["salary": "fixture-salary-value"], "partial": false,
                              "revision": String(repeating: "a", count: 64), "sections": ["salary": String(repeating: "b", count: 64)],
                              "updatedAt": ISO8601DateFormatter().string(from: Date())]
    overrides.forEach { value[$0.key] = $0.value }
    return try! JSONSerialization.data(withJSONObject: value)
}

private actor SyncFixtureTransport: ReylumiReadTransport {
    private var scope: String
    private var holdContext = false
    private var holdResource = false
    private var held: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var heldURL: URL?
    private var heldIsContext = false
    private var rotateCookie = false
    private(set) var contextReads = 0
    var hasHeld: Bool { held != nil }
    init(scope: String) { self.scope = scope }
    func setScope(_ value: String) { scope = value }
    func holdNextContext() { holdContext = true }
    func holdNextResource() { holdResource = true }
    func rotateNextCookie() { rotateCookie = true }
    func get(_ url: URL, cookies: [HTTPCookie]) async throws -> (Data, HTTPURLResponse) {
        let context = url.path == "/api/experience/context"
        if context { contextReads += 1 }
        if (context && holdContext) || (!context && holdResource) {
            holdContext = false; holdResource = false; heldURL = url; heldIsContext = context
            return try await withCheckedThrowingContinuation { held = $0 }
        }
        return response(url: url, context: context, status: 200)
    }
    func releaseHeld(status: Int) {
        guard let continuation = held, let url = heldURL else { return }
        held = nil; heldURL = nil
        continuation.resume(returning: response(url: url, context: heldIsContext, status: status))
    }
    private func response(url: URL, context: Bool, status: Int) -> (Data, HTTPURLResponse) {
        let data = context ? try! JSONSerialization.data(withJSONObject: ["scope": scope, "authenticated": true, "viewerId": "fixture-viewer"]) : payload()
        var headers = ["Content-Type": "application/json"]
        if rotateCookie {
            rotateCookie = false
            headers["Set-Cookie"] = "fixture-session=rotated-fixture-cookie; Path=/; Secure; HttpOnly"
        }
        return (data, HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!)
    }
}

@MainActor
private final class SyncFixtureCookies {
    var values: [HTTPCookie]
    init(values: [HTTPCookie]) { self.values = values }
}
