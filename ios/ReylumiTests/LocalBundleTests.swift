import XCTest
import CryptoKit
import WebKit
@testable import Reylumi

enum AppLocalTestFixture {
    static let scope = "v3:" + String(repeating: "a", count: 64)
    static func portableContext(generation: String, localCommands: Bool = false) -> [String: Any] {
        let salon = "00000000-0000-4000-8000-000000000002", key = "00000000-0000-4000-8000-000000000003", scope = salon + ":" + key
        var object = context(generation: generation, scope: scope, kind: "portable", workspace: key)
        var context = object["context"] as! [String: Any], grant = object["grant"] as! [String: Any]
        context["authenticated"] = false; context["permissionRevision"] = "revision-a"
        grant["workspaceId"] = key; grant["scope"] = scope; grant["localCommands"] = localCommands; grant["path"] = "/pos/portable"
        object["context"] = context; object["grant"] = grant; return object
    }
    static func context(generation: String, scope: String = AppLocalTestFixture.scope, revision: String = "revision-a", now: Date = Date(), kind: String = "owner", viewer: String = "00000000-0000-4000-8000-000000000001", workspace: String = "fixture-workspace", primaryScope: String? = nil) -> [String: Any] {
        let salon = "00000000-0000-4000-8000-000000000002"
        var grant: [String: Any] = ["version": 1, "scope": primaryScope ?? scope, "scopes": Array(Set([scope, primaryScope ?? scope])), "generation": generation, "viewerId": viewer, "grantRevision": revision, "issuedAt": now.timeIntervalSince1970 * 1000, "expiresAt": now.addingTimeInterval(3600).timeIntervalSince1970 * 1000, "kind": kind, "path": "/help", "salonId": salon]
        if kind == "staff" { grant["staffBinding"] = ["version": 1, "staffId": "00000000-0000-4000-8000-000000000003", "viewerId": viewer, "salonId": salon, "revision": "00000000-0000-4000-8000-000000000004", "approvedAt": ISO8601DateFormatter().string(from: now)] }
        return ["schemaVersion": 1, "context": ["scope": scope, "authenticated": true, "viewerId": viewer, "workspaceId": workspace, "salonId": salon, "permissionRevision": "permissions-a"], "grant": grant,
         "display": ["name": "Fixture", "language": "vi", "role": kind], "onlineValidatedAt": now.timeIntervalSince1970 * 1000]
    }
    static func bundle(mapEnabled: Bool = false) throws -> (ReylumiLocalBundle, URL) {
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
        let manifest: [String: Any] = ["version": 1, "buildId": "native-test-bundle", "productionReady": false, "entry": "index.html", "files": files, "mapOrigins": mapEnabled ? ["https://api.maptiler.com"] : [],
            "routes": [["path": "/explore", "adapter": "explore", "access": "public"], ["path": "/help", "adapter": "help", "access": "public"], ["path": "/help/:slug", "adapter": "help.article", "access": "public"]],
            "reads": [["name": "fixture.roster", "path": "/api/app-local/read", "argumentKeys": ["date"], "access": "scoped", "cacheable": true], ["name": "staff.my-work", "path": "/api/app-local/read", "argumentKeys": [], "access": "scoped", "cacheable": true]],
            "commands": [["name": "fixture.save", "path": "/api/app-local/command", "argumentKeys": ["id"]], ["name": "shell.logout", "path": "/api/app-local/command", "argumentKeys": []]]]
        try JSONSerialization.data(withJSONObject: manifest).write(to: directory.appendingPathComponent("manifest.json"))
        return (try ReylumiLocalBundle(directory: directory), directory)
    }
}

final class LocalBundleTests: XCTestCase {
    @MainActor func testStartupQueryKeepsDeclaredRouteAndRejectsOtherOrigins() throws {
        let (bundle,directory)=try AppLocalTestFixture.bundle();defer {try? FileManager.default.removeItem(at:directory)}
        for path in ["/help?lang=vi","/help/windows-portable?lang=vi"] {
            XCTAssertEqual(ReylumiLocalAppViewController(bundle:bundle,startPath:path).currentPath,path)
        }
        for path in ["//evil.invalid/help","https://evil.invalid/help","/help#unexpected","/missing?tab=payroll"] {
            XCTAssertEqual(ReylumiLocalAppViewController(bundle:bundle,startPath:path).currentPath,"/explore")
        }
    }

