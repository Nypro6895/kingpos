import Foundation
import WebKit

/// Trust admission is independent of caller-provided storage keys or scope.
enum ReylumiPortableBridgePolicy {
    static func portablePath(_ path: String) -> Bool {
        path == "/pos/portable" || path.hasPrefix("/pos/portable/")
    }
    static func trusted(origin: URL, frameURL: URL?, currentURL: URL?, isMainFrame: Bool, path: String?) -> Bool {
        guard isMainFrame, let frameURL, let currentURL, let path,
              path == currentURL.path + (currentURL.query.map { "?" + $0 } ?? "") + (currentURL.fragment.map { "#" + $0 } ?? "") else { return false }
        let policy = NavigationPolicy(origin: origin)
        func local(_ url: URL) -> Bool {
            url.scheme == ReylumiLocalBundle.scheme && url.host == ReylumiLocalBundle.host && url.port == nil && url.user == nil && url.password == nil
        }
        return (local(frameURL) && local(currentURL) || policy.isInternal(frameURL) && policy.isInternal(currentURL)) && !policy.isExcluded(currentURL)
    }
}

/// The signed app owns this reply handler. Its synchronous prompt path commits
/// encrypted storage before JavaScript can acknowledge a draft save.
@MainActor
final class ReylumiPortableBridge: NSObject, WKScriptMessageHandlerWithReply {
    private final class WeakBridge {
        weak var value: ReylumiPortableBridge?
        init(_ value: ReylumiPortableBridge) { self.value = value }
    }
    private static var stores: [String: ReylumiPortableStore] = [:]
    private static var bridges: [WeakBridge] = []
    private static var portableLockRevisions: [String: Int] = [:]
    private static var portableLockTasks: [String: Task<Void, Never>] = [:]
    private let origin: URL
    private let mode: ReylumiPortableMode
    private let store: ReylumiPortableStore
    private let transport: ReylumiLocalAppTransport?
    private let nonce = UUID().uuidString
    private var active: (scope: String, expiry: Date, nonce: String, epoch: Int, resources: [String], needsStaff: Bool, offlineEnabled: Bool, operationKinds: Set<String>, lockRevision: Int)?
    private var pending = 0
    private var registered = false
    private var admissionRevision = 0
    private var documentGeneration = 0
    private var onlineLockRevision = 0
    private let writers = ReylumiPortableWriterRegistry.shared
    weak var webView: WKWebView?

