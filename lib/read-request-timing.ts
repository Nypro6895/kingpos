/** Request-local Server-Timing, using only fixed stage names and numeric durations.
 * Stages may overlap (adapter auth and Today phases are inside native load).
 * total is wall time; adding the individual spans does not produce wall time.
 */
export const READ_REQUEST_TIMING_STAGES = ["auth", "validate", "lease", "load", "serialize", "today_full", "today_shell", "today_staff", "today_bookings", "today_waiting", "today_financials", "today_extras"] as const;
const STAGES = READ_REQUEST_TIMING_STAGES;
type ReadStage = typeof STAGES[number];
const clock = () => performance.now();
const finiteDuration = (value: number) => Number.isFinite(value) ? Math.min(3_600_000, Math.max(0, value)) : 0;

export function createReadRequestTiming(now: () => number = clock) {
  const started = now();
  const durations = new Map<ReadStage, number>();
  function add(stage: ReadStage, duration: number) {
    if (STAGES.includes(stage)) durations.set(stage, finiteDuration((durations.get(stage) ?? 0) + finiteDuration(duration)));
  }
  async function measure<T>(stage: ReadStage, read: () => Promise<T>): Promise<T> {
    const before = now();
    try { return await read(); } finally { add(stage, now() - before); }
  }
  return {
    measure,
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
      values.push(`total;dur=${finiteDuration(now() - started).toFixed(1)}`);
      const existing = response.headers.get("Server-Timing");
      response.headers.set("Server-Timing", [...(existing ? [existing] : []), ...values].join(", "));
      return response;
    },
  };
}

export type ReadRequestTiming = ReturnType<typeof createReadRequestTiming>;
