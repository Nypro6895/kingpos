import XCTest
import Foundation
@testable import Reylumi

/// The native transport, context/grant checks, cookie reconciliation and
/// command decoding stay real. Only the HTTP boundary uses synthetic values.
private actor CommandTraceHTTP: ReylumiLocalHTTPClient {
    private(set) var requests: [URLRequest] = []
    private var held: [String: (URLRequest, CheckedContinuation<(Data, HTTPURLResponse), Error>)] = [:]
    private let holdCommands: Bool
    private let holdFirstContext: Bool
    private let contextEcho: Bool
    private let readEcho: Bool
    private var hasHeldContext = false
    private let contextStatus: Int
    private let timeout: Bool
    private let status: Int
    private let responseID: String?
    private let failureCode: String
    init(holdCommands: Bool = false, holdFirstContext: Bool = false, contextEcho: Bool = false, readEcho: Bool = false, contextStatus: Int = 200, timeout: Bool = false, status: Int = 503, responseID: String? = nil, failureCode: String = "handler_timeout") {
        self.holdCommands = holdCommands; self.holdFirstContext = holdFirstContext; self.contextEcho = contextEcho; self.readEcho = readEcho; self.contextStatus = contextStatus; self.timeout = timeout
        self.status = status; self.responseID = responseID; self.failureCode = failureCode
    }
    func heldCount() -> Int { held.count }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let url = try XCTUnwrap(request.url)
        if url.path == "/api/app-local/context" {
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            if holdFirstContext && !hasHeldContext {
                hasHeldContext = true
                let id = try XCTUnwrap(request.value(forHTTPHeaderField: "X-Reylumi-Request-Id"))
                return try await withCheckedThrowingContinuation { held[id] = (request, $0) }
            }
            return try response(request, object: contextStatus == 200 ? AppLocalTestFixture.context(generation: generation) : ["error": "private-context-error"], status: contextStatus, echo: contextEcho)
        }
        if url.path == "/api/app-local/read" {
            return try response(request, object: ["schemaVersion": 1, "status": 200, "scope": AppLocalTestFixture.scope, "etag": "fixture-etag", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["value": 1]], status: 200, echo: readEcho)
        }
        guard url.path == "/api/app-local/command" else { throw URLError(.unsupportedURL) }
        if timeout { throw URLError(.timedOut) }
        if holdCommands {
            let id = try XCTUnwrap(request.value(forHTTPHeaderField: "X-Reylumi-Request-Id"))
            return try await withCheckedThrowingContinuation { held[id] = (request, $0) }
        }
        return try response(request, object: status == 200 ? ["ok": true, "data": ["saved": true]] : ["error": "private-command-error-payload"], status: status)
    }
    func releaseContext() throws {
        let id = try XCTUnwrap(held.keys.first)
        let (request, continuation) = try XCTUnwrap(held.removeValue(forKey: id))
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
        continuation.resume(returning: try response(request, object: AppLocalTestFixture.context(generation: generation), status: 200))
    }
    func release(_ id: String) throws {
        let (request, continuation) = try XCTUnwrap(held.removeValue(forKey: id))
        continuation.resume(returning: try response(request, object: ["error": "private-command-error-payload"], status: status))
    }
    private func response(_ request: URLRequest, object: [String: Any], status: Int, echo: Bool = true) throws -> (Data, HTTPURLResponse) {
        var headers = ["Content-Type": "application/json", "Server-Timing": "auth;dur=1,workspace;dur=2,handler;dur=3,backend_auth;dur=4,backend_rest;dur=5,backend_rpc;dur=6,private-secret;dur=7,total;dur=8"]
        if echo {
            headers["X-Reylumi-Request-Id"] = responseID ?? request.value(forHTTPHeaderField: "X-Reylumi-Request-Id")
            headers["X-Reylumi-Failure-Code"] = failureCode
        }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!)
    }
}

