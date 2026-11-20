import XCTest
import Foundation
@testable import Reylumi

/// Synthetic cookie/HTTP boundaries exercise the production transport and
/// encrypted store without using an existing profile or contacting a server.
private actor PipelineCookieJar {
    private var values: [HTTPCookie]
    private var reads = 0
    private var writes = 0
    private var snapshotDelay: UInt64 = 0
    init(_ values: [HTTPCookie]) { self.values = values }
    func delaySnapshots(nanoseconds: UInt64) { snapshotDelay = nanoseconds }
    func snapshot() async -> [HTTPCookie] {
        reads += 1
        if snapshotDelay > 0 { try? await Task.sleep(nanoseconds: snapshotDelay) }
        return values
    }
    func counts() -> (reads: Int, writes: Int) { (reads, writes) }
    func put(_ cookie: HTTPCookie) {
        writes += 1
        values.removeAll { $0.name == cookie.name && $0.domain == cookie.domain && $0.path == cookie.path }
        values.append(cookie)
    }
}

private actor PipelineHTTP: ReylumiLocalHTTPClient {
    private var holdReads = false
    private var status = 200
    private var cookie: String?
    private var echo = true
    private var held: [(URLRequest, CheckedContinuation<(Data, HTTPURLResponse), Error>)] = []
    func configure(holdReads: Bool = false, status: Int = 200, cookie: String? = nil, echo: Bool = true) {
        self.holdReads = holdReads; self.status = status; self.cookie = cookie; self.echo = echo
    }
    func heldCount() -> Int { held.count }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if request.url?.path == "/api/app-local/read", holdReads {
            return try await withCheckedThrowingContinuation { held.append((request, $0)) }
        }
        return try response(request)
    }
    func releaseFirst() throws {
        guard !held.isEmpty else { throw URLError(.badServerResponse) }
        let (request, continuation) = held.removeFirst()
        continuation.resume(returning: try response(request))
    }
    private func response(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
        let url = try XCTUnwrap(request.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let context = url.path == "/api/app-local/context"
        let code = context ? 200 : status
        var headers = ["Content-Type": "application/json"]
        if echo, let id = request.value(forHTTPHeaderField: "X-Reylumi-Request-Id") { headers["X-Reylumi-Request-Id"] = id }
        if !context, let cookie { headers["Set-Cookie"] = cookie }
        let object: [String: Any]
        if context {
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            object = AppLocalTestFixture.context(generation: generation)
        } else {
            guard url.path == "/api/app-local/read" else { throw URLError(.unsupportedURL) }
            headers["x-reylumi-scope"] = AppLocalTestFixture.scope
            headers["ETag"] = "fixture-pipeline"
            object = ["schemaVersion": 1, "status": 200, "scope": AppLocalTestFixture.scope, "etag": "fixture-pipeline", "updatedAt": Date().timeIntervalSince1970 * 1000, "data": ["fixture": true]]
        }
        return (code == 304 ? Data() : try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: headers)!)
    }
}

@MainActor
final class NativeCookiePipelineTests: XCTestCase {
    private struct Fixture {
        let transport: ReylumiLocalAppTransport
        let jar: PipelineCookieJar
        let http: PipelineHTTP
        let diagnostics: ReylumiLocalDiagnostics
    }
    private var stores: [ReylumiLocalReadStore] = []
    private var directories: [URL] = []
    private var defaultsNames: [String] = []
    private let origin = URL(string: "https://reylumi.com")!

