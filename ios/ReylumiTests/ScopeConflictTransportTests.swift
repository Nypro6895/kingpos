import XCTest
import Foundation
import CryptoKit
@testable import Reylumi

/// Real native transport/store/authority checks with a controllable HTTP boundary.
/// No production identity, business data, server or command is contacted.
private actor ScopeConflictHTTP: ReylumiLocalHTTPClient {
    static let nextScope = "v3:" + String(repeating: "b", count: 64)
    private var scope = AppLocalTestFixture.scope
    private var contextStatus = 200
    private var grantStatus: Int?
    private var unconfirmed = false, holdContext = false, networkDown = false
    private var readStatus: Int?
    private var pendingContext: (Data, HTTPURLResponse, CheckedContinuation<(Data, HTTPURLResponse), Error>)?
    private var pendingRead: (URLRequest, CheckedContinuation<(Data, HTTPURLResponse), Error>)?
    private(set) var commands = 0, contexts = 0, reads = 0

    func configureContext(scope: String, status: Int = 200, grantStatus: Int? = nil, unconfirmed: Bool = false, hold: Bool = false) {
        self.scope = scope; contextStatus = status; self.grantStatus = grantStatus
        self.unconfirmed = unconfirmed; holdContext = hold
    }
    func configureReadStatus(_ status: Int?) { readStatus = status }
    func configureNetworkDown() { networkDown = true }
    func contextHeld() -> Bool { pendingContext != nil }
    func readHeld() -> Bool { pendingRead != nil }
    private func response(_ request: URLRequest, object: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> (Data, HTTPURLResponse) {
        let fields = headers.merging(["Content-Type": "application/json"]) { _, new in new }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: fields)!)
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if networkDown { throw URLError(.notConnectedToInternet) }
        let url = try XCTUnwrap(request.url), query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if url.path == "/api/app-local/context" {
            contexts += 1
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            var object = AppLocalTestFixture.context(generation: generation, scope: scope)
            object["grantStatus"] = grantStatus ?? 200
            if let grantStatus { object["grant"] = NSNull(); object["grantStatus"] = grantStatus }
            if unconfirmed { object["offlineState"] = "unconfirmed" }
            let reply = try response(request, object: contextStatus == 200 ? object : ["error": "Synthetic context failure"], status: contextStatus)
            if holdContext {
                holdContext = false
                return try await withCheckedThrowingContinuation { pendingContext = (reply.0, reply.1, $0) }
            }
            return reply
        }
        if url.path == "/api/app-local/command" {
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
            guard body["name"] as? String == "shell.switch-workspace" else { throw URLError(.unsupportedURL) }
            commands += 1; scope = Self.nextScope
            return try response(request, object: ["ok": true, "data": ["path": "/help"]], headers: ["Set-Cookie": "kingpos-selected-workspace=next; Path=/; Secure; SameSite=Lax"])
        }
        guard url.path == "/api/app-local/read" else { throw URLError(.unsupportedURL) }
        reads += 1
        if (query.first { $0.name == "args" }?.value ?? "").contains("late") {
            return try await withCheckedThrowingContinuation { pendingRead = (request, $0) }
        }
        let requested = query.first { $0.name == "scope" }?.value
        return try readResponse(request, status: readStatus ?? (requested == scope ? 200 : 409))
    }
    private func readResponse(_ request: URLRequest, status: Int) throws -> (Data, HTTPURLResponse) {
        let object: [String: Any] = status == 200 ? ["schemaVersion": 1, "status": 200, "scope": scope, "etag": "fresh", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["current": true]] : ["error": "Synthetic obsolete scope"]
        return try response(request, object: object, status: status)
    }
    func releaseContext() {
        guard let (data, response, continuation) = pendingContext else { return }; pendingContext = nil
        continuation.resume(returning: (data, response))
    }
    func releaseRead(status: Int) throws {
        guard let (request, continuation) = pendingRead else { return }; pendingRead = nil
        continuation.resume(returning: try readResponse(request, status: status))
    }
}

