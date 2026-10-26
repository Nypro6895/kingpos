import { APP_LOCAL_TRACE_REQUEST_ID, appLocalTraceRequestId } from "./app-local-command-trace-protocol";

/** Ephemeral diagnostics only. Never use these values as authority or cache keys. */
export const APP_LOCAL_READ_REQUEST_ID = APP_LOCAL_TRACE_REQUEST_ID;
export const APP_LOCAL_READ_TRACE_FIELD = "__reylumiReadTrace";
export const readTraceRequestId = appLocalTraceRequestId;
export type AppLocalReadTrace = {
  version: 1;
  kind: "context" | "read";
  source: "network" | "joined" | "cache";
  requestId?: string;
};
const traces = new WeakMap<object, AppLocalReadTrace>();

export function newReadRequestId(headers?: Headers): string | undefined {
  try {
    const supplied = appLocalTraceRequestId(headers?.get(APP_LOCAL_READ_REQUEST_ID));
    if (supplied) return supplied;
    // An older/custom-origin runtime may not expose UUID generation. Losing
    // correlation must never prevent its otherwise valid read.
    return typeof globalThis.crypto?.randomUUID === "function" ? appLocalTraceRequestId(globalThis.crypto.randomUUID()) : undefined;
  } catch { return; }
}

export function responseReadTrace(response: Response, sentId: string | undefined, kind: AppLocalReadTrace["kind"]): AppLocalReadTrace {
  try {
    const requestId = appLocalTraceRequestId(response.headers.get(APP_LOCAL_READ_REQUEST_ID));
    return { version: 1, kind, source: "network", ...(requestId && requestId === appLocalTraceRequestId(sentId) ? { requestId } : {}) };
  } catch { return { version: 1, kind, source: "network" }; }
}

function sanitized(value: unknown): AppLocalReadTrace | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Partial<AppLocalReadTrace>;
  if (row.version !== 1 || !["context", "read"].includes(row.kind ?? "") || !["network", "joined", "cache"].includes(row.source ?? "")) return;
  const requestId = row.source === "cache" ? undefined : appLocalTraceRequestId(row.requestId);
  return { version: 1, kind: row.kind!, source: row.source!, ...(requestId ? { requestId } : {}) };
}

/** Remove bridge-only metadata before a DTO can be passed to a cache or caller. */
export function captureAppLocalReadTrace<T>(value: T, supplied?: AppLocalReadTrace): T {
  if (!value || typeof value !== "object") return value;
  try {
    const object = value as Record<string, unknown>;
    const raw = supplied ?? object[APP_LOCAL_READ_TRACE_FIELD];
    if (Object.hasOwn(object, APP_LOCAL_READ_TRACE_FIELD)) delete object[APP_LOCAL_READ_TRACE_FIELD];
    const trace = sanitized(raw);
    if (trace) traces.set(value, trace);
  } catch { /* Diagnostics cannot change response/error semantics. */ }
  return value;
}

export function getAppLocalReadTrace(value: unknown): AppLocalReadTrace | undefined {
  if (!value || typeof value !== "object") return;
  captureAppLocalReadTrace(value);
  const trace = traces.get(value);
  return trace ? { ...trace } : undefined;
}

export function appLocalReadTraceFields(value: unknown) {
  const trace = getAppLocalReadTrace(value);
  return trace ? { readKind: trace.kind, readSource: trace.source, ...(trace.requestId ? { requestId: trace.requestId } : {}) } : {};
}
