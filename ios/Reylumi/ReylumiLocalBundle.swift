import Foundation
import CryptoKit
import WebKit

enum ReylumiLocalBundleError: Error { case missing, invalidManifest, invalidPath, unavailable, integrity }

/// All executable resources come from the signed application bundle. The
/// manifest is generated together with the client app, never downloaded.
struct ReylumiLocalBundle {
    static let scheme = "reylumi-app"
    static let host = "bundle"
    struct File: Codable { let path: String; let bytes: Int; let sha256: String; let mime: String }
    struct Route: Codable { let path: String; let adapter: String; let access: String }
    struct Read: Codable { let name: String; let path: String; let argumentKeys: [String]; let access: String; let cacheable: Bool }
    struct Command: Codable { let name: String; let path: String; let argumentKeys: [String] }
    struct Manifest: Codable {
        let version: Int
        let productionReady: Bool?
        let connectOrigins: [String]?
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
    func resource(for url: URL) throws -> (Data, String) {
        guard owns(url), (url.query?.utf8.count ?? 0) <= 8192,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              !components.percentEncodedPath.lowercased().contains("%2f"), !components.percentEncodedPath.lowercased().contains("%5c"),
              let decoded = components.percentEncodedPath.removingPercentEncoding else { throw ReylumiLocalBundleError.invalidPath }
        let relative = String(decoded.dropFirst())
        let path = files[relative] != nil && url.query == nil ? relative : files[relative] == nil && routeExists(decoded) ? manifest.entry : ""
        guard Self.safePath(path), let expected = files[path] else { throw ReylumiLocalBundleError.unavailable }
        let file = directory.appendingPathComponent(path).resolvingSymlinksInPath().standardizedFileURL
        guard file.path.hasPrefix(directory.path + "/"),
              let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size == expected.bytes,
              let data = try? Data(contentsOf: file), data.count == expected.bytes,
              SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == expected.sha256 else { throw ReylumiLocalBundleError.integrity }
        return (data, expected.mime)
    }
}

final class ReylumiLocalSchemeHandler: NSObject, WKURLSchemeHandler {
    let bundle: ReylumiLocalBundle
    init(bundle: ReylumiLocalBundle) { self.bundle = bundle }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        // Delivery is synchronous: no callback can outlive stopURLSchemeTask.
        do {
            guard urlSchemeTask.request.httpMethod == "GET", let url = urlSchemeTask.request.url else { throw ReylumiLocalBundleError.invalidPath }
            let (data, mime) = try bundle.resource(for: url)
            let connections = bundle.manifest.connectOrigins ?? []
            let connect = (["'self'"] + connections).joined(separator: " ")
            let headers = ["Content-Type": mime, "Content-Length": String(data.count), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src \(connect); frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"]
            guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else { throw ReylumiLocalBundleError.unavailable }
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
