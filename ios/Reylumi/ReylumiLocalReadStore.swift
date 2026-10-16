import Foundation
import CryptoKit
import Security

struct ReylumiLocalSession: Codable {
    let scope: String
    let grantRevision: String
    let generation: String
    let expiresAt: Date
    let envelope: Data

    static func verified(_ envelope: [String: Any], generation: String, now: Date = Date()) -> ReylumiLocalSession? {
        guard envelope["schemaVersion"] as? Int == 1,
              let context = envelope["context"] as? [String: Any], let scope = context["scope"] as? String,
              scope.range(of: "^v3:[a-f0-9]{64}$", options: .regularExpression) != nil,
              let grant = envelope["grant"] as? [String: Any], grant["version"] as? Int == 1,
              let primaryScope = grant["scope"] as? String, (grant["scopes"] as? [String])?.contains(primaryScope) == true,
              (grant["scopes"] as? [String])?.contains(scope) == true,
              grant["generation"] as? String == generation,
              let revision = grant["grantRevision"] as? String, !revision.isEmpty, revision.utf8.count <= 8192,
              let issued = grant["issuedAt"] as? Double, let expiry = grant["expiresAt"] as? Double,
              issued.isFinite, expiry.isFinite, issued <= now.timeIntervalSince1970 * 1000 + 60000,
              expiry > now.timeIntervalSince1970 * 1000, expiry > issued, expiry - issued <= 86400000,
              ReylumiLocalReadStore.isSafeJSON(envelope), JSONSerialization.isValidJSONObject(envelope),
              let data = try? JSONSerialization.data(withJSONObject: envelope), data.count <= 1024 * 1024 else { return nil }
        guard ["owner", "staff", "customer", "portable", "public"].contains(grant["kind"] as? String ?? "") else { return nil }
        if ["owner", "staff", "customer"].contains(grant["kind"] as? String ?? "") {
            guard context["authenticated"] as? Bool == true, let viewer = context["viewerId"] as? String, viewer == grant["viewerId"] as? String else { return nil }
        }
        if grant["kind"] as? String == "portable", grant["localCommands"] as? Bool != true { return nil }
        if grant["kind"] as? String == "staff" {
            guard let binding = grant["staffBinding"] as? [String: Any], binding["version"] as? Int == 1,
                  binding["revoked"] as? Bool != true,
                  let staff = binding["staffId"] as? String, UUID(uuidString: staff) != nil,
                  let viewer = binding["viewerId"] as? String, UUID(uuidString: viewer) != nil, viewer == grant["viewerId"] as? String,
                  let salon = binding["salonId"] as? String, UUID(uuidString: salon) != nil, salon == grant["salonId"] as? String, salon == context["salonId"] as? String,
                  let revision = binding["revision"] as? String, UUID(uuidString: revision) != nil,
                  let approved = binding["approvedAt"] as? String, let approvedAt = ReylumiOfflineRoute.expiry(from: approved), approvedAt <= now.addingTimeInterval(60) else { return nil }
        }
        return ReylumiLocalSession(scope: scope, grantRevision: revision, generation: generation, expiresAt: Date(timeIntervalSince1970: expiry / 1000), envelope: data)
    }
    func valid(generation: String, at now: Date = Date()) -> Bool {
        guard self.generation == generation, expiresAt > now,
              let value = try? JSONSerialization.jsonObject(with: envelope) as? [String: Any],
              let verified = Self.verified(value, generation: generation, now: now) else { return false }
        return verified.scope == scope && verified.grantRevision == grantRevision && verified.expiresAt == expiresAt
    }
    var permitsPrivateReads: Bool {
        guard let value = try? JSONSerialization.jsonObject(with: envelope) as? [String: Any],
              let grant = value["grant"] as? [String: Any], let context = value["context"] as? [String: Any],
              let kind = grant["kind"] as? String, ["owner", "staff", "customer", "portable"].contains(kind) else { return false }
        if kind == "portable" { return grant["localCommands"] as? Bool == true }
        guard let viewer = context["viewerId"] as? String, viewer == grant["viewerId"] as? String else { return false }
        return context["authenticated"] as? Bool == true
    }
    var object: [String: Any] { (try? JSONSerialization.jsonObject(with: envelope) as? [String: Any]) ?? [:] }
    var authority: String { (object["grant"] as? [String: Any])?["kind"] as? String ?? "public" }
    var viewerId: String? { (object["context"] as? [String: Any])?["viewerId"] as? String }
    var key: String { scope + "|" + authority }
    var group: String {
        let context = object["context"] as? [String: Any] ?? [:]
        return authority + "|" + (context["workspaceId"] as? String ?? "") + "|" + (context["salonId"] as? String ?? "")
    }
    func compatible(path: String) -> Bool {
        if path.hasPrefix("/pos/portable") { return authority == "portable" }
        if ["/staff/my-work", "/staff/workday", "/staff/appointments"].contains(path) { return authority == "staff" }
        if path == "/pos" || path.hasPrefix("/pos/") || path == "/payroll" || path == "/staff/today" { return authority == "owner" }
        return authority != "staff" && authority != "portable"
    }
}

