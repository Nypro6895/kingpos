import XCTest
import UIKit
import WebKit
import CryptoKit
@testable import Reylumi

/// The installed application, its entry, React views, bridge, encrypted store
/// and native transport remain real. Only HTTP is replaced, with synthetic
/// read-only DTOs. Neither this client nor the WebView can contact a server.
private actor OwnerTodayMeasurementHTTP: ReylumiLocalHTTPClient {
    private let fixture: [String: Any]
    private var failures: Int
    private var contextCount = 0
    private var commandCount = 0
    private var reads: [String: Int] = [:]
    init(fixture: [String: Any], failures: Int = 0) { self.fixture = fixture; self.failures = failures }
    func counts() -> [String: Any] { ["context": contextCount, "commands": commandCount, "reads": reads] }
    func clearCounts() { contextCount = 0; commandCount = 0; reads = [:] }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        var status = 200, object: [String: Any]
        var headers = ["Content-Type": "application/json", "Server-Timing": "auth;dur=1,load;dur=2,total;dur=3"]
        if url.path == "/api/app-local/context" {
            contextCount += 1
            if failures > 0 {
                failures -= 1; status = 503; object = ["error": "Synthetic temporary context failure"]
            } else {
                let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
                object = AppLocalTestFixture.context(generation: generation, kind: "owner")
                var grant = object["grant"] as! [String: Any]
                grant["path"] = "/staff/today"; grant["workspaceId"] = "fixture-workspace"; object["grant"] = grant
                object["home"] = "/staff/today"
                object["display"] = ["name": "Synthetic owner", "language": "en", "role": "owner"]
                object["access"] = ["ownerWorkspace": true, "staffWorkspace": false]
            }
        } else if url.path == "/api/app-local/read" {
            let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
            let name = (body?["name"] as? String) ?? query.first { $0.name == "name" }?.value ?? ""
            let argsText = query.first { $0.name == "args" }?.value ?? "{}"
            let args = (body?["args"] as? [String: Any]) ?? ((try? JSONSerialization.jsonObject(with: Data(argsText.utf8))) as? [String: Any]) ?? [:]
            let phase = (args["phase"] as? String) ?? "full"
            let label = Self.readLabel(name, phase: phase)
            reads[label, default: 0] += 1
            let value: [String: Any]
            switch name {
            case "page.owner-today": value = ["dashboard": (fixture["phases"] as! [String: Any])[phase]!, "isOwner": true]
            case "shell.navigation": value = ["scope": AppLocalTestFixture.scope, "authenticated": true, "navigation": fixture["navigation"]!, "ownerQueueScope": NSNull(), "audience": "owner"]
            case "shell.configuration": value = ["scope": AppLocalTestFixture.scope, "language": ["enabled": false, "portableEnabled": false, "expiresAt": NSNull()], "campaign": ["installed": false, "runtime": NSNull()]]
            case "shell.summary": value = ["scope": AppLocalTestFixture.scope, "notificationScope": "00000000-0000-4000-8000-000000000001:synthetic-owner-workspace", "summary": fixture["summary"]!]
            case "shell.notice": value = ["scope": AppLocalTestFixture.scope, "mode": NSNull()]
            case "http.notifications.feed": value = Self.wire(["items": [], "unreadCount": 0])
            case "http.shell.advertising": value = Self.wire(["campaigns": []])
            case "http.shell.session": value = Self.wire(["authenticated": true])
            default: status = 503; value = ["error": "Optional synthetic read unavailable"]
            }
            let etag = "\"" + SHA256.hash(data: Data(label.utf8)).map { String(format: "%02x", $0) }.joined() + "\""
            headers["ETag"] = etag; headers["x-reylumi-scope"] = AppLocalTestFixture.scope
            if status == 200, request.value(forHTTPHeaderField: "If-None-Match") == etag {
                return (Data(), HTTPURLResponse(url: url, statusCode: 304, httpVersion: nil, headerFields: headers)!)
            }
            object = ["schemaVersion": 1, "status": 200, "scope": AppLocalTestFixture.scope, "etag": etag, "updatedAt": Date().timeIntervalSince1970 * 1000, "data": value]
        } else {
            if url.path == "/api/app-local/command" { commandCount += 1 }
            status = 503; object = ["error": "Commands and external traffic forbidden in measurement"]
        }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!)
    }
    private static func wire(_ body: [String: Any]) -> [String: Any] {
        ["status": 200, "headers": ["content-type": "application/json"], "body": String(decoding: try! JSONSerialization.data(withJSONObject: body), as: UTF8.self)]
    }
    private static func readLabel(_ name: String, phase: String) -> String {
        if name == "page.owner-today", ["shell", "staff", "bookings", "waiting", "financials", "extras", "full"].contains(phase) { return "today_" + phase }
        switch name {
        case "shell.navigation": return "shell_navigation"
        case "shell.configuration": return "shell_configuration"
        case "shell.summary": return "shell_summary"
        case "shell.notice": return "shell_notice"
        case "http.notifications.feed": return "notifications"
        case "http.shell.advertising": return "advertising"
        case "http.shell.session": return "session"
        default: return "other"
        }
    }
}

