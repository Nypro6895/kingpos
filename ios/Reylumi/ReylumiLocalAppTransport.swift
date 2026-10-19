import Foundation
import WebKit
import CryptoKit

protocol ReylumiLocalHTTPClient {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

private final class ReylumiLocalRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

private final class ReylumiLocalURLClient: ReylumiLocalHTTPClient {
    private let lock = NSLock()
    private var session: URLSession?
    private func activeSession() -> URLSession {
        lock.lock(); defer { lock.unlock() }
        if let session { return session }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 12; configuration.timeoutIntervalForResource = 20
        // The session owns a separate stateless delegate. It must never retain
        // a client which is already deinitializing during invalidation.
        let session = URLSession(configuration: configuration, delegate: ReylumiLocalRedirectGuard(), delegateQueue: nil)
        self.session = session; return session
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (stream, response) = try await activeSession().bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        var data = Data()
        for try await byte in stream {
            guard !Task.isCancelled, data.count < 4 * 1024 * 1024 else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        return (data, response)
    }
    // Referencing a lazy session here used to create networking from deinit,
    // with a dangling delegate. An unused client now has nothing to invalidate.
    deinit { session?.invalidateAndCancel() }
}

@MainActor
final class ReylumiLocalAppTransport {
    let diagnostics: ReylumiLocalDiagnostics
    static let sessionResetNotification = Notification.Name("ReylumiLocalAppSessionReset")
    private let origin: URL
    private let manifest: ReylumiLocalBundle.Manifest
    private let store: ReylumiLocalReadStore
    private let client: ReylumiLocalHTTPClient
    private let cookies: () async -> [HTTPCookie]
    private let setCookie: (HTTPCookie) async -> Void
    private let defaults: UserDefaults
    private let generationKey: String
    private(set) var nonce = UUID().uuidString
    private(set) var scopeEpoch = 0
    private(set) var generation: String
    private var session: ReylumiLocalSession?
    private var loadedSession = false
    private var onlineContext: [String: Any]?
    private var onlineCheckedAt = Date.distantPast
    private var freshContextTask: Task<[String: Any], Error>?
    private var freshContextID: UUID?
    private var freshContextPath: String?
    private var commandIDs = Set<String>()
    private var cookieCommitTask: Task<[HTTPCookie], Error>?
    private var cookieCommitID: UUID?
    private var workspaceCookieRevision = 0
    private let workspaceCookieNames: Set<String> = ["kingpos-selected-workspace", "kingpos-current-account-id", "kingpos-current-salon-id", "kingpos-current-manage-salon-id", "kingpos-current-staff-salon-id"]
    var onEvent: ((String, [String: Any]) -> Void)?

