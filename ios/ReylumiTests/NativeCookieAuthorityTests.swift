import XCTest
import Foundation
@testable import Reylumi

/// All HTTP and cookie values are synthetic. The actual app transport, cookie
/// reconciliation, authorized read store and response handling remain real.
private actor AuthorityCookieJar {
    private(set) var values: [HTTPCookie]
    init(_ values: [HTTPCookie]) { self.values = values }
    func put(_ value: HTTPCookie) {
        values.removeAll {
            $0.name == value.name && $0.path == value.path
                && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == value.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        }
        if (value.expiresDate ?? .distantFuture) > Date() { values.append(value) }
    }
}

private actor AuthorityCookieHTTP: ReylumiLocalHTTPClient {
    private var held: [String: (URL, CheckedContinuation<(Data, HTTPURLResponse), Error>)] = [:]
    private var sentCookies: [String: String] = [:]
    private var failNextTags = Set<String>()
    func heldCount() -> Int { held.count }
    func cookieHeader(for tag: String) -> String { sentCookies[tag] ?? "" }
    func failNextRead(_ tag: String) { failNextTags.insert(tag) }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if url.path == "/api/app-local/context" {
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            return (try JSONSerialization.data(withJSONObject: AppLocalTestFixture.context(generation: generation)), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
        }
        guard url.path == "/api/app-local/read" else { throw URLError(.unsupportedURL) }
        let raw = try XCTUnwrap(query.first { $0.name == "args" }?.value)
        let args = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: String])
        let tag = try XCTUnwrap(args["date"])
        sentCookies[tag] = request.value(forHTTPHeaderField: "Cookie") ?? ""
        if failNextTags.remove(tag) != nil { throw URLError(.timedOut) }
        if tag == "after" { return try response(url: url) }
        return try await withCheckedThrowingContinuation { held[tag] = (url, $0) }
    }
    func release(_ tag: String, cookie: String? = nil) throws {
        let (url, continuation) = try XCTUnwrap(held.removeValue(forKey: tag))
        continuation.resume(returning: try response(url: url, cookie: cookie))
    }
    private func response(url: URL, cookie: String? = nil) throws -> (Data, HTTPURLResponse) {
        let value: [String: Any] = ["schemaVersion": 1, "status": 200, "scope": AppLocalTestFixture.scope, "etag": "mixed-cookie", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["staff": [["name": "Fixture"]]]]
        var headers = ["Content-Type": "application/json"]
        if let cookie { headers["Set-Cookie"] = cookie }
        return (try JSONSerialization.data(withJSONObject: value), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: headers)!)
    }
}

