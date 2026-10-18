/** Local read diagnostics only: fixed categories/counters, never resource keys or data. */
export const READ_RESOURCE_CATEGORIES = ["bookings", "reports", "salon-profile", "app-local", "other"] as const;
export const READ_REQUEST_OUTCOMES = ["cache-hit", "joined", "cooldown", "network", "not-modified", "error", "aborted", "access-denied"] as const;
export type ReadResourceCategory = typeof READ_RESOURCE_CATEGORIES[number];
export type ReadRequestOutcome = typeof READ_REQUEST_OUTCOMES[number];
export type ReadRequestMetric = {
  category: ReadResourceCategory;
  outcome: ReadRequestOutcome;
  count: number;
  durationMsTotal: number;
  durationMsMax: number;
};

/** Classify then discard the key. Do not return dynamic names, paths or query values. */
export function readResourceCategory(key: string): ReadResourceCategory {
  const path = key.split("?", 1)[0];
  if (path === "/api/pos/owner/bookings") return "bookings";
  if (path === "/api/pos/owner/reports") return "reports";
  if (path === "/api/salon-profile/content") return "salon-profile";
  if (path === "/api/app-local/read" || path.startsWith("app-local:")) return "app-local";
  return "other";
}

export function createReadRequestMetrics() {
  // At most 5 * 8 entries, including after arbitrarily many reads or scope changes.
  const counters = new Map<string, ReadRequestMetric>();
  function record(category: ReadResourceCategory, outcome: ReadRequestOutcome, durationMs = 0) {
    if (!READ_REQUEST_OUTCOMES.includes(outcome)) return;
    const safeCategory = READ_RESOURCE_CATEGORIES.includes(category) ? category : "other";
    const duration = Number.isFinite(durationMs) ? Math.min(60_000, Math.max(0, durationMs)) : 0;
    const key = `${safeCategory}:${outcome}`;
    const previous = counters.get(key);
    counters.set(key, {
      category: safeCategory, outcome,
      count: Math.min(1_000_000_000, (previous?.count ?? 0) + 1),
      durationMsTotal: Math.min(Number.MAX_SAFE_INTEGER, (previous?.durationMsTotal ?? 0) + duration),
      durationMsMax: Math.max(previous?.durationMsMax ?? 0, duration),
    });
  }
  return {
    record,
    snapshot: (): ReadRequestMetric[] => Array.from(counters.values(), value => ({ ...value })),
    reset: () => counters.clear(),
  };
}

const clientReadMetrics = createReadRequestMetrics();
/** No persistence, logging, tracking SDK, global browser property or network export. */
export function recordReadRequest(category: ReadResourceCategory, outcome: ReadRequestOutcome, durationMs = 0) {
  // Server responses use request-local Server-Timing instead of visitor-shared counters.
  if (typeof window !== "undefined") clientReadMetrics.record(category, outcome, durationMs);
}
export function getReadRequestMetrics() { return clientReadMetrics.snapshot(); }
export function resetReadRequestMetrics() { clientReadMetrics.reset(); }

