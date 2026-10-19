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
}
