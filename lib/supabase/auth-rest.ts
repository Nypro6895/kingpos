import { fetchWithDeadline, ReadConnectionError } from "@/lib/bounded-get";
import { getReadRequestTiming } from "@/lib/read-context-scope";

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

export const supabaseDeadlineFetch: typeof fetch = (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  // Large Storage downloads/uploads and transactional writes keep their existing
  // transport. A read timeout cannot tell a caller whether a mutation committed.
  const read = () => !["GET", "HEAD"].includes(method) || !/\/(?:auth|rest)\/v1(?:\/|$)/.test(url)
    ? fetch(input, init)
    : fetchWithDeadline(input, init, { timeoutMs: 5_000, totalTimeoutMs: 10_250, maxAttempts: 2, retryDelayMs: 250 });
  const timing = getReadRequestTiming();
  if (!timing) return read();
  // Keep only fixed service categories. URLs, record keys, filters, credentials,
  // headers and response bodies never enter the request-local diagnostic data.
  let pathname: string;
  try { pathname = new URL(url).pathname; } catch { return read(); }
  const kind = /^\/auth\/v1(?:\/|$)/.test(pathname) ? "auth"
    : /^\/rest\/v1\/rpc(?:\/|$)/.test(pathname) ? "rpc"
    : /^\/rest\/v1(?:\/|$)/.test(pathname) ? "rest" : null;
  return kind ? timing.measureBackend(kind, read) : read();
};
