import XCTest
import Foundation
@testable import Reylumi

/// Actual context/offline-context handler output is the starting envelope.
/// Only time/generation and explicit failure conditions are varied locally.
private actor LifecycleHTTP: ReylumiLocalHTTPClient {
    private let template: [String: Any]
    private var partialStatus: Int?
    private var unconfirmed = false
    private var networkDown = false
    private var value = "original"
    private var contextStatus = 200
    private(set) var commands = 0
    private(set) var contexts = 0
    private(set) var readRequests = 0
    private(set) var outgoingCookieHeaders: [String] = []
    private var holdNextContext = false
    private var holdNextCommand = false
    private var held: [String: (URL, [String: Any]?, CheckedContinuation<(Data, HTTPURLResponse), Error>)] = [:]
    init(_ template: [String: Any]) { self.template = template }
    func configurePartial(_ status: Int? = 503, unconfirmed: Bool = false) { partialStatus = status; self.unconfirmed = unconfirmed }
    func configureNetworkDown() { networkDown = true }
    func configureValue(_ value: String) { self.value = value }
    func configureContextStatus(_ status: Int) { contextStatus = status }
    func configureHoldNextContext() { holdNextContext = true }
    func configureHoldNextCommand() { holdNextCommand = true }
    func heldCount() -> Int { held.count }
    var scope: String { (template["context"] as! [String: Any])["scope"] as! String }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        outgoingCookieHeaders.append(request.value(forHTTPHeaderField: "Cookie") ?? "")
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if url.path == "/api/app-local/context" {
            contexts += 1
            if networkDown { throw URLError(.notConnectedToInternet) }
            var envelope = template
            let now = Date().timeIntervalSince1970 * 1000
            var grant = envelope["grant"] as! [String: Any]
            grant["generation"] = query.first { $0.name == "generation" }?.value
            grant["issuedAt"] = now; grant["expiresAt"] = now + 86_400_000
            envelope["grant"] = grant; envelope["onlineValidatedAt"] = now
            if let partialStatus {
                envelope["grant"] = NSNull(); envelope["grantStatus"] = partialStatus
                if unconfirmed { envelope["offlineState"] = "unconfirmed" }
            }
            if holdNextContext {
                holdNextContext = false
                return try await withCheckedThrowingContinuation { held["context"] = (url, envelope, $0) }
            }
            return try response(url, object: envelope, status: contextStatus)
        }
        if url.path == "/api/app-local/command" {
            commands += 1
            if holdNextCommand {
                holdNextCommand = false
                return try await withCheckedThrowingContinuation { held["command"] = (url, ["ok": true, "data": ["saved": true]], $0) }
            }
            return try response(url, object: ["ok": true, "data": ["saved": true]])
        }
        guard url.path == "/api/app-local/read" else { throw URLError(.unsupportedURL) }
        readRequests += 1
        if networkDown { throw URLError(.notConnectedToInternet) }
        let raw = query.first { $0.name == "args" }?.value ?? "{}"
        let args = (try JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: String] ?? [:]
        let tag = args["date"] ?? ""
        if tag == "first" || tag == "second" {
            return try await withCheckedThrowingContinuation { held[tag] = (url, nil, $0) }
        }
        return try payload(url)
    }
    func release(_ tag: String, cookies: [String] = [], status: Int = 200) throws {
        let (url, object, continuation) = try XCTUnwrap(held.removeValue(forKey: tag))
        let result: (Data, HTTPURLResponse)
        if let object { result = try response(url, object: object, cookies: cookies, status: status) }
        else { result = try payload(url, cookies: cookies, status: status) }
        continuation.resume(returning: result)
    }
    private func payload(_ url: URL, cookies: [String] = [], status: Int = 200) throws -> (Data, HTTPURLResponse) {
        try response(url, object: ["schemaVersion": 1, "status": 200, "scope": scope, "etag": "lifecycle", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["value": value]], cookies: cookies, status: status)
    }
    private func response(_ url: URL, object: [String: Any], cookies: [String] = [], status: Int = 200) throws -> (Data, HTTPURLResponse) {
        var fields = ["Content-Type": "application/json"]
        if !cookies.isEmpty { fields["Set-Cookie"] = cookies.joined(separator: ", ") }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!)
    }
}

