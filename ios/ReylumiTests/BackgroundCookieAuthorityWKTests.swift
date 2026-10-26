import XCTest
import Foundation
import WebKit
@testable import Reylumi

// Actual background read/admission path and isolated WK storage. All GETs,
// response bodies and cookie values are synthetic; no default store or UI.
private actor BackgroundWKCookieTransport: ReylumiReadTransport {
    static let scope = "v3:" + String(repeating: "a", count: 64)
    private var contextCookie: String?
    private let resourceCookie: String?
    private var shouldHoldResource = false
    private var held: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var heldURL: URL?
    private(set) var contextReads = 0
    private(set) var resourceReads = 0
    var hasHeldResource: Bool { held != nil }

    init(contextCookie: String? = nil, resourceCookie: String? = nil) {
        self.contextCookie = contextCookie; self.resourceCookie = resourceCookie
    }
    func holdNextResource() { shouldHoldResource = true }
    func get(_ url: URL, cookies: [HTTPCookie]) async throws -> (Data, HTTPURLResponse) {
        guard url.scheme == "https", url.host == "reylumi.com",
              ["/api/experience/context", "/api/experience/today"].contains(url.path) else { throw URLError(.unsupportedURL) }
        if url.path == "/api/experience/context" {
            contextReads += 1
            let update = contextCookie; contextCookie = nil
            return try response(url, context: true, cookie: update)
        }
        resourceReads += 1
        if shouldHoldResource {
            shouldHoldResource = false; heldURL = url
            return try await withCheckedThrowingContinuation { held = $0 }
        }
        return try response(url, context: false, cookie: resourceCookie)
    }
    func releaseResource() throws {
        guard let held, let heldURL else { throw URLError(.badServerResponse) }
        self.held = nil; self.heldURL = nil
        held.resume(returning: try response(heldURL, context: false, cookie: resourceCookie))
    }
    private func response(_ url: URL, context: Bool, cookie: String?) throws -> (Data, HTTPURLResponse) {
        let object: [String: Any] = context
            ? ["scope": Self.scope, "authenticated": true, "viewerId": "synthetic-background-viewer"]
            : ["data": ["fixture": true], "partial": false,
               "revision": String(repeating: "b", count: 64),
               "sections": ["fixture": String(repeating: "c", count: 64)],
               "updatedAt": ISO8601DateFormatter().string(from: Date())]
        var headers = ["Content-Type": "application/json"]
        if let cookie { headers["Set-Cookie"] = cookie }
        return (try JSONSerialization.data(withJSONObject: object),
                try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: headers)))
    }
}

@MainActor
final class BackgroundCookieAuthorityWKTests: XCTestCase {
    private static let sessionName = "contract-bg-session"
    private static let replacement = "contract-bg-session=rotated; Path=/; Secure; HttpOnly; SameSite=Lax"
    private static let deletion = "contract-bg-session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"
    private let origin = URL(string: "https://reylumi.com")!
    private var profiles: [WKWebsiteDataStore] = []
    private var profileOwners: [IsolatedWKCookieProfileOwner] = []
    private var stores: [ReylumiSyncStore] = []
    private var directories: [URL] = []
    private final class Writes { var applications = 0 }
    private final class CleanupGate {
        private var finished = false
        func finish(_ value: Bool, _ continuation: CheckedContinuation<Bool, Never>) {
            guard !finished else { return }; finished = true; continuation.resume(returning: value)
        }
    }
    private struct Fixture {
        let sync: ReylumiBackgroundSync
        let transport: BackgroundWKCookieTransport
        let store: ReylumiSyncStore
        let jar: WKHTTPCookieStore
        let writes: Writes
    }

