import XCTest
@testable import Reylumi

final class PortableModeTests: XCTestCase {
    func testDeviceChoiceSurvivesNewPreferenceObjectAndIsOriginScoped() {
        let suite = "PortableModeTests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let production = URL(string: "https://reylumi.com")!
        let first = ReylumiPortableMode(origin: production, defaults: defaults)
        XCTAssertEqual(first.mode, .personal)
        XCTAssertEqual(first.launchPath, "/")
        first.set(.portable)
        XCTAssertEqual(ReylumiPortableMode(origin: production, defaults: defaults).launchPath, "/pos/portable")
        first.rememberPortableLaunch("/pos/portable/check-in")
        XCTAssertEqual(ReylumiPortableMode(origin: production, defaults: defaults).launchPath, "/pos/portable/check-in")
        first.rememberPortableLaunch("/admin")
        XCTAssertEqual(first.launchPath, "/pos/portable/check-in")
        XCTAssertEqual(ReylumiPortableMode(origin: URL(string: "https://staging.reylumi.com")!, defaults: defaults).mode, .personal)
        first.set(.personal)
        XCTAssertEqual(ReylumiPortableMode(origin: production, defaults: defaults).launchPath, "/")
    }

    func testBridgeAdmissionRejectsFramesExternalDocumentsAndStalePaths() {
        let origin = URL(string: "https://reylumi.com")!
        let current = URL(string: "https://reylumi.com/pos/portable")!
        func accepts(_ frame: URL, _ top: URL = URL(string: "https://reylumi.com/pos/portable")!, main: Bool = true, path: String = "/pos/portable") -> Bool {
            ReylumiPortableBridgePolicy.trusted(origin: origin, frameURL: frame, currentURL: top, isMainFrame: main, path: path)
        }
        XCTAssertTrue(accepts(current))
        // A SPA's original frame request may predate pushState. The current
        // top URL and explicit bridge path still have to match exactly.
        XCTAssertTrue(accepts(URL(string: "https://reylumi.com/")!))
        XCTAssertFalse(accepts(current, main: false))
        XCTAssertFalse(accepts(URL(string: "https://evil.example/pos/portable")!))
        XCTAssertFalse(accepts(current, URL(string: "https://evil.example/pos/portable")!))
        XCTAssertFalse(accepts(current, path: "/settings"))
        XCTAssertFalse(accepts(URL(string: "https://reylumi.com/admin")!, URL(string: "https://reylumi.com/admin")!, path: "/admin"))
        let local = URL(string: "reylumi-app://bundle/pos/portable")!
        XCTAssertTrue(accepts(local, local))
        XCTAssertFalse(accepts(current, local))
        XCTAssertFalse(accepts(URL(string: "reylumi-app://attacker/pos/portable")!, local))
        XCTAssertTrue(ReylumiPortableBridgePolicy.portablePath("/pos/portable/ticket"))
        XCTAssertFalse(ReylumiPortableBridgePolicy.portablePath("/pos/portable-evil"))
    }
}
