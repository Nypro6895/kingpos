import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { ReadConnectionError } from "./bounded-get";
import policy from "./app-local-command-policy.json";
import namedCommands from "./app-local-command-trace-names.generated.json";
import { APP_LOCAL_TRACE_REQUEST_ID, APP_LOCAL_TRACE_FAILURE_CODE, APP_LOCAL_TRACE_PROXY_REFRESH, APP_LOCAL_TRACE_PROXY_FAILURE, appLocalTraceRequestId, type AppLocalCommandFailureCode } from "./app-local-command-trace-protocol";

type Phase = "validate" | "auth" | "workspace" | "handler";
type Backend = "auth" | "rest" | "rpc";
type Stage = "proxy_refresh" | "auth" | "workspace" | "handler" | "backend_auth" | "backend_rest" | "backend_rpc" | "total";
type ErrorClass = "auth_unavailable" | "read_timeout" | "read_network" | "read_body_limit" | "upload_error" | "unknown";
export type AppLocalCommandTraceRecord = {
  event: "app_local_command_trace"; state: "dispatch" | "result"; utc: string;
  requestId: string; commandId: string; status?: number; failureCode?: AppLocalCommandFailureCode;
  failurePhase?: Phase | "proxy_refresh"; errorClass?: ErrorClass;
  durationsMs: Partial<Record<Stage, number>>; backendCalls: Partial<Record<Backend, number>>;
};
type Options = { clock?: () => number; utc?: () => string; log?: (record: AppLocalCommandTraceRecord) => void };
export interface AppLocalCommandTrace {
  requestId: string;
  proxyUnavailable: boolean;
  run<T>(operation: () => Promise<T>): Promise<T>;
  setCommand(value: unknown): void;
  measure<T>(phase: "auth" | "workspace" | "handler", operation: () => Promise<T>): Promise<T>;
  failure(code: AppLocalCommandFailureCode, phase?: Phase | "proxy_refresh"): void;
  error(error: unknown, known?: "auth_unavailable" | "upload_error"): void;
  finish<T extends Response>(response: T): T;
  thrown(error: unknown): void;
  backendNow(): number;
  observeBackend(kind: Backend, duration: number): void;
  rememberBackendFailure(error: unknown, phase: Phase): void;
}
type Observation = { trace: AppLocalCommandTrace; phase: Phase };
const observation = new AsyncLocalStorage<Observation>();
const allowedCommands = new Set([
  ...Object.entries(policy.modules).flatMap(([module, names]) => names.map(name => "action." + createHash("sha256").update(module + "#" + name).digest("hex").slice(0, 24))),
  ...namedCommands.names,
]);
const bounded = (value: number) => Number.isFinite(value) ? Math.round(Math.min(300_000, Math.max(0, value)) * 10) / 10 : 0;
const quietly = (operation: () => void) => { try { operation(); } catch { /* Diagnostics never change business results. */ } };
function inObservation<T>(scope: Observation, operation: () => Promise<T>): Promise<T> {
  let invoked = false, result: Promise<T> | undefined;
  try { return observation.run(scope, () => { invoked = true; result = operation(); return result; }); }
  catch (error) {
    // A failed observer may fall back only before the operation started. Never
    // replay a write when an observer fails after its callback was invoked.
    if (!invoked) return operation();
    if (result) return result;
    throw error;
  }
}