@MainActor
final class OwnerTodayDiagnosticsTests: XCTestCase {
    private let fullReady = "Boolean(document.querySelector('[data-today-dashboard=\"owner-manager\"]')) && Boolean(document.querySelector('nav[aria-label=\"Owner\"]')) && ['staff','bookings','waiting','financials','extras'].every(p=>window.__reylumiDiagnostics?.snapshot().some(x=>x.event==='data.visible'&&x.area==='today'&&x.phase===p))"

    func testInstalledOwnerTodayColdWithoutCacheAndWarmRevisit() async throws {
        try await scenario("cold_empty_warm_revisit") { run in
            try await self.wait(self.fullReady, in: run.web)
            _ = try await run.web.evaluateJavaScript("window.__diagnosticOriginalToday=document.querySelector('[data-today-dashboard]');true")
            let first = await run.http.counts()
            run.controller.navigate("/help")
            try await self.wait("location.pathname==='/help'", in: run.web)
            run.controller.navigate("/staff/today")
            try await self.wait("location.pathname==='/staff/today' && Boolean(document.querySelector('[data-today-dashboard]'))", in: run.web)
            try await Task.sleep(nanoseconds: 500_000_000)
            let same = try await run.web.evaluateJavaScript("window.__diagnosticOriginalToday===document.querySelector('[data-today-dashboard]')") as? Bool
            XCTAssertEqual(same, true, "A warm return retains the rendered Today view")
            let after = await run.http.counts()
            XCTAssertEqual((first["reads"] as? [String: Int])?.filter { $0.key.hasPrefix("today_") }, (after["reads"] as? [String: Int])?.filter { $0.key.hasPrefix("today_") }, "A fresh warm return must not refetch all Today phases")
            return ["coldReady": first, "warmReady": after, "retainedTodayDOM": same ?? false]
        }
    }

    func testInstalledOwnerTodayColdFromEncryptedCache() async throws {
        try await scenario("cold_encrypted_cache", prewarm: true) { run in
            try await self.wait(self.fullReady, in: run.web)
            XCTAssertTrue(run.trace.snapshot().contains { $0.event == .contextCacheHit })
            XCTAssertTrue(run.trace.snapshot().contains { $0.event == .readCacheHit && $0.category == .today })
            let hits = run.trace.snapshot().filter { $0.event == .readCacheHit && $0.category == .today }.count
            return ["todayDiskCacheHits": hits, "ready": await run.http.counts()]
        }
    }

