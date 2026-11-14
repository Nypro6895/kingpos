import Foundation
import CryptoKit
import Security
import SQLite3

enum ReylumiPortableStoreError: Error {
    case unavailable, invalidScope, invalidKey, invalidValue, invalidOperation, immutableOperation, invalidTransition, integrity, newerVersion
}

/// The native POS vault is deliberately separate from the replaceable display
/// cache. A successful call means a FULL-sync SQLite commit, including the
/// receipt's anti-resurrection checkpoint. Failed disk/keychain writes throw;
/// callers must keep the form open instead of falling back to WebKit storage.
/// Values and operation bodies are AES-GCM sealed with a device-only keychain key.
/// No credentials, card data, or server response cache are accepted here.
final class ReylumiPortableStore {
    private let directory: URL
    private let service: String
    private let account: String
    private let lock = NSRecursiveLock()
    private var database: OpaquePointer?
    private var encryptionKey: SymmetricKey?
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private static let maximumValueBytes = 4_000_000
    private static let maximumOperationBytes = 2_000_000

    init(origin: URL, directory: URL? = nil, service: String = "com.reylumi.portable-vault.v1") {
        self.service = service
        self.account = origin.absoluteString
        let originID = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ReylumiPortable", isDirectory: true)
        self.directory = base.appendingPathComponent(originID, isDirectory: true)
    }

    deinit { if let database { sqlite3_close_v2(database) } }

