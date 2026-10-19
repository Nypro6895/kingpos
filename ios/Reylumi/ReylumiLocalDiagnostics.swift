import Foundation
import CoreFoundation

/// Local, bounded diagnostics. The app opts in for device troubleshooting.
/// No caller can add strings, URLs, identifiers, payloads or error messages.
@MainActor
final class ReylumiLocalDiagnostics {
    enum Event: String, Codable {
        case controllerCreate, webViewCreateStart, webViewCreateEnd, bundleLoad
        case documentCommit, documentFinish, surfaceReady, foreground, processTermination, navigationFailure
        case contextRequest, contextJoin, contextCacheHit, contextCacheMiss, contextEnvelope, contextDelivered, contextFailure
        case contextBarrierStart, contextBarrierEnd, scopeReset, authorityRotate, pageInvalidate, displayRevoke, portableLock
        case readCacheHit, readCacheMiss, httpStart, httpEnd, httpFailure, serverTiming
        case cookieCapture, cookieCommit, cookieStale, cookieMismatch
    }
    enum Category: String, Codable {
        case view, context, read, command, cache, launch, today, shell, owner, staff, publicContent, other
    }
    enum Outcome: String, Codable { case started, completed, hit, miss, joined, accepted, failed, cancelled, invalidated, available, missing }
    enum Reason: String, Codable {
        case externalCookies, staleCookies, unauthenticated, displayDenied, workspaceChanged, contextChanged
        case leaseUnavailable, signOut, explicitReset, cancelled, invalidEnvelope, unknown
    }
    enum Stage: String, Codable, CaseIterable {
        case auth, validate, lease, load, serialize, total
        case todayFull = "today_full", todayShell = "today_shell", todayStaff = "today_staff"
        case todayBookings = "today_bookings", todayWaiting = "today_waiting"
        case todayFinancials = "today_financials", todayExtras = "today_extras"
    }
    struct Entry: Codable {
        let sequence: Int
        let elapsedMs: Double
        let event: Event
        let category: Category
        let outcome: Outcome
        let status: Int?
        let durationMs: Double?
        let stage: Stage?
        let reason: Reason?
        let operation: Int?
    }
    private let capacity: Int
    private let now: () -> TimeInterval
    private let origin: TimeInterval
    private(set) var isEnabled: Bool
    private var sequence = 0
    private var entries: [Entry] = []

    init(enabled: Bool = false, capacity: Int = 512, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.capacity = min(512, max(1, capacity)); self.now = now; origin = now()
        isEnabled = enabled
    }
    func record(_ event: Event, category: Category = .view, outcome: Outcome = .completed, status: Int? = nil, durationMs: Double? = nil, stage: Stage? = nil, reason: Reason? = nil, operation: Int? = nil) {
        guard isEnabled else { return }
        let duration = durationMs.flatMap { $0.isFinite && $0 >= 0 && $0 <= 300_000 ? $0 : nil }
        let code = status.flatMap { (-1100...599).contains($0) ? $0 : nil }
        sequence += 1
        let operation = operation.flatMap { (0...1_000_000_000).contains($0) ? $0 : nil }
        entries.append(Entry(sequence: sequence, elapsedMs: max(0, (now() - origin) * 1000), event: event, category: category, outcome: outcome, status: code, durationMs: duration, stage: stage, reason: reason, operation: operation))
        if entries.count > capacity { entries.removeFirst(entries.count - capacity) }
    }
    func snapshot() -> [Entry] { entries }

