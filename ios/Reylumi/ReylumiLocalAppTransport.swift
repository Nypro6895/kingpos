import Foundation
import CoreFoundation
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
    private var scopeConflictRevision = 0
    private var pendingScopeConflicts: [String: Int] = [:]
    private var commandIDs = Set<String>()
    private var workspaceCommandID: String?
    private struct CookieSnapshot {
        let values: [HTTPCookie]
        let revision: Int
    }
    private var cookieCommitTask: Task<CookieSnapshot, Error>?
    private var cookieCommitID: UUID?
    private var cookieAuthorityRevision = 0
    private var lastCommittedCookieIdentity: [String]?
    var onEvent: ((String, [String: Any]) -> Void)?

    init(origin: URL, manifest: ReylumiLocalBundle.Manifest, store: ReylumiLocalReadStore? = nil,
         client: ReylumiLocalHTTPClient? = nil, defaults: UserDefaults = .standard,
         cookies: (() async -> [HTTPCookie])? = nil, setCookie: ((HTTPCookie) async -> Void)? = nil,
         diagnostics: ReylumiLocalDiagnostics? = nil) {
        self.diagnostics = diagnostics ?? ReylumiLocalDiagnostics(enabled: true)
        self.origin = origin; self.manifest = manifest; self.store = store ?? ReylumiLocalReadStore(origin: origin)
        self.client = client ?? ReylumiLocalURLClient(); self.defaults = defaults
        self.generationKey = "reylumi.local-app.generation." + SHA256.hash(data: Data(origin.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
        self.generation = defaults.string(forKey: generationKey) ?? UUID().uuidString
        defaults.set(generation, forKey: generationKey)
        self.cookies = cookies ?? { await withCheckedContinuation { continuation in WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) } } }
        self.setCookie = setCookie ?? { cookie in
            await Self.applyResponseCookie(cookie, to: WKWebsiteDataStore.default().httpCookieStore)
        }
    }
    var metadata: [String: Any] { ["version": 1, "nonce": nonce, "scopeEpoch": scopeEpoch, "generation": generation] }
    private func failure(_ status: Int, _ message: String, reason: String? = nil) -> NSError {
        var detail: [String: Any] = [NSLocalizedDescriptionKey: message]
        if let reason { detail["reason"] = reason }
        return NSError(domain: "ReylumiLocalApp", code: status, userInfo: detail)
    }
    private static func cookieKey(_ cookie: HTTPCookie) -> String {
        [cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased(), cookie.path, cookie.name].joined(separator: "\u{0}")
    }
    @MainActor static func applyResponseCookie(_ cookie: HTTPCookie, to store: WKHTTPCookieStore) async {
        let existing: [HTTPCookie] = await withCheckedContinuation { continuation in
            store.getAllCookies { continuation.resume(returning: $0) }
        }
        // The expected response jar replaces this canonical key for every
        // update. WK can retain both host-only and parent-domain aliases, and
        // deleting a response cookie does not reliably delete stored aliases.
        for stored in existing where cookieKey(stored) == cookieKey(cookie) {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                store.delete(stored) { continuation.resume() }
            }
        }
        if !removesCookie(cookie) {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                store.setCookie(cookie) { continuation.resume() }
            }
        }
    }
    private func cookieIdentity(_ values: [HTTPCookie]) -> [String] {
        ReylumiCookieAuthority.identity(values, origin: origin)
    }
    private static func removesCookie(_ cookie: HTTPCookie) -> Bool {
        if let expiry = cookie.expiresDate, expiry <= Date() { return true }
        if let value = cookie.properties?[.maximumAge], let age = Double(String(describing: value)), age <= 0 { return true }
        return false
    }
    private func responseCookieSet(_ original: [HTTPCookie], updates: [HTTPCookie]) -> [HTTPCookie] {
        var candidate = original
        for cookie in updates {
            candidate.removeAll { Self.cookieKey($0) == Self.cookieKey(cookie) }
            if !Self.removesCookie(cookie) { candidate.append(cookie) }
        }
        return candidate
    }
    private func reconcileCookies(original: CookieSnapshot?, updates: [HTTPCookie], epoch: Int, responseDeniesDisplay: Bool = false) async throws -> CookieSnapshot {
        let previous = cookieCommitTask, id = UUID()
        cookieCommitID = id
        let task = Task { @MainActor [weak self] () throws -> CookieSnapshot in
            guard let self else { throw CancellationError() }
            // Only cookie delivery is serialized. Reads still run in parallel;
            // no observer sees half of another response's auth rotation.
            if let previous { _ = try? await previous.value }
            try self.ensureCurrent(epoch)
            let currentCookies = await self.cookies()
            try self.ensureCurrent(epoch)
            // Capture outgoing headers through the same short queue, so a new
            // request cannot start from half of a multi-cookie refresh.
            guard let original else {
                self.diagnostics.record(.cookieCapture, category: .context, operation: self.cookieAuthorityRevision)
                return CookieSnapshot(values: currentCookies, revision: self.cookieAuthorityRevision)
            }
            let expected = self.cookieIdentity(self.responseCookieSet(original.values, updates: updates))
            let current = self.cookieIdentity(currentCookies)
            guard current == self.cookieIdentity(original.values) || current == expected else {
                // The complete jar must still match our last internal commit.
                // An external workspace/token edit after that commit cannot
                // borrow its revision as proof of a harmless late response.
                let ownCookieCommit = original.revision < self.cookieAuthorityRevision && current == self.lastCommittedCookieIdentity
                if ownCookieCommit {
                    self.diagnostics.record(.cookieStale, category: .context, outcome: .cancelled, reason: .staleCookies, operation: original.revision)
                    // A genuine denied response retains its original handling.
                    // Never replay a command or allow stale cookies to replace
                    // the newer complete cookie transaction.
                    if responseDeniesDisplay {
                        return CookieSnapshot(values: currentCookies, revision: self.cookieAuthorityRevision)
                    }
                    throw CancellationError()
                }
                self.diagnostics.record(.cookieMismatch, category: .context, outcome: .invalidated, reason: .externalCookies, operation: original.revision)
                await self.reset(reason: .externalCookies); throw self.failure(409, "Your access has changed. Please try again.")
            }
            for cookie in updates { await self.setCookie(cookie); try self.ensureCurrent(epoch) }
            let committedCookies = await self.cookies(), committed = self.cookieIdentity(committedCookies)
            try self.ensureCurrent(epoch)
            guard committed == expected else {
                self.diagnostics.record(.cookieMismatch, category: .context, outcome: .invalidated, reason: .externalCookies, operation: original.revision)
                await self.reset(reason: .externalCookies); throw self.failure(409, "Your access has changed. Please try again.")
            }
            if committed != current {
                self.cookieAuthorityRevision += 1
                self.lastCommittedCookieIdentity = committed
                self.diagnostics.record(.cookieCommit, category: .context, outcome: .accepted, operation: self.cookieAuthorityRevision)
            }
            try self.ensureCurrent(epoch)
            return CookieSnapshot(values: committedCookies, revision: self.cookieAuthorityRevision)
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
    func reset(rotateGeneration: Bool = true, reason: ReylumiLocalDiagnostics.Reason = .explicitReset) async {
        diagnostics.record(.scopeReset, category: .cache, outcome: .invalidated, reason: reason)
        cookieAuthorityRevision += 1; lastCommittedCookieIdentity = nil
        scopeEpoch += 1; nonce = UUID().uuidString
        if rotateGeneration { generation = UUID().uuidString; defaults.set(generation, forKey: generationKey) }
        freshContextTask?.cancel(); freshContextTask = nil; freshContextID = nil; freshContextPath = nil
        pendingScopeConflicts.removeAll()
        session = nil; loadedSession = true; onlineContext = nil; onlineCheckedAt = .distantPast
        ReylumiBackgroundSync.shared.clear()
        var detail = metadata
        detail["reason"] = reason == .signOut ? "logout" : reason.rawValue
        if reason == .unauthenticated { detail["status"] = 401 }
        onEvent?("reylumi:app-local-reset", detail)
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
    private func onlineLease(scope: String) -> ReylumiLocalSession? {
        guard let value = onlineContext, value["offline"] as? Bool != true,
              ![401, 403, 409, 503].contains(value["grantStatus"] as? Int ?? 0),
              value["offlineState"] as? String != "unconfirmed",
              let lease = ReylumiLocalSession.verified(value, generation: generation), lease.scope == scope else { return nil }
        return lease
    }
    private static let staffOnlinePaths: Set<String> = ["/staff/my-work", "/staff/workday", "/staff/appointments"]
    private static let staffOnlineCommands: Set<String> = {
        let actions = [
            ("app/staff/workday/actions.ts", "checkInStaffWorkday"),
            ("app/staff/workday/actions.ts", "checkOutStaffWorkday"),
            ("app/staff/workday/actions.ts", "updateStaffWorkdayStatus"),
            ("app/staff/actions.ts", "updateOwnStaffPasscodeAction"),
            ("app/staff/actions.ts", "updateStaffPublicProfileAction"),
            ("app/staff/actions.ts", "getStaffProfileAvatarUploadSessionAction"),
            ("app/staff/appointments/staff-preferences-actions.ts", "staffBookingPreferencesAction"),
            ("app/service-relay/actions.ts", "loadServiceRelay"),
            ("app/service-relay/actions.ts", "respondServiceRelay"),
            ("app/service-relay/actions.ts", "saveServiceRelay"),
            ("app/service-relay/actions.ts", "findServiceRelay")
        ]
        let names = actions.map { module, name in
            "action." + String(SHA256.hash(data: Data((module + "#" + name).utf8)).map { String(format: "%02x", $0) }.joined().prefix(24))
        }
        return Set(names + ["http.staff.create-appointment", "http.staff.report-no-show", "http.staff.confirm-booking", "http.staff.booking-preferences"])
    }()
    // This proof is fresh HTTPS identity authority only. It cannot be decoded
    // as an offline grant, persisted, or used by another page/command family.
    private func verifiedStaffOnlineAccess(_ value: [String: Any], path: String, now: Date = Date()) -> Bool {
        func number(_ value: Any?) -> NSNumber? {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
            return number
        }
        func uuid(_ value: Any?) -> String? {
            guard let text = value as? String, text.utf8.count == 36, UUID(uuidString: text) != nil else { return nil }
            return text
        }
        func isTrue(_ value: Any?) -> Bool {
            guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return false }
            return number.boolValue
        }
        guard origin.scheme == "https", Self.staffOnlinePaths.contains(path),
              number(value["schemaVersion"])?.doubleValue == 1,
              value["offlineState"] as? String == "online-only", value["offline"] as? Bool != true,
              number(value["grantStatus"])?.doubleValue == 503, value["grant"] is NSNull,
              let context = value["context"] as? [String: Any], isTrue(context["authenticated"]),
              let viewer = uuid(context["viewerId"]), let salon = uuid(context["salonId"]),
              let workspace = context["workspaceId"] as? String, !workspace.isEmpty,
              let revision = context["permissionRevision"] as? String, !revision.isEmpty,
              let scope = context["scope"] as? String, scope.range(of: "^v3:[a-f0-9]{64}$", options: .regularExpression) != nil,
              let access = value["access"] as? [String: Any], isTrue(access["staffWorkspace"]),
              let proof = value["staffOnlineAccess"] as? [String: Any], number(proof["version"])?.doubleValue == 1,
              uuid(proof["staffId"]) != nil, uuid(proof["viewerId"]) == viewer, uuid(proof["salonId"]) == salon,
              proof["scope"] as? String == scope, let stamp = number(value["onlineValidatedAt"])?.doubleValue,
              stamp.isFinite, stamp > now.timeIntervalSince1970 * 1000 - 30_000, stamp <= now.timeIntervalSince1970 * 1000 + 60_000,
              ReylumiLocalReadStore.isSafeJSON(value) else { return false }
        return true
    }
    private func requireCommandGrant(_ value: [String: Any], name: String? = nil, path: String? = nil) throws {
        if let name, let path, Self.staffOnlineCommands.contains(name), verifiedStaffOnlineAccess(value, path: path) { return }
        let status = value["grantStatus"] as? Int ?? 0
        if [401, 403, 409, 503].contains(status) { throw failure(status, "Please reconnect and check your access.") }
        guard value["offline"] as? Bool != true, value["offlineState"] as? String != "unconfirmed",
              ReylumiLocalSession.verified(value, generation: generation) != nil else { throw failure(403, "Please reconnect and check your access.") }
    }
    private func ensureCurrent(_ epoch: Int) throws {
        // Leaving a page cancels a read; it does not revoke the account.
        try Task.checkCancellation()
        guard scopeEpoch == epoch else { throw CancellationError() }
    }
    func matchesCachedScope(_ scope: String) async -> Bool { await store.session(generation: generation, scope: scope) != nil }
    private func matchesStaffOnlineScope(_ scope: String) -> Bool {
        guard let value = onlineContext, let path = value["contextPath"] as? String,
              (value["context"] as? [String: Any])?["scope"] as? String == scope else { return false }
        return verifiedStaffOnlineAccess(value, path: path)
    }
    func matchesCacheRemovalScope(_ scope: String) async -> Bool {
        if await matchesCachedScope(scope) { return true }
        return matchesStaffOnlineScope(scope)
    }
    func invalidatePage() { diagnostics.record(.pageInvalidate, category: .context, outcome: .invalidated); scopeEpoch += 1; nonce = UUID().uuidString; freshContextTask?.cancel(); freshContextTask = nil; freshContextID = nil; freshContextPath = nil }
    private func revokeDisplay(scope: String?, staffFamily: Bool = false, status: Int = 403) async {
        let onlineScope = (onlineContext?["context"] as? [String: Any])?["scope"] as? String
        let reason: ReylumiLocalDiagnostics.Reason = status == 409 ? .workspaceChanged : .displayDenied
        if (staffFamily && session?.authority == "staff") || (scope != nil && (session?.scope == scope || onlineScope == scope)) {
            diagnostics.record(.displayRevoke, category: .context, outcome: .invalidated, status: status, reason: reason)
            scopeEpoch += 1; nonce = UUID().uuidString; session = nil; onlineContext = nil; onlineCheckedAt = .distantPast
            ReylumiBackgroundSync.shared.clear()
            onEvent?("reylumi:app-local-reset", metadata.merging(["reason": reason.rawValue, "status": status]) { _, new in new })
        }
        if staffFamily { await store.revoke(scope: nil, authority: "staff") }
        else if let scope { await store.revoke(scope: scope) }
    }
    private func withdrawConflictingScope(_ scope: String?, epoch: Int) async throws {
        try ensureCurrent(epoch)
        guard let scope else { return }
        scopeConflictRevision += 1
        if freshContextID != nil { pendingScopeConflicts[scope] = scopeConflictRevision }
        // A read used an obsolete fingerprint. Withdraw that display/cache, but
        // keep the in-flight current-route authority check alive. Rotating its
        // epoch here would turn the following valid context response into a
        // second, locally invented workspace denial.
        if session?.scope == scope { session = nil }
        if ((onlineContext?["context"] as? [String: Any])?["scope"] as? String) == scope {
            onlineContext = nil; onlineCheckedAt = .distantPast
        }
        await store.revoke(scope: scope)
        try ensureCurrent(epoch)
        diagnostics.record(.displayRevoke, category: .context, outcome: .invalidated, status: 409, reason: .scopeConflict)
        onEvent?("reylumi:app-local-scope-conflict", metadata.merging(["scope": scope, "status": 409, "reason": "stale-scope"]) { _, new in new })
    }
    private func send(path: String, query: [URLQueryItem] = [], body: [String: Any]? = nil, etag: String? = nil, epoch: Int, trace: ReylumiLocalDiagnostics.RequestTrace? = nil) async throws -> (Data, HTTPURLResponse) {
        try ensureCurrent(epoch)
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        components.path = path; components.queryItems = query.isEmpty ? nil : query; components.fragment = nil
        guard let url = components.url, NavigationPolicy(origin: origin).isInternal(url), path.hasPrefix("/api/app-local/") else { throw failure(400, "Unsupported app request.") }
        let snapshot = try await reconcileCookies(original: nil, updates: [], epoch: epoch); try ensureCurrent(epoch)
        let originalCookies = snapshot.values
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // Protocol negotiation only; the server still proves the current
        // Staff identity. Older binaries keep the explicit unconfirmed result.
        if path == "/api/app-local/context" { request.setValue("1", forHTTPHeaderField: "X-Reylumi-Staff-Online-Access") }
        request.setValue("ReylumiIOS/1.0", forHTTPHeaderField: "User-Agent")
        request.setValue(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.setValue("1", forHTTPHeaderField: "X-Reylumi-App-Local")
        if let trace { request.setValue(trace.requestId, forHTTPHeaderField: "X-Reylumi-Request-Id") }
        if let etag, etag.utf8.count <= 512, !etag.contains("\r"), !etag.contains("\n") { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let applicable = originalCookies.filter { cookie in
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return url.host?.lowercased() == domain.lowercased() && url.path.hasPrefix(cookie.path) && (!cookie.isSecure || url.scheme == "https") && (cookie.expiresDate ?? .distantFuture) > Date()
        }
        HTTPCookie.requestHeaderFields(with: applicable).forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        let timingCategory: ReylumiLocalDiagnostics.Category = path == "/api/app-local/context" ? .context : path == "/api/app-local/read" ? .read : .command
        let began = ProcessInfo.processInfo.systemUptime
        diagnostics.record(.httpStart, category: timingCategory, outcome: .started, trace: trace)
        let data: Data, response: HTTPURLResponse
        do {
            (data, response) = try await client.send(request)
            let matchesTrace = trace?.acceptsResponse(response) ?? true
            let trustedMetadata = response.url == url && matchesTrace
            let metadataTrace = matchesTrace ? trace : nil
            let failureCode = trustedMetadata && (400...599).contains(response.statusCode) ? response.value(forHTTPHeaderField: "X-Reylumi-Failure-Code").flatMap(ReylumiLocalDiagnostics.FailureCode.init(rawValue:)) : nil
            diagnostics.record(.httpEnd, category: timingCategory, status: response.statusCode, durationMs: (ProcessInfo.processInfo.systemUptime - began) * 1000, trace: trace, failureCode: failureCode)
            // Preserve fixed numeric legacy read timings from this exact HTTP
            // response, but never correlate a missing/mismatched echo. Command
            // metadata/failure codes retain their existing stricter trust gate.
            if response.url == url && (matchesTrace || trace?.readKind != nil) {
                diagnostics.serverTiming(response.value(forHTTPHeaderField: "Server-Timing"), category: timingCategory, trace: metadataTrace)
            }
        } catch {
            diagnostics.record(.httpFailure, category: timingCategory, outcome: Task.isCancelled ? .cancelled : .failed, status: (error as NSError).code, durationMs: (ProcessInfo.processInfo.systemUptime - began) * 1000, trace: trace)
            throw error
        }
        try ensureCurrent(epoch)
        guard response.url == url, data.count <= 4 * 1024 * 1024 else { throw failure(502, "Couldn't read this page. Please try again.") }
        let fields = response.allHeaderFields.reduce(into: [String: String]()) { result, entry in if let key = entry.key as? String, let value = entry.value as? String { result[key] = value } }
        let updates = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url).filter { $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == origin.host?.lowercased() }
        // A context denial is often an HTTP200 envelope. Preserve only that
        // validated denial through the stale-cookie path; no stale cookies or
        // successful context authority are installed by this classification.
        let deniesDisplay = [401, 403, 409].contains(response.statusCode)
            || contextDeniesDisplay(data, response: response, path: path)
        _ = try await reconcileCookies(original: snapshot, updates: updates, epoch: epoch, responseDeniesDisplay: deniesDisplay)
        try ensureCurrent(epoch)
        if response.statusCode == 401 { await reset(reason: .unauthenticated); throw failure(401, "Please reconnect and check your access.") }
        return (data, response)
    }
    private func contextDeniesDisplay(_ data: Data, response: HTTPURLResponse, path: String) -> Bool {
        guard path == "/api/app-local/context", response.statusCode == 200,
              response.mimeType?.lowercased() == "application/json",
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["schemaVersion"] as? Int == 1, object["grant"] is NSNull,
              let context = object["context"] as? [String: Any],
              let scope = context["scope"] as? String,
              scope.range(of: "^v3:[a-f0-9]{64}$", options: .regularExpression) != nil,
              context["authenticated"] is Bool, context["permissionRevision"] is String,
              ReylumiLocalReadStore.isSafeJSON(object) else { return false }
        return [401, 403, 409].contains(object["grantStatus"] as? Int ?? 0)
            || object["offlineState"] as? String == "unconfirmed"
    }
    private func ensureContextCurrent(epoch: Int, scope: String, conflictRevision: Int) throws {
        try ensureCurrent(epoch)
        guard (pendingScopeConflicts[scope] ?? 0) <= conflictRevision else { throw CancellationError() }
    }
    private func decode(_ data: Data, response: HTTPURLResponse) throws -> [String: Any] {
        guard response.statusCode == 200, response.mimeType?.lowercased() == "application/json",
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw failure(response.statusCode, "Couldn't read this page. Please try again.") }
        return object
    }
    func freshContext(path: String) async throws -> [String: Any] {
        if let task = freshContextTask, freshContextPath == path {
            diagnostics.record(.contextJoin, category: ReylumiLocalDiagnostics.category(path: path), outcome: .joined)
            var joined = try await task.value
            if var metadata = joined["__reylumiReadTrace"] as? [String: Any] { metadata["source"] = "joined"; joined["__reylumiReadTrace"] = metadata }
            return joined
        }
        diagnostics.record(.contextRequest, category: ReylumiLocalDiagnostics.category(path: path), outcome: .started)
        // One in-flight context is authoritative for the current route family.
        // A staff request must never receive an unrelated owner context result.
        freshContextTask?.cancel()
        let epoch = scopeEpoch, expectedGeneration = generation, requestID = UUID(), conflictRevision = scopeConflictRevision
        let trace = ReylumiLocalDiagnostics.RequestTrace(read: .context)
        freshContextID = requestID; freshContextPath = path
        let task = Task { @MainActor [weak self] () throws -> [String: Any] in
            guard let self else { throw CancellationError() }
            // Every joiner observes task completion independently. Release this
            // flight before its value/error becomes observable, so an immediate
            // retry cannot join the completed cancelled task. An older flight
            // must never clear the replacement flight's metadata.
            defer {
                if self.freshContextID == requestID {
                    self.freshContextTask = nil; self.freshContextID = nil; self.freshContextPath = nil
                    self.pendingScopeConflicts.removeAll()
                }
            }
            let (data, response) = try await self.send(path: "/api/app-local/context", query: [URLQueryItem(name: "path", value: path), URLQueryItem(name: "generation", value: expectedGeneration)], epoch: epoch, trace: trace)
            let trustedTrace = trace.acceptsResponse(response) ? trace : nil
            if [403, 409].contains(response.statusCode) {
                let visibleScope = self.session?.scope ?? ((self.onlineContext?["context"] as? [String: Any])?["scope"] as? String)
                await self.revokeDisplay(scope: visibleScope, staffFamily: path.hasPrefix("/staff/") && path != "/staff/today", status: response.statusCode)
                throw self.failure(response.statusCode, "Please reconnect and check your access.")
            }
            var object = try self.decode(data, response: response)
            guard object["schemaVersion"] as? Int == 1, let context = object["context"] as? [String: Any], let scope = context["scope"] as? String else { throw self.failure(502, "App access could not be checked.") }
            // This flight can outlive a read's discovery that its exact scope
            // was obsolete. Its pre-conflict snapshot cannot reauthorize that
            // scope; only a GET started after withdrawal can do so. A different
            // current scope remains eligible for normal authority validation.
            try self.ensureContextCurrent(epoch: epoch, scope: scope, conflictRevision: conflictRevision)
            object["contextPath"] = path
            await self.loadSession(); try self.ensureContextCurrent(epoch: epoch, scope: scope, conflictRevision: conflictRevision)
            let explicitStaffOnline = object["offlineState"] as? String == "online-only"
            let staffOnline = explicitStaffOnline && self.verifiedStaffOnlineAccess(object, path: path)
            let denied = [401, 403, 409].contains(object["grantStatus"] as? Int ?? 0) || object["offlineState"] as? String == "unconfirmed" || explicitStaffOnline && !staffOnline
            let next = denied ? nil : ReylumiLocalSession.verified(object, generation: expectedGeneration)
            self.diagnostics.record(.contextEnvelope, category: ReylumiLocalDiagnostics.category(path: path), outcome: next == nil ? .missing : .available, status: object["grantStatus"] as? Int, trace: trustedTrace)
            let stored = await self.store.session(generation: expectedGeneration)
            try self.ensureContextCurrent(epoch: epoch, scope: scope, conflictRevision: conflictRevision)
            let previous = self.session ?? stored
            // Compare a fresh display envelope with the currently selected
            // online authority, not an unrelated retained offline lease. An
            // identical periodic Staff check must not invalidate a pending
            // workspace preflight merely because Staff has no offline grant.
            let reference = (self.onlineContext?["context"] as? [String: Any]) ?? (previous?.object["context"] as? [String: Any])
            let viewer = context["viewerId"] as? String
            let viewerChanged = reference != nil && reference?["viewerId"] as? String != viewer
            let unchanged = reference != nil && !viewerChanged && reference?["scope"] as? String == scope
                && reference?["permissionRevision"] as? String == context["permissionRevision"] as? String
            // Fresh HTTPS Auth and the offline display lease are separate. This
            // envelope can authorize online presentation through the JS page
            // guard, but never creates/extends a native lease or command grant.
            let onlineOnly = !denied && next == nil && object["grantStatus"] as? Int == 503 && object["grant"] is NSNull
                && scope.range(of: "^v3:[a-f0-9]{64}$", options: .regularExpression) != nil
                && context["authenticated"] is Bool && context["permissionRevision"] is String
                && Self.validUpdatedAt(object["onlineValidatedAt"]) && ReylumiLocalReadStore.isSafeJSON(object)
            guard next != nil || onlineOnly || denied else { throw self.failure(502, "App access could not be checked.") }
            if onlineOnly { self.diagnostics.record(.contextEnvelope, category: .context, outcome: .available, status: 503, reason: .leaseUnavailable, trace: trustedTrace) }
            let priorAuthority: ReylumiLocalSession?
            if let next { priorAuthority = await self.store.session(generation: expectedGeneration, scope: scope, authority: next.authority) }
            else { priorAuthority = nil }
            try self.ensureContextCurrent(epoch: epoch, scope: scope, conflictRevision: conflictRevision)
            let authorityChanged = next != nil && priorAuthority != nil && next?.grantRevision != priorAuthority?.grantRevision
            let additive = previous != nil && next != nil && self.additiveAuthority(previous!, next!) && !authorityChanged
            let leaseChanged = previous != nil && !additive && (viewerChanged || previous?.scope != scope || next?.grantRevision != previous?.grantRevision || previous?.authority != next?.authority)
            // Withdrawing an established online identity must also invalidate
            // gestures already awaiting neutral preflight, even with no lease.
            let rotate = denied && reference != nil || explicitStaffOnline && !staffOnline || authorityChanged || (onlineOnly ? reference != nil && !unchanged : leaseChanged || previous == nil && reference != nil && !unchanged)
            if rotate {
                self.diagnostics.record(.authorityRotate, category: .context, outcome: .invalidated, reason: .contextChanged)
                // Invalidate deliveries for the old visible authority, while
                // retaining other unexpired same-viewer display leases.
                self.scopeEpoch += 1; self.nonce = UUID().uuidString
                self.session = nil; self.onlineContext = nil
                self.onEvent?("reylumi:app-local-reset", self.metadata.merging(["reason": "context"]) { _, new in new })
            }
            let acceptedEpoch = self.scopeEpoch
            if viewerChanged { await self.store.clear(); ReylumiBackgroundSync.shared.clear() }
            try self.ensureContextCurrent(epoch: acceptedEpoch, scope: scope, conflictRevision: conflictRevision)
            if explicitStaffOnline {
                // Missing offline approval is never a temporary lease outage.
                // Remove all prior Staff bindings even for an unchanged scope.
                await self.store.revoke(scope: nil, authority: "staff")
                ReylumiBackgroundSync.shared.clear()
            }
            try self.ensureContextCurrent(epoch: acceptedEpoch, scope: scope, conflictRevision: conflictRevision)
            // Online equality does not authorize borrowing a different stored
            // lease. A temporary lease outage may retain only that lease's own
            // unchanged identity, route family, generation and expiry.
            let previousContext = previous?.object["context"] as? [String: Any]
            let previousUnchanged = previousContext != nil
                && previousContext?["viewerId"] as? String == viewer && previous?.scope == scope
                && previousContext?["permissionRevision"] as? String == context["permissionRevision"] as? String
                && previousContext?["workspaceId"] as? String == context["workspaceId"] as? String
                && previousContext?["salonId"] as? String == context["salonId"] as? String
            self.session = next ?? (onlineOnly && !explicitStaffOnline && previousUnchanged
                && previous?.compatible(path: path) == true && previous?.valid(generation: expectedGeneration) == true ? previous : nil)
            self.onlineContext = denied ? nil : object
            self.onlineCheckedAt = denied ? .distantPast : Date()
            if let next { await self.store.accept(next) }
            else if denied {
                let status = object["grantStatus"] as? Int ?? 403
                self.diagnostics.record(.displayRevoke, category: .context, outcome: .invalidated, status: status, reason: status == 409 ? .workspaceChanged : .displayDenied)
                if path.hasPrefix("/staff/"), path != "/staff/today" { await self.store.revoke(scope: nil, authority: "staff") }
                else { await self.store.revoke(scope: scope) }
                ReylumiBackgroundSync.shared.clear()
            }
            // Mirror store.accept's authority replacement without fabricating
            // a lease when a changed same-workspace context has no display grant.
            if next == nil, !unchanged, let reference, let oldScope = reference["scope"] as? String,
               reference["workspaceId"] as? String == context["workspaceId"] as? String,
               reference["salonId"] as? String == context["salonId"] as? String {
                await self.store.revoke(scope: oldScope)
            }
            try self.ensureContextCurrent(epoch: acceptedEpoch, scope: scope, conflictRevision: conflictRevision)
            object["host"] = self.metadata; object["offline"] = false
            // Never store diagnostic IDs in a lease or use them for authority.
            // onlineContext/store.accept above retain the original envelope.
            object["__reylumiReadTrace"] = trace.bridgeMetadata(response: response)
            self.onEvent?("reylumi:app-local-context", object)
            // Delivery is not the React entry's admission decision. The
            // separate JS context.accept trace records that later boundary.
            self.diagnostics.record(.contextDelivered, category: ReylumiLocalDiagnostics.category(path: path), trace: trustedTrace)
            return object
        }
        freshContextTask = task
        do { return try await task.value }
        catch {
            diagnostics.record(.contextFailure, category: ReylumiLocalDiagnostics.category(path: path), outcome: Task.isCancelled || error is CancellationError ? .cancelled : .failed, status: (error as NSError).code)
            throw error
        }
    }
    private func selectedBusinessCacheIdentity(path: String) -> [String]? {
        let object: [String: Any]
        // An online-only Staff selection intentionally has no native lease.
        // It must still fence unrelated retained Owner/Personal cache entries.
        if let onlineContext { object = onlineContext }
        else if let session, session.valid(generation: generation) { object = session.object }
        else { return nil }
        guard let context = object["context"] as? [String: Any],
              context["authenticated"] as? Bool == true,
              let scope = context["scope"] as? String,
              let viewer = context["viewerId"] as? String, !viewer.isEmpty else { return nil }
        let access = object["access"] as? [String: Any]
        if let selected = ReylumiLocalSession.verified(object, generation: generation) {
            guard selected.compatible(path: path) else { return nil }
        } else {
            // Preserve the existing generic display-lease outage only when its
            // known current identity/capability still matches a valid lease.
            // Explicit online-only Staff authority never borrows an Owner or
            // customer display lease, even for an identical synthetic scope.
            guard object["offlineState"] as? String != "online-only",
                  object["offlineState"] as? String != "unconfirmed",
                  object["grantStatus"] as? Int == 503, object["grant"] is NSNull,
                  let session, session.valid(generation: generation), session.compatible(path: path),
                  session.scope == scope,
                  let previous = session.object["context"] as? [String: Any],
                  previous["viewerId"] as? String == viewer,
                  previous["workspaceId"] as? String == context["workspaceId"] as? String,
                  previous["salonId"] as? String == context["salonId"] as? String,
                  previous["permissionRevision"] as? String == context["permissionRevision"] as? String,
                  (ReylumiLocalSession.businessAuthority(path: path) == "owner"
                    ? access?["ownerWorkspace"] as? Bool == true
                    : access?["ownerWorkspace"] as? Bool == true || access?["staffWorkspace"] as? Bool == true) else { return nil }
        }
        return [scope, viewer, context["workspaceId"] as? String ?? "", context["salonId"] as? String ?? "",
                context["permissionRevision"] as? String ?? "", (object["grant"] as? [String: Any])?["kind"] as? String ?? "",
                (object["grant"] as? [String: Any])?["grantRevision"] as? String ?? "",
                String(access?["ownerWorkspace"] as? Bool ?? false), String(access?["staffWorkspace"] as? Bool ?? false),
                object["offlineState"] as? String ?? "", String(object["grantStatus"] as? Int ?? 0)]
    }
    func context(path: String) async throws -> [String: Any] {
        let epoch = scopeEpoch, expectedGeneration = generation
        let began = ProcessInfo.processInfo.systemUptime
        let business = ReylumiLocalSession.businessAuthority(path: path) != nil
        let selected = business ? selectedBusinessCacheIdentity(path: path) : nil
        var cached: ReylumiLocalSession?
        if !business || selected != nil {
            cached = await store.session(generation: expectedGeneration, scope: selected?.first, path: path)
        }
        try ensureCurrent(epoch)
        guard generation == expectedGeneration else { throw CancellationError() }
        // The actor lookup can interleave a same-epoch additive authority or an
        // online-only selection. Recheck the full selected identity before a
        // cached DTO can become visible. Unknown/private cold routes use HTTPS;
        // the neutral '/' route still restores the account's own cached home.
        if business && selected != selectedBusinessCacheIdentity(path: path) { cached = nil }
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
            object["__reylumiReadTrace"] = ["version": 1, "kind": "context", "source": "cache"]
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
        let args = try arguments(args, keys: rule.argumentKeys), key = try cacheKey(name: name, args: args)
        let scope = requestedScope ?? session?.scope
        // Withdraw in-flight deliveries before yielding for lease lookup. The
        // store repeats this fence atomically with deletion, so a late put can
        // neither repopulate the durable key nor become an offline fallback.
        await store.invalidatePendingReads(key, scope: scope)
        if let scope, onlineContext?["offlineState"] as? String == "online-only",
           (onlineContext?["context"] as? [String: Any])?["scope"] as? String == scope {
            // Eviction needs no display lease. This exact fresh Staff proof
            // permits only deletion of this key's stored scope/generation.
            guard matchesStaffOnlineScope(scope) else { throw failure(503, "Please reconnect to update this page.") }
            await store.remove(key, generation: generation, scope: scope)
        } else if let session = await readLease(name: name, scope: scope, privateOnly: rule.access != "public") { await store.remove(key, session: session) }
    }
    private func withResourceReadPermit<T>(key: String, scope: String?, operation: @MainActor (ReylumiLocalReadStore.ReadPermit) async throws -> T) async throws -> T {
        let permit = await store.beginRead(key, scope: scope)
        do {
            let value = try await operation(permit)
            await store.finishRead(permit)
            return value
        } catch {
            await store.finishRead(permit)
            throw error
        }
    }
    private func ensureResourceReadCurrent(_ permit: ReylumiLocalReadStore.ReadPermit, key: String, scope: String?, epoch: Int) async throws {
        try ensureCurrent(epoch)
        guard await store.permitsRead(permit, key: key, scope: scope) else { throw CancellationError() }
        try ensureCurrent(epoch)
    }
    func backgroundRegistration(_ args: [String: Any]) async throws -> ReylumiSyncRegistration {
        await loadSession()
        guard let scope = args["scope"] as? String, let key = args["key"] as? String, let endpoint = args["endpoint"] as? String,
              let expiry = args["expiresAt"] as? String, let requestedExpiry = ReylumiOfflineRoute.expiry(from: expiry),
              let session, session.scope == scope, session.valid(generation: generation), session.permitsPrivateReads,
              onlineLease(scope: scope) != nil,
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
              onlineLease(scope: scope) != nil,
              Date().timeIntervalSince(onlineCheckedAt) < 30,
              let value = try? JSONSerialization.jsonObject(with: session.envelope) as? [String: Any], let grant = value["grant"] as? [String: Any],
              grant["scope"] as? String == scope else { return false }
        return ["owner", "staff"].contains(grant["kind"] as? String ?? "")
    }
    func read(name: String, args raw: [String: Any], etag: String?, requestedScope: String? = nil) async throws -> [String: Any] {
        guard let rule = manifest.reads.first(where: { $0.name == name }) else { throw failure(400, "Unsupported app request.") }
        let args = try arguments(raw, keys: rule.argumentKeys), key = try cacheKey(name: name, args: args), epoch = scopeEpoch
        let trace = ReylumiLocalDiagnostics.RequestTrace(read: .read)
        let json = String(decoding: try JSONSerialization.data(withJSONObject: args, options: [.sortedKeys]), as: UTF8.self)
        guard json.utf8.count <= 32768 else { throw failure(400, "Unsupported page filters.") }
        return try await withResourceReadPermit(key: key, scope: requestedScope ?? session?.scope) { permit in
        do {
            var query = [URLQueryItem(name: "name", value: name), URLQueryItem(name: "args", value: json)]
            if let requestedScope { query.append(URLQueryItem(name: "scope", value: requestedScope)) }
            var candidate = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
            candidate.path = rule.path; candidate.queryItems = query
            let useBody = name == "http.shell.campaigns" || (candidate.url?.absoluteString.utf8.count ?? Int.max) > 1800
            // This POST is the same compile-pinned read, never a command or
            // outbox operation. Avoid truncating filters in a long GET URL.
            let body: [String: Any]? = useBody ? ["name": name, "args": args, "scope": requestedScope ?? ((onlineContext?["context"] as? [String: Any])?["scope"] as? String) ?? session?.scope ?? ""] : nil
            let (data, response) = try await send(path: rule.path, query: useBody ? [] : query, body: body, etag: etag, epoch: epoch, trace: trace)
            let trustedTrace = trace.acceptsResponse(response) ? trace : nil
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
                try await withdrawConflictingScope(requestedScope ?? session?.scope, epoch: epoch)
                throw failure(409, "Your workspace needs to be checked again.", reason: "stale-scope")
            }
            if response.statusCode == 304 {
                let scope = response.value(forHTTPHeaderField: "x-reylumi-scope") ?? requestedScope ?? session?.scope ?? ""
                guard requestedScope == nil || requestedScope == scope else { throw failure(409, "App access could not be checked.") }
                try await ensureResourceReadCurrent(permit, key: key, scope: scope, epoch: epoch)
                diagnostics.record(.readDelivered, category: ReylumiLocalDiagnostics.category(resource: name), status: 304, trace: trustedTrace)
                return ["status": 304, "schemaVersion": 1, "etag": response.value(forHTTPHeaderField: "ETag") ?? etag ?? "", "scope": scope, "updatedAt": Date().timeIntervalSince1970 * 1000, "__reylumiReadTrace": trace.bridgeMetadata(response: response)]
            }
            var object = try decode(data, response: response)
            guard object["schemaVersion"] as? Int == 1, object["status"] as? Int == 200,
                  let scope = object["scope"] as? String, object["data"] != nil,
                  Self.validUpdatedAt(object["updatedAt"]), requestedScope == nil || requestedScope == scope else { throw failure(409, "App access could not be checked.") }
            if rule.access != "public" { try await awaitReadContext(scope: scope, epoch: epoch) }
            try await ensureResourceReadCurrent(permit, key: key, scope: scope, epoch: epoch)
            if rule.cacheable, onlineLease(scope: scope) != nil, let lease = await readLease(name: name, scope: scope, privateOnly: rule.access != "public") {
                try await ensureResourceReadCurrent(permit, key: key, scope: scope, epoch: epoch)
                await store.put(key, payload: data, session: lease, resourceName: name, permit: permit)
            }
            try await ensureResourceReadCurrent(permit, key: key, scope: scope, epoch: epoch); object["offline"] = false
            object["__reylumiReadTrace"] = trace.bridgeMetadata(response: response)
            diagnostics.record(.readDelivered, category: ReylumiLocalDiagnostics.category(resource: name), status: 200, trace: trustedTrace)
            return object
        } catch {
            // Revocation can advance the epoch itself. Preserve that server
            // denial rather than relabeling an actual401/403 as a local409.
            let status = error as NSError
            if status.domain == "ReylumiLocalApp", [401, 403, 404, 409].contains(status.code) { throw error }
            try ensureCurrent(epoch)
            // Confirmed 403/404 retain their original meaning even though their
            // own removal invalidated this permit. Only an offline fallback
            // needs the extra resource check here.
            if error is URLError {
                try await ensureResourceReadCurrent(permit, key: key, scope: requestedScope, epoch: epoch)
                if var cached = try await cached(name: name, args: args, requestedScope: requestedScope) {
                    try await ensureResourceReadCurrent(permit, key: key, scope: cached["scope"] as? String, epoch: epoch)
                    cached["__reylumiReadTrace"] = ["version": 1, "kind": "read", "source": "cache"]
                    return cached
                }
            }
            throw error
        }
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
                let denied = error as NSError
                if denied.domain == "ReylumiLocalApp", [401, 403, 409].contains(denied.code) { throw error }
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
    private func workspaceCommandContext(scope requestedScope: String?, epoch: Int) async throws -> [String: Any] {
        await loadSession(); try ensureCurrent(epoch)
        // Bind this gesture to the currently displayed account and scope. A
        // retained lease for another role cannot authorize an arbitrary caller.
        let displayed = (onlineContext?["context"] as? [String: Any]) ?? (session?.object["context"] as? [String: Any])
        guard let requestedScope, requestedScope == displayed?["scope"] as? String,
              displayed?["authenticated"] as? Bool == true,
              let viewer = displayed?["viewerId"] as? String, !viewer.isEmpty else { throw failure(409, "Your access has changed. Please try again.") }
        let (data, response) = try await send(path: "/api/app-local/context", query: [URLQueryItem(name: "path", value: "/"), URLQueryItem(name: "generation", value: generation)], epoch: epoch)
        let value = try decode(data, response: response)
        try ensureCurrent(epoch)
        guard value["schemaVersion"] as? Int == 1, value["offline"] as? Bool != true,
              let context = value["context"] as? [String: Any], context["authenticated"] as? Bool == true,
              let nextViewer = context["viewerId"] as? String,
              let scope = context["scope"] as? String, scope.range(of: "^v3:[a-f0-9]{64}$", options: .regularExpression) != nil else { throw failure(403, "Please sign in to continue.") }
        guard nextViewer == viewer else { await reset(); throw failure(409, "Your account has changed. Please open the page again.") }
        try requireCommandGrant(value)
        // This fresh account identity is a command preflight, not a display
        // admission. Do not adopt its neutral lease, rotate epochs or emit a
        // context event. Target membership is checked again by the command.
        return value
    }
    func command(name: String, args raw: [String: Any], requestID: String, path: String, requestedScope: String? = nil) async throws -> [String: Any] {
        guard let rule = manifest.commands.first(where: { $0.name == name }), UUID(uuidString: requestID) != nil, !commandIDs.contains(requestID), commandIDs.count < 100 else { throw failure(400, "Unsupported app request.") }
        let args = try arguments(raw, keys: rule.argumentKeys)
        let trace = ReylumiLocalDiagnostics.RequestTrace(command: rule, manifest: manifest, requestID: requestID)
        let commandBegan = ProcessInfo.processInfo.systemUptime
        diagnostics.record(.commandStart, category: .command, outcome: .started, trace: trace)
        commandIDs.insert(requestID); defer { commandIDs.remove(requestID) }
        do {
            let workspaceSwitch = name == "shell.switch-workspace"
            if workspaceSwitch {
                guard workspaceCommandID == nil else { throw failure(409, "A workspace change is already being checked.") }
                workspaceCommandID = requestID
            }
            defer { if workspaceCommandID == requestID { workspaceCommandID = nil } }
            let expectedEpoch = scopeEpoch
            let context: [String: Any], scope: String
            let preflightBegan = ProcessInfo.processInfo.systemUptime
            do {
                if workspaceSwitch { context = try await workspaceCommandContext(scope: requestedScope, epoch: expectedEpoch) }
                else { context = try await freshContext(path: path) }
                try requireCommandGrant(context, name: name, path: path)
                try ensureCurrent(expectedEpoch)
                guard let currentScope = (context["context"] as? [String: Any])?["scope"] as? String else { throw failure(403, "Please sign in to continue.") }
                if context["offlineState"] as? String == "online-only" {
                    guard requestedScope == currentScope else { throw failure(409, "Your access has changed. Please try again.") }
                }
                guard workspaceSwitch || requestedScope == nil || currentScope == requestedScope else { throw failure(409, "Your access has changed. Please try again.") }
                scope = currentScope
                diagnostics.record(.commandPreflight, category: .command, durationMs: (ProcessInfo.processInfo.systemUptime - preflightBegan) * 1000, trace: trace)
            } catch {
                diagnostics.record(.commandPreflight, category: .command, outcome: Task.isCancelled || error is CancellationError ? .cancelled : .failed, status: (error as NSError).code, durationMs: (ProcessInfo.processInfo.systemUptime - preflightBegan) * 1000, trace: trace)
                throw error
            }
            let epoch = scopeEpoch
            let (data, response) = try await send(path: rule.path, body: ["name": name, "args": args, "requestId": requestID, "scope": scope], epoch: epoch, trace: trace)
            if [403, 409].contains(response.statusCode) {
                await revokeDisplay(scope: scope, staffFamily: path.hasPrefix("/staff/") && path != "/staff/today", status: response.statusCode)
                throw failure(response.statusCode, "Please reconnect and check your access.")
            }
            let result = try decode(data, response: response)
            try ensureCurrent(epoch)
            diagnostics.record(.commandEnd, category: .command, status: response.statusCode, durationMs: (ProcessInfo.processInfo.systemUptime - commandBegan) * 1000, trace: trace)
            return result
        } catch {
            diagnostics.record(.commandFailure, category: .command, outcome: Task.isCancelled || error is CancellationError ? .cancelled : .failed, status: (error as NSError).code, durationMs: (ProcessInfo.processInfo.systemUptime - commandBegan) * 1000, trace: trace)
            throw error
        }
    }
}
