import Foundation
import WebKit
import BackgroundTasks
import CryptoKit
import Security

struct ReylumiSyncRegistration: Codable, Equatable, Sendable {
    let scope: String
    let key: String
    let endpoint: String
    let expiresAt: Date

    init?(scope: String, key: String, endpoint: String, expiresAt: Date, origin: URL, now: Date = Date()) {
        guard scope.range(of: "^v3:[a-f0-9]{64}$", options: .regularExpression) != nil,
              !key.isEmpty, key.utf8.count <= 16384, !key.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              endpoint.utf8.count <= 8192, let url = URL(string: endpoint, relativeTo: origin)?.absoluteURL,
              NavigationPolicy(origin: origin).isInternal(url), url.fragment == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["/api/experience/today", "/api/experience/my-work"].contains(components.path),
              expiresAt > now else { return nil }
        let query = components.queryItems ?? []
        let allowed: Set<String> = components.path == "/api/experience/today" ? ["scope", "date"] : ["scope", "staffId", "tab", "payPeriodStart"]
        guard query.allSatisfy({ allowed.contains($0.name) && $0.value != nil }),
              Set(query.map(\.name)).count == query.count,
              query.first(where: { $0.name == "scope" })?.value == scope else { return nil }
        self.scope = scope; self.key = key; self.endpoint = endpoint
        self.expiresAt = min(expiresAt, now.addingTimeInterval(ReylumiOfflineRoute.maximumLease))
    }

    func url(origin: URL) -> URL? { URL(string: endpoint, relativeTo: origin)?.absoluteURL }
}

struct ReylumiSyncSnapshot: Codable, Sendable {
    let key: String
    let endpoint: String
    let payload: Data
    let updatedAt: Date
    let receivedAt: Date
}

struct ReylumiSyncState: Codable {
    var scope: String
    var registrations: [ReylumiSyncRegistration]
    var snapshots: [ReylumiSyncSnapshot]
}

/// Native snapshots are encrypted, device-only and excluded from backups. No
/// session cookie or credential is ever copied into this persistence layer.
final class ReylumiSyncStore {
    private let file: URL
    private let account: String
    private let service: String
    static let maximumSnapshots = 4
    static let maximumBytes = 2 * 1024 * 1024

    init(origin: URL, directory: URL? = nil, service: String = "com.reylumi.background-readmodels.v1") {
        self.account = origin.absoluteString; self.service = service
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ReylumiReadModels", isDirectory: true)
        self.file = base.appendingPathComponent(SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined() + ".sealed")
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    private func encryptionKey(create: Bool) -> SymmetricKey? {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 { return SymmetricKey(data: data) }
        guard create, status == errSecItemNotFound else { return nil }
        let key = SymmetricKey(size: .bits256)
        let bytes = key.withUnsafeBytes { Data($0) }
        var insert = query; insert[kSecValueData as String] = bytes
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { return nil }
        return key
    }

    func load() -> ReylumiSyncState? {
        guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= Self.maximumBytes * 2,
              let key = encryptionKey(create: false), let sealed = try? Data(contentsOf: file),
              let box = try? AES.GCM.SealedBox(combined: sealed), let data = try? AES.GCM.open(box, using: key),
              let state = try? JSONDecoder().decode(ReylumiSyncState.self, from: data) else { return nil }
        return state
    }

    func save(_ state: ReylumiSyncState) {
        guard state.registrations.count <= Self.maximumSnapshots, state.snapshots.count <= Self.maximumSnapshots,
              state.snapshots.reduce(0, { $0 + $1.payload.count }) <= Self.maximumBytes,
              let key = encryptionKey(create: true), let data = try? JSONEncoder().encode(state),
              data.count <= Self.maximumBytes * 2, let sealed = try? AES.GCM.seal(data, using: key).combined else { return }
        do {
            let directory = file.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try sealed.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var resource = file; var values = URLResourceValues(); values.isExcludedFromBackup = true
            try resource.setResourceValues(values)
        } catch { /* Foreground web reads remain authoritative if native storage is unavailable. */ }
    }

    func clear() {
        try? FileManager.default.removeItem(at: file)
        SecItemDelete(query as CFDictionary)
    }
}

protocol ReylumiReadTransport {
    func get(_ url: URL, cookies: [HTTPCookie]) async throws -> (Data, HTTPURLResponse)
}

private final class ReylumiURLTransport: ReylumiReadTransport {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 8; configuration.timeoutIntervalForResource = 18
        session = URLSession(configuration: configuration, delegate: ReylumiReadRedirectDelegate(), delegateQueue: nil)
    }