    /// A second allowlist at the native boundary. Never trust page-supplied
    /// trace rows to have passed the JavaScript filter. No URLs, IDs, cookies,
    /// free-form errors, device identifiers or business payloads are exported.
    func report(javascript: Any?, appVersion: String, appBuild: String, bundleBuild: String) throws -> Data {
        let native = try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot()))
        let version = appVersion.range(of: "^[0-9]{1,6}(\\.[0-9]{1,6}){0,3}$", options: .regularExpression) != nil ? appVersion : "unknown"
        let build = appBuild.range(of: "^[0-9]{1,10}(\\.[0-9]{1,6}){0,2}$", options: .regularExpression) != nil ? appBuild : "unknown"
        let bundled = bundleBuild.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil ? bundleBuild : "unknown"
        return try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "appVersion": version, "appBuild": build, "bundleBuild": bundled, "native": native, "javascript": Self.sanitizedJavaScript(javascript)], options: [.sortedKeys])
    }

    private static func sanitizedJavaScript(_ value: Any?) -> [[String: Any]] {
        guard let rows = value as? [Any], rows.count <= 256 else { return [] }
        let events: Set<String> = ["boot.start", "boot.ready", "data.visible", "route.reveal", "auth.start", "auth.end", "auth.join", "auth.skip", "auth.abort", "auth.reject", "context.read.start", "context.read.end", "context.accept", "context.reject", "context.abort", "gate.hide", "gate.show", "timer.schedule", "timer.fire", "timer.cancel", "cache.reset", "cache.invalidate", "cache.hit", "cache.miss", "cache.join", "cache.restore.start", "cache.restore.end", "cache.read.start", "cache.read.end", "cache.refresh", "lifecycle.focus", "lifecycle.visible", "lifecycle.foreground", "lifecycle.online", "document.reload.request", "document.pagehide", "document.pageshow"]
        let enums: [String: Set<String>] = [
            "source": ["web", "app-local", "cache", "scheduler"],
            "trigger": ["mount", "focus", "visible", "foreground", "online", "interval", "lease-expiry", "mutation", "reset", "manual", "resource", "unknown"],
            "reason": ["identity", "permissions", "resource", "expired", "reset", "logout", "transient", "scope", "grant", "generation", "mutation", "manual", "unknown"],
            "contextReason": ["schema", "scope", "generation", "lease-expired", "lease-invalid", "unconfirmed", "online-stale", "sign-in", "permission-denied", "workspace-changed", "page-authority", "portable-authority", "authority-family", "workspace-home", "reset", "logout", "lease-unavailable", "transport-timeout", "transport-network", "transport-unavailable", "transport-invalid", "handoff", "late-reply", "lease-valid", "online-valid"],
            "area": ["today", "shell", "other"],
            "phase": ["shell", "staff", "bookings", "waiting", "financials", "extras", "full", "none"]
        ]
        let numbers: [String: ClosedRange<Double>] = ["sequence": 0...1_000_000_000, "atMs": 0...604_800_000, "status": -10000...999, "durationMs": 0...604_800_000, "operation": 0...1_000_000_000]
        return rows.compactMap { value in
            guard let row = value as? [String: Any], let event = row["event"] as? String, events.contains(event) else { return nil }
            var result: [String: Any] = ["event": event]
            for (key, allowed) in enums { if let text = row[key] as? String, allowed.contains(text) { result[key] = text } }
            for (key, range) in numbers {
                if let number = row[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite, range.contains(number.doubleValue) { result[key] = number }
            }
            for key in ["blocked", "offline", "fresh", "changed", "scopeChanged", "permissionChanged", "generationChanged", "grantChanged", "identityChanged"] {
                if let flag = row[key] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID() { result[key] = flag }
            }
            return result
        }
    }
    func serverTiming(_ header: String?, category: Category) {
        guard isEnabled, let header, header.utf8.count <= 8192 else { return }
        for value in header.split(separator: ",").prefix(32) {
            let parts = value.split(separator: ";")
            guard let first = parts.first, let stage = Stage(rawValue: first.trimmingCharacters(in: .whitespaces)) else { continue }
            for parameter in parts.dropFirst() {
                let pair = parameter.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                if pair.count == 2, pair[0] == "dur", let duration = Double(pair[1]), duration.isFinite, duration >= 0, duration <= 300_000 {
                    record(.serverTiming, category: category, durationMs: duration, stage: stage)
                    break
                }
            }
        }
    }
    static func category(path: String) -> Category {
        if path == "/" { return .launch }
        if path == "/staff/today" { return .today }
        if path.hasPrefix("/staff/") { return .staff }
        if path == "/pos" || path.hasPrefix("/pos/") { return .owner }
        return .other
    }
    static func category(resource: String) -> Category {
        if resource == "page.owner-today" || resource == "owner.today" { return .today }
        if resource.hasPrefix("shell.") { return .shell }
        if resource.hasPrefix("owner.") || resource.hasPrefix("page.owner-") { return .owner }
        if resource.hasPrefix("staff.") { return .staff }
        if resource.hasPrefix("public.") { return .publicContent }
        return .other
    }
}
