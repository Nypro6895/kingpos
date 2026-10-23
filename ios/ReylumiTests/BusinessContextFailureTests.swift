import XCTest
import Foundation
@testable import Reylumi

private actor BusinessContextFailureHTTP: ReylumiLocalHTTPClient {
    static let staffScope = "v3:" + String(repeating: "b", count: 64)
    private var status = 200
    private var unconfirmed = false
    private var genericLeaseOutage = false
    private let scope: String
    private let onlineOnly: Bool
    private let owner: Bool
    private(set) var paths: [String] = []
    init(scope: String = BusinessContextFailureHTTP.staffScope, onlineOnly: Bool = false, owner: Bool = false) { self.scope = scope; self.onlineOnly = onlineOnly; self.owner = owner }
    func configure(status: Int, unconfirmed: Bool = false, genericLeaseOutage: Bool = false) { self.status = status; self.unconfirmed = unconfirmed; self.genericLeaseOutage = genericLeaseOutage }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        guard url.scheme == "https", url.host == "reylumi.com", url.path == "/api/app-local/context", request.httpMethod == "GET" else { throw URLError(.unsupportedURL) }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let path = try XCTUnwrap(query.first { $0.name == "path" }?.value), generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
        paths.append(path)
        let workspace = owner ? "manage:fixture" : "staff:fixture"
        var object = AppLocalTestFixture.context(generation: generation, scope: scope, kind: owner ? "owner" : "staff", workspace: workspace)
        var grant = object["grant"] as! [String: Any]; grant["workspaceId"] = workspace; grant["path"] = owner ? "/staff/today" : "/staff/my-work"; object["grant"] = grant
        object["access"] = ["ownerWorkspace": owner, "staffWorkspace": !owner]; object["grantStatus"] = 200
        if genericLeaseOutage { object["grant"] = NSNull(); object["grantStatus"] = 503 }
        if onlineOnly {
            let context = object["context"] as! [String: Any]
            object["grant"] = NSNull(); object["grantStatus"] = 503; object["offlineState"] = "online-only"
            object["staffOnlineAccess"] = ["version": 1, "staffId": "00000000-0000-4000-8000-000000000003", "viewerId": context["viewerId"]!, "salonId": context["salonId"]!, "scope": scope]
        }
        if unconfirmed { object["grant"] = NSNull(); object["grantStatus"] = 503; object["offlineState"] = "unconfirmed" }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
}

private actor BusinessProfileReadHTTP: ReylumiLocalHTTPClient {
    static let rootScope = "v3:" + String(repeating: "c", count: 64)
    private(set) var reads = 0
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        guard url.scheme == "https", url.host == "reylumi.com", request.httpMethod == "GET" else { throw URLError(.unsupportedURL) }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        var object: [String: Any]
        if url.path == "/api/app-local/context" {
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            let root = query.first { $0.name == "path" }?.value == "/salon-profile"
            object = AppLocalTestFixture.context(generation: generation, scope: root ? Self.rootScope : BusinessContextFailureHTTP.staffScope, kind: root ? "customer" : "staff", workspace: "staff:fixture")
            var grant = object["grant"] as! [String: Any]
            grant["workspaceId"] = "staff:fixture"; grant["path"] = root ? "/market" : "/staff/my-work"; object["grant"] = grant
            object["access"] = ["ownerWorkspace": false, "staffWorkspace": true]; object["grantStatus"] = 200
        } else {
            guard url.path == "/api/app-local/read", query.first(where: { $0.name == "name" })?.value == "owner.salon-profile", query.first(where: { $0.name == "scope" })?.value == Self.rootScope else { throw URLError(.unsupportedURL) }
            reads += 1
            object = ["schemaVersion": 1, "status": 200, "scope": Self.rootScope, "etag": "profile-r1", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["profile": "synthetic-selected-staff-salon"]]
        }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }
}