    func testInstalledOwnerTodaySixtySecondsVisibleThenTouchAndForeground() async throws {
        try await scenario("idle_visible_60s_touch_foreground") { run in
            try await self.wait(self.fullReady, in: run.web)
            _ = try await run.web.evaluateJavaScript("window.__diagnosticOriginalToday=document.querySelector('[data-today-dashboard]');true")
            let before = await run.http.counts(), began = ProcessInfo.processInfo.systemUptime
            // Real elapsed time: exercises actual 30/60-second timers without
            // rewriting Date, visibility, freshness or scheduler semantics.
            try await Task.sleep(nanoseconds: 60_200_000_000)
            let visible = try await run.web.evaluateJavaScript("document.visibilityState==='visible'") as? Bool
            XCTAssertEqual(visible, true)
            let idle = await run.http.counts()
            let beforeTouchDocuments = run.trace.snapshot().filter { $0.event == .bundleLoad }.count
            _ = try await run.web.evaluateJavaScript("(()=>{const e=document.querySelector('[data-today-dashboard]');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));e.dispatchEvent(new Event('touchstart',{bubbles:true}));return true})()")
            try await Task.sleep(nanoseconds: 500_000_000)
            let touch = await run.http.counts()
            XCTAssertEqual(run.trace.snapshot().filter { $0.event == .bundleLoad }.count, beforeTouchDocuments, "Synthetic touch must not reload the local document")
            run.controller.foreground()
            try await Task.sleep(nanoseconds: 1_000_000_000)
            let retained = try await run.web.evaluateJavaScript("window.__diagnosticOriginalToday===document.querySelector('[data-today-dashboard]') && !document.querySelector('[data-context-failure]')") as? Bool
            XCTAssertEqual(retained, true, "Visible data survives ordinary lifecycle revalidation")
            return ["visibleIdleMs": (ProcessInfo.processInfo.systemUptime - began) * 1000, "visible": visible ?? false, "syntheticTouch": true, "nativeForegroundHandlerInvoked": true, "actualOSSuspendResume": false, "beforeIdle": before, "afterIdle": idle, "afterTouch": touch, "afterForeground": await run.http.counts(), "retainedTodayDOM": retained ?? false]
        }
    }

    func testInstalledOwnerTodayTransient503RecoversOnceWithoutCommands() async throws {
        try await scenario("cold_transient_503", failures: 1, startPath: "/staff/today") { run in
            try await self.wait(self.fullReady, in: run.web)
            let counts = await run.http.counts()
            XCTAssertEqual(counts["context"] as? Int, 2, "One failed cold read gets one safe automatic recovery")
            XCTAssertTrue(run.trace.snapshot().contains { $0.event == .httpEnd && $0.category == .context && $0.status == 503 })
            XCTAssertFalse(run.trace.snapshot().contains { $0.event == .scopeReset })
            return ["ready": counts]
        }
    }

