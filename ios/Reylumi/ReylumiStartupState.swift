import Foundation

/// Only navigation identity and a transient request are retained; no page data is stored.
struct ReylumiStartupState {
    private(set) var generation = 0
    private(set) var nonce = ""
    private(set) var hasUsablePage = false
    private(set) var isWaiting = false
    private(set) var didCommit = false
    private(set) var isSecurityChallenge = false
    private(set) var request: URLRequest?
    private var previousPageWasUsable = false
    private var acceptsCompletion = true
    private var lastProcessRecovery: Date?

    mutating func begin(_ request: URLRequest?) {
        generation += 1
        nonce = UUID().uuidString
        previousPageWasUsable = hasUsablePage
        self.request = request
        isWaiting = true
        didCommit = false
        isSecurityChallenge = false
        acceptsCompletion = true
    }

    mutating func acceptSecurityChallenge() {
        guard isWaiting, !didCommit, acceptsCompletion else { return }
        isSecurityChallenge = true
    }

    mutating func commit() {
        didCommit = true
        // The previous document is no longer available after commit.
        hasUsablePage = false
        // The provider's document has no Reylumi shell readiness marker. Reveal
        // it at commit and let the visitor finish without the startup timeout.
        if isSecurityChallenge { finish() }
    }

    mutating func ready(nonce: String, generation: Int) -> Bool {
        guard didCommit, !isSecurityChallenge, acceptsCompletion, generation == self.generation,
              !self.nonce.isEmpty, nonce == self.nonce else { return false }
        finish()
        return true
    }

    @discardableResult
    mutating func finish() -> Bool {
        guard acceptsCompletion else { return false }
        isWaiting = false
        hasUsablePage = true
        return true
    }

    mutating func fail(rejectCompletion: Bool = false) {
        isWaiting = false
        acceptsCompletion = !rejectCompletion
        if rejectCompletion { isSecurityChallenge = false }
        hasUsablePage = hasUsablePage || (!didCommit && previousPageWasUsable)
    }

    mutating func processTerminated() {
        generation += 1
        nonce = ""
        isWaiting = false
        didCommit = false
        isSecurityChallenge = false
        hasUsablePage = false
        previousPageWasUsable = false
        acceptsCompletion = false
    }

    mutating func allowProcessRecovery(at now: Date = Date()) -> Bool {
        if let lastProcessRecovery, now.timeIntervalSince(lastProcessRecovery) < 60 { return false }
        lastProcessRecovery = now
        return true
    }

    func retryRequest(origin: URL, currentURL: URL? = nil) -> URLRequest? {
        guard let request, (request.httpMethod ?? "GET").uppercased() == "GET",
              request.httpBody == nil, request.httpBodyStream == nil,
              let url = currentURL ?? request.url else { return nil }
        let policy = NavigationPolicy(origin: origin)
        guard policy.isInternal(url), !policy.isExcluded(url) else { return nil }
        let path = url.path.lowercased()
        // Authentication callbacks and payment returns may contain one-use credentials.
        guard !path.hasPrefix("/api/"), !path.hasPrefix("/auth/"),
              !path.hasPrefix("/booking/manage/"), !path.hasPrefix("/booking-payment/") else { return nil }
        let secretNames: Set<String> = ["token", "code", "secret", "state", "payment", "bookingstripe", "session_id", "payment_intent", "payment_intent_client_secret", "redirect_status"]
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard !query.contains(where: { secretNames.contains($0.name.lowercased()) }) else { return nil }
        // Construct a new GET rather than reloading a POST or reusing its body/headers.
        return URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 15)
    }
}
