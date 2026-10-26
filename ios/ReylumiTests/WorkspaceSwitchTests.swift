import XCTest
import Foundation
@testable import Reylumi

private actor WorkspaceCookieJar {
    private var cookies: [HTTPCookie]
    let dropWrites: Bool
    init(role: String = "staff", dropWrites: Bool = false) {
        self.dropWrites = dropWrites
        cookies = [HTTPCookie(properties: [.name: "kingpos-selected-workspace", .value: role, .domain: "reylumi.com", .path: "/", .secure: "TRUE"])!]
    }
    func all() -> [HTTPCookie] { cookies }
    func put(_ value: HTTPCookie) {
        guard !dropWrites else { return }
        cookies.removeAll { $0.name == value.name && $0.path == value.path && $0.domain == value.domain }
        cookies.append(value)
    }
}

/// Synthetic HTTP only. It derives selected role from the request cookie, just
/// as the original server does; no server-side fake workspace is persisted.
private actor WorkspaceSwitchHTTP: ReylumiLocalHTTPClient {
    static let ownerScope = "v3:" + String(repeating: "a", count: 64)
    static let staffScope = "v3:" + String(repeating: "b", count: 64)
    static let staffRootScope = "v3:" + String(repeating: "c", count: 64)
    private var staffUnavailable = false, loseAcknowledgment = false, holdRoot = false, holdCommand = false, denyTarget = false
    private var rootStatus = 200
    private var viewer = "00000000-0000-4000-8000-000000000001"
    private var held: (Data, HTTPURLResponse, CheckedContinuation<(Data, HTTPURLResponse), Error>)?
    private(set) var contextPaths: [String] = [], postedScopes: [String] = [], commands = 0
    func configure(staffUnavailable: Bool = false, loseAcknowledgment: Bool = false, holdRoot: Bool = false, holdCommand: Bool = false, denyTarget: Bool = false, changedViewer: Bool = false, rootStatus: Int = 200) {
        self.staffUnavailable = staffUnavailable; self.loseAcknowledgment = loseAcknowledgment
        self.holdRoot = holdRoot; self.holdCommand = holdCommand; self.denyTarget = denyTarget
        self.rootStatus = rootStatus
        if changedViewer { viewer = "00000000-0000-4000-8000-000000000009" }
    }
    func isHeld() -> Bool { held != nil }
    func release() { guard let (data, response, continuation) = held else { return }; held = nil; continuation.resume(returning: (data, response)) }
    static func context(generation: String, role: String, root: Bool = false, viewer: String = "00000000-0000-4000-8000-000000000001") -> [String: Any] {
        let scope = role == "owner" ? ownerScope : root ? staffRootScope : staffScope
        var value = AppLocalTestFixture.context(generation: generation, scope: scope, kind: role == "owner" ? "owner" : root ? "customer" : "staff", viewer: viewer, workspace: role, primaryScope: role == "staff" ? staffRootScope : nil)
        var grant = value["grant"] as! [String: Any]
        grant["workspaceId"] = role; grant["path"] = role == "owner" ? "/staff/today" : root ? "/market" : "/staff/my-work"; value["grant"] = grant
        value["home"] = role == "owner" ? "/staff/today" : "/staff/my-work"
        value["access"] = ["ownerWorkspace": role == "owner", "staffWorkspace": role == "staff"]
        return value
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url), query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let role = (request.value(forHTTPHeaderField: "Cookie") ?? "").contains("kingpos-selected-workspace=owner") ? "owner" : "staff"
        var status = 200, headers = ["Content-Type": "application/json"]
        let data: Data
        var shouldHold = false
        if url.path == "/api/app-local/context" {
            let path = query.first { $0.name == "path" }?.value ?? ""
            contextPaths.append(path)
            if path == "/staff/my-work", staffUnavailable { throw URLError(.timedOut) }
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            if path == "/", rootStatus != 200 { status = rootStatus; data = try JSONSerialization.data(withJSONObject: ["error": "Synthetic root session unavailable"]) }
            else { data = try JSONSerialization.data(withJSONObject: Self.context(generation: generation, role: path == "/staff/my-work" ? "staff" : role, root: path == "/", viewer: viewer)) }
            shouldHold = path == "/" && holdRoot
        } else {
            guard url.path == "/api/app-local/command", request.httpMethod == "POST" else { throw URLError(.unsupportedURL) }
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
            guard body["name"] as? String == "shell.switch-workspace", let args = body["args"] as? [String: Any], let target = args["workspaceId"] as? String, ["owner", "staff"].contains(target) else { throw URLError(.unsupportedURL) }
            let scope = body["scope"] as? String ?? ""
            commands += 1; postedScopes.append(scope)
            XCTAssertEqual(scope, role == "owner" ? Self.ownerScope : Self.staffRootScope, "The command is bound to the freshly validated root workspace")
            if denyTarget { status = 403; data = try JSONSerialization.data(withJSONObject: ["ok": false]) }
            else {
                headers["Set-Cookie"] = "kingpos-selected-workspace=\(target); Path=/; Secure; SameSite=Lax"
                // Native commits verified response cookies before decoding.
                // An invalid/lost application acknowledgment must not replay.
                if loseAcknowledgment { data = Data("Synthetic unreadable acknowledgment".utf8) }
                else { data = try JSONSerialization.data(withJSONObject: ["ok": true, "data": ["path": target == "owner" ? "/staff/today" : "/staff/my-work"]]) }
            }
            shouldHold = holdCommand
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!
        if shouldHold { return try await withCheckedThrowingContinuation { held = (data, response, $0) } }
        return (data, response)
    }
}

