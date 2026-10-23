import Foundation

/// Cookie storage/forwarding and authority comparison have different purposes.
/// These exact markers affect attribution, presentation or a remembered device
/// reference. They never identify an authenticated account or grant access.
/// Every other cookie belonging to this origin remains authoritative, including
/// unknown names, auth/MFA, login sessions, workspaces, POS, admin and abuse.
enum ReylumiCookieAuthority {
    private static let nonAuthorityNames: Set<String> = [
        "reylumi-ad-session", "reylumi-ad-visitor", "reylumi-ad-attribution",
        "reylumi-owner-ad-visitor", "reylumi-explore-visitor",
        "reylumi-report-session", "kingpos-portable-pos-remembered-id"
    ]

    static func identity(_ values: [HTTPCookie], origin: URL) -> [String] {
        values.filter { belongsToOrigin($0, origin: origin) && !nonAuthorityNames.contains($0.name) }
            .map { [normalizedDomain($0.domain), $0.path, $0.name, $0.value].joined(separator: "\u{0}") }
            .sorted()
    }

    private static func normalizedDomain(_ domain: String) -> String {
        domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
    }

    private static func belongsToOrigin(_ cookie: HTTPCookie, origin: URL) -> Bool {
        guard let host = origin.host?.lowercased() else { return false }
        let domain = normalizedDomain(cookie.domain)
        guard !domain.isEmpty else { return false }
        if host == domain { return true }
        // HTTPCookie does not expose a dependable host-only flag. Conservatively
        // include a parent domain with or without its leading dot, always at a
        // label boundary. Siblings, children and similar hostnames cannot supply
        // this origin's authority. Reject single-label suffixes in injected jars.
        return domain.contains(".") && host.hasSuffix("." + domain)
    }
}