    override func tearDown() async throws {
        for store in stores { store.clear() }
        for profile in profiles {
            let completed = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                let gate = CleanupGate()
                let timeout = Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if !Task.isCancelled { gate.finish(false, continuation) }
                }
                profile.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
                    timeout.cancel(); gate.finish(true, continuation)
                }
            }
            XCTAssertTrue(completed, "Bounded cleanup applies only to this test's unique WK profile")
        }
        for owner in profileOwners { owner.close() }
        profileOwners.removeAll()
        for directory in directories { try? FileManager.default.removeItem(at: directory) }
        try await super.tearDown()
    }

    func testBackgroundContextDeletionRemovesTheActualStoredParentDomainCookie() async throws {
        let f = try await fixture(contextCookie: Self.deletion)
        await f.sync.register(try registration())
        let after = await cookies(f.jar)
        XCTAssertFalse(after.contains { $0.name == Self.sessionName })
        XCTAssertEqual(after.count, 1, "The unrelated stable authority cookie remains")
        XCTAssertEqual(f.writes.applications, 1)
        XCTAssertEqual(f.store.load()?.registrations.count, 1)
        let reads = await f.transport.contextReads; XCTAssertEqual(reads, 1)
    }

    func testBackgroundResourceReplacementCollapsesHostAndParentDomainAliases() async throws {
        let f = try await fixture(resourceCookie: Self.replacement, aliases: true)
        await f.sync.register(try registration())
        let refreshed = await f.sync.refresh(); XCTAssertTrue(refreshed)
        let selected = await cookies(f.jar).filter { $0.name == Self.sessionName }
        XCTAssertEqual(selected.count, 1); XCTAssertEqual(selected.first?.value, "rotated")
        XCTAssertEqual(f.writes.applications, 1)
        XCTAssertEqual(f.store.load()?.snapshots.count, 1)
        let reads = await f.transport.resourceReads; XCTAssertEqual(reads, 1, "No read is replayed by cookie delivery")
    }

    func testBackgroundReplacementPreservesDifferentCookieDomainsPathsAndNames() async throws {
        let f = try await fixture(resourceCookie: Self.replacement, aliases: true, otherKeys: true)
        await f.sync.register(try registration())
        let refreshed = await f.sync.refresh(); XCTAssertTrue(refreshed)
        let after = await cookies(f.jar)
        XCTAssertEqual(after.count, 5)
        XCTAssertEqual(after.filter { $0.name == Self.sessionName && $0.path == "/" && canonicalDomain($0) == "reylumi.com" }.count, 1)
        XCTAssertTrue(after.contains { $0.name == Self.sessionName && canonicalDomain($0) == "other.reylumi.com" && $0.path == "/" && $0.value == "other-domain" })
        XCTAssertTrue(after.contains { $0.name == Self.sessionName && $0.path == "/other" && $0.value == "other-path" })
        XCTAssertTrue(after.contains { $0.name == "contract-bg-other" && $0.value == "other-name" })
        XCTAssertEqual(f.writes.applications, 1)
    }

    func testConcurrentExternalAuthorityChangeRejectsBeforeBackgroundCookieApplication() async throws {
        let f = try await fixture(resourceCookie: Self.replacement)
        await f.sync.register(try registration()); await f.transport.holdNextResource()
        let pending = Task { @MainActor in await f.sync.refresh() }
        try await waitForHeld(f.transport)
        try await seed(cookie(Self.sessionName, "external", domain: ".reylumi.com"), into: f.jar)
        try await f.transport.releaseResource()
        let refreshed = await pending.value; XCTAssertFalse(refreshed)
        XCTAssertEqual(f.writes.applications, 0, "A response from an obsolete authority cannot touch WK cookies")
        let after = await cookies(f.jar)
        XCTAssertTrue(after.contains { $0.name == Self.sessionName && $0.value == "external" })
        XCTAssertFalse(after.contains { $0.value == "rotated" })
        XCTAssertTrue(f.store.load()?.snapshots.isEmpty ?? true)
        let reads = await f.transport.resourceReads; XCTAssertEqual(reads, 1)
    }

    func testClearWhileBackgroundReadIsPendingRejectsCookiesAndSnapshot() async throws {
        let f = try await fixture(resourceCookie: Self.replacement)
        await f.sync.register(try registration()); await f.transport.holdNextResource()
        let pending = Task { @MainActor in await f.sync.refresh() }
        try await waitForHeld(f.transport); f.sync.clear()
        try await f.transport.releaseResource()
        let refreshed = await pending.value; XCTAssertFalse(refreshed)
        XCTAssertEqual(f.writes.applications, 0); XCTAssertNil(f.store.load())
        let after = await cookies(f.jar); XCTAssertFalse(after.contains { $0.value == "rotated" })
    }

    func testCancellationWhileBackgroundReadIsPendingRejectsCookiesAndSnapshot() async throws {
        let f = try await fixture(resourceCookie: Self.replacement)
        await f.sync.register(try registration()); await f.transport.holdNextResource()
        let pending = Task { @MainActor in await f.sync.refresh() }
        try await waitForHeld(f.transport); pending.cancel()
        try await f.transport.releaseResource()
        let refreshed = await pending.value; XCTAssertFalse(refreshed)
        XCTAssertEqual(f.writes.applications, 0); XCTAssertTrue(f.store.load()?.snapshots.isEmpty ?? true)
        let after = await cookies(f.jar); XCTAssertFalse(after.contains { $0.value == "rotated" })
    }

    private func fixture(contextCookie: String? = nil, resourceCookie: String? = nil,
                         aliases: Bool = false, otherKeys: Bool = false) async throws -> Fixture {
        let profile: WKWebsiteDataStore
        if #available(iOS 17.0, *) {
            let id = UUID(); profile = WKWebsiteDataStore(forIdentifier: id); XCTAssertEqual(profile.identifier, id)
        } else { profile = .nonPersistent() }
        profiles.append(profile)
        let owner = IsolatedWKCookieProfileOwner(store: profile)
        profileOwners.append(owner)
        try await owner.prepare()
        let jar = profile.httpCookieStore
        let empty = await cookies(jar); XCTAssertTrue(empty.isEmpty)
        try await seed(cookie("contract-bg-stable", "stable", domain: "reylumi.com"), into: jar)
        try await seed(cookie(Self.sessionName, "parent", domain: ".reylumi.com"), into: jar)
        if aliases { try await seed(cookie(Self.sessionName, "host", domain: "reylumi.com"), into: jar) }
        if otherKeys {
            try await seed(cookie(Self.sessionName, "other-domain", domain: "other.reylumi.com"), into: jar)
            try await seed(cookie(Self.sessionName, "other-path", domain: ".reylumi.com", path: "/other"), into: jar)
            try await seed(cookie("contract-bg-other", "other-name", domain: ".reylumi.com"), into: jar)
        }
        let seeded = await cookies(jar)
        XCTAssertEqual(seeded.count, 2 + (aliases ? 1 : 0) + (otherKeys ? 3 : 0))
        if aliases {
            XCTAssertEqual(seeded.filter { $0.name == Self.sessionName && $0.path == "/" && canonicalDomain($0) == "reylumi.com" }.count, 2)
        }
        if otherKeys {
            _ = try XCTUnwrap(seeded.first { $0.name == Self.sessionName && canonicalDomain($0) == "other.reylumi.com" && $0.path == "/" && $0.value == "other-domain" }, "Verify the app-bound subdomain cookie exists before testing preservation")
        }
        let id = "reylumi.tests.background-wk." + UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id, isDirectory: true)
        directories.append(directory)
        let store = ReylumiSyncStore(origin: origin, directory: directory, service: id); stores.append(store)
        let transport = BackgroundWKCookieTransport(contextCookie: contextCookie, resourceCookie: resourceCookie), writes = Writes()
        let sync = ReylumiBackgroundSync(origin: origin, store: store, transport: transport,
            cookies: { await self.cookies(jar) }, setCookies: { values in
                writes.applications += 1
                await ReylumiBackgroundSync.applyResponseCookies(values, to: jar)
            })
        return Fixture(sync: sync, transport: transport, store: store, jar: jar, writes: writes)
    }
    private func registration() throws -> ReylumiSyncRegistration {
        try XCTUnwrap(ReylumiSyncRegistration(scope: BackgroundWKCookieTransport.scope, key: "synthetic-today",
            endpoint: "/api/experience/today?scope=\(BackgroundWKCookieTransport.scope)", expiresAt: Date().addingTimeInterval(3600), origin: origin))
    }
    private func cookies(_ jar: WKHTTPCookieStore) async -> [HTTPCookie] {
        await withCheckedContinuation { continuation in jar.getAllCookies { continuation.resume(returning: $0) } }
    }
    private func seed(_ cookie: HTTPCookie, into jar: WKHTTPCookieStore) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in jar.setCookie(cookie) { continuation.resume() } }
    }
    private func cookie(_ name: String, _ value: String, domain: String, path: String = "/") throws -> HTTPCookie {
        try XCTUnwrap(HTTPCookie(properties: [.name: name, .value: value, .domain: domain, .path: path, .secure: "TRUE"]))
    }
    private func canonicalDomain(_ cookie: HTTPCookie) -> String {
        cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
    }
    private func waitForHeld(_ transport: BackgroundWKCookieTransport) async throws {
        for _ in 0..<100 {
            if await transport.hasHeldResource { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("Expected isolated synthetic resource read to be held")
        throw URLError(.timedOut)
    }
}
