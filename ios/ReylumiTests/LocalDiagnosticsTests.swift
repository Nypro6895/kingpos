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
}
