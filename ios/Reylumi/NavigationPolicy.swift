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
        if path == "/qr", let entry = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "entry" })?.value,
           UUID(uuidString: entry) != nil { return true }
        return ["/login", "/signup", "/account-recovery", "/forgot-password",
                "/reset-password", "/security-check", "/accept-invite",
                "/ownership/invite", "/staff/invite", "/claim", "/deletion-status",
                "/booking-payment", "/booking/manage", "/check-in", "/visit",
                "/market/booking-deposit/payment", "/market/payment-return",
                "/support/guest", "/contact-support"].contains {
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
}