private actor LifecycleCookieJar {
    private(set) var values: [HTTPCookie]
    init(_ values: [HTTPCookie]) { self.values = values }
    func put(_ cookie: HTTPCookie) {
        values.removeAll { $0.name == cookie.name && $0.path == cookie.path && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() }
        if (cookie.expiresDate ?? .distantFuture) > Date(), String(describing: cookie.properties?[.maximumAge] ?? "") != "0" { values.append(cookie) }
    }
    func clear() { values = [] }
}

final class AuthLifecycleTransportTests: XCTestCase {
    private let origin = URL(string: "https://reylumi.com")!
    private func template() throws -> [String: Any] {
        let file = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "AuthLifecycleContextFixture", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    }
    private func protocolFixture() throws -> [String: Any] {
        let file = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "AuthCookieProtocolFixture", withExtension: "json"))
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertEqual(value["synthetic"] as? Bool, true)
        XCTAssertEqual(value["sameViewerAndWorkspace"] as? Bool, true)
        return value
    }
    private func cookies(_ headers: [String]) -> [HTTPCookie] {
        headers.flatMap { HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": $0], for: origin) }
    }
    @MainActor
    private func waitForTwo(_ http: LifecycleHTTP) async throws {
        for _ in 0..<150 { if await http.heldCount() == 2 { return }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTFail("Both original-cookie requests must be held before response ordering")
        throw URLError(.timedOut)
    }
    @MainActor
    private func heldRead(_ transport: ReylumiLocalAppTransport, scope: String, tag: String) -> Task<Result<[String: Any], Error>, Never> {
        Task { @MainActor in
            do { return .success(try await transport.read(name: "fixture.roster", args: ["date": tag], etag: nil, requestedScope: scope)) }
            catch { return .failure(error) }
        }
    }
    @MainActor
    func testActualSerializedCookieRefreshCancelsOnlyStaleDeliveryAndRetainsNewState() async throws {
        let protocolValue = try protocolFixture()
        let original = cookies(try XCTUnwrap(protocolValue["originalSetCookie"] as? [String]))
        let aHeaders = try XCTUnwrap(protocolValue["refreshASetCookie"] as? [String])
        XCTAssertEqual(original.count, 7)
        XCTAssertEqual(cookies(aHeaders).count, 4)
        let joinedResponseCookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": aHeaders.joined(separator: ", ")], for: origin)
        XCTAssertEqual(ReylumiCookieAuthority.identity(joinedResponseCookies, origin: origin), ReylumiCookieAuthority.identity(cookies(aHeaders), origin: origin), "Foundation must preserve every actual serialized Set-Cookie entry")
        for variant in ["lateBSetCookie", "distinctRefreshBSetCookie", "refreshASetCookie"] {
            let (bundle, directory) = try AppLocalTestFixture.bundle()
            defer { try? FileManager.default.removeItem(at: directory) }
            let http = LifecycleHTTP(try template()), jar = LifecycleCookieJar(original)
            let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString)
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
            _ = try await transport.freshContext(path: "/staff/today")
            let scope = await http.scope, generation = transport.generation
            _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope)
            var resets = 0
            transport.onEvent = { name, _ in if name == "reylumi:app-local-reset" { resets += 1 } }
            let first = heldRead(transport, scope: scope, tag: "first"), second = heldRead(transport, scope: scope, tag: "second")
            try await waitForTwo(http)
            let outgoing = await http.outgoingCookieHeaders
            let originalHeader = try XCTUnwrap(protocolValue["originalCookieHeader"] as? String)
            let expectedPairs = originalHeader.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.sorted()
            for header in outgoing.suffix(2) { XCTAssertEqual(header.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.sorted(), expectedPairs, "The native requests must use the producer's original serialized cookies") }
            try await http.release("first", cookies: aHeaders)
            if case .failure(let error) = await first.value { XCTFail("First refresh failed: \(error)") }
            let committed = await jar.values
            try await http.release("second", cookies: try XCTUnwrap(protocolValue[variant] as? [String]))
            switch await second.value {
            case .success: XCTAssertEqual(variant, "refreshASetCookie", "Only byte-identical refresh may deliver this second reply")
            case .failure(let error): XCTAssertNotEqual(variant, "refreshASetCookie"); XCTAssertTrue(error is CancellationError, "Stale delivery must not revoke current authority")
            }
            let final = await jar.values
            XCTAssertEqual(ReylumiCookieAuthority.identity(final, origin: origin), ReylumiCookieAuthority.identity(committed, origin: origin))
            XCTAssertEqual(transport.generation, generation); XCTAssertEqual(resets, 0)
            let retained = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: scope)
            XCTAssertNotNil(retained)
            _ = try await transport.freshContext(path: "/staff/today")
            let commandsBefore = await http.commands
            _ = try await transport.command(name: "fixture.save", args: ["id": "single-send"], requestID: UUID().uuidString, path: "/staff/today", requestedScope: scope)
            let commandsAfter = await http.commands, reads = await http.readRequests
            XCTAssertEqual(commandsAfter - commandsBefore, 1); XCTAssertEqual(reads, 3, "Transport must not replay a request")
            await transport.reset()
        }
    }
    @MainActor
    func testExplicitHTTPDenialsRemainDenialsAfterAnotherResponseRefreshesCookies() async throws {
        let protocolValue = try protocolFixture(), aHeaders = try XCTUnwrap(protocolValue["refreshASetCookie"] as? [String])
        for status in [401, 403, 409] {
            let (bundle, directory) = try AppLocalTestFixture.bundle()
            defer { try? FileManager.default.removeItem(at: directory) }
            let http = LifecycleHTTP(try template()), jar = LifecycleCookieJar(cookies(try XCTUnwrap(protocolValue["originalSetCookie"] as? [String])))
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString), client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
            _ = try await transport.freshContext(path: "/staff/today")
            let scope = await http.scope
            let first = heldRead(transport, scope: scope, tag: "first"), second = heldRead(transport, scope: scope, tag: "second")
            try await waitForTwo(http)
            try await http.release("first", cookies: aHeaders); _ = await first.value
            try await http.release("second", status: status)
            switch await second.value {
            case .success: XCTFail("A real denied response may not be hidden by refresh recovery")
            case .failure(let error): XCTAssertFalse(error is CancellationError); XCTAssertEqual((error as NSError).code, status)
            }
            let denied = try await transport.cached(name: "fixture.roster", args: ["date": "second"], requestedScope: scope)
            XCTAssertNil(denied)
            let commands = await http.commands; XCTAssertEqual(commands, 0)
            await transport.reset()
        }
    }
    @MainActor
    func testPossiblyCommittedCommandWithStaleCookieReplyIsNeverAutomaticallyReplayed() async throws {
        let protocolValue = try protocolFixture()
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let http = LifecycleHTTP(try template()), jar = LifecycleCookieJar(cookies(try XCTUnwrap(protocolValue["originalSetCookie"] as? [String])))
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString), client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
        _ = try await transport.freshContext(path: "/staff/today")
        let scope = await http.scope, generation = transport.generation
        await http.configureHoldNextCommand()
        let command = Task { @MainActor () -> Result<[String: Any], Error> in
            do { return .success(try await transport.command(name: "fixture.save", args: ["id": "possibly-committed"], requestID: UUID().uuidString, path: "/staff/today", requestedScope: scope)) } catch { return .failure(error) }
        }
        for _ in 0..<150 { if await http.heldCount() == 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let first = heldRead(transport, scope: scope, tag: "first")
        try await waitForTwo(http)
        try await http.release("first", cookies: try XCTUnwrap(protocolValue["refreshASetCookie"] as? [String])); _ = await first.value
        try await http.release("command")
        switch await command.value {
        case .success: XCTFail("The stale command delivery cannot overwrite newer cookie authority")
        case .failure(let error): XCTAssertTrue(error is CancellationError)
        }
        let commands = await http.commands, reads = await http.readRequests
        XCTAssertEqual(commands, 1, "The POST may already have committed; transport must never replay it")
        XCTAssertEqual(reads, 1); XCTAssertEqual(transport.generation, generation)
        await transport.reset()
    }
    @MainActor
    func testHTTP200ContextDenialSurvivesInternalCookieRefreshAndRevokesStoredDisplay() async throws {
        let protocolValue = try protocolFixture()
        for status in [401, 403, 409, 503] {
            let (bundle, directory) = try AppLocalTestFixture.bundle()
            defer { try? FileManager.default.removeItem(at: directory) }
            let http = LifecycleHTTP(try template()), jar = LifecycleCookieJar(cookies(try XCTUnwrap(protocolValue["originalSetCookie"] as? [String])))
            let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString)
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
            _ = try await transport.freshContext(path: "/staff/today")
            let scope = await http.scope
            _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope)
            await http.configurePartial(status, unconfirmed: status == 503)
            await http.configureHoldNextContext()
            let context = Task { @MainActor () -> Result<[String: Any], Error> in
                do { return .success(try await transport.freshContext(path: "/staff/today")) } catch { return .failure(error) }
            }
            for _ in 0..<150 { if await http.heldCount() == 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
            let first = heldRead(transport, scope: scope, tag: "first")
            try await waitForTwo(http)
            try await http.release("first", cookies: try XCTUnwrap(protocolValue["refreshASetCookie"] as? [String])); _ = await first.value
            let committed = await jar.values
            try await http.release("context")
            switch await context.value {
            case .success(let denied):
                XCTAssertEqual(denied["grantStatus"] as? Int, status, "The exact HTTP200 denial must reach JS")
                XCTAssertEqual(denied["offlineState"] as? String == "unconfirmed", status == 503)
            case .failure(let error): XCTFail("A real context denial may not disappear as a stale-cookie cancellation: \(error)")
            }
            let finalCookies = await jar.values
            XCTAssertEqual(ReylumiCookieAuthority.identity(finalCookies, origin: origin), ReylumiCookieAuthority.identity(committed, origin: origin))
            let lease = await store.session(generation: transport.generation, scope: scope)
            let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: scope)
            XCTAssertNil(lease); XCTAssertNil(cached)
            await http.configureNetworkDown()
            do { _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope); XCTFail("A late genuine denial must prevent offline restoration") }
            catch { XCTAssertTrue(error is URLError) }
            let commands = await http.commands; XCTAssertEqual(commands, 0)
            await transport.reset()
        }
    }
    @MainActor
    func testExternalWorkspaceChangeAfterInternalWorkspaceCommitStillRevokesAuthority() async throws {
        let protocolValue = try protocolFixture()
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let http = LifecycleHTTP(try template()), jar = LifecycleCookieJar(cookies(try XCTUnwrap(protocolValue["originalSetCookie"] as? [String])))
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString), client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
        _ = try await transport.freshContext(path: "/staff/today")
        let scope = await http.scope, generation = transport.generation
        let first = heldRead(transport, scope: scope, tag: "first"), second = heldRead(transport, scope: scope, tag: "second")
        try await waitForTwo(http)
        try await http.release("first", cookies: ["kingpos-selected-workspace=manage:internal-owner; Path=/; Secure"])
        if case .failure(let error) = await first.value { XCTFail("The internal workspace commit must finish: \(error)") }
        for cookie in cookies(["kingpos-selected-workspace=manage:external-workspace; Path=/; Secure"]) { await jar.put(cookie) }
        try await http.release("second")
        switch await second.value {
        case .success: XCTFail("An external workspace cannot borrow an earlier internal workspace revision")
        case .failure(let error): XCTAssertEqual((error as NSError).code, 409); XCTAssertFalse(error is CancellationError)
        }
        XCTAssertNotEqual(transport.generation, generation)
        let cached = try await transport.cached(name: "fixture.roster", args: ["date": "first"], requestedScope: scope)
        XCTAssertNil(cached)
        await transport.reset()
    }
    @MainActor
    func testHTTP401AndSignOutPreserveTypedResetWireContract() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let http = LifecycleHTTP(try template())
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString), client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] })
        var resets: [[String: Any]] = []
        transport.onEvent = { name, detail in if name == "reylumi:app-local-reset" { resets.append(detail) } }
        await http.configureContextStatus(401)
        do { _ = try await transport.freshContext(path: "/staff/today"); XCTFail("HTTP401 must reject the context") }
        catch { XCTAssertEqual((error as NSError).code, 401) }
        XCTAssertEqual(resets.last?["reason"] as? String, "unauthenticated")
        XCTAssertEqual(resets.last?["status"] as? Int, 401)
        await transport.reset(reason: .signOut)
        XCTAssertEqual(resets.last?["reason"] as? String, "logout")
        XCTAssertNil(resets.last?["status"])
    }
    @MainActor
    func testStaleContextTaskFinishesBeforeTheNextFreshGETCanStart() async throws {
        let protocolValue = try protocolFixture()
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let http = LifecycleHTTP(try template()), jar = LifecycleCookieJar(cookies(try XCTUnwrap(protocolValue["originalSetCookie"] as? [String])))
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString), client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
        _ = try await transport.freshContext(path: "/staff/today")
        let scope = await http.scope, generation = transport.generation
        await http.configureHoldNextContext()
        let context = Task { @MainActor () -> Result<[String: Any], Error> in
            do { return .success(try await transport.freshContext(path: "/staff/today")) } catch { return .failure(error) }
        }
        for _ in 0..<150 { if await http.heldCount() == 1 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        let first = heldRead(transport, scope: scope, tag: "first")
        try await waitForTwo(http)
        try await http.release("first", cookies: try XCTUnwrap(protocolValue["refreshASetCookie"] as? [String])); _ = await first.value
        try await http.release("context")
        switch await context.value {
        case .success: XCTFail("The old context snapshot must not be delivered")
        case .failure(let error): XCTAssertTrue(error is CancellationError)
        }
        _ = try await transport.freshContext(path: "/staff/today")
        let contexts = await http.contexts, commands = await http.commands
        XCTAssertEqual(contexts, 3, "The next caller starts a new GET instead of joining a completed cancelled task")
        XCTAssertEqual(commands, 0); XCTAssertEqual(transport.generation, generation)
        await transport.reset()
    }
    @MainActor
    func testUnknownExternalChangesAfterInternalCommitStillRevokeCurrentAuthority() async throws {
        let protocolValue = try protocolFixture()
        for change in ["account", "workspace", "logout"] {
            let (bundle, directory) = try AppLocalTestFixture.bundle()
            defer { try? FileManager.default.removeItem(at: directory) }
            let http = LifecycleHTTP(try template()), jar = LifecycleCookieJar(cookies(try XCTUnwrap(protocolValue["originalSetCookie"] as? [String])))
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString), client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { await jar.values }, setCookie: { await jar.put($0) })
            _ = try await transport.freshContext(path: "/staff/today")
            let scope = await http.scope, generation = transport.generation
            let first = heldRead(transport, scope: scope, tag: "first"), second = heldRead(transport, scope: scope, tag: "second")
            try await waitForTwo(http)
            try await http.release("first", cookies: try XCTUnwrap(protocolValue["refreshASetCookie"] as? [String])); _ = await first.value
            if change == "logout" { await jar.clear() }
            else {
                let header = change == "account" ? "sb-access-token=external-other-account; Path=/; Secure" : "kingpos-selected-workspace=manage:external; Path=/; Secure"
                for cookie in cookies([header]) { await jar.put(cookie) }
            }
            try await http.release("second")
            switch await second.value {
            case .success: XCTFail("Unknown external authority is not an internal refresh transaction")
            case .failure(let error): XCTAssertEqual((error as NSError).code, 409); XCTAssertFalse(error is CancellationError)
            }
            XCTAssertNotEqual(transport.generation, generation)
            let cached = try await transport.cached(name: "fixture.roster", args: ["date": "first"], requestedScope: scope)
            XCTAssertNil(cached)
            await transport.reset()
        }
    }
    @MainActor
    func testColdOnlineContextDuringLeaseOutageReadsWithoutPersistingOrCommandAuthority() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let http = LifecycleHTTP(try template())
        await http.configurePartial()
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.online-only." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] })
        let value = try await transport.freshContext(path: "/staff/today")
        XCTAssertEqual(value["grantStatus"] as? Int, 503)
        XCTAssertEqual(value["offline"] as? Bool, false)
        let scope = await http.scope
        let read = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope)
        XCTAssertEqual(read["offline"] as? Bool, false)
        let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: scope)
        let persisted = await store.session(generation: transport.generation)
        XCTAssertNil(cached); XCTAssertNil(persisted)
        do { _ = try await transport.command(name: "fixture.save", args: ["id": "never-sent"], requestID: UUID().uuidString, path: "/staff/today", requestedScope: scope); XCTFail("Display-only context must not authorize a command") }
        catch { XCTAssertEqual((error as NSError).code, 503) }
        let commands = await http.commands; XCTAssertEqual(commands, 0)
        XCTAssertFalse(transport.backgroundDrainAllowed(scope))
        await http.configureNetworkDown()
        do { _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope); XCTFail("A display-only reply cannot create an offline fallback") }
        catch { XCTAssertTrue(error is URLError) }
        await transport.reset()
    }
    @MainActor
    func testActualNormalGuestPublicContextAndSeparatelyLabeledLeaseOutageRemainReadable() async throws {
        let resource = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "AuthLifecycleGuestContextFixture", withExtension: "json"))
        let guest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: resource)) as? [String: Any])
        XCTAssertEqual(guest["grantStatus"] as? Int, 200)
        XCTAssertEqual((guest["grant"] as? [String: Any])?["kind"] as? String, "public")
        for outage in [false, true] {
            let (_, directory) = try AppLocalTestFixture.bundle()
            defer { try? FileManager.default.removeItem(at: directory) }
            let file = directory.appendingPathComponent("manifest.json")
            var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
            var reads = manifest["reads"] as! [[String: Any]]
            for index in reads.indices where reads[index]["name"] as? String == "fixture.roster" { reads[index]["access"] = "public" }
            manifest["reads"] = reads
            try JSONSerialization.data(withJSONObject: manifest).write(to: file)
            let bundle = try ReylumiLocalBundle(directory: directory), http = LifecycleHTTP(guest)
            if outage { await http.configurePartial() }
            let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString)
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] })
            let context = try await transport.freshContext(path: "/explore")
            XCTAssertEqual((context["context"] as? [String: Any])?["authenticated"] as? Bool, false)
            XCTAssertEqual(context["grantStatus"] as? Int, outage ? 503 : 200)
            let scope = await http.scope
            let read = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope)
            XCTAssertEqual(read["offline"] as? Bool, false)
            let lease = await store.session(generation: transport.generation, scope: scope)
            let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: scope)
            if outage { XCTAssertNil(lease); XCTAssertNil(cached) }
            else { XCTAssertEqual(lease?.authority, "public"); XCTAssertNotNil(cached) }
            XCTAssertFalse(transport.backgroundDrainAllowed(scope))
            let commands = await http.commands; XCTAssertEqual(commands, 0)
            await transport.reset()
        }
    }
    @MainActor
    func testTemporaryLeaseOutagePreservesOriginalLeaseAndSnapshotWithoutExtendingThem() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let http = LifecycleHTTP(try template())
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.lease-preservation." + UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/staff/today")
        let scope = await http.scope
        _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope)
        let originalValue = await store.session(generation: transport.generation)
        let original = try XCTUnwrap(originalValue)
        let generation = transport.generation, epoch = transport.scopeEpoch
        await http.configurePartial(); await http.configureValue("online-only-new-value")
        _ = try await transport.freshContext(path: "/staff/today")
        let fresh = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope)
        XCTAssertEqual((fresh["data"] as? [String: String])?["value"], "online-only-new-value")
        let retained = await store.session(generation: transport.generation)
        let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: scope)
        XCTAssertEqual(retained?.expiresAt, original.expiresAt)
        XCTAssertEqual(retained?.grantRevision, original.grantRevision)
        XCTAssertEqual((cached?["data"] as? [String: String])?["value"], "original")
        XCTAssertEqual(transport.generation, generation); XCTAssertEqual(transport.scopeEpoch, epoch)
        XCTAssertFalse(transport.backgroundDrainAllowed(scope))
        await transport.reset()
    }
    @MainActor
    func testExplicitDeniedOrUnconfirmedLeaseNeverAcquiresAnOfflineLeaseOrCommandAuthority() async throws {
        for status in [401, 403, 409, 503] {
            let (bundle, directory) = try AppLocalTestFixture.bundle()
            defer { try? FileManager.default.removeItem(at: directory) }
            let http = LifecycleHTTP(try template())
            await http.configurePartial(status, unconfirmed: status == 503)
            let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString)
            let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] })
            let denied = try await transport.freshContext(path: "/staff/today")
            XCTAssertEqual(denied["grantStatus"] as? Int, status)
            do { _ = try await transport.command(name: "fixture.save", args: ["id": "never-sent"], requestID: UUID().uuidString, path: "/staff/today", requestedScope: await http.scope); XCTFail("A denied lease may not authorize a command") } catch {}
            let commands = await http.commands, session = await store.session(generation: transport.generation)
            XCTAssertEqual(commands, 0); XCTAssertNil(session)
            await transport.reset()
        }
    }
    @MainActor
    func testHTTP403WithdrawsAnOnlineOnlyContextBeforeAnyLaterReadCanUseItsBarrier() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let http = LifecycleHTTP(try template())
        await http.configurePartial()
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString), client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/staff/today")
        let scope = await http.scope
        await http.configureContextStatus(403)
        do { _ = try await transport.freshContext(path: "/staff/today"); XCTFail("A real HTTP403 must fail") }
        catch { XCTAssertEqual((error as NSError).code, 403) }
        do { _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope); XCTFail("A denied online context cannot remain a private-read barrier") }
        catch { XCTAssertEqual((error as NSError).code, 503) }
        let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: scope)
        XCTAssertNil(cached)
        await transport.reset()
    }
    @MainActor
    func testOwnerLeaseDenialRevokesOnlyThatScopeAndCannotRestoreItsOfflineSnapshot() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let body = try template(), http = LifecycleHTTP(body)
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/staff/today")
        let scope = await http.scope
        _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope)
        var other = body, context = body["context"] as! [String: Any], grant = body["grant"] as! [String: Any]
        let otherScope = "v3:" + String(repeating: "b", count: 64)
        context["scope"] = otherScope; context["workspaceId"] = "manage:other-authorized-workspace"
        grant["scope"] = otherScope; grant["scopes"] = [otherScope]; grant["workspaceId"] = context["workspaceId"]
        grant["generation"] = transport.generation
        let now = Date().timeIntervalSince1970 * 1000
        grant["issuedAt"] = now; grant["expiresAt"] = now + 86_400_000
        other["context"] = context; other["grant"] = grant
        let otherValue = ReylumiLocalSession.verified(other, generation: transport.generation)
        let otherLease = try XCTUnwrap(otherValue)
        await store.accept(otherLease)
        await http.configurePartial(403)
        let denied = try await transport.freshContext(path: "/staff/today")
        XCTAssertEqual(denied["grantStatus"] as? Int, 403, "JS still receives the exact explicit denial")
        let revoked = await store.session(generation: transport.generation, scope: scope)
        let unrelated = await store.session(generation: transport.generation, scope: otherScope)
        let cached = try await transport.cached(name: "fixture.roster", args: [:], requestedScope: scope)
        XCTAssertNil(revoked); XCTAssertNil(cached); XCTAssertNotNil(unrelated)
        await http.configureNetworkDown()
        do { _ = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: scope); XCTFail("Network failure cannot revive the explicitly denied Owner snapshot") }
        catch { XCTAssertTrue(error is URLError) }
        await transport.reset()
    }
    @MainActor
    func testWorkspaceSwitchCannotUseDisplayOnly503AsItsCommandGrant() async throws {
        let (_, directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        var commands = manifest["commands"] as! [[String: Any]]
        commands.append(["name": "shell.switch-workspace", "path": "/api/app-local/command", "argumentKeys": ["workspaceId"]])
        manifest["commands"] = commands
        try JSONSerialization.data(withJSONObject: manifest).write(to: file)
        let bundle = try ReylumiLocalBundle(directory: directory), http = LifecycleHTTP(try template())
        await http.configurePartial()
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: ReylumiLocalReadStore(origin: origin, directory: directory, service: UUID().uuidString), client: http, defaults: UserDefaults(suiteName: UUID().uuidString)!, cookies: { [] })
        _ = try await transport.freshContext(path: "/staff/today")
        let scope = await http.scope
        do { _ = try await transport.command(name: "shell.switch-workspace", args: ["workspaceId": "another-owned-workspace"], requestID: UUID().uuidString, path: "/staff/today", requestedScope: scope); XCTFail("Workspace writes also need a fresh valid grant") }
        catch { XCTAssertEqual((error as NSError).code, 503) }
        let sent = await http.commands; XCTAssertEqual(sent, 0)
        await transport.reset()
    }
}