@MainActor
final class WorkspaceSwitchTests: XCTestCase {
    private struct Fixture {
        let transport: ReylumiLocalAppTransport
        let http: WorkspaceSwitchHTTP
        let directory: URL
    }
    private func fixture(dropCookieWrites: Bool = false) async throws -> Fixture {
        let bundle = try ReylumiLocalBundle.installed()
        let origin = URL(string: "https://reylumi.com")!, id = "reylumi.tests.workspace-switch." + UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let http = WorkspaceSwitchHTTP(), jar = WorkspaceCookieJar(dropWrites: dropCookieWrites)
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: id)!, cookies: { await jar.all() }, setCookie: { await jar.put($0) })
        let staff = try XCTUnwrap(ReylumiLocalSession.verified(WorkspaceSwitchHTTP.context(generation: transport.generation, role: "staff"), generation: transport.generation))
        await store.accept(staff)
        return Fixture(transport: transport, http: http, directory: directory)
    }
    private func waitHeld(_ http: WorkspaceSwitchHTTP) async throws {
        for _ in 0..<200 { if await http.isHeld() { return }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTFail("Synthetic workspace preflight did not reach its held boundary"); throw URLError(.timedOut)
    }

    func testSwitchUsesFreshRootIdentityWhenOldStaffBindingIsUnavailableWithoutAdoptingPreflight() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        await f.http.configure(staffUnavailable: true)
        var events = 0; f.transport.onEvent = { _, _ in events += 1 }
        let epoch = f.transport.scopeEpoch, generation = f.transport.generation
        let reply = try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope)
        XCTAssertEqual(reply["ok"] as? Bool, true); XCTAssertEqual((reply["data"] as? [String: Any])?["path"] as? String, "/staff/today")
        XCTAssertEqual(f.transport.scopeEpoch, epoch); XCTAssertEqual(f.transport.generation, generation); XCTAssertEqual(events, 0)
        let paths = await f.http.contextPaths, posts = await f.http.postedScopes
        XCTAssertEqual(paths, ["/"]); XCTAssertEqual(posts, [WorkspaceSwitchHTTP.staffRootScope])
        let destination = try await f.transport.freshContext(path: "/staff/today")
        XCTAssertEqual((destination["grant"] as? [String: Any])?["kind"] as? String, "owner")
        await f.transport.reset()
    }

    func testCookieCommittedButUnreadableAcknowledgmentRecoversByNeutralReadsWithOneCommand() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        await f.http.configure(staffUnavailable: true, loseAcknowledgment: true)
        do { _ = try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope); XCTFail("Unreadable acknowledgment must remain unconfirmed") } catch {}
        let neutral = try await f.transport.freshContext(path: "/")
        XCTAssertEqual(neutral["home"] as? String, "/staff/today")
        let destination = try await f.transport.freshContext(path: neutral["home"] as! String)
        XCTAssertEqual((destination["context"] as? [String: Any])?["scope"] as? String, WorkspaceSwitchHTTP.ownerScope)
        let commands = await f.http.commands, paths = await f.http.contextPaths
        XCTAssertEqual(commands, 1); XCTAssertFalse(paths.contains("/staff/my-work"))
        await f.transport.reset()
    }

    func testWrongScopeOrChangedAccountCannotSendWorkspaceCommand() async throws {
        for changedViewer in [false, true] {
            let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
            await f.http.configure(changedViewer: changedViewer)
            let generation = f.transport.generation
            do { _ = try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: changedViewer ? WorkspaceSwitchHTTP.staffScope : WorkspaceSwitchHTTP.ownerScope); XCTFail("An old account or unrelated displayed scope cannot submit") } catch { XCTAssertEqual((error as NSError).code, 409) }
            let commands = await f.http.commands; XCTAssertEqual(commands, 0)
            if changedViewer { XCTAssertNotEqual(f.transport.generation, generation) }
            await f.transport.reset()
        }
    }

    func testCancelledOrResetPreflightCannotReachCommandPost() async throws {
        for cancel in [false, true] {
            let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
            await f.http.configure(holdRoot: true)
            let pending = Task { @MainActor in try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope) }
            try await waitHeld(f.http)
            if cancel { pending.cancel() } else { await f.transport.reset() }
            await f.http.release()
            do { _ = try await pending.value; XCTFail("Cancelled or reset preflight cannot post") } catch {}
            let commands = await f.http.commands; XCTAssertEqual(commands, 0)
            await f.transport.reset()
        }
    }

    func testConcurrentWorkspaceWritesAreRejectedAndCookieVerificationStillFencesDelivery() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        await f.http.configure(holdCommand: true)
        let first = Task { @MainActor in try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope) }
        try await waitHeld(f.http)
        do { _ = try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "staff"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope); XCTFail("Concurrent role writes must not race cookies") } catch { XCTAssertEqual((error as NSError).code, 409) }
        await f.http.release(); _ = try await first.value
        let commands = await f.http.commands; XCTAssertEqual(commands, 1)
        await f.transport.reset()
        let dropped = try await fixture(dropCookieWrites: true); defer { try? FileManager.default.removeItem(at: dropped.directory) }
        let generation = dropped.transport.generation
        do { _ = try await dropped.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope); XCTFail("Unverified response cookies cannot acknowledge success") } catch { XCTAssertEqual((error as NSError).code, 409) }
        XCTAssertNotEqual(dropped.transport.generation, generation)
        await dropped.transport.reset()
    }

    func testTwentyOwnerStaffRoundTripsKeepFreshScopesAndOneWritePerSelection() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        var scope = WorkspaceSwitchHTTP.staffScope, path = "/staff/my-work"
        for _ in 0..<20 {
            for target in ["owner", "staff"] {
                let result = try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": target], requestID: UUID().uuidString, path: path, requestedScope: scope)
                path = (result["data"] as! [String: Any])["path"] as! String
                let selected = try await f.transport.freshContext(path: path)
                scope = (selected["context"] as! [String: Any])["scope"] as! String
                XCTAssertEqual(scope, target == "owner" ? WorkspaceSwitchHTTP.ownerScope : WorkspaceSwitchHTTP.staffScope)
            }
        }
        let commands = await f.http.commands, paths = await f.http.contextPaths
        XCTAssertEqual(commands, 40); XCTAssertEqual(paths.filter { $0 == "/" }.count, 40)
        await f.transport.reset()
    }

    func testOrdinaryCommandStillRequiresItsCurrentStaffContextAndUnavailableRootCannotSwitch() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        await f.http.configure(staffUnavailable: true)
        do { _ = try await f.transport.command(name: "shell.logout", args: [:], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope); XCTFail("The root shortcut is exclusive to workspace selection") } catch {}
        let paths = await f.http.contextPaths, before = await f.http.commands
        XCTAssertEqual(paths, ["/staff/my-work"]); XCTAssertEqual(before, 0)
        await f.http.configure(rootStatus: 503)
        do { _ = try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope); XCTFail("A root session outage cannot authorize a switch") } catch { XCTAssertEqual((error as NSError).code, 503) }
        let after = await f.http.commands; XCTAssertEqual(after, 0)
        await f.transport.reset()
    }

    func testTargetDenialCannotSelectOwnerAndRecoveryNeverReplaysTheWrite() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.directory) }
        await f.http.configure(denyTarget: true)
        do { _ = try await f.transport.command(name: "shell.switch-workspace", args: ["workspaceId": "owner"], requestID: UUID().uuidString, path: "/staff/my-work", requestedScope: WorkspaceSwitchHTTP.staffScope); XCTFail("A target denial must remain authoritative") } catch { XCTAssertEqual((error as NSError).code, 403) }
        let neutral = try await f.transport.freshContext(path: "/")
        XCTAssertEqual(neutral["home"] as? String, "/staff/my-work")
        let commands = await f.http.commands; XCTAssertEqual(commands, 1)
        await f.transport.reset()
    }
}
