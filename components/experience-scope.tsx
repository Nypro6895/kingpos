"use client";

import { Activity, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { ExperienceContext } from "@/lib/experience-context";
import { resetExperienceCaches } from "@/lib/reset-experience-cache";
import { resumeExperienceResources } from "@/lib/experience-resource-cache";
import { PageLoadingSkeleton } from "@/components/loading-feedback";
import { fetchBoundedGet } from "@/lib/bounded-get";
import { WorkspaceText } from "@/components/workspace-language";
import { allowExperienceReload, type ExperienceReloadReason } from "@/lib/experience-reload";
import { getExperienceOfflineAuthorizationPath, installExperienceOfflineNavigation, lockExperienceOffline, prepareExperienceOfflinePath, readExperienceOfflineBootGrant, refreshExperienceOfflineAuthorization, releaseExperienceOfflineBootGuard, restoreExperienceOfflineAuthorization, waitForExperienceOfflineLock } from "@/lib/experience-offline-client";
import { EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT, getExperienceOfflineGrant, markExperienceScopeOnlineValidated } from "@/lib/experience-persistent-cache";
import { OfflineNetworkFormGuard } from "@/components/offline-network-form-guard";
import { PreparedReadViewRefresh } from "@/components/prepared-read-view-refresh";
import { installExperienceTraceLifecycle, nextExperienceTraceOperation, recordExperienceTrace, type ExperienceTraceTrigger } from "@/lib/experience-trace";

function ExperienceOfflineRuntime({ scope, check }: { scope: string; check: (force?: boolean, background?: boolean, trigger?: ExperienceTraceTrigger) => Promise<boolean> }) {
  const pathname = usePathname();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const currentPath = () => location.pathname + location.search;
    void restoreExperienceOfflineAuthorization(scope).then(grant => { if (active && grant && readExperienceOfflineBootGrant(scope).present) void check(true, false, "mount"); });
    void refreshExperienceOfflineAuthorization(currentPath(), scope, controller.signal);
    const prepare = () => { if (active && document.visibilityState === "visible" && navigator.onLine) void prepareExperienceOfflinePath(currentPath(), { scope }); };
    recordExperienceTrace("timer.schedule", { source: "web", trigger: "interval", reason: "grant", durationMs: 3500 });
    let preparationFired = false;
    const timer = setTimeout(() => { preparationFired = true; recordExperienceTrace("timer.fire", { source: "web", trigger: "interval", reason: "grant" }); prepare(); }, 3500);
    const authorize = () => { if (active && document.visibilityState === "visible" && navigator.onLine) void refreshExperienceOfflineAuthorization(currentPath(), scope, controller.signal); };
    window.addEventListener("online", prepare);
    window.addEventListener("online", authorize); window.addEventListener("focus", authorize); window.addEventListener("reylumi:foreground", authorize);
    return () => { active = false; controller.abort(); if (!preparationFired) recordExperienceTrace("timer.cancel", { source: "web", trigger: "interval", reason: "grant" }); clearTimeout(timer); window.removeEventListener("online", prepare); window.removeEventListener("online", authorize); window.removeEventListener("focus", authorize); window.removeEventListener("reylumi:foreground", authorize); };
  }, [scope, pathname, check]);
  return <span hidden data-experience-offline-scope={scope} />;
}

type ConnectionState = "idle" | "checking" | "waiting" | "failed";
type ScopeValue = { context: ExperienceContext; validate: (force?: boolean) => Promise<boolean>; checkedAt: () => number; validationRevision: number; getValidationRevision: () => number; connectionState: ConnectionState; retryConnection: () => Promise<boolean> };
const ScopeContext = createContext<ScopeValue | null>(null);
const RETRY_DELAYS = [1_000, 3_000, 8_000];

