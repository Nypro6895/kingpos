import XCTest
@testable import Reylumi

final class LocalDiagnosticsTests: XCTestCase {
    @MainActor
    func testDisabledByDefaultAndBoundedWhenExplicitlyEnabled() throws {
        let disabled = ReylumiLocalDiagnostics()
        disabled.record(.httpStart, category: .context)
        XCTAssertTrue(disabled.snapshot().isEmpty)
        var clock: TimeInterval = 1
        let trace = ReylumiLocalDiagnostics(enabled: true, capacity: 4, now: { clock })
        for _ in 0..<10 { clock += 0.1; trace.record(.httpEnd, category: .read, status: 200, durationMs: 12) }
        let rows = trace.snapshot()
        XCTAssertEqual(rows.count, 4); XCTAssertEqual(rows.first?.sequence, 7); XCTAssertEqual(rows.last?.sequence, 10)
        XCTAssertEqual(rows.last?.elapsedMs ?? 0, 1000, accuracy: 0.01)
    }
    @MainActor
    func testOnlyFixedServerTimingLabelsAndFiniteNumbersAreRetained() throws {
        let trace = ReylumiLocalDiagnostics(enabled: true)
        trace.serverTiming("auth;dur=12.5, secret-user-id;dur=999, load;dur=NaN, total;dur=Infinity, today_shell;dur=3.2, lease;dur=-1", category: .context)
        let rows = trace.snapshot()
        XCTAssertEqual(rows.count, 2); XCTAssertEqual(rows.map(\.stage), [.auth, .todayShell])
        XCTAssertEqual(rows.first?.durationMs, 12.5)
        trace.record(.httpFailure, status: 123456789, durationMs: .infinity)
        XCTAssertNil(trace.snapshot().last?.status); XCTAssertNil(trace.snapshot().last?.durationMs)
        let encoded = String(decoding: try JSONEncoder().encode(trace.snapshot()), as: UTF8.self)
        XCTAssertFalse(encoded.contains("secret-user-id")); XCTAssertFalse(encoded.contains("NaN"))
    }
    @MainActor
    func testArbitraryRouteAndResourceInputsBecomeFixedCategoriesOnly() throws {
        let trace = ReylumiLocalDiagnostics(enabled: true)
        trace.record(.contextRequest, category: ReylumiLocalDiagnostics.category(path: "/private-person-id?token=private-token"))
        trace.record(.readCacheMiss, category: ReylumiLocalDiagnostics.category(resource: "private-person-id"))
        let encoded = String(decoding: try JSONEncoder().encode(trace.snapshot()), as: UTF8.self)
        XCTAssertFalse(encoded.contains("private-person")); XCTAssertFalse(encoded.contains("private-token"))
        XCTAssertEqual(trace.snapshot().map(\.category), [.other, .other])
    }
    @MainActor
    func testUserExportRevalidatesJavaScriptAndOmitsIdentifiersAndPayloads() throws {
        let trace = ReylumiLocalDiagnostics(enabled: true)
        trace.record(.cookieStale, category: .context, outcome: .cancelled, reason: .staleCookies, operation: 4)
        let secret = "private-cookie-person-account-token"
        let rows: [[String: Any]] = [
            ["event": "context.reject", "contextReason": "workspace-changed", "source": "app-local", "status": 409, "atMs": 12.5, "blocked": true, "cookie": secret, "scope": secret, "url": secret, "payload": ["name": secret]],
            ["event": "cache.reset", "reason": secret, "contextReason": secret, "status": "private-status", "atMs": Double.infinity, "blocked": 123],
            ["event": secret, "status": 200]
        ]
        let data = try trace.report(javascript: rows, appVersion: "1.0.0", appBuild: "40", bundleBuild: String(repeating: "a", count: 64))
        let encoded = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(encoded.contains(secret)); XCTAssertFalse(encoded.contains("cookie\":")); XCTAssertFalse(encoded.contains("Infinity"))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let js = try XCTUnwrap(report["javascript"] as? [[String: Any]])
        XCTAssertEqual(js.count, 2); XCTAssertEqual(js.first?["contextReason"] as? String, "workspace-changed")
        XCTAssertEqual(js.first?["blocked"] as? Bool, true); XCTAssertNil(js.last?["blocked"])
        XCTAssertEqual((report["native"] as? [[String: Any]])?.first?["reason"] as? String, "staleCookies")
    }
    @MainActor
    func testUserExportIsBoundedAndDoesNotAcceptMetadataFromPage() throws {
        let trace = ReylumiLocalDiagnostics(enabled: true)
        let rows = Array(repeating: ["event": "cache.hit"], count: 257)
        let data = try trace.report(javascript: rows, appVersion: "private-person", appBuild: "private-token", bundleBuild: "private-payload")
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual((report["javascript"] as? [[String: Any]])?.count, 0)
        XCTAssertEqual(report["appVersion"] as? String, "unknown"); XCTAssertEqual(report["appBuild"] as? String, "unknown")
        XCTAssertEqual(report["bundleBuild"] as? String, "unknown")
    }