@MainActor
final class CommandDiagnosticsTransportTests: XCTestCase {
    private func environment(_ http: CommandTraceHTTP) throws -> (ReylumiLocalAppTransport, ReylumiLocalDiagnostics, URL, UserDefaults) {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        let defaults = UserDefaults(suiteName: "reylumi.command-trace." + UUID().uuidString)!
        let origin = URL(string: "https://reylumi.com")!
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.command-trace." + UUID().uuidString)
        let trace = ReylumiLocalDiagnostics(enabled: true)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: defaults, cookies: { [] }, diagnostics: trace)
        return (transport, trace, directory, defaults)
    }
    private func attempt(_ transport: ReylumiLocalAppTransport, id: String) -> Task<Int, Never> {
        Task { @MainActor in
            do { _ = try await transport.command(name: "fixture.save", args: ["id": "private-record-key"], requestID: id, path: "/help", requestedScope: AppLocalTestFixture.scope); return 200 }
            catch { return (error as NSError).code }
        }
    }
    private func waitForCommands(_ http: CommandTraceHTTP, count: Int) async throws {
        for _ in 0..<200 {
            if await http.heldCount() == count { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Both real transport command requests must reach the held HTTP boundary")
        throw URLError(.timedOut)
    }

    func testOverlappingCommandsKeepTheirOwnRequestIDsWhenResponsesFinishOutOfOrder() async throws {
        let http = CommandTraceHTTP(holdCommands: true)
        let (transport, trace, directory, _) = try environment(http)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = UUID().uuidString, second = UUID().uuidString
        let a = attempt(transport, id: first)
        try await waitForCommands(http, count: 1)
        let b = attempt(transport, id: second)
        try await waitForCommands(http, count: 2)
        try await http.release(second); let bStatus = await b.value
        try await http.release(first); let aStatus = await a.value
        XCTAssertEqual(aStatus, 503); XCTAssertEqual(bStatus, 503)
        let rows = trace.snapshot()
        XCTAssertEqual(rows.filter { $0.event == .httpEnd && $0.category == .command }.map(\.requestId), [second, first])
        for id in [first, second] {
            let commandRows = rows.filter { $0.requestId == id }
            let expected: [ReylumiLocalDiagnostics.Event] = [.commandStart, .commandPreflight, .httpStart, .httpEnd, .commandFailure]
            for event in expected {
                XCTAssertEqual(commandRows.filter { $0.event == event }.count, 1)
            }
            XCTAssertTrue(commandRows.allSatisfy { $0.commandName == "fixture.save" })
            XCTAssertEqual(commandRows.first { $0.event == .httpEnd }?.failureCode, .handlerTimeout)
            XCTAssertFalse(commandRows.contains { $0.event == .httpFailure })
            XCTAssertEqual(commandRows.filter { $0.event == .serverTiming }.count, 7)
        }
        let requests = await http.requests, writes = requests.filter { $0.url?.path == "/api/app-local/command" }
        XCTAssertEqual(writes.count, 2, "Every gesture keeps exactly one write attempt")
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/app-local/context" }.count, 2, "Diagnostics must not add another preflight")
        let contextIDs = requests.filter { $0.url?.path == "/api/app-local/context" }.compactMap { $0.value(forHTTPHeaderField: "X-Reylumi-Request-Id") }
        XCTAssertEqual(contextIDs.count, 2); XCTAssertTrue(contextIDs.allSatisfy(ReylumiLocalDiagnostics.RequestTrace.validRequestID))
        XCTAssertTrue(Set(contextIDs).isDisjoint(with: [first, second]), "A preflight has its actual HTTP ID, not its parent command ID")
        for request in writes {
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            XCTAssertEqual(body["requestId"] as? String, request.value(forHTTPHeaderField: "X-Reylumi-Request-Id"))
        }
        let encoded = String(decoding: try JSONEncoder().encode(rows), as: UTF8.self)
        XCTAssertFalse(encoded.contains("private-record-key")); XCTAssertFalse(encoded.contains("private-command-error-payload")); XCTAssertFalse(encoded.contains("private-secret"))
        await transport.reset()
    }

    func testHTTP503AndURLSessionTimeoutRemainDistinctWithoutWriteRetry() async throws {
        for timeout in [false, true] {
            let http = CommandTraceHTTP(timeout: timeout)
            let (transport, trace, directory, _) = try environment(http)
            defer { try? FileManager.default.removeItem(at: directory) }
            let id = UUID().uuidString, result = await attempt(transport, id: id).value
            XCTAssertEqual(result, timeout ? NSURLErrorTimedOut : 503)
            let rows = trace.snapshot().filter { $0.requestId == id }
            if timeout {
                XCTAssertEqual(rows.first { $0.event == .httpFailure }?.status, NSURLErrorTimedOut)
                XCTAssertFalse(rows.contains { $0.event == .httpEnd }); XCTAssertTrue(rows.allSatisfy { $0.failureCode == nil })
            } else {
                XCTAssertEqual(rows.first { $0.event == .httpEnd }?.status, 503)
                XCTAssertEqual(rows.first { $0.event == .httpEnd }?.failureCode, .handlerTimeout)
                XCTAssertFalse(rows.contains { $0.event == .httpFailure })
            }
            XCTAssertEqual(rows.first { $0.event == .commandFailure }?.status, result)
            let requests = await http.requests
            let writes = requests.filter { $0.url?.path == "/api/app-local/command" }
            XCTAssertEqual(writes.count, 1)
            await transport.reset()
        }
    }

    func testUntrustedResponseMetadataCannotReplaceLocalIDOrChangeSuccessfulCommandResult() async throws {
        for responseID in [UUID().uuidString, "private-secret", UUID().uuidString + ",private-secret"] {
            let http = CommandTraceHTTP(status: 200, responseID: responseID, failureCode: "private-secret")
            let (transport, trace, directory, _) = try environment(http)
            defer { try? FileManager.default.removeItem(at: directory) }
            let id = UUID().uuidString
            let result = try await transport.command(name: "fixture.save", args: ["id": "private-record-key"], requestID: id, path: "/help", requestedScope: AppLocalTestFixture.scope)
            XCTAssertEqual((result["data"] as? [String: Any])?["saved"] as? Bool, true)
            let rows = trace.snapshot().filter { $0.requestId == id }
            XCTAssertEqual(rows.first { $0.event == .httpEnd }?.status, 200)
            XCTAssertTrue(rows.allSatisfy { $0.failureCode == nil && $0.event != .serverTiming })
            XCTAssertEqual(rows.filter { $0.event == .commandEnd }.count, 1)
            XCTAssertFalse(String(decoding: try JSONEncoder().encode(trace.snapshot()), as: UTF8.self).contains(responseID))
            await transport.reset()
        }
    }

    func testUnknownFailureCodeIsIgnoredAndMalformedCallerCannotCreateDiagnosticAuthority() async throws {
        let http = CommandTraceHTTP(failureCode: "private-cookie-secret")
        let (transport, trace, directory, _) = try environment(http)
        defer { try? FileManager.default.removeItem(at: directory) }
        let id = UUID().uuidString
        let status = await attempt(transport, id: id).value
        XCTAssertEqual(status, 503)
        XCTAssertNil(trace.snapshot().first { $0.event == .httpEnd && $0.category == .command }?.failureCode)
        for (name, requestID) in [("private-secret", UUID().uuidString), ("fixture.save", "private-secret\r\nCookie: bad")] {
            do { _ = try await transport.command(name: name, args: ["id": "private-record-key"], requestID: requestID, path: "/help"); XCTFail("Unreviewed caller must remain rejected") }
            catch { XCTAssertEqual((error as NSError).code, 400) }
        }
        let requests = await http.requests
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/app-local/command" }.count, 1)
        XCTAssertEqual(trace.snapshot().filter { $0.event == .commandStart }.count, 1)
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(trace.snapshot()), as: UTF8.self).contains("private-"))
        await transport.reset()
    }

    func testPreflight503CarriesCommandTimingWithoutSendingCommandPOST() async throws {
        let http = CommandTraceHTTP(contextStatus: 503)
        let (transport, trace, directory, _) = try environment(http)
        defer { try? FileManager.default.removeItem(at: directory) }
        let id = UUID().uuidString, status = await attempt(transport, id: id).value
        XCTAssertEqual(status, 503)
        let rows = trace.snapshot().filter { $0.requestId == id }
        XCTAssertEqual(rows.map(\.event), [.commandStart, .commandPreflight, .commandFailure])
        XCTAssertEqual(rows.first { $0.event == .commandPreflight }?.status, 503)
        XCTAssertEqual(rows.first { $0.event == .commandPreflight }?.outcome, .failed)
        XCTAssertNotNil(rows.first { $0.event == .commandPreflight }?.durationMs)
        let requests = await http.requests
        XCTAssertEqual(requests.count, 1); XCTAssertEqual(requests.first?.url?.path, "/api/app-local/context")
        XCTAssertTrue(ReylumiLocalDiagnostics.RequestTrace.validRequestID(try XCTUnwrap(requests.first?.value(forHTTPHeaderField: "X-Reylumi-Request-Id"))))
        await transport.reset()
    }
    func testJoinedContextSharesActualHTTPIDAndCachedContextCannotClaimIt() async throws {
        let http = CommandTraceHTTP(holdFirstContext: true)
        let (transport, trace, directory, _) = try environment(http)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = Task { @MainActor in try await transport.freshContext(path: "/help") }
        try await waitForCommands(http, count: 1)
        let second = Task { @MainActor in try await transport.freshContext(path: "/help") }
        for _ in 0..<200 {
            if trace.snapshot().contains(where: { $0.event == .contextJoin }) { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(trace.snapshot().contains { $0.event == .contextJoin })
        try await http.releaseContext()
        let network = try await first.value, joined = try await second.value
        let a = try XCTUnwrap(network["__reylumiReadTrace"] as? [String: Any])
        let b = try XCTUnwrap(joined["__reylumiReadTrace"] as? [String: Any])
        XCTAssertEqual(a["source"] as? String, "network"); XCTAssertEqual(b["source"] as? String, "joined")
        let id = try XCTUnwrap(a["requestId"] as? String)
        XCTAssertEqual(b["requestId"] as? String, id)
        let requests = await http.requests
        XCTAssertEqual(requests.count, 1, "Joined bridge callers do not invent another HTTP request")
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "X-Reylumi-Request-Id")?.lowercased(), id)
        XCTAssertEqual(trace.snapshot().filter { $0.event == .contextDelivered }.count, 1)
        let cached = try await transport.context(path: "/help")
        let cacheTrace = try XCTUnwrap(cached["__reylumiReadTrace"] as? [String: Any])
        XCTAssertEqual(cacheTrace["source"] as? String, "cache"); XCTAssertNil(cacheTrace["requestId"])
        await transport.reset()
    }

    func testLegacyAndMismatchedReadEchoPreserveNumericTimingWithoutCorrelationOrChangingResults() async throws {
        for echoed in [nil, UUID().uuidString, "private-secret"] as [String?] {
            let http = CommandTraceHTTP(contextEcho: echoed != nil, readEcho: echoed != nil, responseID: echoed)
            let (transport, trace, directory, _) = try environment(http)
            defer { try? FileManager.default.removeItem(at: directory) }
            let context = try await transport.freshContext(path: "/help")
            let contextMetadata = try XCTUnwrap(context["__reylumiReadTrace"] as? [String: Any])
            XCTAssertNil(contextMetadata["requestId"])
            let value = try await transport.read(name: "fixture.roster", args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope)
            let readMetadata = try XCTUnwrap(value["__reylumiReadTrace"] as? [String: Any])
            XCTAssertEqual(value["status"] as? Int, 200); XCTAssertNil(readMetadata["requestId"])
            for category in [ReylumiLocalDiagnostics.Category.context, .read] {
                let rows = trace.snapshot().filter { $0.event == .serverTiming && $0.category == category }
                XCTAssertFalse(rows.isEmpty, "Legacy numeric timing remains available")
                XCTAssertTrue(rows.allSatisfy { $0.requestId == nil && $0.readKind == nil && $0.failureCode == nil })
            }
            XCTAssertTrue(trace.snapshot().filter { $0.event == .contextDelivered || $0.event == .readDelivered }.allSatisfy { $0.requestId == nil })
            let encoded = String(decoding: try JSONEncoder().encode(trace.snapshot()), as: UTF8.self)
            XCTAssertFalse(encoded.contains("private-secret"))
            if let echoed { XCTAssertFalse(encoded.contains(echoed)) }
            await transport.reset()
        }
    }

}