/** Cached route DOM is always owned by a currently validated identity/grant scope. */
export function ExperienceScopeProvider({ context, children }: { context: ExperienceContext; children: ReactNode }) {
  const checked = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true);
  const validationEpoch = useRef(0);
  const initialized = useRef(false);
  const revision = useRef(0);
  const currentRequest = useRef<AbortController | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);
  const retryDue = useRef(0);
  const reloadAfterValidation = useRef(false);
  const recovering = useRef(false);
  const blocking = useRef(false);
  const runValidation = useRef<(force?: boolean, background?: boolean, trigger?: ExperienceTraceTrigger) => Promise<boolean>>(() => Promise.resolve(false));
  const [validationRevision, setValidationRevision] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [offlineNavigationMessage, setOfflineNavigationMessage] = useState(false);
  const recover = useCallback((reason: ExperienceReloadReason) => {
    recordExperienceTrace("auth.reject", { source: "web", reason, blocked: true });
    recovering.current = true;
    blocking.current = true;
    setBlocked(true);
    setConnectionState("idle");
    if (allowExperienceReload(reason)) void waitForExperienceOfflineLock().then(cleared => { if (cleared) { recordExperienceTrace("document.reload.request", { source: "web", reason }); window.location.reload(); } else setRecoveryRequired(true); });
    else setRecoveryRequired(true);
  }, []);
  const invalidateValidation = useCallback(() => {
    validationEpoch.current++;
    if (currentRequest.current) recordExperienceTrace("auth.abort", { source: "web", reason: "reset" });
    currentRequest.current?.abort();
    currentRequest.current = null;
    if (retryTimer.current !== null) { recordExperienceTrace("timer.cancel", { source: "web", reason: "transient" }); clearTimeout(retryTimer.current); }
    retryTimer.current = null;
    retryCount.current = 0;
    retryDue.current = 0;
    pending.current = null;
    checked.current = 0;
  }, []);

  const validate = useCallback((force = false, background = false, trigger: ExperienceTraceTrigger = "unknown"): Promise<boolean> => {
    if (recovering.current) { recordExperienceTrace("auth.skip", { source: "web", trigger, reason: "resource" }); return Promise.resolve(false); }
    if (!force && checked.current && Date.now() - checked.current < 30_000) { recordExperienceTrace("auth.skip", { source: "web", trigger, fresh: true }); return Promise.resolve(true); }
    const lease = getExperienceOfflineGrant(context.scope);
    const localPath = getExperienceOfflineAuthorizationPath();
    if (lease?.path === localPath && localPath) {
      background = true; blocking.current = false; setBlocked(false);
    }
    recordExperienceTrace(lease?.path === localPath && localPath ? "cache.hit" : "cache.miss", { source: "web", trigger, reason: "grant", offline: !navigator.onLine });
    if (!background) {
      blocking.current = true;
      if (context.authenticated) setBlocked(true);
    }
    if (pending.current) { recordExperienceTrace("auth.join", { source: "web", trigger, blocked: blocking.current }); return pending.current; }
    // Several retained views can request authorization together. A failed
    // attempt owns its retry window; focus/reveal must not restart that budget.
    if (retryDue.current > Date.now()) { recordExperienceTrace("auth.skip", { source: "web", trigger, reason: "transient" }); return Promise.resolve(false); }
    const epoch = validationEpoch.current;
    if (retryTimer.current !== null) { recordExperienceTrace("timer.cancel", { source: "web", reason: "transient" }); clearTimeout(retryTimer.current); }
    retryTimer.current = null;
    const allowOffline = async () => {
      const path = getExperienceOfflineAuthorizationPath();
      if (!path) return false;
      const existing = getExperienceOfflineGrant(context.scope);
      const grant = existing?.path === path ? existing : await restoreExperienceOfflineAuthorization(context.scope);
      if (!grant || !alive.current || epoch !== validationEpoch.current || recovering.current) return false;
      checked.current = Date.now(); retryCount.current = 0; blocking.current = false;
      recordExperienceTrace("auth.end", { source: "web", trigger, offline: true, reason: "grant", blocked: false });
      resumeExperienceResources(context.scope); setBlocked(false); setConnectionState("idle");
      setValidationRevision(++revision.current); return true;
    };
    if (!navigator.onLine) return allowOffline().then(allowed => { if (!allowed && blocking.current) setConnectionState("failed"); return allowed; });
    if (blocking.current) setConnectionState("checking");
    const controller = new AbortController();
    const traceOperation = nextExperienceTraceOperation(), traceStarted = performance.now();
    recordExperienceTrace("auth.start", { source: "web", trigger, fresh: force, blocked: blocking.current, operation: traceOperation });
    currentRequest.current = controller;
    const unavailable = async () => {
      if (!alive.current || epoch !== validationEpoch.current || controller.signal.aborted) return false;
      recordExperienceTrace("auth.reject", { source: "web", trigger, reason: "transient", blocked: blocking.current, operation: traceOperation });
      // A content save does not revoke the current view's verified identity.
      // Blocking resume/access checks retain the bounded fail-closed retry path.
      if (!blocking.current) return false;
      if (await allowOffline()) return true;
      if (!alive.current || epoch !== validationEpoch.current || controller.signal.aborted) return false;
      const delay = RETRY_DELAYS[retryCount.current++];
      if (delay !== undefined && navigator.onLine && document.visibilityState === "visible") {
        setConnectionState("waiting");
        retryDue.current = Date.now() + delay;
        recordExperienceTrace("timer.schedule", { source: "web", trigger, reason: "transient", durationMs: delay, operation: traceOperation });
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          retryDue.current = 0;
          recordExperienceTrace("timer.fire", { source: "web", trigger, reason: "transient", operation: traceOperation });
          if (alive.current && epoch === validationEpoch.current) void runValidation.current(true, false, trigger);
        }, delay);
      } else { retryDue.current = Date.now() + 30_000; setConnectionState("failed"); }
      return false;
    };
    const request = fetchBoundedGet(`/api/experience/context${context.admin ? "?admin=1" : ""}`, { signal: controller.signal, cache: "no-store", credentials: "same-origin" }, { timeoutMs: 8_000, totalTimeoutMs: 8_000, maxAttempts: 1 })
      .then(async response => {
        recordExperienceTrace("auth.end", { source: "web", trigger, status: response.status, durationMs: performance.now() - traceStarted, operation: traceOperation });
        if (!alive.current || epoch !== validationEpoch.current) return false;
        if (response.status === 401 || response.status === 403) {
          setConnectionState("idle");
          resetExperienceCaches({ suspend: true, reason: "permissions", notify: false });
          setBlocked(true);
          recover("permissions");
          return false;
        }
        if (!response.ok) return unavailable();
        const next = await response.json() as ExperienceContext;
        if (!alive.current || epoch !== validationEpoch.current) return false;
        if (!next || typeof next.scope !== "string" || typeof next.authenticated !== "boolean" || typeof next.workspaceId !== "string" || typeof next.permissionRevision !== "string"
          || !(next.viewerId === null || typeof next.viewerId === "string") || !(next.salonId === null || typeof next.salonId === "string")) return unavailable();
        if (next.scope !== context.scope || next.viewerId !== context.viewerId || next.workspaceId !== context.workspaceId || next.authenticated !== context.authenticated || next.permissionRevision !== context.permissionRevision || next.salonId !== context.salonId) {
          recordExperienceTrace("auth.reject", { source: "web", trigger, reason: "identity", changed: true, operation: traceOperation });
          resetExperienceCaches({ suspend: true, reason: "identity", notify: false });
          setBlocked(true);
          // A document reload also drops Next's retained DOM and router cache.
          recover("identity");
          return false;
        }
        checked.current = Date.now();
        markExperienceScopeOnlineValidated(context.scope);
        retryCount.current = 0;
        retryDue.current = 0;
        setConnectionState("idle");
        setValidationRevision(++revision.current);
        if (reloadAfterValidation.current) {
          reloadAfterValidation.current = false;
          // The rejected resource may have changed access outside the grant
          // fingerprint. Wait for its new server render before revealing it.
          recover("resource");
          return false;
        }
        resumeExperienceResources(context.scope);
        blocking.current = false;
        setBlocked(false);
        return true;
      })
      .catch(() => {
        recordExperienceTrace(controller.signal.aborted ? "auth.abort" : "auth.end", { source: "web", trigger, reason: "transient", durationMs: performance.now() - traceStarted, operation: traceOperation });
        return unavailable();
      })
      .finally(() => {
        if (pending.current === request) pending.current = null;
        if (currentRequest.current === controller) currentRequest.current = null;
      });
    pending.current = request;
    return request;
  }, [context.scope, context.admin, context.authenticated, context.viewerId, context.workspaceId, context.permissionRevision, context.salonId, recover]);

  useEffect(() => installExperienceOfflineNavigation(() => setOfflineNavigationMessage(true)), []);
  useEffect(() => { installExperienceTraceLifecycle(); }, []);
  useLayoutEffect(() => {
    const hidden = blocked || recoveryRequired;
    recordExperienceTrace(hidden ? "gate.hide" : "gate.show", { source: "web", blocked: hidden });
  }, [blocked, recoveryRequired]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, fired = false;
    const expiry = () => {
      if (timer) { if (!fired) recordExperienceTrace("timer.cancel", { source: "web", trigger: "lease-expiry", reason: "expired" }); clearTimeout(timer); }
      const grant = getExperienceOfflineGrant(context.scope);
      if (grant) {
        fired = false;
        recordExperienceTrace("timer.schedule", { source: "web", trigger: "lease-expiry", reason: "expired", durationMs: Math.max(1, grant.expiresAt - Date.now()) });
        timer = setTimeout(() => {
        fired = true;
        recordExperienceTrace("timer.fire", { source: "web", trigger: "lease-expiry", reason: "expired" });
        // Once a display lease expires, only a fresh server document can
        // replace its protected markup; a root context alone is insufficient.
        reloadAfterValidation.current = true;
        void lockExperienceOffline({ rotateGeneration: false });
        checked.current = 0; void validate(true, false, "lease-expiry");
      }, Math.max(1, grant.expiresAt - Date.now()));
      }
    };
    window.addEventListener(EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT, expiry); expiry();
    return () => { if (timer) { if (!fired) recordExperienceTrace("timer.cancel", { source: "web", trigger: "lease-expiry", reason: "expired" }); clearTimeout(timer); } window.removeEventListener(EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT, expiry); };
  }, [context.scope, validate]);

  useLayoutEffect(() => { runValidation.current = validate; }, [validate]);
  // React has now hidden the private Activity before releasing a rejected
  // cached document's prepaint guard to show the ordinary access/retry shell.
  useLayoutEffect(() => { if (blocked || recoveryRequired) releaseExperienceOfflineBootGuard(); }, [blocked, recoveryRequired]);

  const retryConnection = useCallback(() => {
    if (pending.current) { recordExperienceTrace("auth.join", { source: "web", trigger: "manual" }); return pending.current; }
    invalidateValidation();
    return validate(true, false, "manual");
  }, [invalidateValidation, validate]);

  useLayoutEffect(() => {
    alive.current = true;
    recordExperienceTrace("route.reveal", { source: "web", trigger: "mount" });
    // Only the first mount follows a fresh server render. An Activity reveal
    // must validate again instead of treating retained server props as fresh.
    if (!initialized.current) {
      initialized.current = true;
      const boot = readExperienceOfflineBootGrant(context.scope);
      if (!boot.present) { checked.current = Date.now(); recordExperienceTrace("boot.ready", { source: "web", trigger: "mount", fresh: true }); }
      // External cached-document authority must settle in layout, before paint.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      else if (boot.grant) { void restoreExperienceOfflineAuthorization(context.scope); checked.current = 0; releaseExperienceOfflineBootGuard(); void validate(true, true, "mount"); }
      else {
        // The generic context does not attest the former page's staff binding
        // or device capabilities. It can authorize a fresh render, never revive
        // the invalid document already received from a stale worker.
        lockExperienceOffline({ rotateGeneration: false });
        reloadAfterValidation.current = true;
        checked.current = 0; blocking.current = true; setBlocked(true); void validate(true, false, "mount");
      }
    }
    else void validate(true, false, "mount");
    const reset = () => {
      recordExperienceTrace("cache.reset", { source: "web", trigger: "reset", reason: "reset" });
      invalidateValidation();
      setBlocked(true);
      void validate(true, false, "reset");
    };
    const resume = (event: Event) => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const trigger = event.type === "focus" ? "focus" : event.type === "online" ? "online" : "visible";
      void validate(false, false, trigger);
    };
    window.addEventListener("reylumi:experience-reset", reset);
    window.addEventListener("reylumi:offline-clear", reset);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    const foreground = () => { if (document.visibilityState === "visible" && navigator.onLine) { checked.current = 0; void validate(true, false, "foreground"); } };
    window.addEventListener("reylumi:foreground", foreground);
    const matchesScope = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      return !scope || scope === context.scope;
    };
    // Content invalidation updates resource data without stopping effects,
    // clearing input focus, or restarting read-on-mount actions.
    const mutation = (event: Event) => {
      if (!matchesScope(event)) return;
      recordExperienceTrace("cache.invalidate", { source: "web", trigger: "mutation", reason: "mutation" });
      // A context read begun before a confirmed save cannot validate its result.
      // Retain a foreground/access gate if one is already in progress.
      invalidateValidation();
      void validate(true, !blocking.current, "mutation");
    };
    window.addEventListener("reylumi:experience-mutation", mutation);
    const scopeChanged = (event: Event) => { if (matchesScope(event)) reset(); };
    window.addEventListener("reylumi:experience-scope-changed", scopeChanged);
    const accessChanged = (event: Event) => {
      if (!matchesScope(event)) return;
      recordExperienceTrace("auth.reject", { source: "web", trigger: "resource", reason: "resource" });
      invalidateValidation();
      setBlocked(true);
      reloadAfterValidation.current = true;
      void validate(true, false, "resource");
    };
    window.addEventListener("reylumi:experience-access-changed", accessChanged);
    document.addEventListener("visibilitychange", resume);
    return () => {
      // The retained provider is already gated when its Activity is revealed.
      if (context.authenticated) { blocking.current = true; setBlocked(true); }
      alive.current = false;
      invalidateValidation();
      window.removeEventListener("reylumi:experience-reset", reset);
      window.removeEventListener("reylumi:offline-clear", reset);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("reylumi:foreground", foreground);
      window.removeEventListener("reylumi:experience-mutation", mutation);
      window.removeEventListener("reylumi:experience-scope-changed", scopeChanged);
      window.removeEventListener("reylumi:experience-access-changed", accessChanged);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [context.authenticated, context.scope, validate, invalidateValidation]);

  const checkedAt = useCallback(() => checked.current, []);
  const getValidationRevision = useCallback(() => revision.current, []);
  const value = useMemo(() => ({ context, validate, checkedAt, validationRevision, getValidationRevision, connectionState, retryConnection }), [context, validate, checkedAt, validationRevision, getValidationRevision, connectionState, retryConnection]);
  return <ScopeContext value={value}>
    <OfflineNetworkFormGuard />
    <ExperienceOfflineRuntime scope={context.scope} check={validate} />
    <PreparedReadViewRefresh scope={context.scope} validate={validate} />
    {offlineNavigationMessage ? <div role="status" className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-center justify-between gap-4 rounded-xl border bg-white p-4 text-sm shadow-lg"><WorkspaceText text="Please connect to open this page." /><button type="button" aria-label="Close" onClick={() => setOfflineNavigationMessage(false)}>×</button></div> : null}
    {recoveryRequired ? <div className="mx-auto flex min-h-48 max-w-lg flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <p role="status" className="text-sm text-zinc-600"><WorkspaceText text="Your access has changed. Reload to continue." /></p>
      <button type="button" onClick={() => { void lockExperienceOffline({ rotateGeneration: false }).then(cleared => { if (cleared) { recordExperienceTrace("document.reload.request", { source: "web", trigger: "manual", reason: "manual" }); window.location.reload(); } }); }} className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white"><WorkspaceText text="Reload" /></button>
    </div> : blocked && (connectionState === "waiting" || connectionState === "failed") ? <div className="mx-auto flex min-h-48 max-w-lg flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <p role="status" className="text-sm text-zinc-600"><WorkspaceText text={connectionState === "waiting" ? "Reconnecting…" : "Please check your connection and try again."} /></p>
      <button type="button" onClick={() => { void retryConnection(); }} className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white"><WorkspaceText text="Try again" /></button>
    </div> : blocked ? <PageLoadingSkeleton /> : null}
    <Activity mode={blocked || recoveryRequired ? "hidden" : "visible"}>{children}</Activity>
  </ScopeContext>;
}

export function useExperienceScope() { return useContext(ScopeContext); }
