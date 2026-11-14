import Foundation
import CryptoKit

/// A device-local launch preference. This never grants a Portable session.
final class ReylumiPortableMode {
    enum Mode: String { case personal, portable }
    private let defaults: UserDefaults
    private let key: String
    init(origin: URL, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        key = "reylumi.portable-launch.v1." + SHA256.hash(data: Data(origin.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    var mode: Mode { Mode(rawValue: defaults.string(forKey: key) ?? "") ?? .personal }
    func set(_ mode: Mode) { defaults.set(mode.rawValue, forKey: key) }
    private static let paths: Set<String> = ["/pos/portable", "/pos/portable/check-in", "/pos/portable/book", "/pos/portable/ticket", "/pos/portable/report", "/pos/portable/today"]
    func rememberPortableLaunch(_ path: String) {
        guard Self.paths.contains(path) else { return }
        defaults.set(path, forKey: key + ".path")
    }
    var launchPath: String {
        guard mode == .portable else { return "/" }
        let path = defaults.string(forKey: key + ".path") ?? ""
        return Self.paths.contains(path) ? path : "/pos/portable"
    }
}