    func get(_ url: URL, cookies: [HTTPCookie]) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ReylumiIOS/1.0", forHTTPHeaderField: "User-Agent")
        request.setValue("1", forHTTPHeaderField: "X-Reylumi-Background-Read")
        let applicable = cookies.filter { cookie in
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return url.host?.lowercased() == domain.lowercased() && url.path.hasPrefix(cookie.path)
                && (!cookie.isSecure || url.scheme == "https") && (cookie.expiresDate ?? .distantFuture) > Date()
        }
        HTTPCookie.requestHeaderFields(with: applicable).forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        var data = Data()
        for try await byte in bytes {
            guard !Task.isCancelled, data.count < ReylumiSyncStore.maximumBytes else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        return (data, response)
    }

    deinit { session.invalidateAndCancel() }
}

private final class ReylumiReadRedirectDelegate: NSObject, URLSessionTaskDelegate {
    // A background read must never carry app cookies into a login/provider or
    // external redirect, or turn a GET into a different request.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class ReylumiBackgroundSync {
    static let taskIdentifier = "com.reylumi.ios.read-refresh"
    static let shared = ReylumiBackgroundSync(origin: URL(string: Bundle.main.object(forInfoDictionaryKey: "ReylumiServerURL") as? String ?? "https://reylumi.com")!)
    private let origin: URL
    private let store: ReylumiSyncStore
    private var transport: ReylumiReadTransport?
    private let cookies: @MainActor () async -> [HTTPCookie]
    private let setCookies: @MainActor ([HTTPCookie]) async -> Void
    private var state: ReylumiSyncState?
    private var epoch = 0
    private var task: Task<Bool, Never>?
    private var schedulerRegistered = false
    private var hasLoadedState = false