    func testCoreResourcesAreVerifiedOffMainThreadOnceAndOnlyWithinMemoryBounds() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = ReylumiLocalResourceCache(bundle: bundle)
        let script = URL(string: "reylumi-app://bundle/app.js")!
        let first = try await cache.resource(for: script), second = try await cache.resource(for: script)
        XCTAssertEqual(first.0, second.0)
        let stats = await cache.statistics()
        XCTAssertEqual(stats.verifiedReads, 1); XCTAssertEqual(stats.uiThreadReads, 0)
        XCTAssertLessThanOrEqual(stats.bytes, 8 * 1024 * 1024)
        do { _ = try await cache.resource(for: URL(string: "reylumi-app://bundle/app.js?unrecognized=1")!); XCTFail("A cached core asset cannot bypass URL validation") } catch {}
        let bounded = ReylumiLocalResourceCache(bundle: bundle, maximumBytes: 1, maximumEntries: 1)
        _ = try await bounded.resource(for: script); _ = try await bounded.resource(for: script)
        let limited = await bounded.statistics(); XCTAssertEqual(limited.entries, 0); XCTAssertEqual(limited.bytes, 0); XCTAssertEqual(limited.verifiedReads, 2)
    }
    @MainActor
    func testStoppedSchemeTaskCannotReceiveLateAssetCallbacks() async throws {
        let (bundle, directory) = try AppLocalTestFixture.bundle(); defer { try? FileManager.default.removeItem(at: directory) }
        let handler = ReylumiLocalSchemeHandler(bundle: bundle), web = WKWebView(frame: .zero)
        let task = LocalStoppedSchemeTask()
        handler.webView(web, start: task); handler.webView(web, stop: task)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(task.callbacks, 0)
    }
    func testActualInstalledManifestAndEveryDeclaredResourceAreComplete() throws {
        let bundle = try ReylumiLocalBundle.installed()
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: bundle.directory.appendingPathComponent("manifest.json"))) as? [String: Any])
        let help = try XCTUnwrap(object["help"] as? [String: Any])
        XCTAssertFalse((help["version"] as? String ?? "").isEmpty)
        XCTAssertGreaterThan((help["slugs"] as? [String] ?? []).count, 3)
        XCTAssertTrue((help["languages"] as? [String] ?? []).contains("vi"))
        for file in bundle.manifest.files {
            do {
                let (data, mime) = try bundle.resource(for: URL(string: "reylumi-app://bundle/" + file.path)!)
                XCTAssertEqual(data.count, file.bytes, file.path); XCTAssertEqual(mime, file.mime, file.path)
            } catch { XCTFail("Installed resource failed integrity: \(file.path): \(error)"); throw error }
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
        object["reads"] = []
        object["mapOrigins"] = ["https://unapproved-map.invalid"]
        try JSONSerialization.data(withJSONObject: object).write(to: url)
        XCTAssertThrowsError(try ReylumiLocalBundle(directory: directory))
        object["mapOrigins"] = ["https://api.maptiler.com"]
        try JSONSerialization.data(withJSONObject: object).write(to: url)
        XCTAssertNoThrow(try ReylumiLocalBundle(directory: directory))
        XCTAssertEqual(ReylumiLocalBundle.mime(for: "api/vendor/maplibre-gl"), "text/javascript")
        XCTAssertNil(ReylumiLocalBundle.mime(for: "api/vendor/other"))
    }
}

@MainActor
private final class LocalStoppedSchemeTask: NSObject, WKURLSchemeTask {
    let request = URLRequest(url: URL(string: "reylumi-app://bundle/app.js")!)
    private(set) var callbacks = 0
    func didReceive(_ response: URLResponse) { callbacks += 1 }
    func didReceive(_ data: Data) { callbacks += 1 }
    func didFinish() { callbacks += 1 }
    func didFailWithError(_ error: Error) { callbacks += 1 }
}
