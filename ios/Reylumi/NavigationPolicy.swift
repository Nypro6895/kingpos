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
}