    init(origin: URL, store: ReylumiSyncStore? = nil, transport: ReylumiReadTransport? = nil, cookies: (@MainActor () async -> [HTTPCookie])? = nil,
         setCookies: (@MainActor ([HTTPCookie]) async -> Void)? = nil) {
        self.origin = origin
        self.store = store ?? ReylumiSyncStore(origin: origin)
        self.transport = transport
        self.cookies = cookies ?? { await withCheckedContinuation { continuation in WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) } } }
        self.setCookies = setCookies ?? { values in
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                let group = DispatchGroup()
                let store = WKWebsiteDataStore.default().httpCookieStore
                for value in values { group.enter(); store.setCookie(value) { group.leave() } }
                group.notify(queue: .main) { continuation.resume() }
            }
        }
        // Registration runs during app launch. Defer disk/Keychain/decryption
        // until web registration or a background task, after the first frame.
    }

    func registerScheduler() {
        guard !schedulerRegistered else { return }
        schedulerRegistered = BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskIdentifier, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
            Task { @MainActor in ReylumiBackgroundSync.shared.perform(task) }
        }
    }

    func schedule() {
        ensureStateLoaded()
        prune()
        guard schedulerRegistered, !(state?.registrations.isEmpty ?? true) else { return }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskIdentifier)
        let request = BGAppRefreshTaskRequest(identifier: Self.taskIdentifier)
        request.earliestBeginDate = Date().addingTimeInterval(15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private func perform(_ backgroundTask: BGAppRefreshTask) {
        task?.cancel()
        let work = Task { @MainActor in await refresh() }
        task = work
        backgroundTask.expirationHandler = { work.cancel() }
        Task { @MainActor in
            let success = await work.value
            backgroundTask.setTaskCompleted(success: success)
            schedule()
        }
    }

    func clear() {
        epoch += 1; task?.cancel(); task = nil; state = nil; hasLoadedState = true; store.clear()
        if schedulerRegistered { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskIdentifier) }
    }

    private func prune() {
        guard var current = state else { return }
        current.registrations = current.registrations.filter { registration in
            ReylumiSyncRegistration(scope: registration.scope, key: registration.key, endpoint: registration.endpoint,
                                    expiresAt: registration.expiresAt, origin: origin) != nil && registration.scope == current.scope
        }
        let keys = Set(current.registrations.map(\.key))
        current.snapshots = current.snapshots.filter { keys.contains($0.key) }
        if current.registrations.isEmpty { state = nil; store.clear() }
        else { state = current; store.save(current) }
    }

    private func ensureStateLoaded() {
        guard !hasLoadedState else { return }
        hasLoadedState = true
        state = store.load()
        prune()
    }

    private func cookieIdentity(_ values: [HTTPCookie]) -> [String] {
        ReylumiCookieAuthority.identity(values, origin: origin)
    }

    private func read(_ url: URL, cookies sessionCookies: [HTTPCookie], expectedEpoch: Int) async throws -> (Data, HTTPURLResponse, [HTTPCookie]) {
        let reader = transport ?? ReylumiURLTransport()
        transport = reader
        let (data, response) = try await reader.get(url, cookies: sessionCookies)
        let currentCookies = await cookies()
        guard !Task.isCancelled, epoch == expectedEpoch, cookieIdentity(currentCookies) == cookieIdentity(sessionCookies) else { throw URLError(.cancelled) }
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            if let key = pair.key as? String { result[key] = String(describing: pair.value) }
        }
        let updates = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url).filter {
            $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == origin.host?.lowercased()
        }
        // Benign markers may have changed while networking. Keep forwarding the
        // current full jar after its authority matched; projection never drops
        // cookies from storage or subsequent requests.
        if updates.isEmpty { return (data, response, currentCookies) }
        guard epoch == expectedEpoch, !Task.isCancelled else { throw URLError(.cancelled) }
        await setCookies(updates)
        guard epoch == expectedEpoch, !Task.isCancelled else { throw URLError(.cancelled) }
        return (data, response, await cookies())
    }

    private func authorizedSession(cookies: [HTTPCookie], expectedEpoch: Int) async -> (scope: String, cookies: [HTTPCookie])? {
        guard !Task.isCancelled, !cookies.isEmpty, expectedEpoch == epoch else { return nil }
        do {
            let (data, response, updatedCookies) = try await read(origin.appendingPathComponent("api/experience/context"), cookies: cookies, expectedEpoch: expectedEpoch)
            guard !Task.isCancelled, expectedEpoch == epoch else { return nil }
            if [401, 403, 409].contains(response.statusCode) { clear(); return nil }
            guard response.statusCode == 200,
                  response.mimeType?.lowercased() == "application/json",
                  let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
            if value["authenticated"] as? Bool == false { clear(); return nil }
            guard value["authenticated"] as? Bool == true, value["viewerId"] is String,
                  let scope = value["scope"] as? String else { return nil }
            return (scope, updatedCookies)
        } catch { return nil }
    }

    func register(_ registration: ReylumiSyncRegistration) async {
        ensureStateLoaded()
        guard registration.expiresAt > Date() else { return }
        if state?.scope == registration.scope,
           state?.registrations.contains(where: { $0.key == registration.key && $0.endpoint == registration.endpoint && $0.expiresAt >= registration.expiresAt }) == true { return }
        if state?.scope != registration.scope {
            clear()
            // Reserve the scope before the await: a late registration from an
            // old account must not append itself to a newly selected account.
            state = ReylumiSyncState(scope: registration.scope, registrations: [], snapshots: [])
        }
        let started = epoch
        let sessionCookies = await cookies()
        guard let session = await authorizedSession(cookies: sessionCookies, expectedEpoch: started), !Task.isCancelled, started == epoch else { return }
        guard session.scope == registration.scope else { clear(); return }
        guard registration.expiresAt > Date() else { return }
        var next = state ?? ReylumiSyncState(scope: session.scope, registrations: [], snapshots: [])
        next.registrations.removeAll { $0.key == registration.key }
        next.registrations.append(registration)
        if next.registrations.count > ReylumiSyncStore.maximumSnapshots { next.registrations.removeFirst(next.registrations.count - ReylumiSyncStore.maximumSnapshots) }
        let keys = Set(next.registrations.map(\.key)); next.snapshots.removeAll { !keys.contains($0.key) }
        state = next; store.save(next); schedule()
    }

    nonisolated static func payloadUpdatedAt(_ data: Data, now: Date = Date()) -> Date? {
        guard data.count <= ReylumiSyncStore.maximumBytes,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], value["partial"] as? Bool == false,
              value["data"] is [String: Any], let sections = value["sections"] as? [String: String],
              let revision = value["revision"] as? String,
              [revision].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
              sections.values.allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
              let stamp = value["updatedAt"] as? String, let updated = ReylumiOfflineRoute.expiry(from: stamp),
              updated <= now.addingTimeInterval(60) else { return nil }
        return updated
    }

    func refresh() async -> Bool {
        // Leave time for iOS to finish the task cleanly. Cancellation also
        // reaches the streaming GET; no background request is replayed.
        await withTaskGroup(of: Bool.self) { group in
            group.addTask { await self.refreshWithinBudget() }
            group.addTask {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                return false
            }
            let result = await group.next() ?? false
            group.cancelAll()
            return result
        }
    }

    private func refreshWithinBudget() async -> Bool {
        ensureStateLoaded()
        prune()
        guard let current = state, !Task.isCancelled else { return false }
        let started = epoch
        let sessionCookies = await cookies()
        guard let session = await authorizedSession(cookies: sessionCookies, expectedEpoch: started), !Task.isCancelled, started == epoch else { return false }
        guard session.scope == current.scope else { clear(); return false }
        var currentCookies = session.cookies
        var changed = false
        for registration in current.registrations {
            guard !Task.isCancelled, started == epoch, registration.expiresAt > Date(), let url = registration.url(origin: origin) else { return changed }
            do {
                let (data, response, updatedCookies) = try await read(url, cookies: currentCookies, expectedEpoch: started)
                currentCookies = updatedCookies
                guard !Task.isCancelled, started == epoch else { return false }
                if [401, 403, 409].contains(response.statusCode) { clear(); return false }
                guard response.statusCode == 200, response.mimeType?.lowercased() == "application/json",
                      let updatedAt = Self.payloadUpdatedAt(data), var next = state,
                      next.registrations.contains(registration), registration.expiresAt > Date() else { continue }
                if let previous = next.snapshots.first(where: { $0.key == registration.key }), previous.updatedAt >= updatedAt { continue }
                next.snapshots.removeAll { $0.key == registration.key }
                next.snapshots.append(ReylumiSyncSnapshot(key: registration.key, endpoint: registration.endpoint, payload: data, updatedAt: updatedAt, receivedAt: Date()))
                while next.snapshots.reduce(0, { $0 + $1.payload.count }) > ReylumiSyncStore.maximumBytes { next.snapshots.removeFirst() }
                state = next; store.save(next); changed = true
            } catch { if Task.isCancelled { return false } }
        }
        return changed
    }

    func drain(scope: String) async -> [[String: Any]] {
        ensureStateLoaded()
        prune()
        guard state?.scope == scope else { return [] }
        let started = epoch
        let sessionCookies = await cookies()
        guard let current = await authorizedSession(cookies: sessionCookies, expectedEpoch: started), !Task.isCancelled, started == epoch else { return [] }
        guard current.scope == scope else { clear(); return [] }
        prune()
        guard state?.scope == scope else { return [] }
        return (state?.snapshots ?? []).compactMap { snapshot in
            guard Self.payloadUpdatedAt(snapshot.payload) != nil,
                  let payload = try? JSONSerialization.jsonObject(with: snapshot.payload) else { return nil }
            return ["key": snapshot.key, "endpoint": snapshot.endpoint, "payload": payload,
                    "receivedAt": ISO8601DateFormatter().string(from: snapshot.receivedAt)]
        }
    }
}