    @MainActor
    func testCommandTraceRequiresManifestRuleAndStrictRandomRequestID() throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let rule = try XCTUnwrap(bundle.manifest.commands.first { $0.name == "fixture.save" })
        let id = UUID().uuidString
        let request = try XCTUnwrap(ReylumiLocalDiagnostics.RequestTrace(command: rule, manifest: bundle.manifest, requestID: id))
        XCTAssertEqual(request.requestId, id); XCTAssertEqual(request.commandName, "fixture.save")
        for malformed in ["private-token", id + "\r\nCookie: private-secret", " " + id, "{" + id + "}"] {
            XCTAssertNil(ReylumiLocalDiagnostics.RequestTrace(command: rule, manifest: bundle.manifest, requestID: malformed))
        }
        let arbitrary = ReylumiLocalBundle.Command(name: "private-person-secret", path: "/api/app-local/command", argumentKeys: [])
        XCTAssertNil(ReylumiLocalDiagnostics.RequestTrace(command: arbitrary, manifest: bundle.manifest, requestID: id))
        let wrongEndpoint = ReylumiLocalBundle.Command(name: rule.name, path: "/private-secret", argumentKeys: rule.argumentKeys)
        XCTAssertNil(ReylumiLocalDiagnostics.RequestTrace(command: wrongEndpoint, manifest: bundle.manifest, requestID: id))
        let url = URL(string: "https://reylumi.com/api/app-local/command")!
        XCTAssertTrue(request.acceptsResponse(HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: ["X-Reylumi-Request-Id": id.lowercased()])!))
        for value in [UUID().uuidString, "private-token", id + "," + id] {
            XCTAssertFalse(request.acceptsResponse(HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: ["X-Reylumi-Request-Id": value])!))
        }
    }

    @MainActor
    func testNativeCommandMetadataCannotBeInjectedThroughJavaScriptExport() throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let rule = try XCTUnwrap(bundle.manifest.commands.first)
        let request = try XCTUnwrap(ReylumiLocalDiagnostics.RequestTrace(command: rule, manifest: bundle.manifest, requestID: UUID().uuidString))
        let trace = ReylumiLocalDiagnostics(enabled: true)
        trace.record(.httpEnd, category: .command, status: 503, trace: request, failureCode: .handlerTimeout)
        trace.record(.scopeReset, trace: request, failureCode: .handlerException)
        trace.serverTiming("proxy_refresh;dur=1, workspace;dur=2, handler;dur=3, backend_auth;dur=4, backend_rest;dur=5, backend_rpc;dur=6, private-secret;dur=7, total;dur=8", category: .command, trace: request)
        let injectedID = UUID().uuidString
        let js = [["event": "auth.end", "requestId": injectedID, "commandName": rule.name, "failureCode": "handler_timeout", "nativeTimeOriginUTC": "private-secret"]]
        let data = try trace.report(javascript: js, appVersion: "1.0.0", appBuild: "40", bundleBuild: String(repeating: "a", count: 64))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let native = try XCTUnwrap(report["native"] as? [[String: Any]])
        XCTAssertEqual(native.first?["requestId"] as? String, request.requestId)
        XCTAssertEqual(native.first?["commandName"] as? String, rule.name)
        XCTAssertEqual(native.first?["failureCode"] as? String, "handler_timeout")
        XCTAssertNil(native[1]["requestId"]); XCTAssertNil(native[1]["commandName"]); XCTAssertNil(native[1]["failureCode"])
        XCTAssertEqual(trace.snapshot().filter { $0.event == .serverTiming }.count, 7)
        XCTAssertTrue(trace.snapshot().filter { $0.event == .serverTiming }.allSatisfy { $0.requestId == request.requestId })
        let rows = try XCTUnwrap(report["javascript"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 1); XCTAssertEqual(Set(rows[0].keys), ["event"])
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("private-secret"))
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains(injectedID))
    }

    @MainActor
    func testUTCAnchorAndBothReportRingsRemainBoundedWithValidatedNumbers() throws {
        var monotonic: TimeInterval = 10
        var wall = Date(timeIntervalSince1970: 1_792_425_600)
        let trace = ReylumiLocalDiagnostics(enabled: true, capacity: 900, now: { monotonic }, wallNow: { wall })
        for _ in 0..<600 { monotonic += 0.01; trace.record(.httpEnd, category: .command, status: 503) }
        wall = wall.addingTimeInterval(6)
        let data = try trace.report(javascript: Array(repeating: ["event": "auth.end"], count: 256), appVersion: "1.0.0", appBuild: "40", bundleBuild: String(repeating: "a", count: 64))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual((report["native"] as? [[String: Any]])?.count, 512)
        XCTAssertEqual((report["javascript"] as? [[String: Any]])?.count, 256)
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let began = try XCTUnwrap((report["nativeTimeOriginUTC"] as? String).flatMap(formatter.date(from:)))
        let exported = try XCTUnwrap((report["exportedAtUTC"] as? String).flatMap(formatter.date(from:)))
        XCTAssertEqual(exported.timeIntervalSince(began), 6, accuracy: 0.001)
        XCTAssertEqual(trace.snapshot().last?.elapsedMs ?? 0, 6000, accuracy: 0.001)
        monotonic = .infinity; trace.record(.httpEnd, durationMs: .nan)
        XCTAssertEqual(trace.snapshot().last?.elapsedMs, 0); XCTAssertNil(trace.snapshot().last?.durationMs)
        wall = Date(timeIntervalSince1970: .infinity)
        let invalid = try XCTUnwrap(JSONSerialization.jsonObject(with: trace.report(javascript: nil, appVersion: "1", appBuild: "1", bundleBuild: "invalid")) as? [String: Any])
        XCTAssertEqual(invalid["exportedAtUTC"] as? String, "unknown")
    }
    @MainActor
    func testReadEchoMetadataAndNestedStagesDoNotCreateAuthority() throws {
        let request = ReylumiLocalDiagnostics.RequestTrace(read: .read)
        let url = URL(string: "https://reylumi.com/api/app-local/read")!
        let match = HTTPURLResponse(url: url, statusCode: 304, httpVersion: nil, headerFields: ["X-Reylumi-Request-Id": request.requestId])!
        XCTAssertEqual(request.bridgeMetadata(response: match)["requestId"] as? String, request.requestId.lowercased())
        for headers in [[:], ["X-Reylumi-Request-Id": UUID().uuidString], ["X-Reylumi-Request-Id": "private-secret"]] {
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: headers)!
            XCTAssertNil(request.bridgeMetadata(response: response)["requestId"])
        }
        let trace = ReylumiLocalDiagnostics(enabled: true)
        trace.serverTiming("auth_user;dur=1,auth_status;dur=2,auth_session;dur=3,auth_tombstone;dur=4,staff_resolve;dur=5,staff_revalidate;dur=6,staff_identity;dur=7,staff_assigned;dur=8,clock;dur=9,backend_rest;dur=10;calls=2;bytes=123;sized=1,auth;dur=11;calls=4,backend_rpc;dur=12;calls=-1;bytes=Infinity;sized=2.5,private-secret;dur=13", category: .read, trace: request)
        let rows = trace.snapshot()
        XCTAssertEqual(rows.count, 12)
        XCTAssertEqual(rows.first { $0.stage == .backendRest }?.backendCalls, 2)
        XCTAssertEqual(rows.first { $0.stage == .backendRest }?.responseBytes, 123)
        XCTAssertEqual(rows.first { $0.stage == .backendRest }?.sizedResponses, 1)
        XCTAssertNil(rows.first { $0.stage == .auth }?.backendCalls)
        XCTAssertNil(rows.first { $0.stage == .backendRPC }?.backendCalls)
        let js: [[String: Any]] = [
            ["event": "cache.accept", "readKind": "read", "readSource": "network", "requestId": request.requestId],
            ["event": "cache.accept", "readKind": "read", "readSource": "cache", "requestId": request.requestId],
            ["event": "data.visible", "readKind": "read", "readSource": "network", "requestId": request.requestId],
            ["event": "context.accept", "readKind": "context", "readSource": "joined", "requestId": "private-secret"]
        ]
        let data = try trace.report(javascript: js, appVersion: "1", appBuild: "1", bundleBuild: String(repeating: "a", count: 64))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let safe = try XCTUnwrap(report["javascript"] as? [[String: Any]])
        XCTAssertEqual(safe[0]["requestId"] as? String, request.requestId.lowercased())
        XCTAssertNil(safe[1]["requestId"]); XCTAssertNil(safe[2]["requestId"]); XCTAssertNil(safe[3]["requestId"])
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("private-secret"))
    }

}