    override func tearDown() async throws {
        for store in stores { await store.clear() }
        for directory in directories { try? FileManager.default.removeItem(at: directory) }
        for name in defaultsNames { UserDefaults.standard.removePersistentDomain(forName: name) }
        stores.removeAll(); directories.removeAll(); defaultsNames.removeAll()
        try await super.tearDown()
    }
    private func cookie(_ value: String) -> HTTPCookie {
        HTTPCookie(properties: [.name: "kingpos-selected-workspace", .value: value, .domain: "reylumi.com", .path: "/", .secure: "TRUE"])!
    }
    private func fixture() throws -> Fixture {
        let (bundle, directory) = try AppLocalTestFixture.bundle()
        directories.append(directory)
        let name = "reylumi.tests.cookie-pipeline." + UUID().uuidString
        defaultsNames.append(name)
        let store = ReylumiLocalReadStore(origin: origin, directory: directory, service: name)
        stores.append(store)
        let jar = PipelineCookieJar([cookie("manage:fixture")]), http = PipelineHTTP(), diagnostics = ReylumiLocalDiagnostics(enabled: true)
        let transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest, store: store, client: http, defaults: UserDefaults(suiteName: name)!, cookies: { await jar.snapshot() }, setCookie: { await jar.put($0) }, diagnostics: diagnostics)
        return Fixture(transport: transport, jar: jar, http: http, diagnostics: diagnostics)
    }
    private func read(_ fixture: Fixture, date: String = "today") async throws -> [String: Any] {
        try await fixture.transport.read(name: "fixture.roster", args: ["date": date], etag: nil, requestedScope: AppLocalTestFixture.scope)
    }
    private func waitForReads(_ count: Int, _ http: PipelineHTTP) async throws {
        for _ in 0..<150 {
            if await http.heldCount() == count { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Synthetic requests must overlap at the HTTP boundary")
        throw URLError(.timedOut)
    }

    func testNoCookieUpdatesUseTwoSnapshotsAndExposeNonHTTPDeliveryStages() async throws {
        let fixture = try fixture()
        _ = try await fixture.transport.freshContext(path: "/pos")
        await fixture.jar.delaySnapshots(nanoseconds: 10_000_000)
        let before = await fixture.jar.counts()
        let response = try await read(fixture)
        let after = await fixture.jar.counts()
        XCTAssertEqual(response["status"] as? Int, 200)
        XCTAssertEqual(after.reads - before.reads, 2, "Capture and response authority check remain; no extra post-write check when there was no write")
        XCTAssertEqual(after.writes, 0)
        let rows = fixture.diagnostics.snapshot()
        let delivered = try XCTUnwrap(rows.last { $0.event == .readDelivered })
        let id = try XCTUnwrap(delivered.requestId)
        let pipeline = rows.filter { $0.requestId == id }
        XCTAssertEqual(pipeline.map(\.event), [.cookieCapture, .httpStart, .httpEnd, .cookieReconcile, .cachePersist, .readDelivered])
        for event in [ReylumiLocalDiagnostics.Event.cookieCapture, .cookieReconcile, .cachePersist] {
            let duration = try XCTUnwrap(pipeline.first { $0.event == event }?.durationMs)
            XCTAssertTrue(duration.isFinite && duration >= 0)
            if event != .cachePersist { XCTAssertGreaterThanOrEqual(duration, 8, "The stage includes the synthetic WebKit callback wait") }
        }
        XCTAssertFalse(rows.contains { $0.event == .cookieCommit }, "Checking an unchanged jar is not a committed cookie rotation")
    }

    func testRevalidatedResponseStillChecksAuthorityWithoutPersistingAnotherSnapshot() async throws {
        let fixture = try fixture()
        _ = try await fixture.transport.freshContext(path: "/pos")
        _ = try await read(fixture)
        let persistenceBefore = fixture.diagnostics.snapshot().filter { $0.event == .cachePersist }.count
        let before = await fixture.jar.counts()
        await fixture.http.configure(status: 304)
        let response = try await read(fixture)
        let after = await fixture.jar.counts()
        XCTAssertEqual(response["status"] as? Int, 304)
        XCTAssertEqual(after.reads - before.reads, 2)
        XCTAssertEqual(fixture.diagnostics.snapshot().filter { $0.event == .cachePersist }.count, persistenceBefore)
    }

    func testNoUpdateFastPathStillRejectsExternalWorkspaceChangeBeforeDelivering() async throws {
        let fixture = try fixture()
        _ = try await fixture.transport.freshContext(path: "/pos")
        await fixture.http.configure(holdReads: true)
        let pending = Task { @MainActor in try await self.read(fixture) }
        try await waitForReads(1, fixture.http)
        await fixture.jar.put(cookie("manage:another-workspace"))
        try await fixture.http.releaseFirst()
        do { _ = try await pending.value; XCTFail("External authority changes cannot deliver the old response") }
        catch { XCTAssertEqual((error as NSError).code, 409) }
        XCTAssertFalse(fixture.diagnostics.snapshot().contains { $0.event == .readDelivered })
        XCTAssertTrue(fixture.diagnostics.snapshot().contains { $0.event == .cookieMismatch })
        XCTAssertTrue(fixture.diagnostics.snapshot().contains { $0.event == .cookieReconcile && $0.outcome == .failed && $0.durationMs != nil })
        let cached = try await fixture.transport.cached(name: "fixture.roster", args: ["date": "today"], requestedScope: AppLocalTestFixture.scope)
        XCTAssertNil(cached)
    }

    func testCookieWritesRetainPostWriteVerificationAndStaleNoUpdateReadIsCancelled() async throws {
        let fixture = try fixture()
        _ = try await fixture.transport.freshContext(path: "/pos")
        await fixture.http.configure(holdReads: true)
        let first = Task { @MainActor in try await self.read(fixture, date: "first") }
        try await waitForReads(1, fixture.http)
        let second = Task { @MainActor in try await self.read(fixture, date: "second") }
        try await waitForReads(2, fixture.http)
        let before = await fixture.jar.counts()
        await fixture.http.configure(cookie: "kingpos-selected-workspace=manage:internal-rotation; Path=/; Secure")
        try await fixture.http.releaseFirst()
        _ = try await first.value
        let after = await fixture.jar.counts()
        XCTAssertEqual(after.reads - before.reads, 2, "A response that writes cookies still checks before and after writing")
        XCTAssertEqual(after.writes - before.writes, 1)
        await fixture.http.configure()
        try await fixture.http.releaseFirst()
        do { _ = try await second.value; XCTFail("A no-update late response cannot borrow a newer cookie transaction") }
        catch { XCTAssertTrue(error is CancellationError) }
        let rows = fixture.diagnostics.snapshot()
        XCTAssertTrue(rows.contains { $0.event == .cookieCommit })
        XCTAssertTrue(rows.contains { $0.event == .cookieStale })
        XCTAssertFalse(rows.contains { $0.event == .scopeReset }, "An internal concurrent rotation cancels the stale read without revoking the account")
    }

    func testLegacyResponseCannotAcquireCorrelatedPostResponseTiming() async throws {
        let fixture = try fixture()
        await fixture.http.configure(echo: false)
        _ = try await fixture.transport.freshContext(path: "/pos")
        _ = try await read(fixture)
        let post = fixture.diagnostics.snapshot().filter { [.cookieReconcile, .cachePersist, .readDelivered, .contextDelivered].contains($0.event) }
        XCTAssertFalse(post.isEmpty)
        XCTAssertTrue(post.allSatisfy { $0.requestId == nil && $0.readKind == nil })
        XCTAssertTrue(fixture.diagnostics.snapshot().filter { $0.event == .cookieCapture }.allSatisfy { $0.requestId != nil }, "Outgoing capture correlates only to its locally created HTTP start")
    }
}
