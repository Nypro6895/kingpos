import { APP_LOCAL_CONTEXT_REASONS, type AppLocalContextReason } from "./app-local-context-recovery";

/** Explicitly enabled local diagnostics. No payloads, identifiers, persistence or network export. */
export const EXPERIENCE_TRACE_EVENTS = [
  "boot.start", "boot.ready", "data.visible", "route.reveal",
  "auth.start", "auth.end", "auth.join", "auth.skip", "auth.abort", "auth.reject",
  "context.read.start", "context.read.end", "context.accept", "context.reject", "context.abort", "gate.hide", "gate.show",
  "timer.schedule", "timer.fire", "timer.cancel",
  "cache.reset", "cache.invalidate", "cache.hit", "cache.miss", "cache.join", "cache.restore.start", "cache.restore.end", "cache.read.start", "cache.read.end", "cache.accept", "cache.refresh",
  "lifecycle.focus", "lifecycle.visible", "lifecycle.foreground", "lifecycle.online",
  "document.reload.request", "document.pagehide", "document.pageshow",
] as const;
export type ExperienceTraceEvent = typeof EXPERIENCE_TRACE_EVENTS[number];
export const EXPERIENCE_TRACE_TRIGGERS = ["mount", "focus", "visible", "foreground", "online", "interval", "lease-expiry", "mutation", "reset", "manual", "resource", "unknown"] as const;
export type ExperienceTraceTrigger = typeof EXPERIENCE_TRACE_TRIGGERS[number];
export const EXPERIENCE_TRACE_REASONS = ["identity", "permissions", "resource", "expired", "reset", "logout", "transient", "scope", "grant", "generation", "mutation", "manual", "unknown"] as const;
export type ExperienceTraceReason = typeof EXPERIENCE_TRACE_REASONS[number];
export type ExperienceTraceFields = {
  source?: "web" | "app-local" | "cache" | "scheduler";
  trigger?: ExperienceTraceTrigger;
  reason?: ExperienceTraceReason;
  contextReason?: AppLocalContextReason;
  area?: "today" | "shell" | "other";
  phase?: "shell" | "staff" | "bookings" | "waiting" | "financials" | "extras" | "full" | "none";
  status?: number;
  durationMs?: number;
  operation?: number;
  /** Random response correlation only; never account/scope/resource identity. */
  requestId?: string;
  readKind?: "context" | "read";
  readSource?: "network" | "joined" | "cache";
  blocked?: boolean;
  offline?: boolean;
  fresh?: boolean;
  changed?: boolean;
  scopeChanged?: boolean;
  permissionChanged?: boolean;
  generationChanged?: boolean;
  grantChanged?: boolean;
  identityChanged?: boolean;
};
export type ExperienceTraceEntry = ExperienceTraceFields & { sequence: number; atMs: number; event: ExperienceTraceEvent };
const LIMIT = 256;
let sequence = 0, operation = 0;
const entries: ExperienceTraceEntry[] = [];
let installed = false;

declare global {
  interface Window {
    __reylumiDiagnosticsEnabled?: boolean;
    __reylumiExportDiagnostics?: () => void;
    __reylumiBundleParseStartedAt?: number;
    __reylumiDiagnostics?: { snapshot(): ExperienceTraceEntry[]; clear(): void };
  }
}
const enabled = () => typeof window !== "undefined" && window.__reylumiDiagnosticsEnabled === true;
const clock = () => typeof performance === "undefined" ? 0 : Math.max(0, Math.round(performance.now() * 10) / 10);
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const member = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && values.includes(value as T);

export function getExperienceTraceSnapshot(): ExperienceTraceEntry[] { return enabled() ? entries.map(entry => ({ ...entry })) : []; }
export function clearExperienceTrace() { entries.length = 0; }
export function nextExperienceTraceOperation() { return enabled() ? ++operation : 0; }

export function recordExperienceTrace(event: ExperienceTraceEvent, fields: ExperienceTraceFields = {}) {
  if (!enabled() || !member(EXPERIENCE_TRACE_EVENTS, event)) return;
  const entry: ExperienceTraceEntry = { sequence: ++sequence, atMs: clock(), event };
  if (member(["web", "app-local", "cache", "scheduler"] as const, fields.source)) entry.source = fields.source;
  if (member(EXPERIENCE_TRACE_TRIGGERS, fields.trigger)) entry.trigger = fields.trigger;
  if (member(EXPERIENCE_TRACE_REASONS, fields.reason)) entry.reason = fields.reason;
  if (member(APP_LOCAL_CONTEXT_REASONS, fields.contextReason)) entry.contextReason = fields.contextReason;
  if (member(["today", "shell", "other"] as const, fields.area)) entry.area = fields.area;
  if (member(["shell", "staff", "bookings", "waiting", "financials", "extras", "full", "none"] as const, fields.phase)) entry.phase = fields.phase;
  for (const key of ["blocked", "offline", "fresh", "changed", "scopeChanged", "permissionChanged", "generationChanged", "grantChanged", "identityChanged"] as const) if (typeof fields[key] === "boolean") entry[key] = fields[key];
  if (numeric(fields.status)) entry.status = Math.trunc(Math.min(999, Math.max(-10000, fields.status!)));
  if (numeric(fields.durationMs)) entry.durationMs = Math.round(Math.min(604_800_000, Math.max(0, fields.durationMs!)) * 10) / 10;
  if (numeric(fields.operation)) entry.operation = Math.trunc(Math.min(1_000_000_000, Math.max(0, fields.operation!)));
  if (member(["context", "read"] as const, fields.readKind) && member(["network", "joined", "cache"] as const, fields.readSource)
    && ["context.read.end", "context.accept", "context.reject", "context.abort", "auth.reject", "cache.read.end", "cache.accept"].includes(event)) {
    entry.readKind = fields.readKind; entry.readSource = fields.readSource;
    const requestId = fields.readSource !== "cache" && typeof fields.requestId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(fields.requestId) ? fields.requestId.toLowerCase() : undefined;
    if (requestId) entry.requestId = requestId;
  }
  entries.push(entry);
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
  try { window.__reylumiDiagnostics ??= Object.freeze({ snapshot: getExperienceTraceSnapshot, clear: clearExperienceTrace }); } catch { /* Diagnostic access must never change the application's behavior. */ }
}

/** A single passive listener set for the diagnostic document; it never starts reads. */
export function installExperienceTraceLifecycle() {
  if (!enabled() || installed) return;
  installed = true;
  for (const [name, event] of [["focus", "lifecycle.focus"], ["online", "lifecycle.online"], ["reylumi:foreground", "lifecycle.foreground"], ["pagehide", "document.pagehide"], ["pageshow", "document.pageshow"]] as const) {
    window.addEventListener(name, () => recordExperienceTrace(event));
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") recordExperienceTrace("lifecycle.visible"); });
}