/// This is a display cache, never a command queue. It never stores cookies,
/// request bodies, passcodes, financial commands or authentication credentials.
actor ReylumiLocalReadStore {
    static let maximumSnapshots = 100
    static let maximumBytes = 16 * 1024 * 1024
    struct Row: Codable { let key: String; let sessionKey: String; let revision: String; let payload: Data; let receivedAt: Date }
    private struct State: Codable { let version: Int; var sessions: [ReylumiLocalSession]; var rows: [Row] }
    private let file: URL
    private let service: String
    private let account: String
    private var state: State?
    private var loaded = false

    init(origin: URL, directory: URL? = nil, service: String = "com.reylumi.local-app-reads.v1") {
        self.service = service; self.account = origin.absoluteString
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ReylumiLocalApp", isDirectory: true)
        self.file = base.appendingPathComponent(SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined() + ".sealed")
    }
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
    private func key(create: Bool) -> SymmetricKey? {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        if status == errSecSuccess, let bytes = value as? Data, bytes.count == 32 { return SymmetricKey(data: bytes) }
        guard create, status == errSecItemNotFound else { return nil }
        let key = SymmetricKey(size: .bits256)
        var insert = query; insert[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { return nil }
        return key
    }
    private func load() {
        guard !loaded else { return }; loaded = true
        guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= Self.maximumBytes * 2,
              let bytes = try? Data(contentsOf: file), let key = key(create: false),
              let box = try? AES.GCM.SealedBox(combined: bytes), let decrypted = try? AES.GCM.open(box, using: key),
              let state = try? JSONDecoder().decode(State.self, from: decrypted), state.version == 2, state.sessions.count <= 16,
              state.rows.count <= Self.maximumSnapshots, state.rows.reduce(0, { $0 + $1.payload.count }) <= Self.maximumBytes else { return }
        self.state = state
    }
    private func save() {
        guard let state, let key = key(create: true), let data = try? JSONEncoder().encode(state), data.count <= Self.maximumBytes * 2,
              let encrypted = try? AES.GCM.seal(data, using: key).combined else { return }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try encrypted.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var url = file; var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
        } catch { /* Reads remain usable in memory; unavailable disk cannot grant access. */ }
    }
    func session(generation: String, scope: String? = nil, path: String? = nil, privateOnly: Bool = false, authority: String? = nil, now: Date = Date()) -> ReylumiLocalSession? {
        load()
        return state?.sessions.reversed().first { candidate in
            candidate.valid(generation: generation, at: now) && (scope == nil || candidate.scope == scope) && (path == nil || candidate.compatible(path: path!)) && (!privateOnly || candidate.permitsPrivateReads) && (authority == nil || candidate.authority == authority)
        }
    }
    func accept(_ session: ReylumiLocalSession) {
        load()
        guard session.valid(generation: session.generation) else { return }
        if state == nil || state?.sessions.contains(where: { $0.viewerId != session.viewerId || $0.generation != session.generation }) == true { state = State(version: 2, sessions: [], rows: []) }
        let replaced = Set((state?.sessions ?? []).filter { $0.group == session.group && $0.grantRevision != session.grantRevision }.map(\.key))
        state?.rows.removeAll { replaced.contains($0.sessionKey) }
        state?.sessions.removeAll { replaced.contains($0.key) || $0.key == session.key || !$0.valid(generation: session.generation) }
        state?.sessions.append(session)
        while (state?.sessions.count ?? 0) > 16 { state?.sessions.removeFirst() }
        let retained = Set((state?.sessions ?? []).map(\.key)); state?.rows.removeAll { !retained.contains($0.sessionKey) }
        save()
    }
    func get(_ key: String, session: ReylumiLocalSession, now: Date = Date()) -> Data? {
        load()
        guard state?.sessions.contains(where: { $0.key == session.key && $0.grantRevision == session.grantRevision && $0.generation == session.generation }) == true,
              session.valid(generation: session.generation, at: now),
              let row = state?.rows.first(where: { $0.key == key && $0.sessionKey == session.key && $0.revision == session.grantRevision }) else { return nil }
        // Touch memory LRU without rewriting the encrypted 16 MiB file on each
        // tab visit. The next snapshot commit persists the new order.
        state?.rows.removeAll { $0.key == key && $0.sessionKey == session.key }; state?.rows.append(row)
        return row.payload
    }
    func put(_ key: String, payload: Data, session: ReylumiLocalSession, now: Date = Date()) {
        load()
        guard key.utf8.count <= 16384, payload.count <= 4 * 1024 * 1024, session.valid(generation: session.generation, at: now),
              state?.sessions.contains(where: { $0.key == session.key && $0.grantRevision == session.grantRevision && $0.generation == session.generation }) == true,
              let object = try? JSONSerialization.jsonObject(with: payload), Self.isSafeJSON(object) else { return }
        state?.rows.removeAll { $0.key == key && $0.sessionKey == session.key }
        state?.rows.append(Row(key: key, sessionKey: session.key, revision: session.grantRevision, payload: payload, receivedAt: now))
        while (state?.rows.count ?? 0) > Self.maximumSnapshots || (state?.rows.reduce(0, { $0 + $1.payload.count }) ?? 0) > Self.maximumBytes { state?.rows.removeFirst() }
        save()
    }
    func clear() { loaded = true; state = nil; try? FileManager.default.removeItem(at: file); SecItemDelete(query as CFDictionary) }
    func remove(_ key: String, session: ReylumiLocalSession) {
        load()
        guard state?.sessions.contains(where: { $0.key == session.key && $0.grantRevision == session.grantRevision && $0.generation == session.generation }) == true else { return }
        state?.rows.removeAll { $0.key == key && $0.sessionKey == session.key }; save()
    }
    func revoke(scope: String?, authority: String? = nil) {
        load()
        let removed = Set((state?.sessions ?? []).filter { (scope == nil || $0.scope == scope) && (authority == nil || $0.authority == authority) }.map(\.key))
        state?.sessions.removeAll { removed.contains($0.key) }; state?.rows.removeAll { removed.contains($0.sessionKey) }; save()
    }

    nonisolated static func isSafeJSON(_ value: Any, depth: Int = 0) -> Bool {
        guard depth <= 32 else { return false }
        if let object = value as? [String: Any] {
            let forbidden = ["password", "passcode", "pin", "token", "accesstoken", "refreshtoken", "clientsecret", "secret", "cookie", "authorization", "credential", "sealedpasscode", "sessiontoken", "proto", "prototype", "constructor"]
            return object.count <= 10000 && object.allSatisfy { key, item in
                let normalized = key.lowercased().replacingOccurrences(of: "_", with: "").replacingOccurrences(of: "-", with: "")
                let displayFlag = ["ispasscodedefault", "passcodeisdefault"].contains(normalized) && item is Bool
                let sensitive = ["password", "passcode", "token", "secret", "credential", "cookie", "authorization"].contains { normalized.contains($0) }
                return !forbidden.contains(normalized) && (!sensitive || displayFlag) && isSafeJSON(item, depth: depth + 1)
            }
        }
        if let array = value as? [Any] { return array.count <= 20000 && array.allSatisfy { isSafeJSON($0, depth: depth + 1) } }
        return value is String || value is NSNumber || value is NSNull
    }
}
