import Foundation

/// Local, bounded diagnostics. Disabled unless a DEBUG test explicitly opts in.
/// No caller can add strings, URLs, identifiers, payloads or error messages.
@MainActor
final class ReylumiLocalDiagnostics {
    enum Event: String, Codable {
        case controllerCreate, webViewCreateStart, webViewCreateEnd, bundleLoad
        case documentCommit, documentFinish, surfaceReady, foreground, processTermination, navigationFailure
        case contextRequest, contextJoin, contextCacheHit, contextCacheMiss, contextEnvelope, contextDelivered, contextFailure
        case contextBarrierStart, contextBarrierEnd, scopeReset, authorityRotate, pageInvalidate, displayRevoke, portableLock
        case readCacheHit, readCacheMiss, httpStart, httpEnd, httpFailure, serverTiming
    }
    enum Category: String, Codable {
        case view, context, read, command, cache, launch, today, shell, owner, staff, publicContent, other
    }
    enum Outcome: String, Codable { case started, completed, hit, miss, joined, accepted, failed, cancelled, invalidated, available, missing }
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
    }
    private let capacity: Int
    private let now: () -> TimeInterval
    private let origin: TimeInterval
    private(set) var isEnabled: Bool
    private var sequence = 0
    private var entries: [Entry] = []

    init(enabled: Bool = false, capacity: Int = 512, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.capacity = min(512, max(1, capacity)); self.now = now; origin = now()
        #if DEBUG
        isEnabled = enabled
        #else
        isEnabled = false
        #endif
    }
    func record(_ event: Event, category: Category = .view, outcome: Outcome = .completed, status: Int? = nil, durationMs: Double? = nil, stage: Stage? = nil) {
        guard isEnabled else { return }
        let duration = durationMs.flatMap { $0.isFinite && $0 >= 0 && $0 <= 300_000 ? $0 : nil }
        let code = status.flatMap { (-1100...599).contains($0) ? $0 : nil }
        sequence += 1
        entries.append(Entry(sequence: sequence, elapsedMs: max(0, (now() - origin) * 1000), event: event, category: category, outcome: outcome, status: code, durationMs: duration, stage: stage))
        if entries.count > capacity { entries.removeFirst(entries.count - capacity) }
    }
    func snapshot() -> [Entry] { entries }
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