    private func synchronized<T>(_ work: () throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }
        return try work()
    }

    static func validScope(_ scope: String) -> Bool {
        let parts = scope.split(separator: ":", omittingEmptySubsequences: false)
        return parts.count == 2 && parts.allSatisfy { UUID(uuidString: String($0)) != nil }
    }

    /// Namespace ownership is checked on every call, independently of the
    /// bridge's current server-issued device lease. A different POS identity
    /// cannot enumerate, adopt, remove, or overwrite this device's saved work.
    static func validKey(_ key: String, scope: String) -> Bool {
        guard validScope(scope), key.utf8.count <= 2048,
              !key.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return false }
        if key == "kingpos:portable-native-recovery:v1:" + scope { return true }
        for prefix in ["kingpos:portable-draft:v1:", "kingpos:parked-tickets:v1:", "kingpos:closed-ticket-edits:v1:", "kingpos:report-inputs:", "kingpos:offline-staff:"] {
            let owned = prefix + scope
            if key == owned || key.hasPrefix(owned + ":") { return true }
        }
        return false
    }

    private func validateScope(_ scope: String) throws {
        guard Self.validScope(scope) else { throw ReylumiPortableStoreError.invalidScope }
    }

    private func validateKey(_ key: String, scope: String) throws {
        try validateScope(scope)
        guard Self.validKey(key, scope: scope) else { throw ReylumiPortableStoreError.invalidKey }
    }

    private func validateCheckpointKey(_ key: String, scope: String) throws {
        try validateScope(scope)
        if Self.validKey(key, scope: scope) { return }
        // Legacy browser receipts used the live-display draft scope. This is
        // opaque anti-resurrection metadata only, never permission to read a
        // different POS's saved rows. Keep the exact original receipt payload.
        let salon = String(scope.split(separator: ":")[0])
        let prefix = "kingpos:portable-draft:v1:" + salon + ":"
        guard key.hasPrefix(prefix), key.utf8.count <= 2048,
              String(key.dropFirst(prefix.count)).range(of: "^[a-zA-Z0-9:._-]{1,1024}$", options: .regularExpression) != nil else { throw ReylumiPortableStoreError.invalidKey }
    }

    private static func checkpointID(_ key: String) -> String {
        // Old draft keys may contain a display capability. Persist only their
        // digest in SQLite metadata; the complete operation remains sealed.
        SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private var keychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    private func key(create: Bool) throws -> SymmetricKey {
        if let encryptionKey { return encryptionKey }
        var query = keychainQuery
        query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecSuccess, let data = value as? Data, data.count == 32 {
            let key = SymmetricKey(data: data); encryptionKey = key; return key
        }
        guard create, status == errSecItemNotFound else { throw ReylumiPortableStoreError.unavailable }
        let generated = SymmetricKey(size: .bits256)
        var insert = keychainQuery
        insert[kSecValueData as String] = generated.withUnsafeBytes { Data($0) }
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let result = SecItemAdd(insert as CFDictionary, nil)
        if result == errSecDuplicateItem { return try key(create: false) }
        guard result == errSecSuccess else { throw ReylumiPortableStoreError.unavailable }
        encryptionKey = generated; return generated
    }

    private func open() throws -> OpaquePointer {
        if let database { return database }
        let manager = FileManager.default
        try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var directoryURL = directory, flags = URLResourceValues()
        flags.isExcludedFromBackup = true; try directoryURL.setResourceValues(flags)
        let file = directory.appendingPathComponent("tickets.sqlite")
        let exists = manager.fileExists(atPath: file.path)
        // Losing a key must never silently replace an existing financial vault.
        _ = try key(create: !exists)
        var opened: OpaquePointer?
        guard sqlite3_open_v2(file.path, &opened, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let opened else {
            if let opened { sqlite3_close_v2(opened) }
            throw ReylumiPortableStoreError.unavailable
        }
        do {
            try execute("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;", database: opened)
            let version = try statement("PRAGMA user_version", database: opened) { query -> Int in
                guard sqlite3_step(query) == SQLITE_ROW else { throw ReylumiPortableStoreError.unavailable }
                return Int(sqlite3_column_int(query, 0))
            }
            guard version <= 1 else { throw ReylumiPortableStoreError.newerVersion }
            try execute("""
            CREATE TABLE IF NOT EXISTS saved (key TEXT PRIMARY KEY, body BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS operations (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
              scope TEXT NOT NULL, state TEXT NOT NULL, body BLOB NOT NULL,
              draft_key TEXT, checkpoint REAL);
            CREATE INDEX IF NOT EXISTS operation_scope ON operations(scope, sequence);
            PRAGMA user_version=1;
            """, database: opened)
            // The protected directory covers future WAL/SHM files as well.
            try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file.path)
            var fileURL = file; try fileURL.setResourceValues(flags)
            database = opened; return opened
        } catch { sqlite3_close_v2(opened); throw error }
    }

    private func execute(_ sql: String, database: OpaquePointer) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw ReylumiPortableStoreError.unavailable }
    }

    private func statement<T>(_ sql: String, database: OpaquePointer, _ work: (OpaquePointer) throws -> T) throws -> T {
        var query: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &query, nil) == SQLITE_OK, let query else { throw ReylumiPortableStoreError.unavailable }
        defer { sqlite3_finalize(query) }
        return try work(query)
    }

    private func bind(_ value: String, to query: OpaquePointer, at index: Int32) throws {
        guard value.withCString({ sqlite3_bind_text(query, index, $0, -1, Self.transient) }) == SQLITE_OK else { throw ReylumiPortableStoreError.unavailable }
    }

    private func bind(_ value: Data, to query: OpaquePointer, at index: Int32) throws {
        let result = value.withUnsafeBytes { bytes in sqlite3_bind_blob(query, index, bytes.baseAddress, Int32(bytes.count), Self.transient) }
        guard result == SQLITE_OK else { throw ReylumiPortableStoreError.unavailable }
    }

    private func blob(_ query: OpaquePointer, column: Int32) throws -> Data {
        let count = Int(sqlite3_column_bytes(query, column))
        guard count > 0, count <= Self.maximumValueBytes + 1024, let bytes = sqlite3_column_blob(query, column) else { throw ReylumiPortableStoreError.integrity }
        return Data(bytes: bytes, count: count)
    }

    private func sealed(_ value: Any, context: String) throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
        guard data.count <= Self.maximumValueBytes + 128,
              let encrypted = try AES.GCM.seal(data, using: key(create: false), authenticating: Data(context.utf8)).combined else { throw ReylumiPortableStoreError.invalidValue }
        return encrypted
    }

    private func unsealed(_ data: Data, context: String) throws -> Any {
        do {
            let box = try AES.GCM.SealedBox(combined: data)
            let decrypted = try AES.GCM.open(box, using: key(create: false), authenticating: Data(context.utf8))
            return try JSONSerialization.jsonObject(with: decrypted, options: [.fragmentsAllowed])
        } catch { throw ReylumiPortableStoreError.integrity }
    }

    func get(_ key: String, scope: String) throws -> String? {
        try synchronized {
            try validateKey(key, scope: scope)
            let db = try open()
            return try statement("SELECT body FROM saved WHERE key=?", database: db) { query in
                try bind(key, to: query, at: 1)
                let result = sqlite3_step(query)
                if result == SQLITE_DONE { return nil }
                guard result == SQLITE_ROW, let value = try unsealed(blob(query, column: 0), context: "saved|" + key) as? String else { throw ReylumiPortableStoreError.integrity }
                return value
            }
        }
    }

    func set(_ key: String, value: String, scope: String) throws {
        try synchronized {
            try validateKey(key, scope: scope)
            guard value.utf8.count <= Self.maximumValueBytes else { throw ReylumiPortableStoreError.invalidValue }
            if key.hasPrefix("kingpos:portable-native-recovery:v1:") {
                guard Self.validKey(value, scope: scope), value.hasPrefix("kingpos:portable-draft:v1:") else { throw ReylumiPortableStoreError.invalidValue }
            } else {
                guard let data = value.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data),
                      !Self.hasForbiddenCredentials(object) else { throw ReylumiPortableStoreError.invalidValue }
            }
            let db = try open(), encrypted = try sealed(value, context: "saved|" + key)
            try statement("INSERT INTO saved(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body", database: db) { query in
                try bind(key, to: query, at: 1); try bind(encrypted, to: query, at: 2)
                guard sqlite3_step(query) == SQLITE_DONE else { throw ReylumiPortableStoreError.unavailable }
            }
        }
    }

    func remove(_ key: String, scope: String) throws {
        try synchronized {
            try validateKey(key, scope: scope)
            let db = try open()
            try statement("DELETE FROM saved WHERE key=?", database: db) { query in
                try bind(key, to: query, at: 1)
                guard sqlite3_step(query) == SQLITE_DONE else { throw ReylumiPortableStoreError.unavailable }
            }
        }
    }

    func list(scope: String) throws -> [[String: Any]] {
        try synchronized {
            try validateScope(scope)
            let db = try open()
            return try statement("SELECT sequence,id,body FROM operations WHERE scope=? ORDER BY sequence", database: db) { query in
                try bind(scope, to: query, at: 1)
                var rows: [[String: Any]] = []
                while true {
                    let result = sqlite3_step(query)
                    if result == SQLITE_DONE { return rows }
                    guard result == SQLITE_ROW, let idBytes = sqlite3_column_text(query, 1) else { throw ReylumiPortableStoreError.integrity }
                    let id = String(cString: idBytes)
                    guard var value = try unsealed(blob(query, column: 2), context: "operation|" + id + "|" + scope) as? [String: Any], value["scope"] as? String == scope, value["id"] as? String == id else { throw ReylumiPortableStoreError.integrity }
                    value["sequence"] = sqlite3_column_int64(query, 0); rows.append(value)
                }
            }
        }
    }

    func checkpoint(scope: String, key: String) throws -> Double {
        try synchronized {
            try validateCheckpointKey(key, scope: scope)
            let db = try open()
            return try statement("SELECT MAX(checkpoint) FROM operations WHERE scope=? AND draft_key=?", database: db) { query in
                try bind(scope, to: query, at: 1); try bind(Self.checkpointID(key), to: query, at: 2)
                guard sqlite3_step(query) == SQLITE_ROW else { throw ReylumiPortableStoreError.unavailable }
                return sqlite3_column_type(query, 0) == SQLITE_NULL ? 0 : sqlite3_column_double(query, 0)
            }
        }
    }

    /// Count only, for native mode changes. Leaving Portable never deletes or
    /// silently discards its pending/attention items.
    func pendingCount(scope: String? = nil) throws -> Int {
        try synchronized {
            if let scope { try validateScope(scope) }
            let db = try open()
            let sql = "SELECT COUNT(*) FROM operations WHERE state NOT IN ('synced','cancelled')" + (scope == nil ? "" : " AND scope=?")
            return try statement(sql, database: db) { query in
                if let scope { try bind(scope, to: query, at: 1) }
                guard sqlite3_step(query) == SQLITE_ROW else { throw ReylumiPortableStoreError.unavailable }
                return Int(sqlite3_column_int64(query, 0))
            }
        }
    }

    private static func hasForbiddenCredentials(_ value: Any, depth: Int = 0) -> Bool {
        guard depth <= 64 else { return true }
        if let object = value as? [String: Any] {
            let denied = Set(["password", "passcode", "pin", "access_token", "refresh_token", "client_secret", "authorization", "cardnumber", "card_number", "cvc", "cvv"])
            return object.contains { denied.contains($0.key.lowercased()) || hasForbiddenCredentials($0.value, depth: depth + 1) }
        }
        if let array = value as? [Any] { return array.contains { hasForbiddenCredentials($0, depth: depth + 1) } }
        return false
    }

    private func validateOperation(_ operation: [String: Any], scope: String) throws {
        try validateScope(scope)
        let allowed = Set(["sequence", "id", "scope", "kind", "occurredAt", "payload", "state", "result", "error", "cancelledAt", "syncedAt", "rejected"])
        guard Set(operation.keys).isSubset(of: allowed),
              let id = operation["id"] as? String, UUID(uuidString: id) != nil,
              operation["scope"] as? String == scope,
              ["receipt", "attendance", "booking", "visit"].contains(operation["kind"] as? String ?? ""),
              ["pending", "attention", "synced", "cancelled"].contains(operation["state"] as? String ?? ""),
              let occurredAt = operation["occurredAt"] as? String, ReylumiOfflineRoute.expiry(from: occurredAt) != nil,
              let payload = operation["payload"] as? [String: Any],
              !Self.hasForbiddenCredentials(operation), JSONSerialization.isValidJSONObject(operation),
              let data = try? JSONSerialization.data(withJSONObject: operation), data.count <= Self.maximumOperationBytes else { throw ReylumiPortableStoreError.invalidOperation }
        if operation["kind"] as? String == "receipt", let draftKey = payload["localDraftKey"] {
            guard let draftKey = draftKey as? String else { throw ReylumiPortableStoreError.invalidKey }
            try validateCheckpointKey(draftKey, scope: scope)
        }
    }

    private static func canonical(_ value: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    }

    private static func cancellable(_ old: [String: Any]) -> Bool {
        guard old["state"] as? String == "attention" else { return false }
        let error = old["error"] as? String ?? ""
        if old["kind"] as? String == "receipt", error == "Assigned staff must be checked in and working." { return true }
        return old["rejected"] as? Bool == true && ["This customer visit already has a ticket.", "This customer visit is no longer available.", "This staff member changed on another device."].contains(where: { error.hasPrefix($0) })
    }

    @discardableResult
    func save(_ operation: [String: Any], scope: String) throws -> [String: Any] {
        try save(operation, scope: scope, importing: false, checkpointAt: nil)
    }

    /// A browser upgrade copies its existing durable operation without creating
    /// a new UUID or changing its upload state. Native progress wins on repeat
    /// imports; the legacy row stays untouched for recoverability.
    @discardableResult
    func importOperation(_ operation: [String: Any], scope: String, checkpointAt: Double? = nil) throws -> [String: Any] {
        try save(operation, scope: scope, importing: true, checkpointAt: checkpointAt)
    }

    private func save(_ operation: [String: Any], scope: String, importing: Bool, checkpointAt: Double?) throws -> [String: Any] {
        try synchronized {
            try validateOperation(operation, scope: scope)
            let now = Date().timeIntervalSince1970 * 1000
            if let checkpointAt { guard checkpointAt.isFinite, checkpointAt >= 0, checkpointAt <= now else { throw ReylumiPortableStoreError.invalidValue } }
            let db = try open(), id = UUID(uuidString: operation["id"] as! String)!.uuidString.lowercased(), nextState = operation["state"] as! String
            var value = operation; value.removeValue(forKey: "sequence")
            value["id"] = id
            try execute("BEGIN IMMEDIATE", database: db)
            do {
                let previous: (Int64, [String: Any])? = try statement("SELECT sequence,body FROM operations WHERE id=?", database: db) { query in
                    try bind(id, to: query, at: 1)
                    let result = sqlite3_step(query)
                    if result == SQLITE_DONE { return nil }
                    guard result == SQLITE_ROW, let old = try unsealed(blob(query, column: 1), context: "operation|" + id + "|" + scope) as? [String: Any] else { throw ReylumiPortableStoreError.integrity }
                    return (sqlite3_column_int64(query, 0), old)
                }
                let sequence: Int64
                if let (existingSequence, old) = previous {
                    guard old["scope"] as? String == scope,
                          old["kind"] as? String == value["kind"] as? String,
                          old["occurredAt"] as? String == value["occurredAt"] as? String,
                          try Self.canonical(old["payload"] ?? NSNull()) == Self.canonical(value["payload"] ?? NSNull()) else { throw ReylumiPortableStoreError.immutableOperation }
                    if importing {
                        try execute("COMMIT", database: db)
                        var retained = old; retained["sequence"] = existingSequence
                        return retained
                    }
                    let oldState = old["state"] as? String
                    guard !(oldState == "synced" && nextState != "synced"), !(oldState == "cancelled" && nextState != "cancelled"),
                          nextState != "cancelled" || oldState == "cancelled" || Self.cancellable(old) else { throw ReylumiPortableStoreError.invalidTransition }
                    let encrypted = try sealed(value, context: "operation|" + id + "|" + scope)
                    try statement("UPDATE operations SET state=?,body=? WHERE id=?", database: db) { query in
                        try bind(nextState, to: query, at: 1); try bind(encrypted, to: query, at: 2); try bind(id, to: query, at: 3)
                        guard sqlite3_step(query) == SQLITE_DONE else { throw ReylumiPortableStoreError.unavailable }
                    }
                    sequence = existingSequence
                } else {
                    guard nextState == "pending" || importing else { throw ReylumiPortableStoreError.invalidTransition }
                    let payload = value["payload"] as! [String: Any]
                    let draftKey = value["kind"] as? String == "receipt" ? payload["localDraftKey"] as? String : nil
                    // Browser migration must carry the original checkpoint.
                    // Stamping migration time could discard a newer unfinished
                    // cart that reused the legacy receipt's draft key.
                    let occurredAt = ReylumiOfflineRoute.expiry(from: value["occurredAt"] as! String)!.timeIntervalSince1970 * 1000
                    var savedAt = importing ? checkpointAt ?? max(0, min(now, occurredAt)) : now
                    if !importing, let draftKey, Self.validKey(draftKey, scope: scope), let raw = try get(draftKey, scope: scope),
                       let bytes = raw.data(using: .utf8), let draft = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                       let timestamp = draft["savedAt"] as? Double, timestamp.isFinite { savedAt = max(savedAt, timestamp) }
                    let encrypted = try sealed(value, context: "operation|" + id + "|" + scope)
                    try statement("INSERT INTO operations(id,scope,state,body,draft_key,checkpoint) VALUES(?,?,?,?,?,?)", database: db) { query in
                        try bind(id, to: query, at: 1); try bind(scope, to: query, at: 2); try bind(nextState, to: query, at: 3); try bind(encrypted, to: query, at: 4)
                        if let draftKey {
                            try bind(Self.checkpointID(draftKey), to: query, at: 5)
                            guard sqlite3_bind_double(query, 6, savedAt) == SQLITE_OK else { throw ReylumiPortableStoreError.unavailable }
                        } else { sqlite3_bind_null(query, 5); sqlite3_bind_null(query, 6) }
                        guard sqlite3_step(query) == SQLITE_DONE else { throw ReylumiPortableStoreError.unavailable }
                    }
                    sequence = sqlite3_last_insert_rowid(db)
                }
                try execute("COMMIT", database: db)
                value["sequence"] = sequence; return value
            } catch { try? execute("ROLLBACK", database: db); throw error }
        }
    }

    /// Dispatcher used only after the host validates frame, nonce, path and
    /// current device admission. The scope is supplied by the native host.
    func invoke(_ body: [String: Any], scope: String) throws -> Any {
        guard let action = body["action"] as? String else { throw ReylumiPortableStoreError.invalidOperation }
        switch action {
        case "storage.get":
            guard let key = body["key"] as? String else { throw ReylumiPortableStoreError.invalidKey }
            return try get(key, scope: scope) as Any? ?? NSNull()
        case "storage.set":
            guard let key = body["key"] as? String, let value = body["value"] as? String else { throw ReylumiPortableStoreError.invalidValue }
            try set(key, value: value, scope: scope); return ["ok": true]
        case "storage.remove":
            guard let key = body["key"] as? String else { throw ReylumiPortableStoreError.invalidKey }
            try remove(key, scope: scope); return ["ok": true]
        case "operations.list":
            guard body["scope"] as? String == scope else { throw ReylumiPortableStoreError.invalidScope }
            return try list(scope: scope)
        case "operations.checkpoint":
            guard body["scope"] as? String == scope, let key = body["key"] as? String else { throw ReylumiPortableStoreError.invalidScope }
            return try checkpoint(scope: scope, key: key)
        case "operations.save":
            guard let operation = body["operation"] as? [String: Any] else { throw ReylumiPortableStoreError.invalidOperation }
            return try save(operation, scope: scope)
        case "operations.import":
            guard body["scope"] as? String == scope, let operation = body["operation"] as? [String: Any] else { throw ReylumiPortableStoreError.invalidScope }
            if body["checkpointAt"] != nil && !(body["checkpointAt"] is Double) { throw ReylumiPortableStoreError.invalidValue }
            return try importOperation(operation, scope: scope, checkpointAt: body["checkpointAt"] as? Double)
        default: throw ReylumiPortableStoreError.invalidOperation
        }
    }
}
