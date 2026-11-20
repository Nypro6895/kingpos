import XCTest
import Foundation
@testable import Reylumi

// The original native transport/store are real. All HTTPS replies are
// synthetic; no default WK cookie store, UI, credentials or commands are used.
private enum BusinessCacheFixture {
    static let personalScope = "v3:" + String(repeating: "d", count: 64)
    static let staffScope = "v3:" + String(repeating: "b", count: 64)
    static let rootScope = "v3:" + String(repeating: "c", count: 64)
    static let ownerScope = "v3:" + String(repeating: "a", count: 64)
    static let ownerPaths = ["/staff", "/staff/today", "/pos", "/pos/history", "/pos-tickets", "/pos-tickets/history", "/customers", "/customers/example", "/payroll", "/payroll/history", "/services", "/salon-profile/client-transformations", "/salon-settings", "/bookings", "/reports"]
    enum Role: Equatable, Sendable { case personal, staff, staffRoot, owner, onlineStaff, denied }
    static func envelope(_ generation: String, role: Role) -> [String: Any] {
        let scope = role == .personal ? personalScope : role == .owner ? ownerScope : role == .staffRoot ? rootScope : staffScope
        let kind = role == .owner ? "owner" : role == .staff || role == .onlineStaff || role == .denied ? "staff" : "customer"
        var object = AppLocalTestFixture.context(generation: generation, scope: scope, kind: kind, workspace: role == .personal ? "personal" : role == .owner ? "manage:fixture" : "staff:fixture", primaryScope: role == .staff ? rootScope : nil)
        var context = object["context"] as! [String: Any], grant = object["grant"] as! [String: Any]
        grant["workspaceId"] = context["workspaceId"]
        grant["path"] = role == .staff ? "/staff/my-work" : role == .owner ? "/staff/today" : "/market"
        if role == .personal { context["salonId"] = NSNull(); grant["salonId"] = NSNull() }
        object["context"] = context; object["grant"] = grant; object["grantStatus"] = 200
        object["home"] = role == .personal ? "/explore" : role == .owner ? "/staff/today" : "/staff/my-work"
        object["access"] = ["ownerWorkspace": role == .owner, "staffWorkspace": role != .personal && role != .owner]
        if role == .onlineStaff {
            object["grant"] = NSNull(); object["grantStatus"] = 503; object["offlineState"] = "online-only"
            object["staffOnlineAccess"] = ["version": 1, "staffId": "00000000-0000-4000-8000-000000000003", "viewerId": context["viewerId"]!, "salonId": context["salonId"]!, "scope": scope]
        }
        if role == .denied { object["grant"] = NSNull(); object["grantStatus"] = 503; object["offlineState"] = "unconfirmed" }
        return object
    }
}

private actor BusinessCacheHTTP: ReylumiLocalHTTPClient {
    private var role = BusinessCacheFixture.Role.staff
    private var heldPath: String?
    private var pending: (Data, HTTPURLResponse, CheckedContinuation<(Data, HTTPURLResponse), Error>)?
    private var unavailable = false
    private(set) var paths: [String] = []
    func configure(_ role: BusinessCacheFixture.Role, hold path: String? = nil, unavailable: Bool = false) {
        self.role = role; heldPath = path; self.unavailable = unavailable
    }
    func isHeld() -> Bool { pending != nil }
    func release() {
        guard let (data, response, continuation) = pending else { return }; pending = nil
        continuation.resume(returning: (data, response))
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        guard url.scheme == "https", url.host == "reylumi.com", url.path == "/api/app-local/context", request.httpMethod == "GET" else { throw URLError(.unsupportedURL) }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let path = try XCTUnwrap(query.first { $0.name == "path" }?.value), generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
        paths.append(path)
        if unavailable { throw URLError(.notConnectedToInternet) }
        let data = try JSONSerialization.data(withJSONObject: BusinessCacheFixture.envelope(generation, role: role))
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"]))
        if heldPath == path {
            heldPath = nil
            return try await withCheckedThrowingContinuation { pending = (data, response, $0) }
        }
        return (data, response)
    }
}

