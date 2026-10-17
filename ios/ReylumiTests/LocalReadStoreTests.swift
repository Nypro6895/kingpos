import XCTest
@testable import Reylumi

final class LocalReadStoreTests: XCTestCase {
    func testNeutralHomeAdmitsAccountLeasesWithoutGrantingAnotherRoleOrDeviceAuthority() throws {
        let generation = UUID().uuidString
        for kind in ["owner", "staff", "customer"] {
            let session = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation, kind: kind), generation: generation))
            XCTAssertTrue(session.compatible(path: "/"))
            XCTAssertEqual(session.compatible(path: "/pos"), kind == "owner")
            XCTAssertEqual(session.compatible(path: "/staff/my-work"), kind == "staff")
        }
        let portable = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.portableContext(generation: generation), generation: generation))
        XCTAssertFalse(portable.compatible(path: "/"))
    }
    func testConcurrentSnapshotsShareOneDurableCommitAndIdenticalLeaseDoesNotRewriteIt() async throws {
        let origin = URL(string: "https://reylumi.com")!, directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let service = "reylumi.tests.batched-reads." + UUID().uuidString, generation = UUID().uuidString
        let lease = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation), generation: generation))
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: service)
        await store.accept(lease)
        let initialWrites = await store.successfulSaves; XCTAssertEqual(initialWrites, 1)
        await store.accept(lease)
        let duplicateWrites = await store.successfulSaves; XCTAssertEqual(duplicateWrites, initialWrites)
        let a = Data("{\"staff\":[{\"name\":\"Mai\"}]}".utf8), b = Data("{\"services\":[{\"name\":\"Manicure\"}]}".utf8)
        async let first: Void = store.put("roster", payload: a, session: lease)
        async let second: Void = store.put("services", payload: b, session: lease)
        _ = await (first, second)
        let writes = await store.successfulSaves; XCTAssertEqual(writes, initialWrites + 1)
        let cold = ReylumiLocalReadStore(origin: origin, directory: directory, service: service)
        let restoredA = await cold.get("roster", session: lease), restoredB = await cold.get("services", session: lease)
        XCTAssertEqual(restoredA, a); XCTAssertEqual(restoredB, b, "Both awaited reads must be durable before either caller finishes")
        await store.put("services", payload: b, session: lease)
        let identicalWrites = await store.successfulSaves; XCTAssertEqual(identicalWrites, writes)
        await store.clear()
    }
    func testClearDuringBatchedCommitCannotResurrectPrivateData() async throws {
        let origin = URL(string: "https://reylumi.com")!, directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let service = "reylumi.tests.batch-clear." + UUID().uuidString, generation = UUID().uuidString
        let lease = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation), generation: generation))
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: service)
        await store.accept(lease)
        let pending = Task { await store.put("roster", payload: Data("{\"staff\":[]}".utf8), session: lease) }
        for _ in 0..<100 { if await store.get("roster", session: lease) != nil { break }; try await Task.sleep(nanoseconds: 100_000) }
        await store.clear(); await pending.value
        try await Task.sleep(nanoseconds: 40_000_000)
        let cold = ReylumiLocalReadStore(origin: origin, directory: directory, service: service)
        let restored = await cold.session(generation: generation); XCTAssertNil(restored)
        let bytes = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        XCTAssertTrue(bytes.isEmpty)
    }
    func testBareCustomerDisplaySelectsDeviceLeaseWithoutBorrowingOwnerOrPublicTokenAuthority() async throws {
        let generation = UUID().uuidString, directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = ReylumiLocalReadStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: "reylumi.tests.display." + UUID().uuidString)
        let portable = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.portableContext(generation: generation), generation: generation))
        let owner = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation), generation: generation))
        await store.accept(portable); await store.accept(owner)
        let display = await store.session(generation: generation, path: "/pos/customer-display")
        XCTAssertEqual(display?.scope, portable.scope); XCTAssertEqual(display?.authority, "portable")
        XCTAssertFalse(portable.compatible(path: "/pos/customer-display?token=public-display-capability"))
        XCTAssertFalse(portable.compatible(path: "/pos/customer-display/setup"))
        await store.revoke(scope: nil, authority: "portable")
        let locked = await store.session(generation: generation, path: "/pos/customer-display"); XCTAssertNil(locked)
        await store.clear(); try? FileManager.default.removeItem(at: directory)
    }
    func testPortableAuthorityIsExactDeviceScopeAndCannotImpersonateAnAccountLease() throws {
        let generation = UUID().uuidString, object = AppLocalTestFixture.portableContext(generation: generation)
        let session = try XCTUnwrap(ReylumiLocalSession.verified(object, generation: generation))
        XCTAssertTrue(session.permitsPrivateReads)
        XCTAssertEqual((session.object["grant"] as? [String: Any])?["localCommands"] as? Bool, false, "A display cache must not enable the separate offline command flag")
        for field in ["scope", "salonId", "workspaceId", "permissionRevision", "authenticated"] {
            var invalid = object, context = object["context"] as! [String: Any]
            context[field] = field == "authenticated" ? true : "wrong"; invalid["context"] = context
            XCTAssertNil(ReylumiLocalSession.verified(invalid, generation: generation), field)
        }
        var account = object, grant = object["grant"] as! [String: Any]
        grant["kind"] = "owner"; account["grant"] = grant
        XCTAssertNil(ReylumiLocalSession.verified(account, generation: generation))
    }
    func testPairedDisplayCapabilityCanOnlyPersistInExactEncryptedPortableWorkspace() async throws {
        let generation = UUID().uuidString, object = AppLocalTestFixture.portableContext(generation: generation), directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let session = try XCTUnwrap(ReylumiLocalSession.verified(object, generation: generation))
        let store = ReylumiLocalReadStore(origin: URL(string: "https://reylumi.com")!, directory: directory, service: "reylumi.tests.portable." + UUID().uuidString)
        await store.accept(session)
        let envelope: [String: Any] = ["schemaVersion": 1, "status": 200, "scope": session.scope, "data": ["liveDraft": ["salon_id": "00000000-0000-4000-8000-000000000002", "token": String(repeating: "a", count: 32), "total": 44.25]]]
        let payload = try JSONSerialization.data(withJSONObject: envelope)
        XCTAssertFalse(ReylumiLocalReadStore.isSafeJSON(envelope))
        await store.put("workspace", payload: payload, session: session, resourceName: "portable.workspace")
        let restored = await store.get("workspace", session: session); XCTAssertEqual(restored, payload)
        await store.put("wrong-resource", payload: payload, session: session, resourceName: "owner.workspace")
        let denied = await store.get("wrong-resource", session: session); XCTAssertNil(denied)
        for field in ["salon_id", "access_token"] {
            var changed = envelope, data = changed["data"] as! [String: Any], draft = data["liveDraft"] as! [String: Any]
            draft[field] = "wrong"; data["liveDraft"] = draft; changed["data"] = data
            await store.put(field, payload: try JSONSerialization.data(withJSONObject: changed), session: session, resourceName: "portable.workspace")
            let rejected = await store.get(field, session: session); XCTAssertNil(rejected)
        }
        await store.clear(); try? FileManager.default.removeItem(at: directory)
    }
    func testEncryptedColdReadIsGrantScopeRevisionGenerationAndExpiryBound() async throws {
        let origin = URL(string: "https://reylumi.com")!, directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = "com.reylumi.tests.local-reads." + UUID().uuidString
        let generation = UUID().uuidString, now = Date()
        let session = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation, now: now), generation: generation, now: now))
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: service)
        await store.accept(session)
        let data = try JSONSerialization.data(withJSONObject: ["staff": [["name": "Private fixture roster"]]])
        await store.put("roster", payload: data, session: session)
        let cold = ReylumiLocalReadStore(origin: origin, directory: directory, service: service)
        let saved = await cold.get("roster", session: session); XCTAssertEqual(saved, data)
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        XCTAssertNil(try Data(contentsOf: file).range(of: Data("Private fixture roster".utf8)))
        let wrongGeneration = await cold.session(generation: UUID().uuidString); XCTAssertNil(wrongGeneration)
        let expired = await cold.get("roster", session: session, now: now.addingTimeInterval(3601)); XCTAssertNil(expired)
        let replacement = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation, revision: "revision-b"), generation: generation))
        await cold.accept(replacement)
        let old = await cold.get("roster", session: session), new = await cold.get("roster", session: replacement)
        XCTAssertNil(old); XCTAssertNil(new)
        await cold.clear(); try? FileManager.default.removeItem(at: directory)
    }
    func testNoCredentialOrCommandPayloadCanEnterReadCache() async throws {
        for value in [["passcode": "1234"], ["staff": ["sealed_passcode": "private"]], ["access_token": "secret"], ["nested": ["__proto__": "unsafe"]]] as [[String: Any]] {
            XCTAssertFalse(ReylumiLocalReadStore.isSafeJSON(value))
        }
        XCTAssertTrue(ReylumiLocalReadStore.isSafeJSON(["staff": [["displayName": "Mai", "status": "working"]]]))
        var object = AppLocalTestFixture.context(generation: "device-generation-12345678")
        var grant = try XCTUnwrap(object["grant"] as? [String: Any]); grant["expiresAt"] = Date().addingTimeInterval(2 * 86400).timeIntervalSince1970 * 1000; object["grant"] = grant
        XCTAssertNil(ReylumiLocalSession.verified(object, generation: "device-generation-12345678"))
    }
    func testSameViewerLeasesCoexistWithoutRenewingStaffExpiryAndRevocationIsScoped() async throws {
        let origin = URL(string: "https://reylumi.com")!, directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let generation = UUID().uuidString, now = Date(), staffScope = "v3:" + String(repeating: "b", count: 64)
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.multiscope." + UUID().uuidString)
        let owner = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation, now: now), generation: generation))
        let staff = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation, scope: staffScope, revision: "staff-binding-a", now: now, kind: "staff", primaryScope: owner.scope), generation: generation))
        await store.accept(owner); await store.accept(staff)
        let payload = Data("{\"data\":{\"amount\":44.25}}".utf8)
        await store.put("staff-pay", payload: payload, session: staff)
        var marketObject = AppLocalTestFixture.context(generation: generation, now: now, kind: "customer")
        var marketGrant = try XCTUnwrap(marketObject["grant"] as? [String: Any]); marketGrant["expiresAt"] = now.addingTimeInterval(7200).timeIntervalSince1970 * 1000; marketObject["grant"] = marketGrant
        let market = try XCTUnwrap(ReylumiLocalSession.verified(marketObject, generation: generation))
        await store.accept(market)
        let retained = await store.session(generation: generation, path: "/staff/my-work")
        XCTAssertEqual(retained?.scope, staff.scope); XCTAssertEqual(retained?.expiresAt, staff.expiresAt)
        let pay = await store.get("staff-pay", session: staff); XCTAssertEqual(pay, payload)
        let expired = await store.session(generation: generation, path: "/staff/my-work", now: now.addingTimeInterval(3601)); XCTAssertNil(expired)
        await store.revoke(scope: nil, authority: "staff")
        let denied = await store.session(generation: generation, scope: staffScope)
        let other = await store.session(generation: generation, scope: owner.scope, authority: "owner")
        XCTAssertNil(denied); XCTAssertNotNil(other)
        await store.clear(); try? FileManager.default.removeItem(at: directory)
    }
    func testPermissionRevisionOnlyReplacesRelatedScopeAndDifferentViewerClearsAll() async throws {
        let origin = URL(string: "https://reylumi.com")!, directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), generation = UUID().uuidString
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: "reylumi.tests.authority." + UUID().uuidString)
        let a = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation), generation: generation))
        let b = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation, scope: "v3:" + String(repeating: "b", count: 64), workspace: "second-workspace"), generation: generation))
        await store.accept(a); await store.accept(b)
        let replacement = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation, scope: "v3:" + String(repeating: "c", count: 64), revision: "permission-b"), generation: generation))
        await store.accept(replacement)
        let old = await store.session(generation: generation, scope: a.scope), unrelated = await store.session(generation: generation, scope: b.scope)
        XCTAssertNil(old); XCTAssertNotNil(unrelated)
        let next = try XCTUnwrap(ReylumiLocalSession.verified(AppLocalTestFixture.context(generation: generation, viewer: "00000000-0000-4000-8000-000000000009"), generation: generation))
        await store.accept(next)
        let removed = await store.session(generation: generation, scope: b.scope); XCTAssertNil(removed)
        await store.clear(); try? FileManager.default.removeItem(at: directory)
    }
}
