import XCTest
@testable import Reylumi

final class PortableWriterRegistryTests: XCTestCase {
    @MainActor
    func testOneWriterAcrossViewsAndSameOwnerCannotAcquireTwice() throws {
        let registry = ReylumiPortableWriterRegistry(), origin = URL(string: "https://reylumi.com")!
        let first = NSObject(), second = NSObject()
        let token = try XCTUnwrap(registry.acquire(origin: origin, key: "draft", owner: first, valid: { true }))
        XCTAssertNil(registry.acquire(origin: origin, key: "draft", owner: second, valid: { true }))
        XCTAssertNil(registry.acquire(origin: origin, key: "draft", owner: first, valid: { true }))
        XCTAssertFalse(registry.owns(origin: origin, key: "draft", owner: second, token: token))
        XCTAssertFalse(registry.release(origin: origin, key: "draft", owner: first, token: "wrong"))
        XCTAssertTrue(registry.owns(origin: origin, key: "draft", owner: first, token: token))
        XCTAssertTrue(registry.release(origin: origin, key: "draft", owner: first, token: token))
        XCTAssertNotNil(registry.acquire(origin: origin, key: "draft", owner: second, valid: { true }))
        XCTAssertFalse(registry.release(origin: origin, key: "draft", owner: first, token: token), "A late release cannot evict a newer writer")
    }
    @MainActor
    func testRevokedSessionAndDeadViewReleaseOwnershipWithoutTimeTakeover() throws {
        let registry = ReylumiPortableWriterRegistry(), origin = URL(string: "https://reylumi.com")!
        var first: NSObject? = NSObject()
        let second = NSObject()
        var current = true
        let token = try XCTUnwrap(registry.acquire(origin: origin, key: "draft", owner: first!, valid: { current }))
        XCTAssertTrue(registry.owns(origin: origin, key: "draft", owner: first!, token: token))
        current = false
        XCTAssertNotNil(registry.acquire(origin: origin, key: "draft", owner: second, valid: { true }))
        registry.releaseAll(owner: second)
        current = true
        XCTAssertNotNil(registry.acquire(origin: origin, key: "draft", owner: first!, valid: { current }))
        weak var weakOwner = first
        first = nil
        XCTAssertNil(weakOwner, "The process registry must not retain a closed window")
        XCTAssertNotNil(registry.acquire(origin: origin, key: "draft", owner: second, valid: { true }))
    }
    @MainActor
    func testDifferentDraftsAndOriginsHaveIndependentOwnersAndInvalidClaimCannotAcquire() {
        let registry = ReylumiPortableWriterRegistry(), first = NSObject(), second = NSObject()
        let production = URL(string: "https://reylumi.com")!, staging = URL(string: "https://staging.reylumi.com")!
        XCTAssertNotNil(registry.acquire(origin: production, key: "one", owner: first, valid: { true }))
        XCTAssertNotNil(registry.acquire(origin: production, key: "two", owner: second, valid: { true }))
        XCTAssertNotNil(registry.acquire(origin: staging, key: "one", owner: second, valid: { true }))
        XCTAssertNil(registry.acquire(origin: production, key: "three", owner: first, valid: { false }))
    }
}
