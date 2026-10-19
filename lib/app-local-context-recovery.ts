export type AppLocalContextFailure = "timeout" | "network" | "unavailable" | "access" | "invalid";

// Native also reports invalid context/schema as 502. Keep every 502 manual-only
// until the bridge distinguishes a malformed response from an HTTP gateway error.
const transientHttpStatuses = new Set([408, 500, 503, 504]);
const transientNativeCodes = new Set([-1001, -1003, -1004, -1005, -1006, -1009]);

/** Fixed UI categories only; messages, account details and response data stay private. */
export function classifyAppLocalContextFailure(error: unknown): AppLocalContextFailure {
  if (!error || typeof error !== "object") return "invalid";
  const value = error as Record<string, unknown>;
  if (value.name === "AbortError") return "invalid";
  const status = typeof value.status === "number" ? value.status : undefined;
  if (status === 401 || status === 403 || status === 409) return "access";
  // ReadConnectionError also carries HTTP 503. Its size guard is not a network failure.
  if (value.kind === "body-limit") return "invalid";
  if (status !== undefined && status >= 400 && status <= 599 && !transientHttpStatuses.has(status)) return "invalid";
  if (status === 408 || status === 504) return "timeout";
  if (value.name === "ReadConnectionError") {
    return value.kind === "timeout" ? "timeout" : value.kind === "network" ? "network" : "invalid";
  }
  if (value.name === "TimeoutError") return "timeout";
  if (status !== undefined && transientHttpStatuses.has(status)) return "unavailable";
  // The native bridge preserves NSError.code as status; direct transport tests
  // may expose the same NSURLError code in code instead.
  const nativeCode = status !== undefined && status < 0 ? status : typeof value.code === "number" ? value.code : undefined;
  if (nativeCode !== undefined && transientNativeCodes.has(nativeCode)) return nativeCode === -1001 ? "timeout" : "network";
  return "invalid";
}

function cancelled(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Context read cancelled", "AbortError");
}

async function readUntilCancelled<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw cancelled(signal);
  let cancel: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(cancelled(signal));
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw cancelled(signal);
      return read();
    }), aborted]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function waitForRetry(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled(signal));
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(cancelled(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 300);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function elapsedClock(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** Retry only the context transport read once. Admission/acceptance belongs to the caller.
 * The second attempt may start only within 15s of entry. The transport retains
 * its own deadline: this is no new deadline/cancellation timer. A first 25s lost
 * bridge callback therefore cannot start another 25s wait. An eligible second
 * native HTTP read retains its existing 20s resource limit (under 35s total).
 * Its existing 25s lost-callback fallback can still bring client wait under 40s.
 */
export async function runAppLocalContextRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const retryUntil = elapsedClock() + 15_000;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw cancelled(signal);
    try {
      const value = await readUntilCancelled(read, signal);
      if (signal.aborted) throw cancelled(signal);
      return value;
    } catch (error) {
      if (signal.aborted) throw cancelled(signal);
      const failure = classifyAppLocalContextFailure(error);
      if (attempt !== 0 || failure === "access" || failure === "invalid" || elapsedClock() >= retryUntil) throw error;
      await waitForRetry(signal);
      if (elapsedClock() >= retryUntil) throw error;
    }
  }
  throw new Error("Context read did not settle");
}
