import XCTest
import Foundation
@testable import Reylumi

/// Holds the two real transport GET boundaries independently. No WK store,
/// live HTTP, account mutation or retried command is involved.
private actor OnlineAuthorityRefreshHTTP: ReylumiLocalHTTPClient {
    static let staffScope = "v3:" + String(repeating: "b", count: 64)
    static let personalScope = "v3:" + String(repeating: "c", count: 64)
    static let rootScope = "v3:" + String(repeating: "d", count: 64)
    private var patch: [String: Any] = [:]
    private var generic = false
    private var denied = false
    private var invalidProof = false
    private var holds: [String: XCTestExpectation] = [:]
    private var pending: [String: (Data, HTTPURLResponse, CheckedContinuation<(Data, HTTPURLResponse), Error>)] = [:]
    private(set) var commands = 0
    private(set) var paths: [String] = []
    func configure(generic: Bool = false, denied: Bool = false, invalidProof: Bool = false, patch: [String: Any] = [:]) {
        self.generic = generic; self.denied = denied; self.invalidProof = invalidProof; self.patch = patch
    }
    func hold(_ path: String, signal: XCTestExpectation) { holds[path] = signal }
    func release(_ path: String) throws {
        let (data, response, continuation) = try XCTUnwrap(pending.removeValue(forKey: path))
        continuation.resume(returning: (data, response))
    }
    static func context(generation: String, personal: Bool = false) -> [String: Any] {
        let scope = personal ? personalScope : staffScope, workspace = personal ? "personal" : "staff:fixture"
        var value = AppLocalTestFixture.context(generation: generation, scope: scope, kind: personal ? "customer" : "staff", workspace: workspace)
        var context = value["context"] as! [String: Any], grant = value["grant"] as! [String: Any]
        grant["workspaceId"] = workspace; grant["path"] = personal ? "/market" : "/staff/my-work"
        if personal { context["salonId"] = NSNull(); grant["salonId"] = NSNull() }
        value["context"] = context; value["grant"] = grant
        value["grantStatus"] = 200; value["access"] = ["ownerWorkspace": false, "staffWorkspace": !personal]
        return value
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        guard url.scheme == "https", url.host == "reylumi.com" else { throw URLError(.unsupportedURL) }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        var object: [String: Any]
        var heldPath: String?
        if url.path == "/api/app-local/context", request.httpMethod == "GET" {
            let path = try XCTUnwrap(query.first { $0.name == "path" }?.value)
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            paths.append(path)
            if path == "/" {
                object = Self.context(generation: generation)
                var context = object["context"] as! [String: Any], grant = object["grant"] as! [String: Any]
                context["scope"] = Self.rootScope
                grant["scope"] = Self.rootScope; grant["scopes"] = [Self.rootScope]
                grant["kind"] = "customer"; grant["path"] = "/market"; grant.removeValue(forKey: "staffBinding")
                object["context"] = context; object["grant"] = grant
            } else {
                guard path == "/staff/my-work" else { throw URLError(.unsupportedURL) }
                object = Self.context(generation: generation)
                var context = object["context"] as! [String: Any]
                context.merge(patch) { _, new in new }; object["context"] = context
                object["grant"] = NSNull(); object["grantStatus"] = 503
                if denied { object["offlineState"] = "unconfirmed" }
                else if !generic {
                    object["offlineState"] = "online-only"
                    object["staffOnlineAccess"] = ["version": 1, "staffId": "00000000-0000-4000-8000-000000000003", "viewerId": context["viewerId"]!, "salonId": context["salonId"]!, "scope": invalidProof ? Self.personalScope : context["scope"]!]
                }
            }
            heldPath = path
        } else if url.path == "/api/app-local/read", request.httpMethod == "GET" {
            return (Data("{}".utf8), HTTPURLResponse(url: url, statusCode: 409, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
        } else {
            guard url.path == "/api/app-local/command", request.httpMethod == "POST" else { throw URLError(.unsupportedURL) }
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
            XCTAssertEqual(body["name"] as? String, "shell.switch-workspace")
            XCTAssertEqual((body["args"] as? [String: Any])?["workspaceId"] as? String, "owner")
            XCTAssertEqual(body["scope"] as? String, Self.rootScope)
            commands += 1
            object = ["ok": true, "data": ["path": "/staff/today"]]
        }
        let data = try JSONSerialization.data(withJSONObject: object)
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        if let path = heldPath, let signal = holds.removeValue(forKey: path) {
            return try await withCheckedThrowingContinuation { pending[path] = (data, response, $0); signal.fulfill() }
        }
        return (data, response)
    }
}

@MainActor
final class OnlineAuthorityRefreshTests: XCTestCase {
    private struct Fixture {
        let transport: ReylumiLocalAppTransport
        let store: ReylumiLocalReadStore
        let http: OnlineAuthorityRefreshHTTP
        let directory: URL
    }
    private func fixture(retainPersonal: Bool = true) async throws -> Fixture {
        let bundle = try ReylumiLocalBundle.installed(), id = "reylumi.tests.online-refresh." + UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let origin = URL(string: "https://reylumi.com")!, http = OnlineAuthorityRefreshHTTP()
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: id)!, cookies: { [] }, setCookie: { _ in XCTFail("These responses have no cookie updates") })
        if retainPersonal {
            let retained = OnlineAuthorityRefreshHTTP.context(generation: transport.generation, personal: true)
            await store.accept(try XCTUnwrap(ReylumiLocalSession.verified(retained, generation: transport.generation)))
        }
        _ = try await transport.freshContext(path: "/staff/my-work")
        return Fixture(transport: transport, store: store, http: http, directory: directory)
    }
    private func command(_ f: Fixture) -> Task<[String: Any], Error> {
        Task { @MainActor in try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: OnlineAuthorityRefreshHTTP.staffScope) }
    }
    private func unchangedRefresh(generic: Bool) async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        await f.http.configure(generic: generic)
        let displayHeld = expectation(description: "periodic Staff GET pending before gesture")
        await f.http.hold("/staff/my-work", signal: displayHeld)
        let display = Task { @MainActor in try await f.transport.freshContext(path: "/staff/my-work") }
        await fulfillment(of: [displayHeld], timeout: 5)
        let rootHeld = expectation(description: "neutral command preflight pending")
        await f.http.hold("/", signal: rootHeld)
        let epoch = f.transport.scopeEpoch, generation = f.transport.generation
        var resets = 0; f.transport.onEvent = { event, _ in if event == "reylumi:app-local-reset" { resets += 1 } }
        let selection = command(f)
        await fulfillment(of: [rootHeld], timeout: 5)
        try await f.http.release("/staff/my-work"); _ = try await display.value
        XCTAssertEqual(f.transport.scopeEpoch, epoch, "An identical selected online identity must not rotate against another retained lease")
        XCTAssertEqual(resets, 0)
        let retained = await f.store.session(generation: generation, scope: OnlineAuthorityRefreshHTTP.personalScope, authority: "customer")
        XCTAssertNotNil(retained, "Retained Personal authority remains stored, without becoming selected Staff authority")
        let staffCache = await f.transport.matchesCachedScope(OnlineAuthorityRefreshHTTP.staffScope)
        XCTAssertFalse(staffCache)
        try await f.http.release("/")
        var reply: [String: Any]?, error: Error?
        do { reply = try await selection.value } catch let caught { error = caught }
        XCTAssertNil(error, "An unchanged background display check must not cancel the one workspace selection")
        XCTAssertEqual(reply?["ok"] as? Bool, true)
        let commands = await f.http.commands, paths = await f.http.paths
        XCTAssertEqual(commands, 1); XCTAssertEqual(paths.filter { $0 == "/" }.count, 1, "No GET or POST retry is introduced")
        XCTAssertEqual(f.transport.generation, generation)
        await f.transport.reset()
    }
    func testIdenticalExplicitOnlineStaffRefreshDoesNotCancelWorkspacePreflight() async throws { try await unchangedRefresh(generic: false) }
    func testIdenticalGenericLeaseOutageDoesNotBorrowPersonalLeaseOrCancelPreflight() async throws { try await unchangedRefresh(generic: true) }

    func testGeneric503CannotSelectUnrelatedPersonalLeaseForReadConflictRevocation() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        await f.http.configure(generic: true)
        _ = try await f.transport.freshContext(path: "/staff/my-work")
        // A read without an explicit scope uses the selected native lease for
        // invalidation. It must not withdraw an unrelated retained Personal
        // lease simply because the current online Staff envelope has no grant.
        do { _ = try await f.transport.read(name: "staff.my-work", args: [:], etag: nil); XCTFail("Synthetic obsolete read must fail") }
        catch { XCTAssertEqual((error as NSError).code, 409) }
        let retained = await f.store.session(generation: f.transport.generation, scope: OnlineAuthorityRefreshHTTP.personalScope, authority: "customer")
        XCTAssertNotNil(retained)
        let staff = await f.transport.matchesCachedScope(OnlineAuthorityRefreshHTTP.staffScope); XCTAssertFalse(staff)
        await f.transport.reset()
    }

    func testChangedOnlineIdentityStillInvalidatesPendingWorkspacePreflight() async throws {
        let changes: [[String: Any]] = [["permissionRevision": "permissions-changed"], ["scope": "v3:" + String(repeating: "e", count: 64)], ["viewerId": "00000000-0000-4000-8000-000000000009"]]
        for patch in changes {
            let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
            await f.http.configure(patch: patch)
            let held = expectation(description: "command preflight held across actual authority change")
            await f.http.hold("/", signal: held); let pending = command(f)
            await fulfillment(of: [held], timeout: 5)
            let epoch = f.transport.scopeEpoch
            _ = try await f.transport.freshContext(path: "/staff/my-work")
            XCTAssertNotEqual(f.transport.scopeEpoch, epoch)
            try await f.http.release("/")
            do { _ = try await pending.value; XCTFail("Changed authority cannot submit the old gesture") } catch { XCTAssertTrue(error is CancellationError) }
            let commands = await f.http.commands; XCTAssertEqual(commands, 0)
            if patch["viewerId"] != nil {
                let old = await f.store.session(generation: f.transport.generation, scope: OnlineAuthorityRefreshHTTP.personalScope)
                XCTAssertNil(old, "Changing viewer clears the retained account")
            }
            await f.transport.reset()
        }
    }
    func testUnconfirmedOrInvalidStaffProofStillBlocksPendingWorkspaceCommand() async throws {
        for invalidProof in [false, true] {
            let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
            let held = expectation(description: "preflight held across explicit Staff denial")
            await f.http.hold("/", signal: held); let pending = command(f)
            await fulfillment(of: [held], timeout: 5)
            await f.http.configure(denied: !invalidProof, invalidProof: invalidProof)
            let denied = try await f.transport.freshContext(path: "/staff/my-work")
            XCTAssertTrue(denied["grant"] is NSNull)
            try await f.http.release("/")
            do { _ = try await pending.value; XCTFail("Denied current Staff authority cannot submit") } catch { XCTAssertTrue(error is CancellationError) }
            let commands = await f.http.commands; XCTAssertEqual(commands, 0)
            let cache = await f.transport.matchesCachedScope(OnlineAuthorityRefreshHTTP.staffScope); XCTAssertFalse(cache)
            await f.transport.reset()
        }
    }
    func testOuterCancellationAndResetStillCannotPostAfterPreflightReturns() async throws {
        for cancel in [false, true] {
            let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
            let held = expectation(description: "preflight held before cancellation")
            await f.http.hold("/", signal: held); let pending = command(f)
            await fulfillment(of: [held], timeout: 5)
            if cancel { pending.cancel() } else { await f.transport.reset() }
            try await f.http.release("/")
            do { _ = try await pending.value; XCTFail("Cancelled or reset command cannot post") } catch {}
            let commands = await f.http.commands; XCTAssertEqual(commands, 0)
            await f.transport.reset()
        }
    }
    func testUnconfirmedCurrentOnlineStaffWithNoStoredLeaseStillInvalidatesPendingCommand() async throws {
        let f = try await fixture(retainPersonal: false); defer { try? FileManager.default.removeItem(at: f.directory) }
        let stored = await f.store.session(generation: f.transport.generation)
        XCTAssertNil(stored, "The denial fence must not depend on an unrelated retained lease")
        let held = expectation(description: "neutral preflight held before same-identity unconfirmed Staff response")
        await f.http.hold("/", signal: held); let pending = command(f)
        await fulfillment(of: [held], timeout: 5)
        let epoch = f.transport.scopeEpoch
        await f.http.configure(denied: true)
        let denied = try await f.transport.freshContext(path: "/staff/my-work")
        XCTAssertEqual(denied["offlineState"] as? String, "unconfirmed")
        XCTAssertNotEqual(f.transport.scopeEpoch, epoch, "Explicit display denial invalidates an already pending gesture even without a disk lease")
        try await f.http.release("/")
        do { _ = try await pending.value; XCTFail("An explicitly withdrawn displayed identity cannot authorize its old gesture") } catch { XCTAssertTrue(error is CancellationError) }
        let commands = await f.http.commands; XCTAssertEqual(commands, 0)
        await f.transport.reset()
    }
}