/** Independent observation only: no read-context memoization, abort or retries. */
export function createAppLocalCommandTrace(requestHeaders: Headers, options: Options = {}): AppLocalCommandTrace {
  // Wall-clock values themselves may exceed the duration cap; only differences
  // are bounded. A bad injected diagnostic clock remains observational.
  const now = () => { try { const value = (options.clock ?? (() => performance.now()))(); return Number.isFinite(value) ? value : 0; } catch { return 0; } };
  const started = now(), requestId = appLocalTraceRequestId(requestHeaders.get(APP_LOCAL_TRACE_REQUEST_ID)) ?? randomUUID();
  const durations: Partial<Record<Stage, number>> = {}, backendCalls: Partial<Record<Backend, number>> = {};
  const failedPhases = new Map<unknown, Phase>();
  let commandId = "unknown", code: AppLocalCommandFailureCode | undefined, failurePhase: Phase | "proxy_refresh" | undefined, errorClass: ErrorClass | undefined;
  let finished = false;
  const rawProxy = requestHeaders.get(APP_LOCAL_TRACE_PROXY_REFRESH);
  if (rawProxy && /^\d{1,6}(?:\.\d{1,3})?$/.test(rawProxy) && Number(rawProxy) <= 300_000) durations.proxy_refresh = bounded(Number(rawProxy));
  const proxyUnavailable = requestHeaders.get(APP_LOCAL_TRACE_PROXY_FAILURE) === "proxy_refresh_unavailable";
  const add = (stage: Stage, duration: number) => { durations[stage] = bounded((durations[stage] ?? 0) + bounded(duration)); };
  function record(state: "dispatch" | "result", status?: number) {
    quietly(() => {
      const utc = (options.utc ?? (() => new Date().toISOString()))();
      const row: AppLocalCommandTraceRecord = { event: "app_local_command_trace", state, utc: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(utc) ? utc : "unknown", requestId, commandId, durationsMs: { ...durations }, backendCalls: { ...backendCalls }, ...(status !== undefined ? { status } : {}), ...(code ? { failureCode: code } : {}), ...(failurePhase ? { failurePhase } : {}), ...(errorClass ? { errorClass } : {}) };
      (options.log ?? (value => console.info(JSON.stringify(value))))(row);
    });
  }
  const trace: AppLocalCommandTrace = {
    requestId,
    run<T>(operation: () => Promise<T>): Promise<T> { record("dispatch"); return inObservation({ trace, phase: "validate" }, operation); },
    setCommand(value: unknown) { if (typeof value === "string" && allowedCommands.has(value)) commandId = value; },
    async measure<T>(phase: "auth" | "workspace" | "handler", operation: () => Promise<T>): Promise<T> {
      const before = now();
      try { return await inObservation({ trace, phase }, operation); }
      catch (error) { quietly(() => { if (failedPhases.size < 64 && !failedPhases.has(error)) failedPhases.set(error, phase); }); throw error; }
      finally { quietly(() => add(phase, now() - before)); }
    },
    failure(value: AppLocalCommandFailureCode, phase?: Phase | "proxy_refresh") { code = value; if (phase) failurePhase = phase; },
    error(error: unknown, known?: "auth_unavailable" | "upload_error") {
      failurePhase = failedPhases.get(error) ?? "validate";
      if (known === "auth_unavailable") { code = "auth_unavailable"; errorClass = known; }
      else if (error instanceof ReadConnectionError) {
        code = error.kind === "timeout" ? "handler_timeout" : "handler_upstream";
        errorClass = error.kind === "timeout" ? "read_timeout" : error.kind === "network" ? "read_network" : "read_body_limit";
      } else { code = "handler_exception"; errorClass = known ?? "unknown"; }
    },
    proxyUnavailable,
    backendNow: now,
    observeBackend(kind: Backend, duration: number) { add(`backend_${kind}`, duration); backendCalls[kind] = Math.min(1_000_000, (backendCalls[kind] ?? 0) + 1); },
    rememberBackendFailure(error: unknown, phase: Phase) { if (failedPhases.size < 64 && !failedPhases.has(error)) failedPhases.set(error, phase); },
    finish<T extends Response>(response: T): T {
      if (finished) return response;
      finished = true;
      quietly(() => {
        durations.total = bounded(now() - started);
        if (response.status < 400) { code = undefined; failurePhase = undefined; errorClass = undefined; }
        response.headers.set(APP_LOCAL_TRACE_REQUEST_ID, requestId);
        if (code) response.headers.set(APP_LOCAL_TRACE_FAILURE_CODE, code);
        const timing = Object.entries(durations).map(([stage, duration]) => `${stage};dur=${duration!.toFixed(1)}${stage.startsWith("backend_") ? `;calls=${backendCalls[stage.slice(8) as Backend] ?? 0}` : ""}`).join(", ");
        const previous = response.headers.get("Server-Timing");
        response.headers.set("Server-Timing", [previous, timing].filter(Boolean).join(", "));
      });
      record("result", response.status);
      return response;
    },
    thrown(error: unknown) { quietly(() => { trace.error(error); durations.total = bounded(now() - started); record("result", 500); }); },
  };
  return trace;
}

/** Observe the existing logical fetch exactly once; never read/clone its body. */
export async function measureAppLocalCommandBackend<T>(kind: Backend, operation: () => Promise<T>): Promise<T> {
  let scope: Observation | undefined;
  quietly(() => { scope = observation.getStore(); });
  if (!scope || !["auth", "rest", "rpc"].includes(kind)) return operation();
  const current = scope;
  let started = 0;
  quietly(() => { started = current.trace.backendNow(); });
  try { return await operation(); }
  catch (error) { quietly(() => current.trace.rememberBackendFailure(error, current.phase)); throw error; }
  finally { quietly(() => current.trace.observeBackend(kind, current.trace.backendNow() - started)); }
}
