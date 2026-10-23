import Foundation
import CryptoKit
import WebKit

enum ReylumiLocalBundleError: Error { case missing, invalidManifest, invalidPath, unavailable, integrity }

/// All executable resources come from the signed application bundle. The
/// manifest is generated together with the client app, never downloaded.
struct ReylumiLocalBundle: Sendable {
    static let scheme = "reylumi-app"
    static let host = "bundle"
    struct File: Codable, Sendable { let path: String; let bytes: Int; let sha256: String; let mime: String }
    struct Route: Codable, Sendable { let path: String; let adapter: String; let access: String }
    struct Read: Codable, Sendable { let name: String; let path: String; let argumentKeys: [String]; let access: String; let cacheable: Bool }
    struct Command: Codable, Sendable { let name: String; let path: String; let argumentKeys: [String] }
    struct Manifest: Codable, Sendable {
        let version: Int
        let productionReady: Bool?
        let connectOrigins: [String]?
        let mapOrigins: [String]?
        let buildId: String
        let entry: String
        let files: [File]
        let routes: [Route]
        let reads: [Read]
        let commands: [Command]
    }
    let directory: URL
    let manifest: Manifest
    private let files: [String: File]

    init(directory: URL) throws {
        self.directory = directory.resolvingSymlinksInPath().standardizedFileURL
        let url = directory.appendingPathComponent("manifest.json")
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 0, size <= 2 * 1024 * 1024,
              let data = try? Data(contentsOf: url), let manifest = try? JSONDecoder().decode(Manifest.self, from: data) else { throw ReylumiLocalBundleError.missing }
        guard manifest.version == 1, !manifest.buildId.isEmpty, manifest.buildId.utf8.count <= 128,
              !manifest.files.isEmpty, manifest.files.count <= 5000,
              Set(manifest.files.map(\.path)).count == manifest.files.count,
              manifest.files.allSatisfy({ Self.safePath($0.path) && $0.bytes > 0 && $0.bytes <= 32 * 1024 * 1024 && $0.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil && Self.mime(for: $0.path) == $0.mime }),
              manifest.files.reduce(0, { $0 + $1.bytes }) <= 200 * 1024 * 1024,
              manifest.files.contains(where: { $0.path == manifest.entry && $0.mime == "text/html" }),
              !manifest.routes.isEmpty, Set(manifest.routes.map(\.path)).count == manifest.routes.count,
              manifest.routes.allSatisfy({ Self.safeRoute($0.path) && !$0.adapter.isEmpty && !["placeholder", "loading", "stub"].contains($0.adapter) }),
              Set(manifest.reads.map(\.name)).count == manifest.reads.count,
              Set(manifest.commands.map(\.name)).count == manifest.commands.count,
              manifest.reads.allSatisfy({ Self.safeName($0.name) && $0.path == "/api/app-local/read" && Set($0.argumentKeys).count == $0.argumentKeys.count && $0.argumentKeys.allSatisfy(Self.safeName) && ["public", "scoped"].contains($0.access) }),
              manifest.commands.allSatisfy({ Self.safeName($0.name) && $0.path == "/api/app-local/command" && Set($0.argumentKeys).count == $0.argumentKeys.count && $0.argumentKeys.allSatisfy(Self.safeName) }) else { throw ReylumiLocalBundleError.invalidManifest }
        let connections = manifest.connectOrigins ?? []
        guard connections.count <= 2, Set(connections).count == connections.count,
              connections.allSatisfy({ value in
                  guard let url = URL(string: value) else { return false }
                  return ["https", "wss"].contains(url.scheme ?? "") && url.host?.hasSuffix(".supabase.co") == true && url.port == nil && url.user == nil && url.password == nil && url.query == nil && url.fragment == nil && url.path.isEmpty
              }), Set(connections.compactMap { URL(string: $0)?.host }).count <= 1 else { throw ReylumiLocalBundleError.invalidManifest }
        let maps = manifest.mapOrigins ?? []
        guard maps.isEmpty || maps == ["https://api.maptiler.com"] else { throw ReylumiLocalBundleError.invalidManifest }
        self.manifest = manifest
        self.files = Dictionary(uniqueKeysWithValues: manifest.files.map { ($0.path, $0) })
    }