    init(origin: URL, transport: ReylumiLocalAppTransport? = nil, store: ReylumiPortableStore? = nil) {
        self.origin = origin; self.mode = ReylumiPortableMode(origin: origin)
        if let store { self.store = store }
        else if let existing = Self.stores[origin.absoluteString] { self.store = existing }
        else { let created = ReylumiPortableStore(origin: origin); Self.stores[origin.absoluteString] = created; self.store = created }
        if let transport { self.transport = transport }
        else if let bundle = try? ReylumiLocalBundle.installed(), bundle.manifest.productionReady == true { self.transport = ReylumiLocalAppTransport(origin: origin, manifest: bundle.manifest) }
        else { self.transport = nil }
        super.init()
        Self.bridges.removeAll { $0.value == nil }
        Self.bridges.append(WeakBridge(self))
    }
    func install(in configuration: WKWebViewConfiguration) {
        if !registered { configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "portableDevice"); registered = true }
        guard let file = Bundle.main.url(forResource: "PortableDeviceBridge", withExtension: "js"),
              let resource = try? String(contentsOf: file, encoding: .utf8),
              let data = try? JSONSerialization.data(withJSONObject: ["nonce": nonce]),
              let metadata = String(data: data, encoding: .utf8) else { return }
        configuration.userContentController.addUserScript(WKUserScript(source: "window.__reylumiPortableHost=\(metadata);\n" + resource, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    func lock() { active = nil; admissionRevision += 1; writers.releaseAll(owner: self) }
    /// Explicit Portable lock is device-wide across scenes and hosted/bundled
    /// views. Personal account authority and the durable outbox are untouched.
    private static func lockPortable(origin: URL) -> Task<Void, Never> {
        let identity = origin.absoluteString
        let revision = (portableLockRevisions[identity] ?? 0) + 1
        portableLockRevisions[identity] = revision
        let previous = portableLockTasks[identity]
        bridges.removeAll { $0.value == nil }
        let matching = bridges.compactMap(\.value).filter { $0.origin.absoluteString == identity }
        var transports: [ReylumiLocalAppTransport] = []
        var seen = Set<ObjectIdentifier>()
        for bridge in matching {
            bridge.lock()
            bridge.webView?.evaluateJavaScript("window.dispatchEvent(new Event('kingpos:native-portable-lock'))", completionHandler: nil)
            if let transport = bridge.transport, seen.insert(ObjectIdentifier(transport)).inserted { transports.append(transport) }
        }
        let task = Task { @MainActor in
            await previous?.value
            for transport in transports { await transport.lockPortable() }
            if Self.portableLockRevisions[identity] == revision { Self.portableLockTasks[identity] = nil }
        }
        portableLockTasks[identity] = task
        return task
    }
    func documentWillNavigate() {
        let hadAuthority = active != nil
        documentGeneration += 1
        lock()
        if hadAuthority { webView?.evaluateJavaScript("window.dispatchEvent(new Event('kingpos:native-writer-reset'))", completionHandler: nil) }
    }
    private func authorized(_ scope: String? = nil) -> (scope: String, expiry: Date)? {
        guard let active, let transport, active.expiry > Date(), active.nonce == transport.nonce,
              active.epoch == transport.scopeEpoch, active.lockRevision == (Self.portableLockRevisions[origin.absoluteString] ?? 0) else { lock(); return nil }
        // A late request for a previous scope must not revoke a newly admitted
        // workspace. It receives no data and cannot mutate that workspace.
        guard scope == nil || scope == active.scope else { return nil }
        return (active.scope, active.expiry)
    }
    private func error(_ message: String = "Connect and unlock POS Portable before opening saved tickets.", code: String = "storage-locked") -> [String: Any] { ["__portableError": ["error": message, "code": code]] }
    private func offlineReady(scope: String) async throws -> Bool {
        guard let transport, let active, active.scope == scope, active.offlineEnabled, !active.resources.isEmpty else { return false }
        for name in active.resources {
            guard let resource = try await transport.cached(name: name, args: [:], requestedScope: scope), resource["scope"] as? String == scope else { return false }
        }
        if active.needsStaff {
            guard let raw = try store.get("kingpos:offline-staff:" + scope, scope: scope), let data = raw.data(using: .utf8),
                  let staff = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], staff["scope"] as? String == scope,
                  let expiry = staff["expiresAt"] as? Double, expiry > Date().timeIntervalSince1970 * 1000,
                  staff["staff"] is [[String: Any]], staff["publicKey"] is String else { return false }
        }
        return authorized(scope) != nil
    }
    private func valid(_ body: [String: Any], frame: WKFrameInfo) -> Bool {
        body["version"] as? Int == 1 && body["nonce"] as? String == nonce && ReylumiPortableBridgePolicy.trusted(origin: origin, frameURL: frame.request.url, currentURL: webView?.url, isMainFrame: frame.isMainFrame, path: body["path"] as? String)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], valid(body, frame: message.frameInfo), let action = body["action"] as? String, pending < 32 else { replyHandler(error("Portable storage is not available on this page.", code: "untrusted-page"), nil); return }
        if action == "mode.get" { replyHandler(["mode": mode.mode.rawValue], nil); return }
        if action == "mode.set" {
            guard let value = body["mode"] as? String, let selected = ReylumiPortableMode.Mode(rawValue: value) else { replyHandler(error("Choose a valid app mode.", code: "invalid-mode"), nil); return }
            // The choice changes the next launch only. The web's explicit
            // exit flow owns its draft flush before navigating away.
            mode.set(selected)
            replyHandler(["mode": selected.rawValue], nil); return
        }
        if action == "writer.release" {
            guard let key = body["key"] as? String, let token = body["token"] as? String else { replyHandler(["released": false], nil); return }
            replyHandler(["released": writers.release(origin: origin, key: key, owner: self, token: token)], nil); return
        }
        guard let current = webView?.url, ReylumiPortableBridgePolicy.portablePath(current.path) else { replyHandler(error("Open POS Portable to access this device's saved tickets.", code: "untrusted-page"), nil); return }
        if action == "storage.lock" {
            let revocation = Self.lockPortable(origin: origin)
            Task { @MainActor in await revocation.value; replyHandler(["ok": true], nil) }
            return
        }
        pending += 1
        Task { @MainActor [weak self] in
            guard let self else { replyHandler(nil, "App view closed."); return }
            defer { self.pending -= 1 }
            var failureRevision = self.admissionRevision
            do {
                if action == "storage.prepare" {
                    self.lock()
                    let revision = self.admissionRevision
                    failureRevision = revision
                    guard let scope = body["scope"] as? String, let transport = self.transport else { replyHandler(self.error(), nil); return }
                    // Check the actual permitted Portable view. A check-in-only
                    // device must not borrow or require the POS desk capability.
                    let path = current.path
                    let lockRevision = Self.portableLockRevisions[self.origin.absoluteString] ?? 0
                    await Self.portableLockTasks[self.origin.absoluteString]?.value
                    guard self.admissionRevision == revision, lockRevision == (Self.portableLockRevisions[self.origin.absoluteString] ?? 0) else { replyHandler(self.error(), nil); return }
                    let requiresOnline = lockRevision > self.onlineLockRevision
                    let value: [String: Any]
                    if requiresOnline { value = try await transport.freshContext(path: path) }
                    else { value = try await transport.context(path: path) }
                    let checked = value["onlineValidatedAt"] as? Double ?? 0
                    guard !requiresOnline || value["offline"] as? Bool == false && abs(Date().timeIntervalSince1970 * 1000 - checked) <= 30_000,
                          self.admissionRevision == revision, lockRevision == (Self.portableLockRevisions[self.origin.absoluteString] ?? 0),
                          self.valid(body, frame: message.frameInfo), let lease = ReylumiLocalSession.verified(value, generation: transport.generation),
                          lease.authority == "portable", lease.scope == scope, lease.compatible(path: path),
                          lease.permitsPrivateReads, ![401, 403, 409, 503].contains(value["grantStatus"] as? Int ?? 0),
                          value["offlineState"] as? String != "unconfirmed",
                          let descriptor = value["portable"] as? [String: Any], descriptor["scope"] as? String == scope,
                          let capabilities = descriptor["capabilities"] as? [String] else { replyHandler(self.error(), nil); return }
                    let pending = try self.store.pendingCount(scope: scope)
                    let resources = [("portable.pos.use", "portable.workspace"), ("portable.checkin.use", "portable.check-in"), ("portable.book.view", "portable.book"), ("portable.today.view", "portable.ticket"), ("portable.report.view", "portable.report")].filter { capabilities.contains($0.0) }.map { $0.1 }
                    let localCommands = (value["grant"] as? [String: Any])?["localCommands"] as? Bool == true
                    let operationKinds = Set([("portable.pos.use", "receipt"), ("portable.pos.use", "visit"), ("portable.checkin.use", "attendance"), ("portable.book.create", "booking")].filter { capabilities.contains($0.0) }.map { $0.1 })
                    self.active = (scope, lease.expiresAt, transport.nonce, transport.scopeEpoch, resources, capabilities.contains("portable.checkin.use"), localCommands && descriptor["offlineEnabled"] as? Bool == true, operationKinds, lockRevision)
                    if requiresOnline { self.onlineLockRevision = lockRevision }
                    // A replaceable data-cache miss cannot prevent an online
                    // draft from committing to the separate durable vault.
                    let ready = (try? await self.offlineReady(scope: scope)) ?? false
                    guard self.admissionRevision == revision, self.authorized(scope) != nil else { replyHandler(self.error(), nil); return }
                    let launchPaths = [("portable.pos.use", "/pos/portable"), ("portable.checkin.use", "/pos/portable/check-in"), ("portable.book.view", "/pos/portable/book"), ("portable.today.view", "/pos/portable/ticket"), ("portable.report.view", "/pos/portable/report")]
                    if let launch = launchPaths.first(where: { capabilities.contains($0.0) }) { self.mode.rememberPortableLaunch(launch.1) }
                    replyHandler(["ok": true, "prepared": true, "scope": scope, "pending": pending, "storage": "native", "offlineReady": ready, "expiresAt": ISO8601DateFormatter().string(from: lease.expiresAt)], nil)
                    return
                }
                guard let admission = self.authorized(body["scope"] as? String) else { replyHandler(self.error(), nil); return }
                if action == "writer.acquire" {
                    guard body["scope"] as? String == admission.scope, let key = body["key"] as? String,
                          key.hasPrefix("kingpos:portable-draft:v1:"), ReylumiPortableStore.validKey(key, scope: admission.scope),
                          let active = self.active else { replyHandler(self.error("Invalid POS draft writer.", code: "invalid-writer"), nil); return }
                    let document = self.documentGeneration, epoch = active.epoch, nonce = active.nonce
                    let token = self.writers.acquire(origin: self.origin, key: key, owner: self) { [weak self] in
                        guard let self, self.documentGeneration == document, let active = self.active,
                              active.scope == admission.scope, active.epoch == epoch, active.nonce == nonce,
                              let transport = self.transport, transport.scopeEpoch == epoch, transport.nonce == nonce,
                              active.expiry > Date(), let url = self.webView?.url, ReylumiPortableBridgePolicy.portablePath(url.path) else { return false }
                        let local = url.scheme == ReylumiLocalBundle.scheme && url.host == ReylumiLocalBundle.host && url.port == nil && url.user == nil && url.password == nil
                        return local || NavigationPolicy(origin: self.origin).isInternal(url)
                    }
                    if let token { replyHandler(["acquired": true, "token": token], nil) }
                    else { replyHandler(["acquired": false], nil) }
                    return
                }
                if action == "offline.status" {
                    let ready = (try? await self.offlineReady(scope: admission.scope)) ?? false
                    guard self.authorized(admission.scope) != nil else { replyHandler(self.error(), nil); return }
                    replyHandler(["ok": true, "prepared": true, "scope": admission.scope, "pending": try self.store.pendingCount(scope: admission.scope), "offlineReady": ready, "storage": "native", "expiresAt": ISO8601DateFormatter().string(from: admission.expiry)], nil); return
                }
                guard ["operations.list", "operations.checkpoint", "operations.save", "operations.import"].contains(action) else { replyHandler(self.error("Portable request is not supported.", code: "unsupported-action"), nil); return }
                if action == "operations.save" {
                    guard let operation = body["operation"] as? [String: Any], let id = operation["id"] as? String, let kind = operation["kind"] as? String else { replyHandler(self.error("Invalid POS operation.", code: "invalid-operation"), nil); return }
                    let existing = try self.store.containsOperation(id: id, scope: admission.scope)
                    if !existing {
                        guard self.active?.offlineEnabled == true, self.active?.operationKinds.contains(kind) == true else {
                            replyHandler(self.error("Offline changes are not enabled for this POS device. Reconnect before continuing.", code: "offline-not-enabled"), nil); return
                        }
                        if kind == "receipt" {
                            guard let payload = operation["payload"] as? [String: Any], let key = payload["localDraftKey"] as? String,
                                  self.writers.owns(origin: self.origin, key: key, owner: self, token: body["writerToken"] as? String) else {
                                replyHandler(self.error("This POS window no longer owns the open ticket. Keep it open and check the other window.", code: "writer-required"), nil); return
                            }
                        }
                    }
                }
                let result = try self.store.invoke(body, scope: admission.scope)
                if ["operations.save", "operations.import"].contains(action) { replyHandler(["ok": true], nil) }
                else { replyHandler(result, nil) }
            } catch {
                if self.admissionRevision == failureRevision { self.lock() }
                replyHandler(self.error("Portable storage could not confirm this save. Keep this ticket open and try again.", code: "storage-unavailable"), nil)
            }
        }
    }
    /// Returns nil only for an ordinary prompt. Recognized bridge prompts never
    /// produce a user-facing text-entry dialog, including malformed requests.
    func prompt(_ prompt: String, frame: WKFrameInfo) -> String? {
        let prefix = "__reylumiPortableDevice:"
        guard prompt.hasPrefix(prefix) else { return nil }
        func reply(_ value: [String: Any]) -> String { (try? JSONSerialization.data(withJSONObject: value)).map { String(decoding: $0, as: UTF8.self) } ?? "{\"ok\":false}" }
        guard prompt.utf8.count <= 8 * 1024 * 1024, let data = String(prompt.dropFirst(prefix.count)).data(using: .utf8),
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], valid(body, frame: frame),
              let current = webView?.url, ReylumiPortableBridgePolicy.portablePath(current.path),
              let admission = authorized(), let action = body["action"] as? String, let key = body["key"] as? String else { return reply(["ok": false, "error": "Connect and unlock POS Portable before opening saved tickets.", "code": "storage-locked"]) }
        do {
            if ["storage.set", "storage.remove"].contains(action), key.hasPrefix("kingpos:portable-draft:v1:"),
               !writers.owns(origin: origin, key: key, owner: self, token: body["writerToken"] as? String) {
                return reply(["ok": false, "error": "POS is already open in another window. Continue there or close it first.", "code": "writer-required"])
            }
            switch action {
            case "storage.get": return reply(["ok": true, "value": try store.get(key, scope: admission.scope) as Any? ?? NSNull()])
            case "storage.set":
                guard let value = body["value"] as? String else { return reply(["ok": false, "error": "Invalid Portable storage value."]) }
                try store.set(key, value: value, scope: admission.scope)
            case "storage.remove": try store.remove(key, scope: admission.scope)
            default: return reply(["ok": false, "error": "Portable storage request is not supported."])
            }
            return reply(["ok": true])
        } catch { return reply(["ok": false, "error": "Portable storage could not confirm this save. Keep this ticket open and try again.", "code": "storage-unavailable"]) }
    }
}
