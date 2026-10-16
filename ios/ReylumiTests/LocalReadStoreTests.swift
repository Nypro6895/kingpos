import XCTest
@testable import Reylumi

final class LocalReadStoreTests: XCTestCase {
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