@MainActor
final class BusinessContextFailureTests: XCTestCase {
    private func run(status: Int, unconfirmed: Bool = false, sameScope: Bool = false, onlineOnly: Bool = false, path: String = "/salon-profile") async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(), id = "reylumi.tests.business-failure." + UUID().uuidString
        defer { try? FileManager.default.removeItem(at: directory); UserDefaults.standard.removePersistentDomain(forName: id) }
        let chosenScope = sameScope ? AppLocalTestFixture.scope : BusinessContextFailureHTTP.staffScope
        let origin = URL(string: "https://reylumi.com")!, http = BusinessContextFailureHTTP(scope: chosenScope, onlineOnly: onlineOnly)
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: id)!, cookies: { [] }, setCookie: { _ in XCTFail("No cookie writes expected") })
        var owner = AppLocalTestFixture.context(generation: transport.generation, workspace: "manage:fixture")
        var grant = owner["grant"] as! [String: Any]; grant["workspaceId"] = "manage:fixture"; grant["path"] = "/staff/today"; owner["grant"] = grant
        owner["access"] = ["ownerWorkspace": true, "staffWorkspace": false]
        await store.accept(try XCTUnwrap(ReylumiLocalSession.verified(owner, generation: transport.generation)))
        _ = try await transport.freshContext(path: "/staff/my-work")
        await http.configure(status: status, unconfirmed: unconfirmed)
        // A second call after explicit denial must not resurrect another
        // retained role merely because current session/online context is nil.
        for _ in 0..<(unconfirmed ? 2 : 1) {
            if unconfirmed {
                let value = try await transport.context(path: path)
                XCTAssertEqual(value["offlineState"] as? String, "unconfirmed")
                XCTAssertEqual(value["grantStatus"] as? Int, 503); XCTAssertTrue(value["grant"] is NSNull)
                XCTAssertEqual(value["offline"] as? Bool, false)
                XCTAssertEqual((value["context"] as? [String: Any])?["scope"] as? String, chosenScope)
            } else {
                do { _ = try await transport.context(path: path); XCTFail("A failed fresh check must not fall back to retained Owner") }
                catch { XCTAssertEqual((error as NSError).code, status) }
            }
        }
        let paths = await http.paths
        XCTAssertEqual(paths.filter { $0 == path }.count, unconfirmed ? 2 : 1)
        await transport.reset()
    }
    func testFreshUnavailableOrActualDenialNeverFallsBackToAnotherRole() async throws {
        for status in [503, 403, 401] { try await run(status: status) }
    }
    func testExplicitUnconfirmedRepeatedContextCannotResurrectRetainedOwner() async throws {
        try await run(status: 200, unconfirmed: true)
    }
    func testIdenticalScopeRetainedOwnerCannotAuthorizeSelectedStaffBusinessCache() async throws {
        for onlineOnly in [false, true] {
            for path in ["/services", "/salon-profile"] {
                try await run(status: 503, sameScope: true, onlineOnly: onlineOnly, path: path)
            }
        }
    }
    func testGenericOwnerDisplayLeaseOutageKeepsItsMatchingValidOfflineLease() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(), id = "reylumi.tests.owner-lease-outage." + UUID().uuidString
        defer { try? FileManager.default.removeItem(at: directory); UserDefaults.standard.removePersistentDomain(forName: id) }
        let origin = URL(string: "https://reylumi.com")!, http = BusinessContextFailureHTTP(scope: AppLocalTestFixture.scope, owner: true)
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: id)!, cookies: { [] }, setCookie: { _ in XCTFail("No cookie writes expected") })
        _ = try await transport.freshContext(path: "/staff/today")
        await http.configure(status: 200, genericLeaseOutage: true)
        let online = try await transport.freshContext(path: "/staff/today")
        XCTAssertTrue(online["grant"] is NSNull); XCTAssertEqual(online["grantStatus"] as? Int, 503)
        await http.configure(status: 503)
        let cached = try await transport.context(path: "/services")
        XCTAssertEqual(cached["offline"] as? Bool, true)
        XCTAssertEqual((cached["grant"] as? [String: Any])?["kind"] as? String, "owner")
        XCTAssertEqual((cached["context"] as? [String: Any])?["scope"] as? String, AppLocalTestFixture.scope)
        await transport.reset()
    }
    func testFreshStaffPostUsesOriginalOnlineReadWithoutBorrowingOwnerOfflineAuthority() async throws {
        let bundle = try ReylumiLocalBundle.installed(), id = "reylumi.tests.staff-post-read." + UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id)
        defer { try? FileManager.default.removeItem(at: directory); UserDefaults.standard.removePersistentDomain(forName: id) }
        let origin = URL(string: "https://reylumi.com")!, http = BusinessProfileReadHTTP()
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: id)!, cookies: { [] }, setCookie: { _ in XCTFail("No cookie writes expected") })
        _ = try await transport.freshContext(path: "/staff/my-work")
        let context = try await transport.context(path: "/salon-profile")
        XCTAssertEqual((context["grant"] as? [String: Any])?["kind"] as? String, "customer")
        XCTAssertEqual(context["offline"] as? Bool, false)
        let value = try await transport.read(name: "owner.salon-profile", args: [:], etag: nil, requestedScope: BusinessProfileReadHTTP.rootScope)
        XCTAssertEqual(value["status"] as? Int, 200)
        XCTAssertEqual((value["data"] as? [String: Any])?["profile"] as? String, "synthetic-selected-staff-salon")
        let cached = try await transport.cached(name: "owner.salon-profile", args: [:], requestedScope: BusinessProfileReadHTTP.rootScope)
        XCTAssertNil(cached, "A Staff/customer root does not become an Owner offline resource lease")
        let owner = await store.session(generation: transport.generation, scope: BusinessProfileReadHTTP.rootScope, authority: "owner")
        XCTAssertNil(owner); let reads = await http.reads; XCTAssertEqual(reads, 1)
        let portable = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.portableContext(generation: transport.generation), generation: transport.generation))
        XCTAssertFalse(portable.compatible(path: "/pos/customer-display?token=public-display-capability"), "Preserve the original raw Portable path boundary")
        await transport.reset()
    }
}
