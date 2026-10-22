import XCTest
import Foundation
import WebKit
@testable import Reylumi

// Actual transport and WK cookie storage; every HTTP response and cookie value
// is synthetic. No default website data store, live request, or app UI is used.
private enum NativeWKCookieFixture {
    static let origin = URL(string: "https://reylumi.com")!
    static let scope = "v3:" + String(repeating: "a", count: 64)
    static let owner = "manage:00000000-0000-4000-8000-000000000002"
    static let selectedName = "kingpos-selected-workspace"
    static let workspaceNames = ["kingpos-current-account-id", "kingpos-current-manage-salon-id", "kingpos-current-staff-salon-id", "kingpos-current-salon-id"]
    static let personalHeaders = ["kingpos-selected-workspace=personal; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax"]
        + workspaceNames.map { "\($0)=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0" }
    static func context(_ generation: String) -> [String: Any] {
        var value = AppLocalTestFixture.context(generation: generation, scope: scope, workspace: owner)
        var grant = value["grant"] as! [String: Any]
        grant["workspaceId"] = owner; grant["path"] = "/staff/today"
        value["grant"] = grant; value["grantStatus"] = 200; value["home"] = "/staff/today"
        value["access"] = ["ownerWorkspace": true, "staffWorkspace": false]
        return value
    }
}

private actor NativeWKCookieHTTP: ReylumiLocalHTTPClient {
    private let beforeReply: (@MainActor () async -> Void)?
    private(set) var posts = 0
    private(set) var expiryMarkerCaptured = false
    init(beforeReply: (@MainActor () async -> Void)? = nil) { self.beforeReply = beforeReply }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        guard url.scheme == "https", url.host == "reylumi.com" else { throw URLError(.unsupportedURL) }
        var headers = ["Content-Type": "application/json"]
        let object: [String: Any]
        if url.path == "/api/app-local/context", request.httpMethod == "GET" {
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            object = NativeWKCookieFixture.context(generation)
        } else if url.path == "/api/app-local/command", request.httpMethod == "POST" {
            let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
            let args = try XCTUnwrap(body["args"] as? [String: Any])
            guard body["name"] as? String == "shell.switch-workspace", args["workspaceId"] as? String == "personal" else { throw URLError(.unsupportedURL) }
            posts += 1
            let outgoing = request.value(forHTTPHeaderField: "Cookie") ?? ""
            expiryMarkerCaptured = outgoing.contains("contract-expiring-authority=") || outgoing.contains("reylumi-ad-session=")
            if let beforeReply { await beforeReply() }
            headers["Set-Cookie"] = NativeWKCookieFixture.personalHeaders.joined(separator: ", ")
            object = ["ok": true, "data": ["path": "/explore"]]
        } else { throw URLError(.unsupportedURL) }
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: headers))
        return (try JSONSerialization.data(withJSONObject: object), response)
    }
}

@MainActor
final class NativeCookieAuthorityWKTests: XCTestCase {
    private enum Disturbance { case none, nonAuthorityExpiry, authorityExpiry, externalWorkspace }
    private var dataStores: [WKWebsiteDataStore] = []
    private var profileOwners: [IsolatedWKCookieProfileOwner] = []
    private var directories: [URL] = []
    private var defaultsNames: [String] = []
    private final class CleanupGate {
        private var finished = false
        func finish(_ result: Bool, _ continuation: CheckedContinuation<Bool, Never>) {
            guard !finished else { return }; finished = true; continuation.resume(returning: result)
        }
    }

