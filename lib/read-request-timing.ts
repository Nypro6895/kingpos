/** Request-local Server-Timing, using only fixed stage names and numeric durations.
 * Stages may overlap (adapter auth and Today phases are inside native load).
 * total is wall time; adding the individual spans does not produce wall time.
 */
export const READ_REQUEST_TIMING_STAGES = ["auth", "validate", "lease", "load", "serialize", "today_full", "today_shell", "today_staff", "today_bookings", "today_waiting", "today_financials", "today_extras", "clock", "hours", "staff_board", "staff_activity", "bookings", "waiting", "financial_report", "financial_compare", "extras"] as const;
const STAGES = READ_REQUEST_TIMING_STAGES;
export type ReadStage = typeof STAGES[number];
export type ReadBackendKind = "auth" | "rest" | "rpc";
const BACKENDS: readonly ReadBackendKind[] = ["auth", "rest", "rpc"];
const clock = () => performance.now();
const finiteDuration = (value: number) => Number.isFinite(value) ? Math.min(3_600_000, Math.max(0, value)) : 0;
const addCount = (value: number, amount = 1) => Math.min(Number.MAX_SAFE_INTEGER, value + amount);

export function createReadRequestTiming(now: () => number = clock) {
  const started = now();
  const durations = new Map<ReadStage, number>();
  const backends = new Map<ReadBackendKind, { calls: number; duration: number; bytes: number; sized: number }>();
  function add(stage: ReadStage, duration: number) {
    if (STAGES.includes(stage)) durations.set(stage, finiteDuration((durations.get(stage) ?? 0) + finiteDuration(duration)));
  }
  async function measure<T>(stage: ReadStage, read: () => Promise<T>): Promise<T> {
    const before = now();
    try { return await read(); } finally { add(stage, now() - before); }
  }
  return {
    measure,
    /** One logical transport call, including its existing retries/body policy.
     * This is not a database query/attempt count. Content-Length, when present,
     * describes only the returned response, not every attempt or decoded JSON.
     * Duration ends when the existing fetch promise settles: bounded GETs
     * already buffer bodies; raw RPC POSTs normally settle at response headers.
     */
    async measureBackend(kind: ReadBackendKind, read: () => Promise<Response>): Promise<Response> {
      if (!BACKENDS.includes(kind)) return read();
      let metrics = backends.get(kind);
      if (!metrics) {
        metrics = { calls: 0, duration: 0, bytes: 0, sized: 0 };
        backends.set(kind, metrics);
      }
      metrics.calls = addCount(metrics.calls);
      const before = now();
      try {
        const response = await read();
        const rawLength = response.headers.get("content-length");
        if (rawLength !== null && /^\d+$/.test(rawLength)) {
          const length = Number(rawLength);
          if (Number.isSafeInteger(length)) {
            metrics.bytes = addCount(metrics.bytes, length);
            metrics.sized = addCount(metrics.sized);
          }
        }
        return response;
      } finally { metrics.duration = finiteDuration(metrics.duration + finiteDuration(now() - before)); }
    },
    measureToday<T>(phase: unknown, read: () => Promise<T>): Promise<T> {
      // Never derive a header token from a query/resource key. These spans are
      // nested inside load; their durations must not be summed with load/total.
      const stage: ReadStage = phase === "shell" ? "today_shell" : phase === "staff" ? "today_staff"
        : phase === "bookings" ? "today_bookings" : phase === "waiting" ? "today_waiting"
        : phase === "financials" ? "today_financials" : phase === "extras" ? "today_extras" : "today_full";
      return measure(stage, read);
    },
    measureSync<T>(stage: ReadStage, read: () => T): T {
      const before = now();
      try { return read(); } finally { add(stage, now() - before); }
    },
    finish<T extends Response>(response: T): T {
      const values = Array.from(durations, ([stage, duration]) => `${stage};dur=${duration.toFixed(1)}`);
      for (const kind of BACKENDS) {
        const metrics = backends.get(kind);
        if (metrics) values.push(`backend_${kind};dur=${metrics.duration.toFixed(1)};calls=${metrics.calls}${metrics.sized ? `;bytes=${metrics.bytes};sized=${metrics.sized}` : ""}`);
      }
      values.push(`total;dur=${finiteDuration(now() - started).toFixed(1)}`);
      const existing = response.headers.get("Server-Timing");
      response.headers.set("Server-Timing", [...(existing ? [existing] : []), ...values].join(", "));
      return response;
    },
  };
}

export type ReadRequestTiming = ReturnType<typeof createReadRequestTiming>;
