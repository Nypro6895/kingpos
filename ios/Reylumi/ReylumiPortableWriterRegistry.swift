import Foundation

/// Web Locks are origin-local. The native vault spans hosted/bundled WebViews
/// and iPad scenes, so its draft writer has one process-wide owner instead.
/// Ownership ends only on explicit release, dead owner, or revoked document/
/// session authority. There is no elapsed-time takeover of a living writer.
@MainActor
final class ReylumiPortableWriterRegistry {
    static let shared = ReylumiPortableWriterRegistry()
    private final class Claim {
        weak var owner: AnyObject?
        let token: String
        let valid: () -> Bool
        init(owner: AnyObject, valid: @escaping () -> Bool) {
            self.owner = owner; self.token = UUID().uuidString; self.valid = valid
        }
        var current: Bool { owner != nil && valid() }
    }
    private var claims: [String: Claim] = [:]
    private func identifier(origin: URL, key: String) -> String { origin.absoluteString + "\u{0}" + key }
    func acquire(origin: URL, key: String, owner: AnyObject, valid: @escaping () -> Bool) -> String? {
        let id = identifier(origin: origin, key: key)
        if let previous = claims[id], previous.current { return nil }
        claims[id] = nil
        guard valid() else { return nil }
        let claim = Claim(owner: owner, valid: valid); claims[id] = claim
        return claim.token
    }
    func owns(origin: URL, key: String, owner: AnyObject, token: String?) -> Bool {
        let id = identifier(origin: origin, key: key)
        guard let claim = claims[id], claim.current else { claims[id] = nil; return false }
        return claim.owner === owner && claim.token == token
    }
    @discardableResult
    func release(origin: URL, key: String, owner: AnyObject, token: String) -> Bool {
        let id = identifier(origin: origin, key: key)
        guard let claim = claims[id], claim.owner === owner, claim.token == token else { return false }
        claims[id] = nil; return true
    }
    func releaseAll(owner: AnyObject) {
        for (key, claim) in claims where claim.owner === owner || claim.owner == nil { claims[key] = nil }
    }
}
