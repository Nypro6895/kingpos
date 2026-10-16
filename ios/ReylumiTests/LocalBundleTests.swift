import XCTest
import CryptoKit
@testable import Reylumi

enum AppLocalTestFixture {
    static let scope = "v3:" + String(repeating: "a", count: 64)
    static func context(generation: String, scope: String = AppLocalTestFixture.scope, revision: String = "revision-a", now: Date = Date(), kind: String = "owner", viewer: String = "00000000-0000-4000-8000-000000000001", workspace: String = "fixture-workspace", primaryScope: String? = nil) -> [String: Any] {
        let salon = "00000000-0000-4000-8000-000000000002"
        var grant: [String: Any] = ["version": 1, "scope": primaryScope ?? scope, "scopes": Array(Set([scope, primaryScope ?? scope])), "generation": generation, "viewerId": viewer, "grantRevision": revision, "issuedAt": now.timeIntervalSince1970 * 1000, "expiresAt": now.addingTimeInterval(3600).timeIntervalSince1970 * 1000, "kind": kind, "path": "/help", "salonId": salon]
        if kind == "staff" { grant["staffBinding"] = ["version": 1, "staffId": "00000000-0000-4000-8000-000000000003", "viewerId": viewer, "salonId": salon, "revision": "00000000-0000-4000-8000-000000000004", "approvedAt": ISO8601DateFormatter().string(from: now)] }
        return ["schemaVersion": 1, "context": ["scope": scope, "authenticated": true, "viewerId": viewer, "workspaceId": workspace, "salonId": salon], "grant": grant,
         "display": ["name": "Fixture", "language": "vi", "role": kind], "onlineValidatedAt": now.timeIntervalSince1970 * 1000]
    }
    static func bundle() throws -> (ReylumiLocalBundle, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("reylumi-local-fixture-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let resources = ["index.html": "<!doctype html><html><head><meta name='viewport' content='width=device-width'><link rel='stylesheet' href='/app.css'></head><body><main><h1>Fixture Help</h1><button id='next'>Read guide</button><p id='guide'></p></main><script src='/app.js'></script></body></html>",
                         "app.css": "body{font:16px system-ui}button{min-height:44px}",
                         "app.js": "window.fixtureLocal=true;document.body.dataset.appLocalReady='true';document.getElementById('next').onclick=()=>document.getElementById('guide').textContent='A complete local guide';"]
        var files: [[String: Any]] = []
        for (path, text) in resources {
            let data = Data(text.utf8); try data.write(to: directory.appendingPathComponent(path))
            files.append(["path": path, "bytes": data.count, "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), "mime": ReylumiLocalBundle.mime(for: path)!])
        }
        let manifest: [String: Any] = ["version": 1, "buildId": "native-test-bundle", "productionReady": false, "entry": "index.html", "files": files,
            "routes": [["path": "/explore", "adapter": "explore", "access": "public"], ["path": "/help", "adapter": "help", "access": "public"], ["path": "/help/:slug", "adapter": "help.article", "access": "public"]],
            "reads": [["name": "fixture.roster", "path": "/api/app-local/read", "argumentKeys": ["date"], "access": "scoped", "cacheable": true]],
            "commands": [["name": "fixture.save", "path": "/api/app-local/command", "argumentKeys": ["id"]]]]
        try JSONSerialization.data(withJSONObject: manifest).write(to: directory.appendingPathComponent("manifest.json"))
        return (try ReylumiLocalBundle(directory: directory), directory)
    }
}

final class LocalBundleTests: XCTestCase {
    func testActualInstalledManifestAndEveryDeclaredResourceAreComplete() throws {
        let bundle = try ReylumiLocalBundle.installed()
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: bundle.directory.appendingPathComponent("manifest.json"))) as? [String: Any])
        let help = try XCTUnwrap(object["help"] as? [String: Any])
        XCTAssertFalse((help["version"] as? String ?? "").isEmpty)
        XCTAssertGreaterThan((help["slugs"] as? [String] ?? []).count, 3)
        XCTAssertTrue((help["languages"] as? [String] ?? []).contains("vi"))
        for file in bundle.manifest.files {
            let (data, mime) = try bundle.resource(for: URL(string: "reylumi-app://bundle/" + file.path)!)
            XCTAssertEqual(data.count, file.bytes, file.path); XCTAssertEqual(mime, file.mime, file.path)
        }
    }
    func testManifestResourcesAndActualRouteAreVerifiedWithoutNetwork() throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let (html, mime) = try bundle.resource(for: URL(string: "reylumi-app://bundle/help/check-in?language=vi")!)
        XCTAssertEqual(mime, "text/html"); XCTAssertTrue(String(decoding: html, as: UTF8.self).contains("Fixture Help"))
        XCTAssertTrue(bundle.routeExists("/help/check-in")); XCTAssertFalse(bundle.routeExists("/unlisted"))
        XCTAssertThrowsError(try bundle.resource(for: URL(string: "reylumi-app://bundle/app.js?unknown=1")!))
    }
    func testTamperedMissingAndOutsideBundleFilesFailClosed() throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        try Data("window.fixtureLocal=false".utf8).write(to: directory.appendingPathComponent("app.js"))
        XCTAssertThrowsError(try bundle.resource(for: URL(string: "reylumi-app://bundle/app.js")!))
        for url in ["https://reylumi.com/help", "reylumi-app://evil/help", "reylumi-app://bundle/%2fapp.js", "reylumi-app://bundle/%252e%252e/app.js", "reylumi-app://bundle/unlisted"] {
            XCTAssertThrowsError(try bundle.resource(for: URL(string: url)!))
        }
        XCTAssertThrowsError(try ReylumiLocalBundle(directory: directory.appendingPathComponent("missing")))
    }
    func testManifestCannotEnableAnArbitraryNetworkProxy() throws {
        let (_, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("manifest.json")
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        object["reads"] = [["name": "unsafe", "path": "https://evil.invalid/private", "argumentKeys": [], "access": "scoped", "cacheable": true]]
        try JSONSerialization.data(withJSONObject: object).write(to: url)
        XCTAssertThrowsError(try ReylumiLocalBundle(directory: directory))
    }
}