@MainActor
final class BusinessContextCacheAdmissionTests: XCTestCase {
    private final class Probe { var completed = false }
    private struct Fixture {
        let transport: ReylumiLocalAppTransport
        let store: ReylumiLocalReadStore
        let http: BusinessCacheHTTP
        let directory: URL
        let defaultsName: String
    }
    private func fixture() throws -> Fixture {
        let (bundle, directory) = try AppLocalTestFixture.bundle(), id = "reylumi.tests.business-cache." + UUID().uuidString
        let origin = URL(string: "https://reylumi.com")!, http = BusinessCacheHTTP()
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: id)!, cookies: { [] }, setCookie: { _ in XCTFail("No synthetic context writes cookies") })
        return Fixture(transport: transport, store: store, http: http, directory: directory, defaultsName: id)
    }
    private func finish(_ f: Fixture) async {
        await f.transport.reset(); UserDefaults.standard.removePersistentDomain(forName: f.defaultsName)
        try? FileManager.default.removeItem(at: f.directory)
    }
    private func seed(_ role: BusinessCacheFixture.Role, in f: Fixture) async throws {
        let session = try XCTUnwrap(ReylumiLocalSession.verified(BusinessCacheFixture.envelope(f.transport.generation, role: role), generation: f.transport.generation))
        await f.store.accept(session)
    }
    private func waitHeld(_ http: BusinessCacheHTTP) async throws {
        for _ in 0..<200 { if await http.isHeld() { return }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTFail("Fresh synthetic context did not start"); throw URLError(.timedOut)
    }
    private func scope(_ value: [String: Any]) -> String? { (value["context"] as? [String: Any])?["scope"] as? String }
    private func assertFreshPost(retained: BusinessCacheFixture.Role, current: BusinessCacheFixture.Role) async throws {
        let f = try fixture()
        try await seed(retained, in: f)
        await f.http.configure(current); _ = try await f.transport.freshContext(path: "/staff/my-work")
        await f.http.configure(.staffRoot, hold: "/salon-profile")
        let probe = Probe(), epoch = f.transport.scopeEpoch
        let pending = Task { @MainActor in defer { probe.completed = true }; return try await f.transport.context(path: "/salon-profile") }
        try await waitHeld(f.http)
        XCTAssertFalse(probe.completed, "Post must await its current root context instead of returning another role's cached envelope")
        XCTAssertEqual(f.transport.scopeEpoch, epoch, "A cache lookup must not adopt/reset to a retained role")
        await f.http.release()
        let value = try await pending.value
        XCTAssertEqual(scope(value), BusinessCacheFixture.rootScope); XCTAssertEqual(value["offline"] as? Bool, false)
        XCTAssertEqual((value["grant"] as? [String: Any])?["kind"] as? String, "customer", "Keep the original server's selected-Staff /market root shape")
        let paths = await f.http.paths; XCTAssertEqual(paths, ["/staff/my-work", "/salon-profile"])
        await finish(f)
    }

    func testPersonalToStaffFirstPostAwaitsFreshRootInsteadOfPersonalLease() async throws {
        try await assertFreshPost(retained: .personal, current: .staff)
    }
    func testRetainedOwnerCannotReplaceSelectedStaffWhilePostIsPending() async throws {
        try await assertFreshPost(retained: .owner, current: .staff)
    }
    func testOnlineOnlyStaffUsesCurrentOnlineScopeInsteadOfRetainedOwnerLease() async throws {
        try await assertFreshPost(retained: .owner, current: .onlineStaff)
    }
    func testPersonalCustomerCannotAdmitAnyBusinessPageButItsAccountPagesRemainCompatible() throws {
        let generation = UUID().uuidString
        let personal = try XCTUnwrap(ReylumiLocalSession.verified(BusinessCacheFixture.envelope(generation, role: .personal), generation: generation))
        for path in BusinessCacheFixture.ownerPaths + ["/salon-profile"] { XCTAssertFalse(personal.compatible(path: path), path) }
        for path in ["/", "/my-place", "/my-profile", "/explore", "/help", "/market"] { XCTAssertTrue(personal.compatible(path: path), path) }
    }
    func testServerShapedStaffRootCustomerAllowsOnlySharedSalonProfileAmongBusinessPages() throws {
        let generation = UUID().uuidString
        let root = try XCTUnwrap(ReylumiLocalSession.verified(BusinessCacheFixture.envelope(generation, role: .staffRoot), generation: generation))
        XCTAssertTrue(root.compatible(path: "/salon-profile"))
        for path in BusinessCacheFixture.ownerPaths { XCTAssertFalse(root.compatible(path: path), path) }
        let staff = try XCTUnwrap(ReylumiLocalSession.verified(BusinessCacheFixture.envelope(generation, role: .staff), generation: generation))
        XCTAssertTrue(staff.compatible(path: "/staff/my-work")); XCTAssertFalse(staff.compatible(path: "/salon-profile"), "Staff bindings remain limited to their existing native resource family")
    }
    func testNeutralHomeEstablishesOwnerAndPreservesItsOfflineBusinessContext() async throws {
        let f = try fixture(); try await seed(.owner, in: f)
        await f.http.configure(.owner, unavailable: true)
        let home = try await f.transport.context(path: "/")
        XCTAssertEqual(scope(home), BusinessCacheFixture.ownerScope)
        for path in ["/salon-profile", "/services", "/staff/today", "/pos-tickets", "/reports"] {
            let value = try await f.transport.context(path: path)
            XCTAssertEqual(scope(value), BusinessCacheFixture.ownerScope); XCTAssertEqual(value["offline"] as? Bool, true)
        }
        await finish(f)
    }
    func testCurrentStaffRootCanReuseMatchingSalonCustomerWithoutPersonalFallback() async throws {
        let f = try fixture()
        await f.http.configure(.staffRoot); _ = try await f.transport.freshContext(path: "/salon-profile")
        try await seed(.personal, in: f)
        await f.http.configure(.staffRoot, unavailable: true)
        let value = try await f.transport.context(path: "/salon-profile")
        XCTAssertEqual(scope(value), BusinessCacheFixture.rootScope); XCTAssertEqual(value["offline"] as? Bool, true)
        await finish(f)
    }
    func testColdNonNeutralBusinessRouteAwaitsFreshRatherThanGuessingRetainedOwner() async throws {
        let f = try fixture(); try await seed(.owner, in: f)
        await f.http.configure(.staffRoot, hold: "/salon-profile")
        let probe = Probe()
        let pending = Task { @MainActor in defer { probe.completed = true }; return try await f.transport.context(path: "/salon-profile") }
        try await waitHeld(f.http); XCTAssertFalse(probe.completed)
        await f.http.release(); let value = try await pending.value
        XCTAssertEqual(scope(value), BusinessCacheFixture.rootScope); XCTAssertEqual(value["offline"] as? Bool, false)
        await finish(f)
    }
    func testResetWhileFreshPostIsPendingCannotDeliverOrRestoreOldAuthority() async throws {
        let f = try fixture(); try await seed(.personal, in: f)
        await f.http.configure(.staff); _ = try await f.transport.freshContext(path: "/staff/my-work")
        await f.http.configure(.staffRoot, hold: "/salon-profile")
        let pending = Task { @MainActor in try await f.transport.context(path: "/salon-profile") }
        try await waitHeld(f.http); await f.transport.reset(); await f.http.release()
        do { _ = try await pending.value; XCTFail("A reset must reject the old pending context") } catch {}
        let restored = await f.store.session(generation: f.transport.generation); XCTAssertNil(restored)
        await finish(f)
    }
    func testPortableAndExpiredOrWrongGenerationLeasesKeepTheirExistingBoundaries() async throws {
        let generation = UUID().uuidString
        let portable = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.portableContext(generation: generation), generation: generation))
        XCTAssertTrue(portable.compatible(path: "/pos/portable")); XCTAssertTrue(portable.compatible(path: "/pos/customer-display"))
        for path in BusinessCacheFixture.ownerPaths + ["/", "/salon-profile", "/my-place"] { XCTAssertFalse(portable.compatible(path: path), path) }
        let owner = try XCTUnwrap(ReylumiLocalSession.verified(BusinessCacheFixture.envelope(generation, role: .owner), generation: generation))
        XCTAssertFalse(owner.valid(generation: UUID().uuidString)); XCTAssertFalse(owner.valid(generation: generation, at: Date().addingTimeInterval(7200)))
    }
}