    static func installed(in bundle: Bundle = .main) throws -> ReylumiLocalBundle {
        guard let directory = bundle.url(forResource: "LocalAppBundle", withExtension: nil) else { throw ReylumiLocalBundleError.missing }
        return try ReylumiLocalBundle(directory: directory)
    }

    static func safeName(_ value: String) -> Bool { value.range(of: "^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$", options: .regularExpression) != nil }
    static func safePath(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 1024 && !value.hasPrefix("/") && !value.contains("\\") && !value.contains("%") && !value.contains("?") && !value.contains("#") && !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) && value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    static func safeRoute(_ value: String) -> Bool { value == "/" || value.hasPrefix("/") && safePath(String(value.dropFirst())) }
    static func safeEndpoint(_ value: String) -> Bool {
        value.hasPrefix("/api/app-local/") && safeRoute(value) && !value.contains(":")
    }
    static func mime(for path: String) -> String? {
        // Keep the existing MapLibre vendor URL; no arbitrary extensionless
        // script can be introduced by a downloaded or caller-provided URL.
        if path == "api/vendor/maplibre-gl" { return "text/javascript" }
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html"
        case "js": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "avif": return "image/avif"
        case "svg": return "image/svg+xml"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        default: return nil
        }
    }
    func owns(_ url: URL) -> Bool {
        url.scheme == Self.scheme && url.host == Self.host && url.port == nil && url.user == nil && url.password == nil
    }
    func routeExists(_ path: String) -> Bool {
        guard Self.safeRoute(path) else { return false }
        let actual = path.split(separator: "/")
        return manifest.routes.contains { route in
            let pattern = route.path.split(separator: "/")
            return pattern.count == actual.count && zip(pattern, actual).allSatisfy { expected, received in
                expected == received || (expected.hasPrefix(":") && !received.isEmpty)
            }
        }
    }
    /// A hosted auth flow may return only to a complete ordinary installed
    /// route. Keep one-use returns, security settings and open forms hosted.
    func hostedReturnPath(_ url: URL, origin: URL) -> String? {
        let policy = NavigationPolicy(origin: origin)
        guard policy.isInternal(url), !policy.isExcluded(url), url.query == nil, url.fragment == nil,
              Self.safeRoute(url.path), routeExists(url.path) else { return nil }
        let path = url.path.lowercased()
        let prefixes = ["/api", "/auth", "/login", "/signup", "/account-recovery", "/forgot-password", "/reset-password", "/security-check", "/accept-invite", "/ownership/invite", "/staff/invite", "/booking", "/booking-payment", "/book", "/check-in", "/visit", "/claim", "/deletion-status", "/support/guest", "/market/payment-return", "/market/orders", "/market/booking-deposit/payment", "/market/booking-deposit/settings", "/settings/login-security", "/pos/customer-display"]
        guard !prefixes.contains(where: { path == $0 || path.hasPrefix($0 + "/") }),
              !path.split(separator: "/").contains(where: { ["new", "create", "edit", "setup", "delete", "remove", "cancel", "confirm", "checkout", "transfer", "accept", "reset"].contains(String($0)) }) else { return nil }
        return url.path
    }
    func resourcePath(for url: URL) throws -> String {
        guard owns(url), (url.query?.utf8.count ?? 0) <= 8192,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              !components.percentEncodedPath.lowercased().contains("%2f"), !components.percentEncodedPath.lowercased().contains("%5c"),
              let decoded = components.percentEncodedPath.removingPercentEncoding else { throw ReylumiLocalBundleError.invalidPath }
        let relative = String(decoded.dropFirst())
        let path = files[relative] != nil && url.query == nil ? relative : files[relative] == nil && routeExists(decoded) ? manifest.entry : ""
        guard Self.safePath(path), files[path] != nil else { throw ReylumiLocalBundleError.unavailable }
        return path
    }
    func resource(for url: URL) throws -> (Data, String) {
        let path = try resourcePath(for: url)
        guard let expected = files[path] else { throw ReylumiLocalBundleError.unavailable }
        let file = directory.appendingPathComponent(path).resolvingSymlinksInPath().standardizedFileURL
        guard file.path.hasPrefix(directory.path + "/"),
              let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size == expected.bytes,
              let data = try? Data(contentsOf: file), data.count == expected.bytes,
              SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == expected.sha256 else { throw ReylumiLocalBundleError.integrity }
        return (data, expected.mime)
    }
}