private actor ScopeConflictCookieJar {
    private var values: [HTTPCookie] = []
    func all() -> [HTTPCookie] { values }
    func put(_ cookie: HTTPCookie) {
        values.removeAll { $0.name == cookie.name && $0.path == cookie.path && $0.domain == cookie.domain }
        values.append(cookie)
    }
}

@MainActor
final class ScopeConflictTransportTests: XCTestCase {
    private struct Fixture {
        let transport: ReylumiLocalAppTransport
        let store: ReylumiLocalReadStore
        let http: ScopeConflictHTTP
        let directory: URL
    }
    private func fixture() throws -> Fixture {
        let (_, directory) = try AppLocalTestFixture.bundle()
        let file = directory.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        var commands = try XCTUnwrap(manifest["commands"] as? [[String: Any]])
        commands.append(["name": "shell.switch-workspace", "path": "/api/app-local/command", "argumentKeys": ["workspaceId"]])
        manifest["commands"] = commands; try JSONSerialization.data(withJSONObject: manifest).write(to: file)
        let bundle = try ReylumiLocalBundle(directory: directory), origin = URL(string: "https://reylumi.com")!
        let id = "reylumi.tests.scope-conflict." + UUID().uuidString, http = ScopeConflictHTTP(), jar = ScopeConflictCookieJar()
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: id)!, cookies: { await jar.all() }, setCookie: { await jar.put($0) }, diagnostics: ReylumiLocalDiagnostics(enabled: true))
        return Fixture(transport: transport, store: store, http: http, directory: directory)
    }
    private func seedCachedScope(_ f: Fixture) async throws {
        let lease = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: f.transport.generation), generation: f.transport.generation))
        await f.store.accept(lease)
        let key = "fixture.roster:" + SHA256.hash(data: Data("{}".utf8)).map { String(format: "%02x", $0) }.joined()
        let data: [String: Any] = ["schemaVersion": 1, "status": 200, "scope": lease.scope, "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["private": "withdrawn fixture"]]
        await f.store.put(key, payload: try JSONSerialization.data(withJSONObject: data), session: lease)
    }
    private func waitForHeld(_ f: Fixture, context: Bool) async throws {
        for _ in 0..<200 {
            let held: Bool
            if context { held = await f.http.contextHeld() } else { held = await f.http.readHeld() }
            if held { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("The controlled native HTTP boundary was not reached"); throw URLError(.timedOut)
    }
    private func expectConflict(_ f: Fixture) async throws {
        do { _ = try await f.transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope); XCTFail("An obsolete scope cannot deliver its private data") }
        catch {
            let error = error as NSError
            XCTAssertEqual(error.code, 409); XCTAssertEqual(error.userInfo["reason"] as? String, "stale-scope")
        }
    }

    func testRead409BeforeContext200WithdrawsOldScopeAndPreservesCurrentAuthorityFlight() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        try await seedCachedScope(f)
        await f.http.configureContext(scope: ScopeConflictHTTP.nextScope, hold: true)
        var conflicts: [[String: Any]] = [], resets = 0
        f.transport.onEvent = { name, detail in if name == "reylumi:app-local-scope-conflict" { conflicts.append(detail) }; if name == "reylumi:app-local-reset" { resets += 1 } }
        let cached = try await f.transport.context(path: "/help"); XCTAssertEqual(cached["offline"] as? Bool, true)
        try await waitForHeld(f, context: true)
        let authority = Task { @MainActor in try await f.transport.freshContext(path: "/help") }
        let epoch = f.transport.scopeEpoch, generation = f.transport.generation
        try await expectConflict(f)
        XCTAssertEqual(f.transport.scopeEpoch, epoch); XCTAssertEqual(f.transport.generation, generation); XCTAssertEqual(resets, 0)
        XCTAssertEqual(conflicts.count, 1); XCTAssertEqual(conflicts.first?["scope"] as? String, AppLocalTestFixture.scope)
        let oldLease = await f.store.session(generation: generation, scope: AppLocalTestFixture.scope)
        let oldData = try await f.transport.cached(name: "fixture.roster", args: [:], requestedScope: AppLocalTestFixture.scope)
        XCTAssertNil(oldLease); XCTAssertNil(oldData)
        await f.http.releaseContext()
        let current = try await authority.value
        XCTAssertEqual((current["context"] as? [String: Any])?["scope"] as? String, ScopeConflictHTTP.nextScope)
        let read = try await f.transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: ScopeConflictHTTP.nextScope)
        XCTAssertEqual((read["data"] as? [String: Any])?["current"] as? Bool, true)
        let commands = await f.http.commands, contexts = await f.http.contexts
        XCTAssertEqual(commands, 0); XCTAssertEqual(contexts, 1, "Conflict recovery must join the already pending authority GET")
        await f.transport.reset()
    }

    func testPreConflictSameScopeResponseIsCancelledAndOnlyNewAuthorityGETCanReauthorizeIt() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        try await seedCachedScope(f)
        await f.http.configureContext(scope: AppLocalTestFixture.scope, hold: true)
        await f.http.configureReadStatus(409)
        // Higher-priority joiners may resume before the background creator's
        // outer method. Each must be able to start/join the new GET immediately
        // after cancellation, rather than rejoining the completed old task.
        let launch = Task(priority: .background) { @MainActor in try await f.transport.context(path: "/help") }
        _ = try await launch.value; try await waitForHeld(f, context: true)
        let joiners = (0..<4).map { _ in
            Task(priority: .userInitiated) { @MainActor in
                do { _ = try await f.transport.freshContext(path: "/help"); XCTFail("The pre-conflict same-scope snapshot must not restore withdrawn authority") }
                catch { XCTAssertTrue(error is CancellationError) }
                return try await f.transport.freshContext(path: "/help")
            }
        }
        for _ in 0..<200 {
            if f.transport.diagnostics.snapshot().filter({ $0.event == .contextJoin }).count == joiners.count { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(f.transport.diagnostics.snapshot().filter({ $0.event == .contextJoin }).count, joiners.count)
        try await expectConflict(f)
        let quarantinedLease = await f.store.session(generation: f.transport.generation, scope: AppLocalTestFixture.scope)
        XCTAssertNil(quarantinedLease)
        await f.http.releaseContext()
        for joiner in joiners {
            let current = try await joiner.value
            XCTAssertEqual((current["context"] as? [String: Any])?["scope"] as? String, AppLocalTestFixture.scope)
        }
        let oldData = try await f.transport.cached(name: "fixture.roster", args: [:], requestedScope: AppLocalTestFixture.scope)
        XCTAssertNil(oldData, "A newly verified lease cannot revive the withdrawn old payload")
        await f.http.configureReadStatus(nil)
        let read = try await f.transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope)
        XCTAssertEqual(read["status"] as? Int, 200)
        let contexts = await f.http.contexts
        XCTAssertEqual(contexts, 2, "Same-scope recovery needs exactly one new post-conflict authority GET")
        await f.transport.reset()
    }

    func testConflictRecoveryPreservesHTTPDenialsUnavailableAndUnconfirmedEnvelope() async throws {
        let scenarios: [(Int, Int?, Bool)] = [(401, nil, false), (403, nil, false), (503, nil, false), (200, 401, false), (200, 403, false), (200, 409, false), (200, 503, true)]
        for (status, grantStatus, unconfirmed) in scenarios {
            let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
            try await seedCachedScope(f)
            await f.http.configureContext(scope: ScopeConflictHTTP.nextScope, status: status, grantStatus: grantStatus, unconfirmed: unconfirmed, hold: true)
            _ = try await f.transport.context(path: "/help"); try await waitForHeld(f, context: true)
            let authority = Task { @MainActor in try await f.transport.freshContext(path: "/help") }
            try await expectConflict(f); await f.http.releaseContext()
            if status == 200 {
                let denied = try await authority.value
                XCTAssertEqual(denied["grantStatus"] as? Int, grantStatus)
                XCTAssertEqual(denied["offlineState"] as? String == "unconfirmed", unconfirmed)
            } else {
                do { _ = try await authority.value; XCTFail("A genuine context failure must remain a failure") }
                catch { XCTAssertEqual((error as NSError).code, status) }
            }
            let oldLease = await f.store.session(generation: f.transport.generation, scope: AppLocalTestFixture.scope)
            let newLease = await f.store.session(generation: f.transport.generation, scope: ScopeConflictHTTP.nextScope)
            XCTAssertNil(oldLease); XCTAssertNil(newLease)
            await f.http.configureNetworkDown()
            do { _ = try await f.transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope); XCTFail("Network failure cannot revive a withdrawn old scope") }
            catch { XCTAssertTrue(error is URLError) }
            let commands = await f.http.commands; XCTAssertEqual(commands, 0)
            await f.transport.reset()
        }
    }

    func testDepartingRead409AfterWorkspaceSwitchCannotWithdrawTheVerifiedDestination() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        _ = try await f.transport.freshContext(path: "/help")
        let oldRead = Task { @MainActor in try await f.transport.read(name: "fixture.roster", args: ["date": "late"], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        try await waitForHeld(f, context: false)
        _ = try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "next"], requestID: UUID().uuidString, path: "/help", requestedScope: AppLocalTestFixture.scope)
        let current = try await f.transport.freshContext(path: "/help")
        var conflicts = 0, resets = 0
        f.transport.onEvent = { name, _ in if name == "reylumi:app-local-scope-conflict" { conflicts += 1 }; if name == "reylumi:app-local-reset" { resets += 1 } }
        let epoch = f.transport.scopeEpoch, generation = f.transport.generation
        try await f.http.releaseRead(status: 409)
        do { _ = try await oldRead.value; XCTFail("A departing role response must not be delivered") }
        catch { XCTAssertTrue(error is CancellationError, "An obsolete local epoch is cancellation, not authoritative server409") }
        XCTAssertEqual(conflicts, 0); XCTAssertEqual(resets, 0); XCTAssertEqual(f.transport.scopeEpoch, epoch)
        XCTAssertEqual((current["context"] as? [String: Any])?["scope"] as? String, ScopeConflictHTTP.nextScope)
        let lease = await f.store.session(generation: generation, scope: ScopeConflictHTTP.nextScope)
        XCTAssertNotNil(lease)
        let commands = await f.http.commands; XCTAssertEqual(commands, 1, "Read recovery must never replay the role-changing POST")
        await f.transport.reset()
    }

    func testPageSupersessionCancelsOldDeliveryWithoutFabricatingWorkspaceDenial() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        _ = try await f.transport.freshContext(path: "/help")
        let oldRead = Task { @MainActor in try await f.transport.read(name: "fixture.roster", args: ["date": "late"], etag: nil, requestedScope: AppLocalTestFixture.scope) }
        try await waitForHeld(f, context: false)
        f.transport.invalidatePage(); try await f.http.releaseRead(status: 200)
        do { _ = try await oldRead.value; XCTFail("A response from the previous page cannot be delivered") }
        catch { XCTAssertTrue(error is CancellationError) }
        let lease = await f.store.session(generation: f.transport.generation, scope: AppLocalTestFixture.scope)
        XCTAssertNotNil(lease, "Page supersession alone does not revoke the account's valid display lease")
        await f.transport.reset()
    }

    func testOldScopeConflictCannotWithdrawADifferentAlreadyVerifiedScope() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        _ = try await f.transport.freshContext(path: "/help")
        await f.http.configureContext(scope: ScopeConflictHTTP.nextScope)
        _ = try await f.transport.freshContext(path: "/help")
        let epoch = f.transport.scopeEpoch
        try await expectConflict(f)
        XCTAssertEqual(f.transport.scopeEpoch, epoch)
        let lease = await f.store.session(generation: f.transport.generation, scope: ScopeConflictHTTP.nextScope)
        XCTAssertNotNil(lease)
        let data = try await f.transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: ScopeConflictHTTP.nextScope)
        XCTAssertEqual(data["status"] as? Int, 200, "An old resource cannot clear the new scope's online context barrier")
        let commands = await f.http.commands; XCTAssertEqual(commands, 0)
        await f.transport.reset()
    }
}
