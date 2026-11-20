import XCTest
import WebKit
import Security
@testable import Reylumi

final class OfflineRouteTests: XCTestCase {
    func testHostAppCanUseItsOwnDeviceProtectedKeychain() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: "com.reylumi.tests.keychain-preflight.\(UUID().uuidString)",
                                   kSecAttrAccount as String: "fixture"]
        var insert = query
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        insert[kSecValueData as String] = Data("fixture-only".utf8)
        defer { SecItemDelete(query as CFDictionary) }
        let status = SecItemAdd(insert as CFDictionary, nil)
        XCTAssertEqual(status, errSecSuccess, "Device-protected Keychain unavailable. OSStatus \(status): \(SecCopyErrorMessageString(status, nil) as String? ?? "unknown status"). Check the actual host app signature/entitlements; never substitute unprotected storage.")
    }

    func testOnlyExactPublicAndPreparedRoleRoutesCanBeRestored() {
        let now = Date()
        for path in ReylumiOfflineRoute.protectedPaths.union(ReylumiOfflineRoute.publicPaths) {
            XCTAssertNotNil(ReylumiOfflineRoute(path: path, expiresAt: now.addingTimeInterval(60), now: now), path)
        }
        for path in ["/admin", "/settings", "/login", "/api/experience/context", "/pos?ticketId=private",
                     "/pos/ticket/123", "/staff/invite/secret", "/market?payment=received", "/market#secret",
                     "https://reylumi.com/pos", "/POS", "/pos/", "/more/unknown"] {
            XCTAssertNil(ReylumiOfflineRoute(path: path, expiresAt: now.addingTimeInterval(60), now: now), path)
        }
    }

    func testLeaseIsCappedAndExpiryCannotBeExtendedByRestore() throws {
        let now = Date()
        XCTAssertNil(ReylumiOfflineRoute(path: "/pos", expiresAt: now, now: now))
        let route = try XCTUnwrap(ReylumiOfflineRoute(path: "/staff/my-work", expiresAt: now.addingTimeInterval(7 * 86400), now: now))
        XCTAssertEqual(route.expiresAt.timeIntervalSince(now), 86400, accuracy: 0.001)
        XCTAssertTrue(route.isValid(at: now.addingTimeInterval(86399)))
        XCTAssertFalse(route.isValid(at: now.addingTimeInterval(86400)))
        XCTAssertFalse(route.isValid(at: now.addingTimeInterval(-61)))
        XCTAssertNotNil(ReylumiOfflineRoute.expiry(from: "2026-10-16T12:34:56.789Z"))
        XCTAssertNotNil(ReylumiOfflineRoute.expiry(from: "2026-10-16T12:34:56Z"))
        XCTAssertNil(ReylumiOfflineRoute.expiry(from: "not-a-date"))
    }

    func testProtectedKeychainHintIsOriginBoundAndClearedOnExpiryOrReset() throws {
        let service = "com.reylumi.tests.offline-route.\(UUID().uuidString)"
        let first = ReylumiOfflineRouteStore(origin: URL(string: "https://reylumi.com")!, service: service)
        let other = ReylumiOfflineRouteStore(origin: URL(string: "https://other.invalid")!, service: service)
        defer { first.clear(); other.clear() }
        let now = Date()
        let route = try XCTUnwrap(ReylumiOfflineRoute(path: "/my-bookings", expiresAt: now.addingTimeInterval(60), now: now))
        first.save(route)
        XCTAssertEqual(first.restored(), route)
        XCTAssertNil(other.restored())
        XCTAssertNil(first.restored(at: now.addingTimeInterval(61)))
        XCTAssertNil(first.restored(at: now))
        first.save(route)
        first.clear()
        XCTAssertNil(first.restored())
    }

    @MainActor
    func testColdStartupQueuesHomeAndExplicitAuthReturnStillTakesPrecedence() throws {
        let store = ReylumiOfflineRouteStore(origin: URL(string: "https://reylumi.com")!, service: "com.reylumi.tests.queued.\(UUID().uuidString)")
        defer { store.clear() }
        store.save(try XCTUnwrap(ReylumiOfflineRoute(path: "/pos/portable", expiresAt: Date().addingTimeInterval(60))))
        let controller = ReylumiViewController(offlineRoutes: store)
        controller.loadViewIfNeeded()
        XCTAssertEqual(controller.queuedStartupURL?.absoluteString, "https://reylumi.com")
        XCTAssertFalse(controller.view.subviews.contains { $0 is WKWebView })
        store.clear()
        let reset = ReylumiViewController(offlineRoutes: store)
        reset.loadViewIfNeeded()
        XCTAssertEqual(reset.queuedStartupURL?.absoluteString, "https://reylumi.com")
        let next = URL(string: "https://reylumi.com/login?next=%2Fbook%2Ffixture")!
        let login = ReylumiViewController(offlineRoutes: store, initialURL: next)
        login.loadViewIfNeeded()
        XCTAssertEqual(login.queuedStartupURL, next)
    }
}
