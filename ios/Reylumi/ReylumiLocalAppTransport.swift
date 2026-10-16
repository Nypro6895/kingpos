import Foundation
import WebKit
import CryptoKit

protocol ReylumiLocalHTTPClient {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

private final class ReylumiLocalURLClient: NSObject, ReylumiLocalHTTPClient, URLSessionTaskDelegate {
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 12; configuration.timeoutIntervalForResource = 20
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (stream, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        var data = Data()
        for try await byte in stream {
            guard !Task.isCancelled, data.count < 4 * 1024 * 1024 else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        return (data, response)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    deinit { session.invalidateAndCancel() }
}

@MainActor
final class ReylumiLocalAppTransport {
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
    var onEvent: ((String, [String: Any]) -> Void)?

    init(origin: URL, manifest: ReylumiLocalBundle.Manifest, store: ReylumiLocalReadStore? = nil,
         client: ReylumiLocalHTTPClient? = nil, defaults: UserDefaults = .standard,
         cookies: (() async -> [HTTPCookie])? = nil, setCookie: ((HTTPCookie) async -> Void)? = nil) {
        self.origin = origin; self.manifest = manifest; self.store = store ?? ReylumiLocalReadStore(origin: origin)
        self.client = client ?? ReylumiLocalURLClient(); self.defaults = defaults
        self.generationKey = "reylumi.local-app.generation." + SHA256.hash(data: Data(origin.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
        self.generation = defaults.string(forKey: generationKey) ?? UUID().uuidString
        defaults.set(generation, forKey: generationKey)
        self.cookies = cookies ?? { await withCheckedContinuation { continuation in WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) } } }
        self.setCookie = setCookie ?? { cookie in await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie) { continuation.resume() } } }
    }
    var metadata: [String: Any] { ["version": 1, "nonce": nonce, "scopeEpoch": scopeEpoch, "generation": generation] }
    private func failure(_ status: Int, _ message: String) -> NSError { NSError(domain: "ReylumiLocalApp", code: status, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func cookieIdentity(_ values: [HTTPCookie]) -> [String] {
        values.filter { $0.name.hasPrefix("sb-") || $0.name.hasPrefix("reylumi") || $0.name.hasPrefix("kingpos") }.map { [$0.domain, $0.path, $0.name, $0.value].joined(separator: "\u{0}") }.sorted()
    }
    private func loadSession() async {
        guard !loadedSession else { return }; loadedSession = true
        let epoch = scopeEpoch, expectedGeneration = generation
        let cached = await store.session(generation: expectedGeneration)
        guard scopeEpoch == epoch, generation == expectedGeneration else { return }
        session = cached
    }
    func reset(rotateGeneration: Bool = true) async {
        scopeEpoch += 1; nonce = UUID().uuidString
        if rotateGeneration { generation = UUID().uuidString; defaults.set(generation, forKey: generationKey) }
        freshContextTask?.cancel(); freshContextTask = nil; freshContextID = nil; freshContextPath = nil
        session = nil; loadedSession = true; onlineContext = nil; onlineCheckedAt = .distantPast
        ReylumiBackgroundSync.shared.clear()
        onEvent?("reylumi:app-local-reset", metadata)
        await store.clear()
    }
    private func ensureCurrent(_ epoch: Int) throws { guard scopeEpoch == epoch, !Task.isCancelled else { throw failure(409, "Your access has changed. Please try again.") } }
    func matchesCachedScope(_ scope: String) async -> Bool { await store.session(generation: generation, scope: scope) != nil }
    func invalidatePage() { scopeEpoch += 1; nonce = UUID().uuidString; freshContextTask?.cancel(); freshContextTask = nil; freshContextID = nil; freshContextPath = nil }
    private func revokeDisplay(scope: String?, staffFamily: Bool = false) async {
        if (staffFamily && session?.authority == "staff") || (scope != nil && session?.scope == scope) {
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
        let originalCookies = await cookies(); try ensureCurrent(epoch)
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
        let (data, response) = try await client.send(request)
        try ensureCurrent(epoch)
        guard cookieIdentity(await cookies()) == cookieIdentity(originalCookies) else { await reset(); throw failure(409, "Your access has changed. Please try again.") }
        guard response.url == url, data.count <= 4 * 1024 * 1024 else { throw failure(502, "Couldn't read this page. Please try again.") }
        let fields = response.allHeaderFields.reduce(into: [String: String]()) { result, entry in if let key = entry.key as? String, let value = entry.value as? String { result[key] = value } }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: fields, for: url) where cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == origin.host?.lowercased() { await setCookie(cookie) }
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
        if let task = freshContextTask, freshContextPath == path { return try await task.value }
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
            await self.loadSession(); try self.ensureCurrent(epoch)
            let next = ReylumiLocalSession.verified(object, generation: expectedGeneration)
            let stored = await self.store.session(generation: expectedGeneration)
            try self.ensureCurrent(epoch)
            let previous = self.session ?? stored
            let viewer = context["viewerId"] as? String
            let viewerChanged = previous != nil && previous?.viewerId != viewer
            if let previous, viewerChanged || previous.scope != scope || next?.grantRevision != previous.grantRevision || previous.authority != next?.authority {
                // Invalidate deliveries for the old visible authority, while
                // retaining other unexpired same-viewer display leases.
                self.scopeEpoch += 1; self.nonce = UUID().uuidString
                self.session = nil; self.onlineContext = nil
                self.onEvent?("reylumi:app-local-reset", self.metadata)
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
            return object
        }
        freshContextTask = task
        defer { if freshContextID == requestID { freshContextTask = nil; freshContextID = nil; freshContextPath = nil } }
        return try await task.value
    }
    func context(path: String) async throws -> [String: Any] {
        let epoch = scopeEpoch, expectedGeneration = generation
        let cached = await store.session(generation: expectedGeneration, path: path)
        try ensureCurrent(epoch)
        if let cached {
            if let previous = session, previous.key != cached.key {
                scopeEpoch += 1; nonce = UUID().uuidString; onlineContext = nil; onlineCheckedAt = .distantPast
                onEvent?("reylumi:app-local-reset", metadata)
            }
            session = cached; loadedSession = true
            var object = cached.object
            object["host"] = metadata; object["offline"] = true
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
    private func cacheKey(name: String, args: [String: Any]) throws -> String { name + ":" + String(decoding: try JSONSerialization.data(withJSONObject: args, options: [.sortedKeys]), as: UTF8.self) }
    func cached(name: String, args: [String: Any], requestedScope: String? = nil) async throws -> [String: Any]? {
        guard let rule = manifest.reads.first(where: { $0.name == name }), rule.cacheable else { return nil }
        let args = try arguments(args, keys: rule.argumentKeys)
        let epoch = scopeEpoch
        guard let session = await store.session(generation: generation, scope: requestedScope ?? session?.scope, privateOnly: rule.access != "public"),
              let data = await store.get(try cacheKey(name: name, args: args), session: session),
              var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        try ensureCurrent(epoch)
        guard object["scope"] as? String == session.scope else { return nil }
        object["offline"] = true; return object
    }
    func removeCached(name: String, args: [String: Any], requestedScope: String? = nil) async throws {
        guard let rule = manifest.reads.first(where: { $0.name == name }), rule.cacheable else { return }
        let args = try arguments(args, keys: rule.argumentKeys)
        if let session = await store.session(generation: generation, scope: requestedScope ?? session?.scope) { await store.remove(try cacheKey(name: name, args: args), session: session) }
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
        do {
            var query = [URLQueryItem(name: "name", value: name), URLQueryItem(name: "args", value: json)]
            if let requestedScope { query.append(URLQueryItem(name: "scope", value: requestedScope)) }
            let (data, response) = try await send(path: rule.path, query: query, etag: etag, epoch: epoch)
            if [403, 409].contains(response.statusCode) {
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
                  Self.validUpdatedAt(object["updatedAt"]), requestedScope == nil || requestedScope == scope,
                  rule.access == "public" || scope == ((onlineContext?["context"] as? [String: Any])?["scope"] as? String) else { throw failure(409, "App access could not be checked.") }
            try ensureCurrent(epoch)
            if rule.cacheable, let lease = await store.session(generation: generation, scope: scope, privateOnly: rule.access != "public") { await store.put(key, payload: data, session: lease) }
            try ensureCurrent(epoch); object["offline"] = false
            return object
        } catch {
            try ensureCurrent(epoch)
            if error is URLError, let cached = try await cached(name: name, args: args, requestedScope: requestedScope) { return cached }
            throw error
        }
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
