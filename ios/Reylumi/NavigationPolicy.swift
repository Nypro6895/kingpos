import Foundation

struct NavigationPolicy {
    let origin: URL

    func isInternal(_ url: URL) -> Bool {
        url.scheme == "https" && url.host?.lowercased() == origin.host?.lowercased()
            && url.port == origin.port && url.user == nil && url.password == nil
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
}