    override func tearDown() async throws {
        for store in dataStores {
            let completed = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                let gate = CleanupGate()
                let timeout = Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if !Task.isCancelled { gate.finish(false, continuation) }
                }
                store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
                    timeout.cancel(); gate.finish(true, continuation)
                }
            }
            XCTAssertTrue(completed, "Only this test's isolated WK profile must finish bounded cleanup")
        }
        for owner in profileOwners { owner.close() }
        profileOwners.removeAll()
        for directory in directories { try? FileManager.default.removeItem(at: directory) }
        for name in defaultsNames { UserDefaults.standard.removePersistentDomain(forName: name) }
        try await super.tearDown()
    }

    func testHostOnlyPersonalSwitchCommitsTheAcknowledgedDestination() async throws {
        try await run(domain: "reylumi.com")
    }
    func testParentDomainPersonalSwitchDeletesStoredAliasesAndCommitsDestination() async throws {
        try await run(domain: ".reylumi.com")
    }
    func testReplacementCollapsesAliasesAndPreservesDifferentDomainsPathsAndNames() async throws {
        try await run(domain: ".reylumi.com", mixedAliasesAndOtherKeys: true)
    }
    func testNonAuthorityCookieExpiryDoesNotResetThePersonalSwitch() async throws {
        try await run(domain: "reylumi.com", disturbance: .nonAuthorityExpiry)
    }
    func testAuthorityCookieExpiryStillRejectsBeforeResponseCookieWrites() async throws {
        try await run(domain: "reylumi.com", disturbance: .authorityExpiry, denied: true)
    }
    func testExternalWorkspaceEditStillRejectsWithoutReplayingTheCommand() async throws {
        try await run(domain: ".reylumi.com", disturbance: .externalWorkspace, denied: true)
    }

    private func cookies(_ store: WKHTTPCookieStore) async -> [HTTPCookie] {
        await withCheckedContinuation { continuation in store.getAllCookies { continuation.resume(returning: $0) } }
    }
    private func seed(_ cookie: HTTPCookie, into store: WKHTTPCookieStore) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in store.setCookie(cookie) { continuation.resume() } }
    }
    private func cookie(_ name: String, _ value: String, domain: String, path: String = "/", expires: Date? = nil) throws -> HTTPCookie {
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path, .secure: "TRUE"]
        if let expires { properties[.expires] = expires }
        return try XCTUnwrap(HTTPCookie(properties: properties))
    }
    private func canonicalDomain(_ cookie: HTTPCookie) -> String {
        cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
    }
    private func isolatedStore() -> WKWebsiteDataStore {
        let store: WKWebsiteDataStore
        if #available(iOS 17.0, *) {
            let id = UUID(); store = WKWebsiteDataStore(forIdentifier: id)
            XCTAssertEqual(store.identifier, id)
        } else { store = .nonPersistent() }
        dataStores.append(store)
        return store
    }
    private func run(domain: String, mixedAliasesAndOtherKeys: Bool = false, disturbance: Disturbance = .none, denied: Bool = false) async throws {
        let websiteData = isolatedStore(), jar = websiteData.httpCookieStore
        let owner = IsolatedWKCookieProfileOwner(store: websiteData)
        profileOwners.append(owner)
        try await owner.prepare()
        let empty = await cookies(jar); XCTAssertTrue(empty.isEmpty, "The test must never borrow an existing user's cookies")
        for name in [NativeWKCookieFixture.selectedName] + NativeWKCookieFixture.workspaceNames {
            try await seed(cookie(name, name == NativeWKCookieFixture.selectedName ? NativeWKCookieFixture.owner : "synthetic-workspace", domain: domain), into: jar)
        }
        if mixedAliasesAndOtherKeys {
            try await seed(cookie(NativeWKCookieFixture.selectedName, "old-host-alias", domain: "reylumi.com"), into: jar)
            try await seed(cookie(NativeWKCookieFixture.selectedName, "other-path", domain: domain, path: "/other"), into: jar)
            try await seed(cookie(NativeWKCookieFixture.selectedName, "other-domain", domain: "other.reylumi.com"), into: jar)
            try await seed(cookie("contract-other-name", "unrelated-value", domain: domain), into: jar)
        }
        let seeded = await cookies(jar)
        if mixedAliasesAndOtherKeys {
            // App-bound WK APIs filter unrelated registrable domains. This
            // subdomain is permitted by the existing app-bound configuration,
            // while remaining a different canonical cookie domain/key.
            _ = try XCTUnwrap(seeded.first {
                $0.name == NativeWKCookieFixture.selectedName && canonicalDomain($0) == "other.reylumi.com"
                    && $0.path == "/" && $0.value == "other-domain"
            }, "The distinct-domain cookie must actually exist before production-helper preservation is tested")
        }
        XCTAssertEqual(seeded.count, mixedAliasesAndOtherKeys ? 9 : 5)
        if mixedAliasesAndOtherKeys {
            XCTAssertEqual(seeded.filter { $0.name == NativeWKCookieFixture.selectedName && $0.path == "/" && canonicalDomain($0) == "reylumi.com" }.count, 2,
                           "Exercise actual WK host/domain alias coexistence")
        }
        let updates = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": NativeWKCookieFixture.personalHeaders.joined(separator: ", ")], for: NativeWKCookieFixture.origin)
        XCTAssertEqual(updates.count, 5, "Keep the selected workspace plus all four production-form deletions")
        XCTAssertEqual(updates.filter { ($0.expiresDate ?? .distantFuture) <= Date() }.count, 4)
        let id = "reylumi.tests.real-wk-cookie." + UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); directories.append(directory)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: id)); defaultsNames.append(id)
        let trace = ReylumiLocalDiagnostics(enabled: true)
        let http = NativeWKCookieHTTP(beforeReply: {
            if disturbance == .externalWorkspace {
                try? await self.seed(self.cookie(NativeWKCookieFixture.selectedName, "untrusted-external-workspace", domain: domain), into: jar)
            } else if disturbance == .authorityExpiry || disturbance == .nonAuthorityExpiry {
                try? await Task.sleep(nanoseconds: 2_200_000_000)
                // WK may retain an expired object in its API jar until later
                // collection. Explicitly collect only this expired synthetic
                // marker so disappearance precedes the response's first fence;
                // this test does not claim WK always purges it automatically.
                let name = disturbance == .authorityExpiry ? "contract-expiring-authority" : "reylumi-ad-session"
                let pending = await self.cookies(jar)
                for marker in pending where marker.name == name && marker.path == "/"
                    && self.canonicalDomain(marker) == domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
                    && marker.value == "synthetic-expiring" {
                    let expiry = marker.expiresDate
                    XCTAssertNotNil(expiry, "Only an explicitly expired synthetic cookie may be collected")
                    if let expiry {
                        XCTAssertLessThanOrEqual(expiry, Date(), "The marker must expire before explicit collection")
                        if expiry <= Date() {
                            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                                jar.delete(marker) { continuation.resume() }
                            }
                        }
                    }
                }
                let collected = await self.cookies(jar)
                XCTAssertFalse(collected.contains { $0.name == name && $0.path == "/"
                    && self.canonicalDomain($0) == domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
                    && $0.value == "synthetic-expiring" }, "The expired marker must be absent before returning synthetic HTTP")
            }
        })
        var setterCalls = 0
        let transport = ReylumiLocalAppTransport(origin: NativeWKCookieFixture.origin, manifest: try ReylumiLocalBundle.installed().manifest,
            store: ReylumiLocalReadStore(origin: NativeWKCookieFixture.origin, directory: directory, service: id), client: http, defaults: defaults,
            cookies: { await self.cookies(jar) }, setCookie: { value in
                setterCalls += 1
                await ReylumiLocalAppTransport.applyResponseCookie(value, to: jar)
            }, diagnostics: trace)
        _ = try await transport.freshContext(path: "/staff/today")
        if disturbance == .authorityExpiry || disturbance == .nonAuthorityExpiry {
            let name = disturbance == .authorityExpiry ? "contract-expiring-authority" : "reylumi-ad-session"
            try await seed(cookie(name, "synthetic-expiring", domain: domain, expires: Date().addingTimeInterval(1.5)), into: jar)
        }
        let generation = transport.generation, epoch = transport.scopeEpoch
        var reply: [String: Any]?, failureCode: Int?
        do {
            reply = try await transport.command(name: "shell.switch-workspace", args: ["workspaceId": "personal"], requestID: UUID().uuidString,
                                                path: "/staff/today", requestedScope: NativeWKCookieFixture.scope)
        } catch { failureCode = (error as NSError).code }
        let after = await cookies(jar), events = trace.snapshot(), posts = await http.posts
        XCTAssertEqual(posts, 1, "Response-cookie repair and denials must never replay the workspace POST")
        if disturbance == .authorityExpiry || disturbance == .nonAuthorityExpiry {
            let captured = await http.expiryMarkerCaptured
            XCTAssertTrue(captured, "The outgoing command snapshot must contain the cookie before real WK expiry")
        }
        if denied {
            XCTAssertNil(reply); XCTAssertEqual(failureCode, 409)
            XCTAssertTrue(events.contains { $0.event == .cookieMismatch }); XCTAssertTrue(events.contains { $0.event == .scopeReset })
            XCTAssertNotEqual(transport.generation, generation); XCTAssertGreaterThan(transport.scopeEpoch, epoch)
            XCTAssertEqual(setterCalls, 0, "Changed external authority must fail before applying any response cookie")
        } else {
            XCTAssertEqual(reply?["ok"] as? Bool, true)
            XCTAssertEqual((reply?["data"] as? [String: Any])?["path"] as? String, "/explore")
            XCTAssertNil(failureCode); XCTAssertEqual(transport.generation, generation); XCTAssertEqual(transport.scopeEpoch, epoch)
            XCTAssertFalse(events.contains { $0.event == .cookieMismatch || $0.event == .scopeReset })
            XCTAssertTrue(events.contains { $0.event == .cookieCommit }); XCTAssertEqual(setterCalls, 5)
            let selected = after.filter { $0.name == NativeWKCookieFixture.selectedName && $0.path == "/" && canonicalDomain($0) == "reylumi.com" }
            XCTAssertEqual(selected.count, 1); XCTAssertEqual(selected.first?.value, "personal")
            XCTAssertTrue(NativeWKCookieFixture.workspaceNames.allSatisfy { name in !after.contains { $0.name == name } })
            XCTAssertEqual(after.count, mixedAliasesAndOtherKeys ? 4 : 1)
            if mixedAliasesAndOtherKeys {
                XCTAssertTrue(after.contains { $0.name == NativeWKCookieFixture.selectedName && $0.path == "/other" && $0.value == "other-path" })
                XCTAssertTrue(after.contains { $0.name == NativeWKCookieFixture.selectedName && canonicalDomain($0) == "other.reylumi.com" && $0.value == "other-domain" })
                XCTAssertTrue(after.contains { $0.name == "contract-other-name" && $0.value == "unrelated-value" })
            }
        }
        await transport.reset(rotateGeneration: false)
    }
}
