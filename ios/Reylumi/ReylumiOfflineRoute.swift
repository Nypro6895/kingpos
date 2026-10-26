import Foundation
import Security

/// A startup hint is not an offline permission. The web shell verifies its
/// server-issued display lease again before showing protected snapshots/work.
struct ReylumiOfflineRoute: Codable, Equatable {
    let path: String
    let preparedAt: Date
    let expiresAt: Date

    static let protectedPaths: Set<String> = [
        "/pos", "/pos/book", "/pos/check-in", "/pos/ticket", "/pos/report",
        "/pos/portable", "/pos/portable/book", "/pos/portable/check-in",
        "/pos/portable/ticket", "/pos/portable/report", "/pos/portable/today",
        "/bookings", "/reports", "/payroll", "/staff/my-work", "/staff/workday",
        "/staff/appointments", "/staff/today", "/activity", "/my-bookings",
        "/explore/favorites", "/more", "/more/saved-post", "/more/following",
        "/beauty", "/notifications", "/my-place",
    ]
    static let publicPaths: Set<String> = ["/explore", "/market"]
    static let maximumLease: TimeInterval = 24 * 60 * 60

    static func expiry(from value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    init?(path: String, expiresAt: Date, now: Date = Date()) {
        guard Self.protectedPaths.contains(path) || Self.publicPaths.contains(path),
              expiresAt > now else { return nil }
        self.path = path
        self.preparedAt = now
        self.expiresAt = min(expiresAt, now.addingTimeInterval(Self.maximumLease))
    }

    func isValid(at now: Date = Date()) -> Bool {
        (Self.protectedPaths.contains(path) || Self.publicPaths.contains(path))
            && preparedAt <= now.addingTimeInterval(60)
            && expiresAt > now && expiresAt.timeIntervalSince(preparedAt) <= Self.maximumLease
    }
}

/// Store only a bare route and capped expiry. Keychain never contains page HTML,
/// credentials, grants, customer records, payroll values or a financial outbox.
final class ReylumiOfflineRouteStore {
    private let account: String
    private let service: String

    init(origin: URL, service: String = "com.reylumi.offline-route.v1") {
        self.account = origin.absoluteString
        self.service = service
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func save(_ route: ReylumiOfflineRoute) {
        guard route.isValid(), let data = try? JSONEncoder().encode(route) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let result = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if result == errSecItemNotFound {
            var item = query
            attributes.forEach { item[$0.key] = $0.value }
            SecItemAdd(item as CFDictionary, nil)
        }
    }

    func restored(at now: Date = Date()) -> ReylumiOfflineRoute? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        // A device that has not been unlocked yet cannot read this hint. Do not
        // turn that temporary condition into a destructive logout/reset.
        guard status != errSecInteractionNotAllowed else { return nil }
        guard status == errSecSuccess,
              let data = value as? Data,
              let route = try? JSONDecoder().decode(ReylumiOfflineRoute.self, from: data),
              route.isValid(at: now) else { clear(); return nil }
        return route
    }

    func clear() { SecItemDelete(query as CFDictionary) }
}
