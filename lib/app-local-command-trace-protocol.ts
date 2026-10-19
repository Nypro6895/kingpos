// Correlation is diagnostic metadata only, never authentication or idempotency.
export const APP_LOCAL_TRACE_REQUEST_ID = "X-Reylumi-Request-Id";
export const APP_LOCAL_TRACE_FAILURE_CODE = "X-Reylumi-Failure-Code";
export const APP_LOCAL_TRACE_PROXY_REFRESH = "X-Reylumi-Trace-Proxy-Refresh-Ms";
export const APP_LOCAL_TRACE_PROXY_FAILURE = "X-Reylumi-Trace-Proxy-Failure-Code";
export const APP_LOCAL_COMMAND_FAILURE_CODES = [
  "proxy_refresh_unavailable", "auth_unavailable", "handler_timeout", "handler_upstream", "handler_exception",
  "invalid_request", "access_denied", "workspace_changed", "unsupported_command",
] as const;
export type AppLocalCommandFailureCode = typeof APP_LOCAL_COMMAND_FAILURE_CODES[number];
export function appLocalTraceRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : undefined;
}
export function appLocalTraceNow(): number {
  try { const value = performance.now(); return Number.isFinite(value) ? value : 0; } catch { return 0; }
}
export function appLocalTraceDuration(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(300_000, Math.max(0, value)) * 10) / 10 : 0;
}
export function stripAppLocalCommandTraceHeaders(headers: Headers): void {
  for (const name of Array.from(headers.keys())) {
    if (name.toLowerCase().startsWith("x-reylumi-trace-") || name.toLowerCase() === APP_LOCAL_TRACE_FAILURE_CODE.toLowerCase() || name.toLowerCase() === "server-timing") headers.delete(name);
  }
}
