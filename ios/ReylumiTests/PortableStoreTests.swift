import XCTest
import CryptoKit
import Security
import SQLite3
@testable import Reylumi

final class PortableStoreTests: XCTestCase {
    private let scope = "00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003"
    private let otherScope = "00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000004"

    private func operation(scope: String, id: String = UUID().uuidString.lowercased(), key: String? = nil) -> [String: Any] {
        var payload: [String: Any] = ["lines": [["total": 127.50, "serviceLabel": "Synthetic private salon service"]]]
        if let key { payload["localDraftKey"] = key }
        return ["id": id, "scope": scope, "kind": "receipt", "occurredAt": "2026-11-13T12:00:00.000Z", "payload": payload, "state": "pending"]
    }

    private func fixture() -> (URL, String, ReylumiPortableStore) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("portable-vault-tests-" + UUID().uuidString, isDirectory: true)
        let service = "com.reylumi.tests.portable-vault." + UUID().uuidString
        return (directory, service, ReylumiPortableStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: service))
    }

    private func clean(_ directory: URL, _ service: String) {
        try? FileManager.default.removeItem(at: directory)
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
    }

    func testSynchronousDraftSurvivesNewStoreWithoutWebKitAndValuesAreEncryptedAndExcludedFromBackup() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let key = "kingpos:portable-draft:v1:" + scope + ":native"
        let draft = "{\"schema\":1,\"savedAt\":1234,\"recovery\":{\"amount\":\"127.50\",\"customer\":\"Synthetic private customer\"}}"
        try store.set(key, value: draft, scope: scope)
        let restarted = ReylumiPortableStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: service)
        XCTAssertEqual(try restarted.get(key, scope: scope), draft, "A returned synchronous save must survive a completely new native store")
        let enumerator = try XCTUnwrap(FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey, .isExcludedFromBackupKey]))
        var checkedFiles = 0
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey, .isExcludedFromBackupKey])
            if values.isDirectory == true { XCTAssertEqual(values.isExcludedFromBackup, true) }
            if values.isRegularFile == true {
                checkedFiles += 1
                let bytes = try Data(contentsOf: url)
                XCTAssertNil(bytes.range(of: Data("Synthetic private customer".utf8)))
                XCTAssertNil(bytes.range(of: Data("127.50".utf8)))
            }
        }
        XCTAssertGreaterThan(checkedFiles, 0)
        try restarted.remove(key, scope: scope)
        XCTAssertNil(try store.get(key, scope: scope))
    }

    func testReceiptAndCheckpointCommitTogetherAndIdenticalRetryKeepsSequenceAndOriginalCheckpoint() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let key = "kingpos:portable-draft:v1:" + scope + ":native"
        let futureDraftTime = Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000
        try store.set(key, value: "{\"schema\":1,\"savedAt\":\(futureDraftTime)}", scope: scope)
        let initial = operation(scope: scope, key: key)
        let saved = try store.save(initial, scope: scope)
        let checkpoint = try store.checkpoint(scope: scope, key: key)
        XCTAssertGreaterThanOrEqual(checkpoint, futureDraftTime, "A clock adjustment must not resurrect the already submitted draft")
        let restarted = ReylumiPortableStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: service)
        let rows = try restarted.list(scope: scope)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?["id"] as? String, initial["id"] as? String)
        XCTAssertEqual(try restarted.checkpoint(scope: scope, key: key), checkpoint)
        var retry = initial; retry["id"] = (initial["id"] as! String).uppercased()
        let repeated = try restarted.save(retry, scope: scope)
        XCTAssertEqual(repeated["sequence"] as? Int64, saved["sequence"] as? Int64)
        XCTAssertEqual(try restarted.list(scope: scope).count, 1)
        XCTAssertEqual(try restarted.checkpoint(scope: scope, key: key), checkpoint, "Retrying the same operation must not manufacture a later checkpoint")
    }

    func testFailedReceiptTransactionCannotLeaveEitherRowOrCheckpoint() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let key = "kingpos:portable-draft:v1:" + scope + ":native"
        try store.set(key, value: "{\"schema\":1,\"savedAt\":1234}", scope: scope)
        let files = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)
        let sqlite = try XCTUnwrap(files?.allObjects.compactMap { $0 as? URL }.first { $0.lastPathComponent == "tickets.sqlite" })
        var connection: OpaquePointer?
        XCTAssertEqual(sqlite3_open(sqlite.path, &connection), SQLITE_OK)
        let db = try XCTUnwrap(connection); defer { sqlite3_close_v2(db) }
        XCTAssertEqual(sqlite3_exec(db, "CREATE TRIGGER fixture_block BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT,'synthetic disk refusal'); END", nil, nil, nil), SQLITE_OK)
        XCTAssertThrowsError(try store.save(operation(scope: scope, key: key), scope: scope))
        let restarted = ReylumiPortableStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: service)
        XCTAssertTrue(try restarted.list(scope: scope).isEmpty)
        XCTAssertEqual(try restarted.checkpoint(scope: scope, key: key), 0)
        XCTAssertNotNil(try restarted.get(key, scope: scope), "Rejected persistence cannot remove the form")
    }

    func testCiphertextCannotBeSubstitutedUnderAnotherSavedDraftKeyOrOperationIdentity() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let firstKey = "kingpos:portable-draft:v1:" + scope + ":native-device"
        let secondKey = "kingpos:portable-draft:v1:" + otherScope + ":native-device"
        try store.set(firstKey, value: "{\"amount\":127.5}", scope: scope)
        try store.set(secondKey, value: "{\"amount\":99.5}", scope: otherScope)
        let first = operation(scope: scope), second = operation(scope: scope)
        try store.save(first, scope: scope); try store.save(second, scope: scope)
        let enumerator = try XCTUnwrap(FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil))
        let sqlite = try XCTUnwrap(enumerator.allObjects.compactMap { $0 as? URL }.first { $0.lastPathComponent == "tickets.sqlite" })
        var connection: OpaquePointer?
        XCTAssertEqual(sqlite3_open(sqlite.path, &connection), SQLITE_OK)
        let db = try XCTUnwrap(connection); defer { sqlite3_close_v2(db) }
        // Even another authentic encrypted value is unusable at a different
        // key, scope, or operation UUID. Neither ciphertext is decrypted by SQL.
        XCTAssertEqual(sqlite3_exec(db, "UPDATE saved SET body=(SELECT body FROM saved WHERE key='\(secondKey)') WHERE key='\(firstKey)'", nil, nil, nil), SQLITE_OK)
        XCTAssertThrowsError(try store.get(firstKey, scope: scope))
        XCTAssertEqual(try store.get(secondKey, scope: otherScope), "{\"amount\":99.5}")
        XCTAssertEqual(sqlite3_exec(db, "UPDATE operations SET body=(SELECT body FROM operations WHERE id='\(second["id"] as! String)') WHERE id='\(first["id"] as! String)'", nil, nil, nil), SQLITE_OK)
        XCTAssertThrowsError(try store.list(scope: scope))
    }

    func testScopeNamespacesAndBridgeDispatcherRejectForeignPOSWorkAndSensitiveFields() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let key = "kingpos:parked-tickets:v1:" + scope
        try store.set(key, value: "[]", scope: scope)
        for foreignKey in [key, "kingpos:portable-draft:v1:" + scope + ":native", "kingpos:report-inputs:" + scope + ":2026-11-13", "kingpos:offline-staff:" + scope] {
            XCTAssertThrowsError(try store.get(foreignKey, scope: otherScope))
            XCTAssertThrowsError(try store.set(foreignKey, value: "[]", scope: otherScope))
            XCTAssertThrowsError(try store.remove(foreignKey, scope: otherScope))
        }
        XCTAssertThrowsError(try store.get("kingpos:parked-tickets:v1:" + scope + "1", scope: scope))
        XCTAssertThrowsError(try store.get("auth-token", scope: scope))
        XCTAssertThrowsError(try store.list(scope: "owner:" + scope))
        XCTAssertThrowsError(try store.invoke(["action": "operations.list", "scope": otherScope], scope: scope))
        XCTAssertThrowsError(try store.save(operation(scope: otherScope), scope: scope))
        for field in ["passcode", "password", "access_token", "refresh_token", "cardNumber", "cvv"] {
            let json = String(data: try JSONSerialization.data(withJSONObject: [field: "synthetic-secret"]), encoding: .utf8)!
            XCTAssertThrowsError(try store.set(key, value: json, scope: scope), field)
            var invalid = operation(scope: scope); invalid["payload"] = [field: "synthetic-secret"]
            XCTAssertThrowsError(try store.save(invalid, scope: scope), field)
        }
        XCTAssertEqual(try store.get(key, scope: scope), "[]")
        XCTAssertTrue(try store.list(scope: scope).isEmpty)
    }

    func testImmutablePayloadStableOrderAndTerminalStatesCannotBeReplaced() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let first = operation(scope: scope), second = operation(scope: scope)
        try store.save(first, scope: scope); try store.save(second, scope: scope)
        var changed = first; changed["payload"] = ["total": 1]
        XCTAssertThrowsError(try store.save(changed, scope: scope))
        changed = first; changed["occurredAt"] = "2026-11-13T13:00:00.000Z"
        XCTAssertThrowsError(try store.save(changed, scope: scope))
        changed = first; changed["scope"] = otherScope
        XCTAssertThrowsError(try store.save(changed, scope: otherScope))
        changed = first; changed["state"] = "cancelled"
        XCTAssertThrowsError(try store.save(changed, scope: scope), "An uncertain upload cannot be cancelled")
        var completed = first; completed["state"] = "synced"; completed["syncedAt"] = "2026-11-13T13:00:00.000Z"
        try store.save(completed, scope: scope)
        XCTAssertThrowsError(try store.save(first, scope: scope))
        let rows = try store.list(scope: scope)
        XCTAssertEqual(rows.map { $0["id"] as! String }, [first["id"] as! String, second["id"] as! String])
        XCTAssertEqual(rows.first?["state"] as? String, "synced")
    }

    func testOnlyKnownBusinessRuleRejectionAllowsDurableCancellation() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        var row = operation(scope: scope)
        try store.save(row, scope: scope)
        row["state"] = "attention"; row["error"] = "Unable to upload this item."
        try store.save(row, scope: scope)
        var cancelled = row; cancelled["state"] = "cancelled"
        XCTAssertThrowsError(try store.save(cancelled, scope: scope))
        row["error"] = "Assigned staff must be checked in and working."
        try store.save(row, scope: scope)
        cancelled = row; cancelled["state"] = "cancelled"; cancelled["cancelledAt"] = "2026-11-13T13:00:00.000Z"
        try store.save(cancelled, scope: scope)
        XCTAssertThrowsError(try store.save(row, scope: scope))
        XCTAssertEqual(try store.list(scope: scope).first?["state"] as? String, "cancelled")
    }

    func testLegacyImportKeepsExactIdentityPayloadStateOrderAndNeverDowngradesNativeProgress() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let legacyKey = "kingpos:portable-draft:v1:00000000-0000-4000-8000-000000000002:fixtureDisplayCapability123:native"
        var legacy = operation(scope: scope, key: legacyKey)
        legacy["state"] = "attention"; legacy["error"] = "Unable to upload this item."; legacy["sequence"] = 74
        var completed = operation(scope: scope)
        completed["state"] = "synced"; completed["result"] = ["ticketId": "fixture-ticket"]
        let imported = try store.importOperation(legacy, scope: scope)
        try store.importOperation(completed, scope: scope)
        XCTAssertEqual(imported["id"] as? String, legacy["id"] as? String)
        XCTAssertEqual(imported["payload"] as? NSDictionary, legacy["payload"] as? NSDictionary)
        XCTAssertEqual(imported["state"] as? String, "attention")
        XCTAssertGreaterThan(try store.checkpoint(scope: scope, key: legacyKey), 0)
        XCTAssertThrowsError(try store.get(legacyKey, scope: scope), "An opaque legacy checkpoint must not expose another draft namespace")
        XCTAssertEqual(try store.pendingCount(scope: scope), 1)
        var progressed = legacy; progressed["state"] = "synced"; progressed["result"] = ["ticketId": "fixture-recovered"]
        try store.save(progressed, scope: scope)
        let repeated = try store.importOperation(legacy, scope: scope)
        XCTAssertEqual(repeated["state"] as? String, "synced")
        XCTAssertEqual(try store.pendingCount(), 0)
        let rows = try store.list(scope: scope)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows.map { $0["id"] as! String }, [legacy["id"] as! String, completed["id"] as! String])
        let enumerator = try XCTUnwrap(FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.isRegularFileKey]))
        for case let url as URL in enumerator where (try url.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true {
            XCTAssertNil(try Data(contentsOf: url).range(of: Data("fixtureDisplayCapability123".utf8)), "Checkpoint metadata may not leak an old display capability")
        }
    }

    func testMigrationUsesHistoricalCheckpointAndCannotSuppressANewerUnfinishedCart() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let key = "kingpos:portable-draft:v1:" + scope + ":native-device"
        let savedAt = Date().timeIntervalSince1970 * 1000
        let checkpointAt = savedAt - 60_000
        try store.set(key, value: "{\"schema\":1,\"savedAt\":\(savedAt)}", scope: scope)
        var oldReceipt = operation(scope: scope, key: key)
        oldReceipt["state"] = "synced"
        try store.importOperation(oldReceipt, scope: scope, checkpointAt: checkpointAt)
        XCTAssertEqual(try store.checkpoint(scope: scope, key: key), checkpointAt)
        XCTAssertLessThan(try store.checkpoint(scope: scope, key: key), savedAt, "Import time must never replace the historical anti-resurrection boundary")
        XCTAssertNotNil(try store.get(key, scope: scope))
        let otherKey = "kingpos:portable-draft:v1:" + scope + ":old-browser-slot"
        let noMetadata = operation(scope: scope, key: otherKey)
        try store.importOperation(noMetadata, scope: scope)
        let occurredAt = try XCTUnwrap(ReylumiOfflineRoute.expiry(from: noMetadata["occurredAt"] as! String)).timeIntervalSince1970 * 1000
        XCTAssertEqual(try store.checkpoint(scope: scope, key: otherKey), min(savedAt, occurredAt), accuracy: 1000)
        XCTAssertThrowsError(try store.importOperation(operation(scope: scope), scope: scope, checkpointAt: Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000))
    }

    func testUnavailableDirectoryFailsClosedAndMissingKeyDoesNotReplaceSavedFinancialWork() throws {
        let (directory, service, store) = fixture(); defer { clean(directory, service) }
        let key = "kingpos:portable-draft:v1:" + scope + ":native"
        try store.set(key, value: "{\"savedAt\":1234}", scope: scope)
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
        let missingKey = ReylumiPortableStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: service)
        XCTAssertThrowsError(try missingKey.get(key, scope: scope))
        XCTAssertThrowsError(try missingKey.set(key, value: "{}", scope: scope))
        // A file in place of the requested directory simulates unavailable disk.
        let blocked = directory.appendingPathComponent("blocked")
        try Data([1]).write(to: blocked)
        let denied = ReylumiPortableStore(origin: URL(string: "https://reylumi.com")!, directory: blocked, service: service + ".blocked")
        XCTAssertThrowsError(try denied.set(key, value: "{}", scope: scope))
        XCTAssertThrowsError(try denied.save(operation(scope: scope, key: key), scope: scope))
    }
}
