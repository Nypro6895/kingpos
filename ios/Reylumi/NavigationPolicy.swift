import Foundation

struct NavigationPolicy {
    let origin: URL

    func isInternal(_ url: URL) -> Bool {
        let sameOrigin = url.host?.lowercased() == origin.host?.lowercased()
            && url.port == origin.port && url.user == nil && url.password == nil
        #if DEBUG
        // Only the simulator fixture opts into HTTP localhost. Release builds
        // and the production HTTPS origin keep the original HTTPS restriction.
        if origin.scheme == "http", origin.host == "localhost" {
            return sameOrigin && url.scheme == "http"
        }
        #endif
        return sameOrigin && url.scheme == "https"
    }

    func isExcluded(_ url: URL) -> Bool {
        let path = url.path.removingPercentEncoding?.replacingOccurrences(of: "\\", with: "/").lowercased() ?? url.path.lowercased()
        return ["/admin", "/api/admin", "/settings/recovery-back-office", "/api/pos/windows-download"].contains {
            path == $0 || path.hasPrefix($0 + "/")
        }
    }

    func isExternalAllowed(_ url: URL) -> Bool {
        ["https", "tel", "mailto", "sms"].contains(url.scheme?.lowercased() ?? "")
            && url.user == nil && url.password == nil
    }

    /// Presentation only; server authorization and installed-route admission
    /// remain independent. Ordinary pages use their own app navigation.
    func needsHostedTaskControls(_ url: URL) -> Bool {
        guard isInternal(url), !isExcluded(url) else { return false }
        let path = url.path.lowercased()
        if let fragment = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedFragment,
           let publicURL = URL(string: "https://reylumi.com/gift-cards#" + fragment),
           Self.giftCardPath(publicURL) != nil,
           path == "/gift-cards", url.query == nil { return true }
        if path == "/qr", let entry = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "entry" })?.value,
           UUID(uuidString: entry) != nil { return true }
        // Authentication and public support pages already link back to Explore
        // and to each other. Native task chrome must not follow those journeys.
        // Keep an exit for challenges and standalone token/payment tasks only.
        return ["/security-check", "/accept-invite",
                "/ownership/invite", "/staff/invite", "/claim", "/deletion-status",
                "/booking-payment", "/booking/manage", "/check-in", "/visit",
                "/market/booking-deposit/payment", "/market/payment-return",
                "/support/guest"].contains {
            path == $0 || path.hasPrefix($0 + "/")
        }
    }

    /// A provider challenge is an interactive document, not an application error.
    /// Keep this exception limited to the dedicated check on our own origin.
    func isSecurityChallengeResponse(_ response: HTTPURLResponse, isMainFrame: Bool, canShowMIMEType: Bool) -> Bool {
        guard isMainFrame, canShowMIMEType,
              let url = response.url, isInternal(url), !isExcluded(url),
              url.path == "/security-check",
              [403, 429].contains(response.statusCode),
              response.mimeType?.lowercased() == "text/html",
              response.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") != true else { return false }
        return response.value(forHTTPHeaderField: "x-vercel-mitigated")?
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "challenge"
    }

    func isSafariPayment(_ url: URL) -> Bool {
        url.scheme == "https" && ["checkout.stripe.com", "billing.stripe.com"].contains(url.host?.lowercased() ?? "")
            && url.port == nil && url.user == nil && url.password == nil
    }

    func isMapsDirections(_ url: URL) -> Bool {
        guard url.scheme == "https", url.port == nil, url.user == nil, url.password == nil,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        let query = parts.queryItems ?? []
        let host = url.host?.lowercased() ?? ""
        if host == "maps.apple.com", url.path.isEmpty || url.path == "/" {
            return query.contains { $0.name == "daddr" && !($0.value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }
        }
        if ["www.google.com", "google.com"].contains(host), ["/maps/dir", "/maps/dir/"].contains(url.path) {
            return query.contains { $0.name == "api" && $0.value == "1" }
                && query.contains { $0.name == "destination" && !($0.value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }
        }
        return false
    }

    static func isMarketReturn(_ url: URL) -> Bool {
        url.scheme == "reylumi" && url.host == "market" && url.path.isEmpty
            && url.query == nil && url.fragment == nil && url.user == nil && url.password == nil && url.port == nil
    }

    /// Public entry identifiers identify a salon display, never an account or
    /// permission. Accept only the exact Camera link; writes remain in the UI.
    static func personalCheckinPath(_ url: URL) -> String? {
        let universal = url.scheme == "https" && ["reylumi.com", "www.reylumi.com"].contains(url.host?.lowercased() ?? "")
        let explicitOpen = url.scheme == "reylumi" && url.host == "check-in"
        guard universal || explicitOpen, url.user == nil, url.password == nil, url.port == nil,
              url.query == nil, url.fragment == nil else { return nil }
        let path = explicitOpen ? "/check-in" + url.path : url.path
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 3 || (parts.count == 4 && parts[3].isEmpty),
              parts[0].isEmpty, parts[1] == "check-in",
              let id = UUID(uuidString: String(parts[2])), parts[2].count == 36 else { return nil }
        return "/qr?entry=" + id.uuidString.lowercased()
    }

    /// A delivery link only opens the existing website. The customer still
    /// signs in and explicitly claims the card; mobile/payment links stay web-only.
    static func giftCardPath(_ url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.user == nil, components.password == nil, components.port == nil,
              components.query == nil else { return nil }
        let universal = components.scheme == "https" && components.host?.lowercased() == "reylumi.com"
            && components.percentEncodedPath == "/gift-cards"
        let explicitOpen = components.scheme == "reylumi" && components.host == "gift-cards"
            && components.percentEncodedPath.isEmpty
        guard universal || explicitOpen, let fragment = components.percentEncodedFragment,
              fragment.hasPrefix("card=") else { return nil }
        let token = fragment.dropFirst(5)
        // gift_card_secret is SHA-256 encoded as lowercase hex. Never decode
        // query syntax, extra fragments or percent escapes into this capability.
        guard token.utf8.count == 64, token.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return nil }
        return "/gift-cards#" + fragment
    }
}
