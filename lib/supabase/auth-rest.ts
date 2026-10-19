import { fetchWithDeadline, ReadConnectionError } from "@/lib/bounded-get";
import { measureAppLocalCommandBackend, observeAppLocalCommandBackendStatus } from "@/lib/app-local-command-trace";
import { getReadAbortSignal, getReadRequestTiming } from "@/lib/read-context-scope";

export class AuthAvailabilityError extends Error {
  readonly status = 503;
  constructor(area = "Authentication") { super(`${area} temporarily unavailable`); this.name = "AuthAvailabilityError"; }
}

function rejection(error: unknown, status?: number) {
  const value = error as { status?: number; code?: string } | null;
  const code = value?.code ?? "";
  return [401, 403].includes(status ?? value?.status ?? 0)
    || ["bad_jwt", "session_not_found", "refresh_token_not_found", "refresh_token_already_used", "user_not_found", "PGRST301", "PGRST302", "PGRST303"].includes(code);
}

export function isAuthTemporarilyUnavailable(error: unknown, status?: number): boolean {
  if (!error || rejection(error, status)) return false;
  const code = (error as { code?: string }).code ?? "";
  return error instanceof AuthAvailabilityError || error instanceof ReadConnectionError
    || !status || status === 408 || status === 429 || status >= 500
    || /^(?:08|53|57P)/.test(code);
}

/** A critical status read must be verified; an unknown failure cannot become a guest. */
export function assertAuthAvailable(error: unknown, status?: number, area?: string): void {
  if (error && !rejection(error, status)) throw new AuthAvailabilityError(area);
}

function backendKind(url: string): "auth" | "rest" | "rpc" | null {
  try {
    const path = new URL(url).pathname;
    return /^\/auth\/v1(?:\/|$)/.test(path) ? "auth"
      : /^\/rest\/v1\/rpc(?:\/|$)/.test(path) ? "rpc"
      : /^\/rest\/v1(?:\/|$)/.test(path) ? "rest" : null;
  } catch { return null; }
}

export const supabaseDeadlineFetch: typeof fetch = (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  // Large Storage downloads/uploads and transactional writes keep their existing
  // transport. A read timeout cannot tell a caller whether a mutation committed.
  const kind = backendKind(url);
  const read = async () => {
    if (!["GET", "HEAD"].includes(method) || !/\/(?:auth|rest)\/v1(?:\/|$)/.test(url)) return fetch(input, init);
    const parent = getReadAbortSignal();
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = parent && caller ? AbortSignal.any([parent, caller]) : parent ?? caller;
    try {
      const response = await fetchWithDeadline(input, parent ? { ...init, signal } : init, { timeoutMs: 5_000, totalTimeoutMs: 10_250, maxAttempts: 2, retryDelayMs: 250 });
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        // Retain the known final HTTP code before the existing typed error.
        // This records one logical result, not the transport retry attempts.
        if (kind) observeAppLocalCommandBackendStatus(kind, response.status);
        throw new ReadConnectionError("network");
      }
      return response;
    } catch (error) {
      // This transport owns the complete safe-read budget. PostgREST recognizes
      // AbortError as terminal; leaving a timeout/network/last503 retryable would
      // start its independent four-attempt loop after ours. Keep typed503 and
      // the original error identity; confirmed401/403 responses pass unchanged.
      if (error instanceof ReadConnectionError) error.name = "AbortError";
      else if (signal?.aborted && (!(error instanceof Error) || error.name !== "AbortError")) {
        const stopped = new ReadConnectionError("timeout");
        stopped.name = "AbortError";
        throw stopped;
      }
      throw error;
    }
  };
  const timing = getReadRequestTiming();
  // Keep only fixed service categories. URLs, record keys, filters, credentials,
  // headers and response bodies never enter the request-local diagnostic data.
  if (!kind) return read();
  // A command observer records elapsed transport only. It never installs a read
  // scope, changes retry/cancellation policy, or inspects a mutation response.
  const operation = timing ? () => timing.measureBackend(kind, read) : read;
  return measureAppLocalCommandBackend(kind, operation);
};