    private struct Run {
        let controller: ReylumiLocalAppViewController
        let web: WKWebView
        let http: OwnerTodayMeasurementHTTP
        let trace: ReylumiLocalDiagnostics
    }
    private func scenario(_ name: String, prewarm: Bool = false, failures: Int = 0, startPath: String = "/", body: (Run) async throws -> [String: Any]) async throws {
        let bundle = try ReylumiLocalBundle.installed()
        XCTAssertEqual(bundle.manifest.productionReady, true); XCTAssertTrue(bundle.routeExists("/staff/today"))
        let resource = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "OwnerTodayMeasurementFixture", withExtension: "json"))
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: resource)) as? [String: Any])
        XCTAssertEqual(fixture["synthetic"] as? Bool, true)
        let http = OwnerTodayMeasurementHTTP(fixture: fixture, failures: failures), origin = URL(string: "https://reylumi.com")!
        let id = "reylumi.tests.owner-today-measurement." + UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let defaults = UserDefaults(suiteName: id)!
        defer { defaults.removePersistentDomain(forName: id) }
        if prewarm {
            let seedStore = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
            let seed = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: seedStore, client: http, defaults: defaults, cookies: { [] })
            _ = try await seed.freshContext(path: "/staff/today")
            for name in ["shell.navigation", "shell.configuration", "shell.summary", "shell.notice"] { _ = try await seed.read(name: name, args: [:], etag: nil, requestedScope: AppLocalTestFixture.scope) }
            _ = try await seed.read(name: "page.owner-today", args: ["phase": "shell"], etag: nil, requestedScope: AppLocalTestFixture.scope)
            for phase in ["staff", "bookings", "waiting", "financials", "extras"] {
                _ = try await seed.read(name: "page.owner-today", args: ["date": "2026-10-18", "phase": phase], etag: nil, requestedScope: AppLocalTestFixture.scope)
            }
            await http.clearCounts()
        }
        // A new actor reopens the persisted encrypted store; no in-memory row
        // or React instance from prewarming is passed to this cold WebView.
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: id)
        let trace = ReylumiLocalDiagnostics(enabled: true)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: defaults, cookies: { [] }, diagnostics: trace)
        let controller = ReylumiLocalAppViewController(bundle: bundle, startPath: startPath, transport: transport)
        let rules = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<WKContentRuleList, Error>) in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: id, encodedContentRuleList: """
            [{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}}]
            """) { list, error in
                if let list { continuation.resume(returning: list) } else { continuation.resume(throwing: error ?? URLError(.cannotLoadFromNetwork)) }
            }
        }
        defer { WKContentRuleListStore.default().removeContentRuleList(forIdentifier: id) { _ in } }
        controller.configureWebViewForTesting = { configuration in
            configuration.userContentController.add(rules)
            configuration.userContentController.addUserScript(WKUserScript(source: """
            window.fetch=()=>Promise.reject(new TypeError('External fixture network blocked'));
            window.WebSocket=class extends EventTarget{static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;readyState=3;send(){}close(){}};
            navigator.sendBeacon=()=>false;
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene { window.windowScene = scene }
        window.rootViewController = controller; window.isHidden = false
        defer { controller.webView?.stopLoading(); window.isHidden = true; window.rootViewController = nil }
        controller.initializeWebContentIfNeeded()
        let run = Run(controller: controller, web: try XCTUnwrap(controller.webView), http: http, trace: trace)
        do {
            let checkpoints = try await body(run)
            let counts = await http.counts()
            XCTAssertEqual(counts["commands"] as? Int, 0, "Measurements cannot replay business commands")
            let external = try await run.web.evaluateJavaScript("performance.getEntriesByType('resource').filter(x=>/^https?:/.test(x.name)).length") as? Int
            XCTAssertEqual(external, 0)
            XCTAssertEqual(trace.snapshot().filter { $0.event == .bundleLoad }.count, 1)
            try await attach(name, run: run, checkpoints: checkpoints, passed: (testRun?.totalFailureCount ?? 0) == 0)
        } catch {
            try? await attach(name, run: run, checkpoints: [:], passed: false)
            await transport.reset(); throw error
        }
        await transport.reset()
    }
    private func wait(_ expression: String, in web: WKWebView) async throws {
        for _ in 0..<600 {
            if (try? await web.evaluateJavaScript(expression)) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("The actual installed Owner Today fixture did not reach its expected rendered state")
        throw URLError(.timedOut)
    }
    private func attach(_ name: String, run: Run, checkpoints: [String: Any], passed: Bool) async throws {
        let js = (try? await run.web.evaluateJavaScript("window.__reylumiDiagnostics?.snapshot() ?? []")) as? [[String: Any]] ?? []
        let native = try JSONSerialization.jsonObject(with: JSONEncoder().encode(run.trace.snapshot()))
        let firstVisible = js.first { $0["event"] as? String == "data.visible" && $0["area"] as? String == "today" }
        let bootStart = js.first { $0["event"] as? String == "boot.start" }
        let report: [String: Any] = ["schemaVersion": 1, "scenario": name, "candidateBaseCommit": "866d8c6c08d0fd21d6a734de0207b93af26ed9cf", "bundleBuildId": run.controller.bundle.manifest.buildId, "passed": passed, "actualInstalledBundle": true, "newColdWebView": true, "nativeProcessColdStart": false, "syntheticTransport": true, "syntheticServerTiming": true, "physicalDeviceEvidence": false, "nativeTrace": native, "javascriptTrace": js, "checkpoints": checkpoints, "counts": await run.http.counts()]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "owner-today-" + name + ".json"; attachment.lifetime = .keepAlways; add(attachment)
        // The bridge mark precedes app.js resource loading and evaluation;
        // this interval deliberately does not claim pure parser CPU time.
        let metrics: [String: Any] = ["scenario": name, "passed": passed, "candidateBase": "866d8c6", "syntheticTransport": true, "firstVisibleAtMs": firstVisible?["atMs"] ?? NSNull(), "bridgeToEntryStartMs": bootStart?["durationMs"] ?? NSNull(), "nativeDocuments": run.trace.snapshot().filter { $0.event == .bundleLoad }.count]
        print("REYLUMI_STARTUP_MEASUREMENT " + String(decoding: try JSONSerialization.data(withJSONObject: metrics, options: [.sortedKeys]), as: UTF8.self))
    }
}
