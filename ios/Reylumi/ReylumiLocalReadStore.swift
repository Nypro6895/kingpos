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
        if grant["kind"] as? String == "portable" {
            let parts = scope.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 2, UUID(uuidString: parts[0]) != nil, UUID(uuidString: parts[1]) != nil,
                  primaryScope == scope, context["authenticated"] as? Bool == false,
                  context["salonId"] as? String == parts[0], grant["salonId"] as? String == parts[0],
                  context["workspaceId"] as? String == parts[1], grant["workspaceId"] as? String == parts[1],
                  context["permissionRevision"] as? String == revision,
                  (context["viewerId"] as? String) == (grant["viewerId"] as? String),
                  (grant["localCommands"] as? Bool) != nil else { return nil }
        } else {
            guard scope.range(of: "^v3:[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        }
        if ["owner", "staff", "customer"].contains(grant["kind"] as? String ?? "") {
            guard context["authenticated"] as? Bool == true, let viewer = context["viewerId"] as? String, viewer == grant["viewerId"] as? String else { return nil }
        }
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
        // A valid device display lease can restore its existing read model.
        // localCommands remains the original separate outbox/write policy.
        if kind == "portable" { return true }
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
        // The neutral launch route only resolves an account's own home. Device
        // PIN authority remains separate and cannot become an account session.
        if path == "/" { return authority != "portable" }
        if path.hasPrefix("/pos/portable") { return authority == "portable" }
        if path == "/pos/customer-display" { return authority == "portable" }
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
    /// Transient lifecycle fence, never a credential or part of the disk schema.
    struct ReadPermit: Sendable { fileprivate let id: UUID }
    private struct PendingRead { let key: String; let scope: String?; var invalidated = false }
    private struct State: Codable { let version: Int; var sessions: [ReylumiLocalSession]; var rows: [Row] }
    private let file: URL
    private let service: String
    private let account: String
    private var state: State?
    private var loaded = false
    private var pendingSave: Task<Void, Never>?
    private var pendingSaveID: UUID?
    private var pendingReads: [UUID: PendingRead] = [:]
    private(set) var successfulSaves = 0

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
            successfulSaves += 1
        } catch { /* Reads remain usable in memory; unavailable disk cannot grant access. */ }
    }
    private func cancelPendingSave() { pendingSave?.cancel(); pendingSave = nil; pendingSaveID = nil }
    private func finishSave(_ id: UUID) {
        guard pendingSaveID == id, !Task.isCancelled else { return }
        pendingSave = nil; pendingSaveID = nil; save()
    }
    private func saveTogether() async {
        if let pendingSave { await pendingSave.value; return }
        let id = UUID(); pendingSaveID = id
        let task: Task<Void, Never> = Task { [weak self] in
            // Concurrent shell/roster responses share one atomic encrypted
            // commit. Callers still await persistence before receiving data.
            do { try await Task.sleep(nanoseconds: 25_000_000) } catch { return }
            await self?.finishSave(id)
        }
        pendingSave = task; await task.value
    }
    func session(generation: String, scope: String? = nil, path: String? = nil, privateOnly: Bool = false, authority: String? = nil, now: Date = Date()) -> ReylumiLocalSession? {
        load()
        return state?.sessions.reversed().first { candidate in
            candidate.valid(generation: generation, at: now) && (scope == nil || candidate.scope == scope) && (path == nil || candidate.compatible(path: path!)) && (!privateOnly || candidate.permitsPrivateReads) && (authority == nil || candidate.authority == authority)
        }
    }
    func beginRead(_ key: String, scope: String?) -> ReadPermit {
        let permit = ReadPermit(id: UUID())
        pendingReads[permit.id] = PendingRead(key: key, scope: scope)
        return permit
    }
    func finishRead(_ permit: ReadPermit) { pendingReads[permit.id] = nil }
    func permitsRead(_ permit: ReadPermit, key: String, scope: String?) -> Bool {
        guard let read = pendingReads[permit.id], !read.invalidated, read.key == key else { return false }
        return read.scope == nil || scope == nil || read.scope == scope
    }
    func invalidatePendingReads(_ key: String, scope: String?) {
        for (id, read) in pendingReads where read.key == key && (scope == nil || read.scope == nil || read.scope == scope) {
            pendingReads[id]?.invalidated = true
        }
    }
    private func invalidatePendingScopes(_ scopes: Set<String>) {
        guard !scopes.isEmpty else { return }
        for (id, read) in pendingReads where read.scope.map({ scopes.contains($0) }) ?? true { pendingReads[id]?.invalidated = true }
    }
    func accept(_ session: ReylumiLocalSession) async {
        load()
        guard session.valid(generation: session.generation) else { return }
        if state?.sessions.contains(where: { $0.key == session.key && $0.envelope == session.envelope }) == true {
            if let pendingSave { await pendingSave.value }; return
        }
        if state == nil || state?.sessions.contains(where: { $0.viewerId != session.viewerId || $0.generation != session.generation }) == true {
            if state != nil { pendingReads.removeAll() }
            state = State(version: 2, sessions: [], rows: [])
        }
        let replaced = Set((state?.sessions ?? []).filter { $0.group == session.group && $0.grantRevision != session.grantRevision }.map(\.key))
        let revokedScopes = Set((state?.sessions ?? []).filter {
            replaced.contains($0.key) || (!$0.valid(generation: session.generation) && ($0.key != session.key || $0.grantRevision != session.grantRevision))
        }.map(\.scope))
        invalidatePendingScopes(revokedScopes)
        state?.rows.removeAll { replaced.contains($0.sessionKey) }
        state?.sessions.removeAll { replaced.contains($0.key) || $0.key == session.key || !$0.valid(generation: session.generation) }
        state?.sessions.append(session)
        while (state?.sessions.count ?? 0) > 16 { state?.sessions.removeFirst() }
        let retained = Set((state?.sessions ?? []).map(\.key)); state?.rows.removeAll { !retained.contains($0.sessionKey) }
        await saveTogether()
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
    // Network-backed callers must carry the permit acquired before networking.
    // Direct, already-available trusted seeds may omit it; the session and safe
    // payload guards still apply. The sole production network caller passes it.
    func put(_ key: String, payload: Data, session: ReylumiLocalSession, resourceName: String? = nil, now: Date = Date(), permit: ReadPermit? = nil) async {
        load()
        if let permit, !permitsRead(permit, key: key, scope: session.scope) { return }
        guard !Task.isCancelled, key.utf8.count <= 16384, payload.count <= 4 * 1024 * 1024, session.valid(generation: session.generation, at: now),
              state?.sessions.contains(where: { $0.key == session.key && $0.grantRevision == session.grantRevision && $0.generation == session.generation }) == true,
              let object = try? JSONSerialization.jsonObject(with: payload), Self.isSafeReadPayload(object, resourceName: resourceName, session: session) else { return }
        if state?.rows.contains(where: { $0.key == key && $0.sessionKey == session.key && $0.revision == session.grantRevision && $0.payload == payload }) == true {
            if let pendingSave { await pendingSave.value }; return
        }
        state?.rows.removeAll { $0.key == key && $0.sessionKey == session.key }
        state?.rows.append(Row(key: key, sessionKey: session.key, revision: session.grantRevision, payload: payload, receivedAt: now))
        while (state?.rows.count ?? 0) > Self.maximumSnapshots || (state?.rows.reduce(0, { $0 + $1.payload.count }) ?? 0) > Self.maximumBytes { state?.rows.removeFirst() }
        await saveTogether()
    }
    func clear() { pendingReads.removeAll(); cancelPendingSave(); loaded = true; state = nil; try? FileManager.default.removeItem(at: file); SecItemDelete(query as CFDictionary) }
    func remove(_ key: String, session: ReylumiLocalSession) {
        load()
        invalidatePendingReads(key, scope: session.scope)
        guard state?.sessions.contains(where: { $0.key == session.key && $0.grantRevision == session.grantRevision && $0.generation == session.generation }) == true else { return }
        state?.rows.removeAll { $0.key == key && $0.sessionKey == session.key }; cancelPendingSave(); save()
    }
    func revoke(scope: String?, authority: String? = nil) {
        load()
        let revokedScopes = Set((state?.sessions ?? []).filter { (scope == nil || $0.scope == scope) && (authority == nil || $0.authority == authority) }.map(\.scope))
        if scope == nil && authority == nil { pendingReads.removeAll() }
        else { invalidatePendingScopes(revokedScopes.union(scope.map { Set([$0]) } ?? [])) }
        let removed = Set((state?.sessions ?? []).filter { (scope == nil || $0.scope == scope) && (authority == nil || $0.authority == authority) }.map(\.key))
        state?.sessions.removeAll { removed.contains($0.key) }; state?.rows.removeAll { removed.contains($0.sessionKey) }; cancelPendingSave(); save()
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
    nonisolated static func isSafeReadPayload(_ value: Any, resourceName: String?, session: ReylumiLocalSession) -> Bool {
        if isSafeJSON(value) { return true }
        // The original Portable draft already durably holds this paired-display
        // capability. Permit it only in its exact device-leased workspace DTO,
        // encrypted at rest; auth/session tokens remain forbidden everywhere.
        guard resourceName == "portable.workspace", session.authority == "portable", session.permitsPrivateReads,
              var root = value as? [String: Any], root["scope"] as? String == session.scope,
              var data = root["data"] as? [String: Any], var draft = data["liveDraft"] as? [String: Any],
              let token = draft["token"] as? String,
              token.range(of: "^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$", options: [.regularExpression, .caseInsensitive]) != nil,
              let salon = (session.object["grant"] as? [String: Any])?["salonId"] as? String, draft["salon_id"] as? String == salon else { return false }
        draft.removeValue(forKey: "token"); data["liveDraft"] = draft; root["data"] = data
        return isSafeJSON(root)
    }
}