/// The installed, signed public resources are immutable for this bundle's
/// lifetime. Verify once per retained core asset, off the UI actor. Never pin
/// every image or the complete application package in memory.
actor ReylumiLocalResourceCache {
    struct Statistics: Sendable { let entries: Int; let bytes: Int; let verifiedReads: Int; let uiThreadReads: Int }
    private let bundle: ReylumiLocalBundle
    private let maximumBytes: Int
    private let maximumEntries: Int
    private var cached: [String: (Data, String)] = [:]
    private var order: [String] = []
    private var bytes = 0
    private var reads = 0
    private var uiReads = 0
    init(bundle: ReylumiLocalBundle, maximumBytes: Int = 8 * 1024 * 1024, maximumEntries: Int = 24) {
        self.bundle = bundle; self.maximumBytes = maximumBytes; self.maximumEntries = maximumEntries
    }
    func resource(for url: URL) throws -> (Data, String) {
        try Task.checkCancellation()
        let path = try bundle.resourcePath(for: url)
        if let value = cached[path] { order.removeAll { $0 == path }; order.append(path); return value }
        reads += 1; if Thread.isMainThread { uiReads += 1 }
        let value = try bundle.resource(for: url)
        try Task.checkCancellation()
        let core = ["text/html", "text/css", "text/javascript", "font/woff", "font/woff2"].contains(value.1)
        if core, value.0.count <= maximumBytes, maximumEntries > 0 {
            while (!order.isEmpty && (bytes + value.0.count > maximumBytes || cached.count >= maximumEntries)) {
                let oldest = order.removeFirst(); bytes -= (cached.removeValue(forKey: oldest)?.0.count ?? 0)
            }
            cached[path] = value; order.append(path); bytes += value.0.count
        }
        return value
    }
    func statistics() -> Statistics { Statistics(entries: cached.count, bytes: bytes, verifiedReads: reads, uiThreadReads: uiReads) }
}

@MainActor
final class ReylumiLocalSchemeHandler: NSObject, WKURLSchemeHandler {
    let bundle: ReylumiLocalBundle
    private let resources: ReylumiLocalResourceCache
    private var active: [ObjectIdentifier: (UUID, Task<Void, Never>)] = [:]
    init(bundle: ReylumiLocalBundle) { self.bundle = bundle; self.resources = ReylumiLocalResourceCache(bundle: bundle) }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard urlSchemeTask.request.httpMethod == "GET", let url = urlSchemeTask.request.url else { urlSchemeTask.didFailWithError(ReylumiLocalBundleError.invalidPath); return }
        let id = ObjectIdentifier(urlSchemeTask), token = UUID(), resources = resources
        let task: Task<Void, Never> = Task { @MainActor [weak self] in
          defer { if self?.active[id]?.0 == token { self?.active.removeValue(forKey: id) } }
          do {
            let (data, mime) = try await resources.resource(for: url)
            guard let self, self.active[id]?.0 == token, !Task.isCancelled else { return }
            let maps = bundle.manifest.mapOrigins ?? []
            let connections = (bundle.manifest.connectOrigins ?? []) + maps
            let connect = (["'self'"] + connections).joined(separator: " ")
            let workers = maps.isEmpty ? "'none'" : "'self' blob:"
            let headers = ["Content-Type": mime, "Content-Length": String(data.count), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src \(connect); worker-src \(workers); frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"]
            guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else { throw ReylumiLocalBundleError.unavailable }
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
          } catch {
            guard self?.active[id]?.0 == token, !Task.isCancelled else { return }
            urlSchemeTask.didFailWithError(error)
          }
        }
        active[id] = (token, task)
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        active.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.1.cancel()
    }
}
