export type AppLocalContextFailure = "timeout" | "network" | "unavailable" | "sign-in" | "access" | "workspace" | "verification" | "reset" | "invalid";

/** Local diagnostics accept fixed codes only; never server text or identifiers. */
export const APP_LOCAL_CONTEXT_REASONS = [
  "schema", "scope", "generation", "lease-expired", "lease-invalid", "unconfirmed", "online-stale",
  "sign-in", "permission-denied", "workspace-changed", "page-authority", "portable-authority", "authority-family",
  "workspace-home", "reset", "logout", "lease-unavailable", "transport-timeout", "transport-network",
  "transport-unavailable", "transport-invalid", "handoff", "late-reply", "lease-valid", "online-valid",
] as const;
export type AppLocalContextReason = typeof APP_LOCAL_CONTEXT_REASONS[number];

/** A rejected DTO is not an invented HTTP403. Preserve only an explicit denial. */
export function appLocalAdmissionError(reason: AppLocalContextReason, status?: number): Error {
  return Object.assign(new Error("Application page admission was not confirmed"), {
    contextReason: reason,
    ...([401, 403, 409].includes(status ?? 0) ? { status } : {}),
  });
}

export function appLocalContextFailureReason(error: unknown): AppLocalContextReason {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  if (value.status === 401) return "sign-in";
  if (value.status === 403) return "permission-denied";
  if (value.status === 409) return "workspace-changed";
  if (isAppLocalContextCancellation(error)) return "late-reply";
  if (APP_LOCAL_CONTEXT_REASONS.includes(value.contextReason as AppLocalContextReason)) return value.contextReason as AppLocalContextReason;
  const failure = classifyAppLocalContextFailure(error);
  return failure === "timeout" ? "transport-timeout" : failure === "network" ? "transport-network"
    : failure === "unavailable" ? "transport-unavailable" : "transport-invalid";
}

/** Native discarded an older read; it did not deny this user's access. */
export function isAppLocalContextCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  return value.status === -999 || value.code === -999;
}

// Native also reports invalid context/schema as 502. Keep every 502 manual-only
// until the bridge distinguishes a malformed response from an HTTP gateway error.
const transientHttpStatuses = new Set([408, 500, 503, 504]);
const transientNativeCodes = new Set([-1001, -1003, -1004, -1005, -1006, -1009]);

/** Fixed UI categories only; messages, account details and response data stay private. */
export function classifyAppLocalContextFailure(error: unknown): AppLocalContextFailure {
  if (!error || typeof error !== "object") return "invalid";
  const value = error as Record<string, unknown>;
  const status = typeof value.status === "number" ? value.status : undefined;
  if (status === 401) return "sign-in";
  if (status === 403) return "access";
  if (status === 409) return "workspace";
  if (isAppLocalContextCancellation(error)) return "verification";
  if (value.name === "AbortError") return "invalid";
  if (value.contextReason === "reset") return "reset";
  if (value.contextReason === "logout" || value.contextReason === "sign-in") return "sign-in";
  if (value.contextReason === "workspace-changed") return "workspace";
  if (typeof value.contextReason === "string" && ["generation", "lease-expired", "lease-invalid", "unconfirmed", "online-stale", "page-authority", "portable-authority", "authority-family", "workspace-home", "lease-unavailable"].includes(value.contextReason)) return "verification";
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
      if (attempt !== 0 || !["timeout", "network", "unavailable"].includes(failure) || elapsedClock() >= retryUntil) throw error;
      await waitForRetry(signal);
      if (elapsedClock() >= retryUntil) throw error;
    }
  }
  throw new Error("Context read did not settle");
}
