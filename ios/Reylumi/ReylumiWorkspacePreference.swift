import Foundation
import CryptoKit

/// A durable UI selection, never authentication or an offline display grant.
/// WebKit can acknowledge a cookie update before that choice survives process
/// termination. Restore only the last acknowledged choice for the same login;
/// the first HTTPS context still validates the user, membership and permissions.
final class ReylumiWorkspacePreference {
    private struct Record: Codable {
        let version: Int
        let binding: String
        let value: String
        let expiresAt: Date
    }
    private let origin: URL
    private let file: URL
    private static let name = "kingpos-selected-workspace"
    init(origin: URL, directory: URL? = nil) {
        self.origin = origin
        let root = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ReylumiWorkspacePreferences", isDirectory: true)
        let key = Self.hash(origin.absoluteString)
        self.file = root.appendingPathComponent(key + ".json")
    }
    private static func hash(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func cookie(_ name: String, in values: [HTTPCookie], now: Date) -> HTTPCookie? {
        let matches = values.filter {
            $0.name == name && $0.path == "/" && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == origin.host?.lowercased()
                && ($0.expiresDate ?? .distantFuture) > now
        }
        guard Set(matches.map(\.value)).count == 1 else { return nil }
        return matches.first
    }
    private func binding(_ values: [HTTPCookie], now: Date) -> String? {
        guard origin.scheme == "https", let token = cookie("sb-access-token", in: values, now: now)?.value,
              let login = cookie("kingpos-login-session-id", in: values, now: now)?.value, UUID(uuidString: login) != nil else { return nil }
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var body = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        body += String(repeating: "=", count: (4 - body.count % 4) % 4)
        guard let bytes = Data(base64Encoded: body), let claims = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any],
              let sub = claims["sub"] as? String, UUID(uuidString: sub) != nil else { return nil }
        // Unverified claims only bind a non-authoritative UI preference across
        // token rotation. They never establish identity or admit a data read.
        return Self.hash([origin.absoluteString, sub, claims["session_id"] as? String ?? "", login].joined(separator: "\u{0}"))
    }
    private static func valid(_ value: String) -> Bool {
        guard value.utf8.count <= 160, let decoded = value.removingPercentEncoding else { return false }
        if decoded == "personal" { return true }
        let parts = decoded.split(separator: ":", omittingEmptySubsequences: false)
        return parts.count == 2 && ["manage", "staff", "account"].contains(String(parts[0])) && UUID(uuidString: String(parts[1])) != nil
    }
    func saveAcknowledgedChoice(cookies: [HTTPCookie], now: Date = Date()) {
        guard let binding = binding(cookies, now: now), let choice = cookie(Self.name, in: cookies, now: now), Self.valid(choice.value) else { clear(); return }
        let record = Record(version: 1, binding: binding, value: choice.value, expiresAt: min(choice.expiresDate ?? now.addingTimeInterval(31_536_000), now.addingTimeInterval(31_536_000)))
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(record).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch { clear() } // Preference persistence cannot authorize or fail a command.
    }
    func choiceToRestore(cookies: [HTTPCookie], now: Date = Date()) -> HTTPCookie? {
        guard let data = try? Data(contentsOf: file), let record = try? JSONDecoder().decode(Record.self, from: data),
              record.version == 1, record.expiresAt > now, Self.valid(record.value),
              let binding = binding(cookies, now: now), record.binding == binding else { clear(); return nil }
        if cookie(Self.name, in: cookies, now: now)?.value == record.value { return nil }
        return HTTPCookie(properties: [.name: Self.name, .value: record.value, .domain: origin.host!, .path: "/", .secure: "TRUE", .expires: record.expiresAt, HTTPCookiePropertyKey("HttpOnly"): "TRUE", HTTPCookiePropertyKey("SameSite"): "Lax"])
    }
    func reconcileRoot(workspaceId: String?) {
        guard let data = try? Data(contentsOf: file), let record = try? JSONDecoder().decode(Record.self, from: data) else { return }
        if record.value.removingPercentEncoding != workspaceId { clear() }
    }
    func clear() { try? FileManager.default.removeItem(at: file) }
}