private actor AuthorityBackgroundHTTP: ReylumiReadTransport {
    private var holdResource = false
    private var held: (URL, CheckedContinuation<(Data, HTTPURLResponse), Error>)?
    func holdNextResource() { holdResource = true }
    func hasHeldResource() -> Bool { held != nil }
    func get(_ url: URL, cookies: [HTTPCookie]) async throws -> (Data, HTTPURLResponse) {
        if url.path == "/api/experience/context" {
            return try response(url, object: ["scope": AppLocalTestFixture.scope, "authenticated": true, "viewerId": "fixture-viewer"])
        }
        guard url.path == "/api/experience/today" else { throw URLError(.unsupportedURL) }
        if holdResource { holdResource = false; return try await withCheckedThrowingContinuation { held = (url, $0) } }
        return try payload(url)
    }
    func releaseResource() throws {
        let (url, continuation) = try XCTUnwrap(held); held = nil
        continuation.resume(returning: try payload(url))
    }
    private func response(_ url: URL, object: [String: Any]) throws -> (Data, HTTPURLResponse) {
        (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
    private func payload(_ url: URL) throws -> (Data, HTTPURLResponse) {
        try response(url, object: ["data": ["fixture": true], "partial": false, "revision": String(repeating: "a", count: 64), "sections": ["staff": String(repeating: "b", count: 64)], "updatedAt": ISO8601DateFormatter().string(from: Date())])
    }
}

final class NativeCookieAuthorityTests: XCTestCase {
    // These exact names are audited presentation/attribution/reference markers.
    // Auth, MFA, login session, workspace, POS authority, admin and abuse cookies
    // are deliberately absent. Unknown cookie names must remain fail closed.
    private let presentationNames = ["reylumi-ad-session", "reylumi-ad-visitor", "reylumi-ad-attribution", "reylumi-owner-ad-visitor", "reylumi-explore-visitor", "reylumi-report-session", "kingpos-portable-pos-remembered-id"]
    private let origin = URL(string: "https://reylumi.com")!
    private struct Observation {
        let firstStatus: Int
        let secondStatus: Int
        let resets: Int
        let storedCookies: [HTTPCookie]
        let subsequentCookieHeader: String
    }
    private func cookie(_ name: String, _ value: String, domain: String = "reylumi.com") -> HTTPCookie {
        HTTPCookie(properties: [.name: name, .value: value, .domain: domain, .path: "/", .secure: "TRUE"])!
    }
    @MainActor
    private func overlap(initial: [HTTPCookie] = [], firstResponseCookie: String? = nil, externalMutation: HTTPCookie? = nil, reverseReplies: Bool = false) async throws -> Observation {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = [cookie("sb-access-token", "unchanged-access"), cookie("sb-refresh-token", "unchanged-refresh"), cookie("kingpos-login-session-id", "unchanged-login"), cookie("kingpos-selected-workspace", "manage:fixture")] + initial
        let http = AuthorityCookieHTTP(), jar = AuthorityCookieJar(original)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.cookie-authority." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests.cookie-authority." + UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
        _ = try await transport.freshContext(path: "/help")
        var resets = 0
        transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
        func read(_ tag: String) -> Task<Int, Never> {
            Task { @MainActor in
                do { return (try await transport.read(name: "fixture.roster", args: ["date": tag], etag: nil, requestedScope: AppLocalTestFixture.scope))["status"] as? Int ?? -1 }
                catch { return (error as NSError).code }
            }
        }
        let first = read("first"), second = read("second")
        for _ in 0..<150 { if await http.heldCount() == 2 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let held = await http.heldCount(); XCTAssertEqual(held, 2)
        if reverseReplies {
            try await http.release("second")
            _ = await second.value
        }
        try await http.release("first", cookie: firstResponseCookie)
        let firstStatus = await first.value
        if let externalMutation { await jar.put(externalMutation) }
        if !reverseReplies { try await http.release("second") }
        let secondStatus = await second.value
        if firstStatus == 200 && secondStatus == 200 {
            _ = try await transport.read(name: "fixture.roster", args: ["date": "after"], etag: nil, requestedScope: AppLocalTestFixture.scope)
        }
        let observation = Observation(firstStatus: firstStatus, secondStatus: secondStatus, resets: resets, storedCookies: await jar.values, subsequentCookieHeader: await http.cookieHeader(for: "after"))
        await transport.reset()
        return observation
    }

    @MainActor
    func testMissingAdvertisingCookieInsertionCannotRevokeConcurrentRead() async throws {
        let value = try await overlap(firstResponseCookie: "reylumi-ad-session=00000000-0000-4000-8000-000000000038; Path=/; Secure; SameSite=Lax; Max-Age=1800")
        XCTAssertEqual(value.firstStatus, 200)
        XCTAssertEqual(value.secondStatus, 200, "Independent advertising cookie insertion must not revoke the account")
        XCTAssertEqual(value.resets, 0)
        XCTAssertTrue(value.storedCookies.contains { $0.name == "reylumi-ad-session" })
        XCTAssertTrue(value.subsequentCookieHeader.contains("reylumi-ad-session="), "Excluded authority markers must still be forwarded normally")
    }

    @MainActor
    func testAdvertisingCookieRotationCannotRevokeConcurrentRead() async throws {
        let value = try await overlap(initial: [cookie("reylumi-ad-session", "expired-or-invalid-value")], firstResponseCookie: "reylumi-ad-session=00000000-0000-4000-8000-000000000038; Path=/; Secure; Max-Age=1800")
        XCTAssertEqual(value.firstStatus, 200); XCTAssertEqual(value.secondStatus, 200); XCTAssertEqual(value.resets, 0)
    }

    @MainActor
    func testAllAuditedNonAuthorityMarkersStayStoredWithoutRevokingParallelRead() async throws {
        for name in presentationNames {
            let value = try await overlap(firstResponseCookie: "\(name)=synthetic-marker; Path=/; Secure; Max-Age=1800")
            XCTAssertEqual(value.firstStatus, 200, name); XCTAssertEqual(value.secondStatus, 200, name); XCTAssertEqual(value.resets, 0, name)
            XCTAssertEqual(value.storedCookies.first { $0.name == name }?.value, "synthetic-marker", name)
            XCTAssertTrue(value.subsequentCookieHeader.contains("\(name)=synthetic-marker"), name)
        }
    }

    @MainActor
    func testExistingValidAdvertisingCookieValueAndReversedReplyOrderControls() async throws {
        let marker = "00000000-0000-4000-8000-000000000038"
        let unchanged = try await overlap(initial: [cookie("reylumi-ad-session", marker)], firstResponseCookie: "reylumi-ad-session=\(marker); Path=/; Secure; Max-Age=1800")
        XCTAssertEqual(unchanged.firstStatus, 200); XCTAssertEqual(unchanged.secondStatus, 200); XCTAssertEqual(unchanged.resets, 0)
        let reverse = try await overlap(firstResponseCookie: "reylumi-ad-session=\(marker); Path=/; Secure", reverseReplies: true)
        XCTAssertEqual(reverse.firstStatus, 200); XCTAssertEqual(reverse.secondStatus, 200); XCTAssertEqual(reverse.resets, 0)
    }

    @MainActor
    func testAuthWorkspaceAbuseAndUnknownPrefixedCookieChangesStillRevoke() async throws {
        for name in ["sb-access-token", "sb-refresh-token", "sb-pending-mfa-access-token", "kingpos-login-session-id", "kingpos-selected-workspace", "kingpos-workspace-device", "kingpos-portable-local-lock", "reylumi-admin-session", "reylumi-device", "reylumi-unknown-authority", "kingpos-unknown-authority", "sb-unknown-authority"] {
            let value = try await overlap(externalMutation: cookie(name, "external-change"))
            XCTAssertEqual(value.firstStatus, 200, name); XCTAssertEqual(value.secondStatus, 409, name); XCTAssertEqual(value.resets, 1, name)
        }
    }

    @MainActor
    func testUnknownUnprefixedOriginCookieRemainsConservativelyAuthoritative() async throws {
        let value = try await overlap(externalMutation: cookie("unclassified-origin-authority", "external-change"))
        XCTAssertEqual(value.secondStatus, 409); XCTAssertEqual(value.resets, 1)
    }

    @MainActor
    func testUnrelatedDomainCookieCannotInvalidateThisOrigin() async throws {
        let unrelated = cookie("sb-access-token", "third-party-before", domain: "other.invalid")
        let value = try await overlap(initial: [unrelated], externalMutation: cookie("sb-access-token", "third-party-after", domain: "other.invalid"))
        XCTAssertEqual(value.firstStatus, 200); XCTAssertEqual(value.secondStatus, 200); XCTAssertEqual(value.resets, 0)
        XCTAssertFalse(value.subsequentCookieHeader.contains("third-party-"), "Unrelated domains must never receive or supply app cookies")
    }

    @MainActor
    private func backgroundOverlap(mutation: HTTPCookie) async throws -> (Bool, Int) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("reylumi.background.cookie-authority." + UUID().uuidString, isDirectory: true)
        let store = ReylumiSyncStore(origin: origin, directory: directory, service: "reylumi.tests.background-cookie-authority." + UUID().uuidString)
        defer { store.clear(); try? FileManager.default.removeItem(at: directory) }
        let http = AuthorityBackgroundHTTP(), jar = AuthorityCookieJar([cookie("sb-access-token", "unchanged-access"), cookie("kingpos-login-session-id", "unchanged-login")])
        let sync = ReylumiBackgroundSync(origin: origin, store: store, transport: http, cookies: { await jar.values }, setCookies: { updates in for value in updates { await jar.put(value) } })
        let registration = try XCTUnwrap(ReylumiSyncRegistration(scope: AppLocalTestFixture.scope, key: "today", endpoint: "/api/experience/today?scope=\(AppLocalTestFixture.scope)", expiresAt: Date().addingTimeInterval(3600), origin: origin))
        await sync.register(registration)
        XCTAssertEqual(store.load()?.registrations.count, 1)
        await http.holdNextResource()
        let refresh = Task { @MainActor in await sync.refresh() }
        for _ in 0..<150 { if await http.hasHeldResource() { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let held = await http.hasHeldResource(); XCTAssertTrue(held)
        await jar.put(mutation)
        try await http.releaseResource()
        let refreshed = await refresh.value, snapshots = store.load()?.snapshots.count ?? 0
        sync.clear()
        return (refreshed, snapshots)
    }

    @MainActor
    func testBackgroundReadUsesSameBenignCookieBoundary() async throws {
        let (refreshed, snapshots) = try await backgroundOverlap(mutation: cookie("reylumi-ad-session", "inserted-during-background-read"))
        XCTAssertTrue(refreshed, "A presentation marker must not discard an otherwise authorized background response")
        XCTAssertEqual(snapshots, 1)
    }

    @MainActor
    func testBackgroundReadStillDiscardsChangedAuthAndUnknownOriginCookies() async throws {
        for name in ["sb-access-token", "kingpos-login-session-id", "kingpos-selected-workspace", "reylumi-device", "unclassified-origin-authority"] {
            let (refreshed, snapshots) = try await backgroundOverlap(mutation: cookie(name, "external-change"))
            XCTAssertFalse(refreshed, name); XCTAssertEqual(snapshots, 0, name)
        }
    }

    func testAuthorityProjectionUsesOriginAndDomainLabelBoundaries() {
        let nested = URL(string: "https://portal.reylumi.com")!
        let hostOnly = cookie("sb-access-token", "host", domain: "portal.reylumi.com")
        let parent = cookie("kingpos-login-session-id", "parent", domain: ".reylumi.com")
        let irrelevant = [cookie("sb-refresh-token", "sibling", domain: "other.reylumi.com"), cookie("sb-refresh-token", "child", domain: "child.portal.reylumi.com"), cookie("sb-refresh-token", "lookalike", domain: ".evilreylumi.com"), cookie("sb-refresh-token", "suffix", domain: ".com")]
        let expected = ReylumiCookieAuthority.identity([hostOnly, parent], origin: nested)
        XCTAssertEqual(expected.count, 2)
        XCTAssertEqual(ReylumiCookieAuthority.identity([hostOnly, parent] + irrelevant, origin: nested), expected)
        XCTAssertEqual(ReylumiCookieAuthority.identity([parent], origin: origin).count, 1)
        XCTAssertEqual(ReylumiCookieAuthority.identity([cookie("kingpos-login-session-id", "parent", domain: "reylumi.com")], origin: nested).count, 1, "A parent-domain authority must not depend on Foundation preserving its leading dot")
        XCTAssertEqual(ReylumiCookieAuthority.identity([hostOnly], origin: origin).count, 0)
    }

    func testExactMarkerNamesCannotExcludeUnknownOrDifferentlyCasedAuthority() {
        XCTAssertEqual(ReylumiCookieAuthority.identity(presentationNames.map { cookie($0, "one") }, origin: origin), [])
        let protectedNames = ["Reylumi-ad-session", "reylumi-ad-session-extra", "kingpos-portable-pos-remembered-id-extra", "unclassified-origin-authority"]
        XCTAssertEqual(ReylumiCookieAuthority.identity(protectedNames.map { cookie($0, "one") }, origin: origin).count, protectedNames.count)
        XCTAssertNotEqual(ReylumiCookieAuthority.identity([cookie("unclassified-origin-authority", "one")], origin: origin), ReylumiCookieAuthority.identity([cookie("unclassified-origin-authority", "two")], origin: origin))
    }

    @MainActor
    func testExplicitResourceRemovalFencesPendingReadAndItsOfflineFallback() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let http = AuthorityCookieHTTP()
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.resource-removal." + UUID().uuidString), client: http, defaults: UserDefaults(suiteName: "reylumi.tests.resource-removal." + UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/help")
        let generation = transport.generation
        var resets = 0
        transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
        // A different argument key represents an unrelated authorized view.
        _ = try await transport.read(name: "fixture.roster", args: ["date": "after"], etag: nil, requestedScope: AppLocalTestFixture.scope)
        let old = Task { @MainActor () -> Result<[String: Any], Error> in
            do { return .success(try await transport.read(name: "fixture.roster", args: ["date": "first"], etag: nil, requestedScope: AppLocalTestFixture.scope)) }
            catch { return .failure(error) }
        }
        for _ in 0..<150 { if await http.heldCount() == 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let held = await http.heldCount(); XCTAssertEqual(held, 1)
        try await transport.removeCached(name: "fixture.roster", args: ["date": "first"], requestedScope: AppLocalTestFixture.scope)
        try await http.release("first")
        switch await old.value {
        case .success: XCTFail("A response started before explicit withdrawal must not be delivered or recached")
        case .failure(let error): XCTAssertTrue(error is CancellationError, "Resource withdrawal is cancellation, not a global account revocation")
        }
        let withdrawn = try await transport.cached(name: "fixture.roster", args: ["date": "first"], requestedScope: AppLocalTestFixture.scope)
        XCTAssertNil(withdrawn, "A late successful response must not repopulate the withdrawn durable key")
        await http.failNextRead("first")
        do {
            _ = try await transport.read(name: "fixture.roster", args: ["date": "first"], etag: nil, requestedScope: AppLocalTestFixture.scope)
            XCTFail("A subsequent network failure must not revive a withdrawn DTO through native offline fallback")
        } catch { XCTAssertTrue(error is URLError) }
        let unrelated = try await transport.cached(name: "fixture.roster", args: ["date": "after"], requestedScope: AppLocalTestFixture.scope)
        XCTAssertNotNil(unrelated, "Withdrawal is scoped to exact resource arguments")
        XCTAssertEqual(transport.generation, generation); XCTAssertEqual(resets, 0)
        await transport.reset()
    }
}