    init(origin: URL, manifest: ReylumiLocalBundle.Manifest, store: ReylumiLocalReadStore? = nil,
         client: ReylumiLocalHTTPClient? = nil, defaults: UserDefaults = .standard,
         cookies: (() async -> [HTTPCookie])? = nil, setCookie: ((HTTPCookie) async -> Void)? = nil,
         diagnostics: ReylumiLocalDiagnostics? = nil) {
        self.diagnostics = diagnostics ?? ReylumiLocalDiagnostics()
        self.origin = origin; self.manifest = manifest; self.store = store ?? ReylumiLocalReadStore(origin: origin)
        self.client = client ?? ReylumiLocalURLClient(); self.defaults = defaults
        self.generationKey = "reylumi.local-app.generation." + SHA256.hash(data: Data(origin.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
        self.generation = defaults.string(forKey: generationKey) ?? UUID().uuidString
        defaults.set(generation, forKey: generationKey)
        self.cookies = cookies ?? { await withCheckedContinuation { continuation in WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) } } }
        self.setCookie = setCookie ?? { cookie in
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                let store = WKWebsiteDataStore.default().httpCookieStore
                if Self.removesCookie(cookie) { store.delete(cookie) { continuation.resume() } }
                else { store.setCookie(cookie) { continuation.resume() } }
            }
        }
    }
    var metadata: [String: Any] { ["version": 1, "nonce": nonce, "scopeEpoch": scopeEpoch, "generation": generation] }
    private func failure(_ status: Int, _ message: String) -> NSError { NSError(domain: "ReylumiLocalApp", code: status, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func cookieKey(_ cookie: HTTPCookie) -> String {
        [cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased(), cookie.path, cookie.name].joined(separator: "\u{0}")
    }
    private func cookieIdentity(_ values: [HTTPCookie]) -> [String] {
        values.filter { $0.name.hasPrefix("sb-") || $0.name.hasPrefix("reylumi") || $0.name.hasPrefix("kingpos") }.map { cookieKey($0) + "\u{0}" + $0.value }.sorted()
    }
    private static func removesCookie(_ cookie: HTTPCookie) -> Bool {
        if let expiry = cookie.expiresDate, expiry <= Date() { return true }
        if let value = cookie.properties?[.maximumAge], let age = Double(String(describing: value)), age <= 0 { return true }
        return false
    }
    private func responseCookieSet(_ original: [HTTPCookie], updates: [HTTPCookie]) -> [HTTPCookie] {
        var candidate = original
        for cookie in updates {
            candidate.removeAll { cookieKey($0) == cookieKey(cookie) }
            if !Self.removesCookie(cookie) { candidate.append(cookie) }
        }
        return candidate
    }
    private func reconcileCookies(original: [HTTPCookie]?, updates: [HTTPCookie], epoch: Int, workspaceRevision: Int? = nil) async throws -> [HTTPCookie] {
        let previous = cookieCommitTask, id = UUID()
        cookieCommitID = id
        let task = Task { @MainActor [weak self] () throws -> [HTTPCookie] in
            guard let self else { throw CancellationError() }
            // Only cookie delivery is serialized. Reads still run in parallel;
            // no observer sees half of another response's auth rotation.
            if let previous { _ = try? await previous.value }
            try self.ensureCurrent(epoch)
            let currentCookies = await self.cookies()
            try self.ensureCurrent(epoch)
            // Capture outgoing headers through the same short queue, so a new
            // request cannot start from half of a multi-cookie refresh.
            guard let original else { return currentCookies }
            let expected = self.cookieIdentity(self.responseCookieSet(original, updates: updates))
            let current = self.cookieIdentity(currentCookies)
            guard current == self.cookieIdentity(original) || current == expected else {
                // A response launched before our own confirmed workspace write
                // cannot overwrite its cookies or revoke the new authority.
                // Account/token changes still take the full revocation path.
                if let workspaceRevision, workspaceRevision != self.workspaceCookieRevision,
                   self.cookieIdentity(currentCookies.filter { !self.workspaceCookieNames.contains($0.name) }) == self.cookieIdentity(original.filter { !self.workspaceCookieNames.contains($0.name) }) {
                    throw CancellationError()
                }
                await self.reset(); throw self.failure(409, "Your access has changed. Please try again.")
            }
            for cookie in updates { await self.setCookie(cookie); try self.ensureCurrent(epoch) }
            let committedCookies = await self.cookies(), committed = self.cookieIdentity(committedCookies)
            try self.ensureCurrent(epoch)
            guard committed == expected else {
                await self.reset(); throw self.failure(409, "Your access has changed. Please try again.")
            }
            if updates.contains(where: { self.workspaceCookieNames.contains($0.name) }),
               self.cookieIdentity(original.filter { self.workspaceCookieNames.contains($0.name) }) != self.cookieIdentity(committedCookies.filter { self.workspaceCookieNames.contains($0.name) }) {
                self.workspaceCookieRevision += 1
            }
            try self.ensureCurrent(epoch)
            return committedCookies
        }
        cookieCommitTask = task
        defer { if cookieCommitID == id { cookieCommitTask = nil; cookieCommitID = nil } }
        return try await task.value
    }
    private func loadSession() async {
        guard !loadedSession else { return }; loadedSession = true
        let epoch = scopeEpoch, expectedGeneration = generation
        let cached = await store.session(generation: expectedGeneration)
        guard scopeEpoch == epoch, generation == expectedGeneration else { return }
        session = cached
    }
    func reset(rotateGeneration: Bool = true) async {
        diagnostics.record(.scopeReset, category: .cache, outcome: .invalidated)
        scopeEpoch += 1; nonce = UUID().uuidString
        if rotateGeneration { generation = UUID().uuidString; defaults.set(generation, forKey: generationKey) }
        freshContextTask?.cancel(); freshContextTask = nil; freshContextID = nil; freshContextPath = nil
        session = nil; loadedSession = true; onlineContext = nil; onlineCheckedAt = .distantPast
        ReylumiBackgroundSync.shared.clear()
        onEvent?("reylumi:app-local-reset", metadata)
        await store.clear()
    }
    func lockPortable() async {
        if session?.authority == "portable" {
            diagnostics.record(.portableLock, category: .context, outcome: .invalidated)
            scopeEpoch += 1; nonce = UUID().uuidString
            freshContextTask?.cancel(); freshContextTask = nil; freshContextID = nil; freshContextPath = nil
            session = nil; onlineContext = nil; onlineCheckedAt = .distantPast
            onEvent?("reylumi:app-local-reset", metadata)
        }
        await store.revoke(scope: nil, authority: "portable")
        // The original web implementation cannot write this HTTPS cookie from
        // a custom origin. Persist that same local lock natively, not a new PIN
        // or credential. Original re-entry clears it after fresh authentication.
        let secure = origin.scheme == "https" ? "; Secure" : ""
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "kingpos-portable-local-lock=1; Path=/; Max-Age=31536000; SameSite=Lax" + secure], for: origin) { await setCookie(cookie) }
    }
    private func additiveAuthority(_ previous: ReylumiLocalSession, _ next: ReylumiLocalSession) -> Bool {
        let pair = Set([previous.authority, next.authority])
        guard previous.scope == next.scope, let viewer = previous.viewerId, viewer == next.viewerId,
              previous.authority != next.authority, pair.contains("staff"), pair.isSubset(of: ["staff", "owner", "customer"]),
              let old = previous.object["context"] as? [String: Any], let current = next.object["context"] as? [String: Any],
              let permission = old["permissionRevision"] as? String, !permission.isEmpty,
              current["permissionRevision"] as? String == permission else { return false }
        return true
    }
    private func readLease(name: String, scope: String?, privateOnly: Bool) async -> ReylumiLocalSession? {
        let authority: String?
        if name.hasPrefix("staff.") { authority = "staff" }
        else if name.hasPrefix("portable.") || name.hasPrefix("http.portable.") { authority = "portable" }
        else if name.hasPrefix("owner.") || name.hasPrefix("page.owner-") { authority = "owner" }
        else { authority = nil }
        if let authority { return await store.session(generation: generation, scope: scope, privateOnly: privateOnly, authority: authority) }
        // General customer/public resources must not borrow a staff binding or
        // Portable device lease merely because its scope happens to match.
        for kind in ["customer", "owner", "public"] {
            if let lease = await store.session(generation: generation, scope: scope, privateOnly: privateOnly, authority: kind) { return lease }
        }
        return nil
    }
    private func ensureCurrent(_ epoch: Int) throws {
        guard scopeEpoch == epoch else { throw failure(409, "Your access has changed. Please try again.") }
        // Leaving a page cancels a read; it does not revoke the account.
        try Task.checkCancellation()
    }
    func matchesCachedScope(_ scope: String) async -> Bool { await store.session(generation: generation, scope: scope) != nil }
    func invalidatePage() { diagnostics.record(.pageInvalidate, category: .context, outcome: .invalidated); scopeEpoch += 1; nonce = UUID().uuidString; freshContextTask?.cancel(); freshContextTask = nil; freshContextID = nil; freshContextPath = nil }
    private func revokeDisplay(scope: String?, staffFamily: Bool = false) async {
        if (staffFamily && session?.authority == "staff") || (scope != nil && session?.scope == scope) {
            diagnostics.record(.displayRevoke, category: .context, outcome: .invalidated)
            scopeEpoch += 1; nonce = UUID().uuidString; session = nil; onlineContext = nil; onlineCheckedAt = .distantPast
            ReylumiBackgroundSync.shared.clear()
            onEvent?("reylumi:app-local-reset", metadata)
        }
        if staffFamily { await store.revoke(scope: nil, authority: "staff") }
        else if let scope { await store.revoke(scope: scope) }
    }
    private func send(path: String, query: [URLQueryItem] = [], body: [String: Any]? = nil, etag: String? = nil, epoch: Int) async throws -> (Data, HTTPURLResponse) {
        try ensureCurrent(epoch)
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        components.path = path; components.queryItems = query.isEmpty ? nil : query; components.fragment = nil
        guard let url = components.url, NavigationPolicy(origin: origin).isInternal(url), path.hasPrefix("/api/app-local/") else { throw failure(400, "Unsupported app request.") }
        let originalCookies = try await reconcileCookies(original: nil, updates: [], epoch: epoch); try ensureCurrent(epoch)
        let outgoingWorkspaceRevision = workspaceCookieRevision
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ReylumiIOS/1.0", forHTTPHeaderField: "User-Agent")
        request.setValue(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.setValue("1", forHTTPHeaderField: "X-Reylumi-App-Local")
        if let etag, etag.utf8.count <= 512, !etag.contains("\r"), !etag.contains("\n") { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let applicable = originalCookies.filter { cookie in
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return url.host?.lowercased() == domain.lowercased() && url.path.hasPrefix(cookie.path) && (!cookie.isSecure || url.scheme == "https") && (cookie.expiresDate ?? .distantFuture) > Date()
        }
        HTTPCookie.requestHeaderFields(with: applicable).forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        let timingCategory: ReylumiLocalDiagnostics.Category = path == "/api/app-local/context" ? .context : path == "/api/app-local/read" ? .read : .command
        let began = ProcessInfo.processInfo.systemUptime
        diagnostics.record(.httpStart, category: timingCategory, outcome: .started)
        let data: Data, response: HTTPURLResponse
        do {
            (data, response) = try await client.send(request)
            diagnostics.record(.httpEnd, category: timingCategory, status: response.statusCode, durationMs: (ProcessInfo.processInfo.systemUptime - began) * 1000)
            diagnostics.serverTiming(response.value(forHTTPHeaderField: "Server-Timing"), category: timingCategory)
        } catch {
            diagnostics.record(.httpFailure, category: timingCategory, outcome: Task.isCancelled ? .cancelled : .failed, status: (error as NSError).code, durationMs: (ProcessInfo.processInfo.systemUptime - began) * 1000)
            throw error
        }
        try ensureCurrent(epoch)
        guard response.url == url, data.count <= 4 * 1024 * 1024 else { throw failure(502, "Couldn't read this page. Please try again.") }
        let fields = response.allHeaderFields.reduce(into: [String: String]()) { result, entry in if let key = entry.key as? String, let value = entry.value as? String { result[key] = value } }
        let updates = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url).filter { $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == origin.host?.lowercased() }
        _ = try await reconcileCookies(original: originalCookies, updates: updates, epoch: epoch, workspaceRevision: outgoingWorkspaceRevision)
        try ensureCurrent(epoch)
        if response.statusCode == 401 { await reset(); throw failure(401, "Please reconnect and check your access.") }
        return (data, response)
    }
    private func decode(_ data: Data, response: HTTPURLResponse) throws -> [String: Any] {
        guard response.statusCode == 200, response.mimeType?.lowercased() == "application/json",
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw failure(response.statusCode, "Couldn't read this page. Please try again.") }
        return object
    }
    func freshContext(path: String) async throws -> [String: Any] {
        if let task = freshContextTask, freshContextPath == path {
            diagnostics.record(.contextJoin, category: ReylumiLocalDiagnostics.category(path: path), outcome: .joined)
            return try await task.value
        }
        diagnostics.record(.contextRequest, category: ReylumiLocalDiagnostics.category(path: path), outcome: .started)
        // One in-flight context is authoritative for the current route family.
        // A staff request must never receive an unrelated owner context result.
        freshContextTask?.cancel()
        let epoch = scopeEpoch, expectedGeneration = generation, requestID = UUID()
        freshContextID = requestID; freshContextPath = path
        let task = Task { @MainActor [weak self] () throws -> [String: Any] in
            guard let self else { throw CancellationError() }
            let (data, response) = try await self.send(path: "/api/app-local/context", query: [URLQueryItem(name: "path", value: path), URLQueryItem(name: "generation", value: expectedGeneration)], epoch: epoch)
            if [403, 409].contains(response.statusCode) {
                await self.revokeDisplay(scope: self.session?.scope, staffFamily: path.hasPrefix("/staff/") && path != "/staff/today")
                throw self.failure(response.statusCode, "Please reconnect and check your access.")
            }
            var object = try self.decode(data, response: response)
            guard object["schemaVersion"] as? Int == 1, let context = object["context"] as? [String: Any], let scope = context["scope"] as? String else { throw self.failure(502, "App access could not be checked.") }
            object["contextPath"] = path
            await self.loadSession(); try self.ensureCurrent(epoch)
            let next = ReylumiLocalSession.verified(object, generation: expectedGeneration)
            self.diagnostics.record(.contextEnvelope, category: ReylumiLocalDiagnostics.category(path: path), outcome: next == nil ? .missing : .available, status: object["grantStatus"] as? Int)
            let stored = await self.store.session(generation: expectedGeneration)
            try self.ensureCurrent(epoch)
            let previous = self.session ?? stored
            let viewer = context["viewerId"] as? String
            let viewerChanged = previous != nil && previous?.viewerId != viewer
            let priorPermissions = (previous?.object["context"] as? [String: Any])?["permissionRevision"] as? String
            // A temporary lease-service failure does not prove that an unchanged
            // viewer lost access. Keep the existing lease's ORIGINAL expiry and
            // freshness; commands still require a successful fresh context.
            if next == nil, object["grantStatus"] as? Int == 503,
               object["offlineState"] as? String != "unconfirmed",
               previous == nil || (!viewerChanged && previous?.scope == scope && priorPermissions == context["permissionRevision"] as? String) {
                throw self.failure(503, "Please reconnect to update this page.")
            }
            let priorAuthority: ReylumiLocalSession?
            if let next { priorAuthority = await self.store.session(generation: expectedGeneration, scope: scope, authority: next.authority) }
            else { priorAuthority = nil }
            try self.ensureCurrent(epoch)
            let authorityChanged = next != nil && priorAuthority != nil && next?.grantRevision != priorAuthority?.grantRevision
            let additive = previous != nil && next != nil && self.additiveAuthority(previous!, next!) && !authorityChanged
            if let previous, !additive && (viewerChanged || previous.scope != scope || next?.grantRevision != previous.grantRevision || previous.authority != next?.authority) || authorityChanged {
                self.diagnostics.record(.authorityRotate, category: .context, outcome: .invalidated)
                // Invalidate deliveries for the old visible authority, while
                // retaining other unexpired same-viewer display leases.
                self.scopeEpoch += 1; self.nonce = UUID().uuidString
                self.session = nil; self.onlineContext = nil
                self.onEvent?("reylumi:app-local-reset", self.metadata.merging(["reason": "context"]) { _, new in new })
            }
            let acceptedEpoch = self.scopeEpoch
            if viewerChanged { await self.store.clear(); ReylumiBackgroundSync.shared.clear() }
            try self.ensureCurrent(acceptedEpoch)
            self.session = next; self.onlineContext = object
            self.onlineCheckedAt = Date()
            if let next { await self.store.accept(next) }
            else if ([401, 403, 409].contains(object["grantStatus"] as? Int ?? 0) || object["offlineState"] as? String == "unconfirmed"), path.hasPrefix("/staff/"), path != "/staff/today" { await self.store.revoke(scope: nil, authority: "staff"); ReylumiBackgroundSync.shared.clear() }
            try self.ensureCurrent(acceptedEpoch)
            object["host"] = self.metadata; object["offline"] = false
            self.onEvent?("reylumi:app-local-context", object)
            // Delivery is not the React entry's admission decision. The
            // separate JS context.accept trace records that later boundary.
            self.diagnostics.record(.contextDelivered, category: ReylumiLocalDiagnostics.category(path: path))
            return object
        }
        freshContextTask = task
        defer { if freshContextID == requestID { freshContextTask = nil; freshContextID = nil; freshContextPath = nil } }
        do { return try await task.value }
        catch {
            diagnostics.record(.contextFailure, category: ReylumiLocalDiagnostics.category(path: path), outcome: Task.isCancelled || error is CancellationError ? .cancelled : .failed, status: (error as NSError).code)
            throw error
        }
    }
    func context(path: String) async throws -> [String: Any] {
        let epoch = scopeEpoch, expectedGeneration = generation
        let began = ProcessInfo.processInfo.systemUptime
        let cached = await store.session(generation: expectedGeneration, path: path)
        try ensureCurrent(epoch)
        diagnostics.record(cached == nil ? .contextCacheMiss : .contextCacheHit, category: ReylumiLocalDiagnostics.category(path: path), outcome: cached == nil ? .miss : .hit, durationMs: (ProcessInfo.processInfo.systemUptime - began) * 1000)
        if let cached {
            if let previous = session, previous.key != cached.key, !additiveAuthority(previous, cached) {
                diagnostics.record(.authorityRotate, category: .context, outcome: .invalidated)
                scopeEpoch += 1; nonce = UUID().uuidString; onlineContext = nil; onlineCheckedAt = .distantPast
                // This context read is delivering the selected cached lease.
                // Rotate old deliveries without cancelling its own admission.
                onEvent?("reylumi:app-local-reset", metadata.merging(["reason": "context"]) { _, new in new })
            }
            session = cached; loadedSession = true
            var object = cached.object
            object["host"] = metadata; object["offline"] = true; object["contextPath"] = path
            if path == "/pos/customer-display", cached.authority == "portable", cached.compatible(path: path) { object["displayAuthority"] = ["kind": "portable"] }
            Task { @MainActor [weak self] in _ = try? await self?.freshContext(path: path) }
            return object
        }
        return try await freshContext(path: path)
    }
    private func arguments(_ value: Any?, keys: [String]) throws -> [String: Any] {
        let args = value as? [String: Any] ?? [:]
        guard Set(args.keys).isSubset(of: Set(keys)), JSONSerialization.isValidJSONObject(args),
              (try JSONSerialization.data(withJSONObject: args)).count <= 256 * 1024 else { throw failure(400, "Unsupported app request.") }
        return args
    }
    private func cacheKey(name: String, args: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: args, options: [.sortedKeys])
        return name + ":" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    func cached(name: String, args: [String: Any], requestedScope: String? = nil) async throws -> [String: Any]? {
        guard let rule = manifest.reads.first(where: { $0.name == name }), rule.cacheable else { return nil }
        let args = try arguments(args, keys: rule.argumentKeys)
        let epoch = scopeEpoch
        guard let session = await readLease(name: name, scope: requestedScope ?? session?.scope, privateOnly: rule.access != "public"),
              let data = await store.get(try cacheKey(name: name, args: args), session: session),
              var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            diagnostics.record(.readCacheMiss, category: ReylumiLocalDiagnostics.category(resource: name), outcome: .miss)
            return nil
        }
        try ensureCurrent(epoch)
        guard object["scope"] as? String == session.scope else { return nil }
        diagnostics.record(.readCacheHit, category: ReylumiLocalDiagnostics.category(resource: name), outcome: .hit)
        object["offline"] = true; return object
    }
    func removeCached(name: String, args: [String: Any], requestedScope: String? = nil) async throws {
        guard let rule = manifest.reads.first(where: { $0.name == name }), rule.cacheable else { return }
        let args = try arguments(args, keys: rule.argumentKeys)
        if let session = await readLease(name: name, scope: requestedScope ?? session?.scope, privateOnly: rule.access != "public") { await store.remove(try cacheKey(name: name, args: args), session: session) }
    }
    func backgroundRegistration(_ args: [String: Any]) async throws -> ReylumiSyncRegistration {
        await loadSession()
        guard let scope = args["scope"] as? String, let key = args["key"] as? String, let endpoint = args["endpoint"] as? String,
              let expiry = args["expiresAt"] as? String, let requestedExpiry = ReylumiOfflineRoute.expiry(from: expiry),
              let session, session.scope == scope, session.valid(generation: generation), session.permitsPrivateReads,
              Date().timeIntervalSince(onlineCheckedAt) < 30,
              let value = try? JSONSerialization.jsonObject(with: session.envelope) as? [String: Any], let grant = value["grant"] as? [String: Any],
              grant["scope"] as? String == scope,
              let url = URL(string: endpoint, relativeTo: origin), let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let registration = ReylumiSyncRegistration(scope: scope, key: key, endpoint: endpoint, expiresAt: min(requestedExpiry, session.expiresAt), origin: origin) else { throw failure(403, "Background read is not available.") }
        if components.path == "/api/experience/my-work" {
            let staff = components.queryItems?.first(where: { $0.name == "staffId" })?.value
            guard grant["kind"] as? String == "staff", let binding = grant["staffBinding"] as? [String: Any], staff != nil, staff == binding["staffId"] as? String else { throw failure(403, "Background read is not available.") }
        } else { guard grant["kind"] as? String == "owner" else { throw failure(403, "Background read is not available.") } }
        return registration
    }
    func backgroundDrainAllowed(_ scope: String) -> Bool {
        guard let session, session.scope == scope, session.valid(generation: generation), session.permitsPrivateReads,
              Date().timeIntervalSince(onlineCheckedAt) < 30,
              let value = try? JSONSerialization.jsonObject(with: session.envelope) as? [String: Any], let grant = value["grant"] as? [String: Any],
              grant["scope"] as? String == scope else { return false }
        return ["owner", "staff"].contains(grant["kind"] as? String ?? "")
    }
    func read(name: String, args raw: [String: Any], etag: String?, requestedScope: String? = nil) async throws -> [String: Any] {
        guard let rule = manifest.reads.first(where: { $0.name == name }) else { throw failure(400, "Unsupported app request.") }
        let args = try arguments(raw, keys: rule.argumentKeys), key = try cacheKey(name: name, args: args), epoch = scopeEpoch
        let json = String(decoding: try JSONSerialization.data(withJSONObject: args, options: [.sortedKeys]), as: UTF8.self)
        guard json.utf8.count <= 32768 else { throw failure(400, "Unsupported page filters.") }
        do {
            var query = [URLQueryItem(name: "name", value: name), URLQueryItem(name: "args", value: json)]
            if let requestedScope { query.append(URLQueryItem(name: "scope", value: requestedScope)) }
            var candidate = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
            candidate.path = rule.path; candidate.queryItems = query
            let useBody = (candidate.url?.absoluteString.utf8.count ?? Int.max) > 1800
            // This POST is the same compile-pinned read, never a command or
            // outbox operation. Avoid truncating filters in a long GET URL.
            let body: [String: Any]? = useBody ? ["name": name, "args": args, "scope": requestedScope ?? ((onlineContext?["context"] as? [String: Any])?["scope"] as? String) ?? session?.scope ?? ""] : nil
            let (data, response) = try await send(path: rule.path, query: useBody ? [] : query, body: body, etag: etag, epoch: epoch)
            if response.statusCode == 404 {
                // A fresh missing/private relationship response revokes this
                // exact read only. Other drafts and scoped resources survive.
                try await removeCached(name: name, args: args, requestedScope: requestedScope)
                try ensureCurrent(epoch)
                throw failure(404, "This item is no longer available.")
            }
            if response.statusCode == 403 {
                // Staff reads depend on a revocable salon relationship. Keep
                // the existing family-wide revocation for an explicit denial.
                if name.hasPrefix("staff.") {
                    await revokeDisplay(scope: requestedScope ?? session?.scope, staffFamily: true)
                    throw failure(403, "Please reconnect and check your access.")
                }
                // This resource can be denied while the account and other
                // resources remain valid. Never keep the denied snapshot.
                try await removeCached(name: name, args: args, requestedScope: requestedScope)
                try ensureCurrent(epoch)
                throw failure(403, "This view is no longer available. Please check your access.")
            }
            if response.statusCode == 409 {
                await revokeDisplay(scope: requestedScope ?? session?.scope, staffFamily: name.hasPrefix("staff."))
                throw failure(response.statusCode, "Please reconnect and check your access.")
            }
            if response.statusCode == 304 {
                let scope = response.value(forHTTPHeaderField: "x-reylumi-scope") ?? requestedScope ?? session?.scope ?? ""
                guard requestedScope == nil || requestedScope == scope else { throw failure(409, "App access could not be checked.") }
                return ["status": 304, "schemaVersion": 1, "etag": response.value(forHTTPHeaderField: "ETag") ?? etag ?? "", "scope": scope, "updatedAt": Date().timeIntervalSince1970 * 1000]
            }
            var object = try decode(data, response: response)
            guard object["schemaVersion"] as? Int == 1, object["status"] as? Int == 200,
                  let scope = object["scope"] as? String, object["data"] != nil,
                  Self.validUpdatedAt(object["updatedAt"]), requestedScope == nil || requestedScope == scope else { throw failure(409, "App access could not be checked.") }
            if rule.access != "public" { try await awaitReadContext(scope: scope, epoch: epoch) }
            try ensureCurrent(epoch)
            if rule.cacheable, let lease = await readLease(name: name, scope: scope, privateOnly: rule.access != "public") { await store.put(key, payload: data, session: lease, resourceName: name) }
            try ensureCurrent(epoch); object["offline"] = false
            return object
        } catch {
            try ensureCurrent(epoch)
            if error is URLError, let cached = try await cached(name: name, args: args, requestedScope: requestedScope) { return cached }
            throw error
        }
    }
    private func awaitReadContext(scope: String, epoch: Int) async throws {
        if scope == ((onlineContext?["context"] as? [String: Any])?["scope"] as? String) { return }
        let began = ProcessInfo.processInfo.systemUptime
        diagnostics.record(.contextBarrierStart, category: .read, outcome: .started)
        // A cold cached lease is delivered before its background authorization
        // GET completes. The data GET can finish first; keep the original fresh
        // context barrier rather than treating that ordinary ordering as a 409.
        if let pending = freshContextTask {
            do { _ = try await pending.value }
            catch {
                diagnostics.record(.contextBarrierEnd, category: .read, outcome: .failed, status: (error as NSError).code, durationMs: (ProcessInfo.processInfo.systemUptime - began) * 1000)
                try ensureCurrent(epoch)
                if error is CancellationError { throw error }
                throw failure(503, "Please reconnect to update this page.")
            }
        }
        try ensureCurrent(epoch)
        guard scope == ((onlineContext?["context"] as? [String: Any])?["scope"] as? String) else {
            diagnostics.record(.contextBarrierEnd, category: .read, outcome: .failed, durationMs: (ProcessInfo.processInfo.systemUptime - began) * 1000)
            // A response for a page left behind must not clear a newer view.
            if onlineContext != nil { throw CancellationError() }
            throw failure(503, "Please reconnect to update this page.")
        }
        diagnostics.record(.contextBarrierEnd, category: .read, durationMs: (ProcessInfo.processInfo.systemUptime - began) * 1000)
    }
    private static func validUpdatedAt(_ value: Any?) -> Bool {
        if let milliseconds = value as? Double { return milliseconds.isFinite && milliseconds > 0 && milliseconds <= Date().timeIntervalSince1970 * 1000 + 60000 }
        if let stamp = value as? String, let date = ReylumiOfflineRoute.expiry(from: stamp) { return date <= Date().addingTimeInterval(60) }
        return false
    }
    func command(name: String, args raw: [String: Any], requestID: String, path: String, requestedScope: String? = nil) async throws -> [String: Any] {
        guard let rule = manifest.commands.first(where: { $0.name == name }), UUID(uuidString: requestID) != nil, !commandIDs.contains(requestID), commandIDs.count < 100 else { throw failure(400, "Unsupported app request.") }
        let args = try arguments(raw, keys: rule.argumentKeys)
        commandIDs.insert(requestID); defer { commandIDs.remove(requestID) }
        let expectedEpoch = scopeEpoch
        let context = try await freshContext(path: path)
        try ensureCurrent(expectedEpoch)
        guard let scope = (context["context"] as? [String: Any])?["scope"] as? String else { throw failure(403, "Please sign in to continue.") }
        guard requestedScope == nil || scope == requestedScope else { throw failure(409, "Your access has changed. Please try again.") }
        let epoch = scopeEpoch
        let (data, response) = try await send(path: rule.path, body: ["name": name, "args": args, "requestId": requestID, "scope": scope], epoch: epoch)
        if [403, 409].contains(response.statusCode) {
            await revokeDisplay(scope: scope, staffFamily: path.hasPrefix("/staff/") && path != "/staff/today")
            throw failure(response.statusCode, "Please reconnect and check your access.")
        }
        let result = try decode(data, response: response)
        try ensureCurrent(epoch)
        return result
    }
}
