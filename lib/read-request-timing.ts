/** Request-local Server-Timing, using only fixed stage names and numeric durations. */
const STAGES = ["auth", "validate", "load", "serialize"] as const;
type ReadStage = typeof STAGES[number];
const clock = () => performance.now();
const finiteDuration = (value: number) => Number.isFinite(value) ? Math.min(3_600_000, Math.max(0, value)) : 0;

export function createReadRequestTiming(now: () => number = clock) {
  const started = now();
  const durations = new Map<ReadStage, number>();
  function add(stage: ReadStage, duration: number) {
    if (STAGES.includes(stage)) durations.set(stage, finiteDuration((durations.get(stage) ?? 0) + finiteDuration(duration)));
  }
  return {
    async measure<T>(stage: ReadStage, read: () => Promise<T>): Promise<T> {
      const before = now();
      try { return await read(); } finally { add(stage, now() - before); }
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
