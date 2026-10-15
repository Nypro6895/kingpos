"use client";

import { Activity, createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExperienceContext } from "@/lib/experience-context";
import { resetExperienceCaches } from "@/lib/reset-experience-cache";
import { resumeExperienceResources } from "@/lib/experience-resource-cache";
import { PageLoadingSkeleton } from "@/components/loading-feedback";
import { fetchBoundedGet } from "@/lib/bounded-get";
import { WorkspaceText } from "@/components/workspace-language";

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
  const reloadAfterValidation = useRef(false);
  const runValidation = useRef<(force?: boolean) => Promise<boolean>>(() => Promise.resolve(false));
  const [validationRevision, setValidationRevision] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const invalidateValidation = useCallback(() => {
    validationEpoch.current++;
    currentRequest.current?.abort();
    currentRequest.current = null;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    retryCount.current = 0;
    pending.current = null;
    checked.current = 0;
  }, []);

  const validate = useCallback((force = false): Promise<boolean> => {
    if (!force && checked.current && Date.now() - checked.current < 30_000) return Promise.resolve(true);
    if (pending.current) return pending.current;
    const epoch = validationEpoch.current;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    if (context.authenticated) setBlocked(true);
    if (!navigator.onLine) { setConnectionState("failed"); return Promise.resolve(false); }
    setConnectionState("checking");
    const controller = new AbortController();
    currentRequest.current = controller;
    const unavailable = () => {
      if (!alive.current || epoch !== validationEpoch.current || controller.signal.aborted) return false;
      const delay = RETRY_DELAYS[retryCount.current++];
      if (delay !== undefined && navigator.onLine && document.visibilityState === "visible") {
        setConnectionState("waiting");
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          if (alive.current && epoch === validationEpoch.current) void runValidation.current(true);
        }, delay);
      } else setConnectionState("failed");
      return false;
    };
    const request = fetchBoundedGet(`/api/experience/context${context.admin ? "?admin=1" : ""}`, { signal: controller.signal, cache: "no-store", credentials: "same-origin" }, { timeoutMs: 8_000, totalTimeoutMs: 8_000, maxAttempts: 1 })
      .then(async response => {
        if (!alive.current || epoch !== validationEpoch.current) return false;
        if (response.status === 401 || response.status === 403) {
          setConnectionState("idle");
          resetExperienceCaches({ suspend: true, reason: "permissions", notify: false });
          setBlocked(true);
          window.location.reload();
          return false;
        }
        if (!response.ok) return unavailable();
        const next = await response.json() as ExperienceContext;
        if (!alive.current || epoch !== validationEpoch.current) return false;
        if (!next || typeof next.scope !== "string" || typeof next.authenticated !== "boolean" || typeof next.workspaceId !== "string" || typeof next.permissionRevision !== "string"
          || !(next.viewerId === null || typeof next.viewerId === "string") || !(next.salonId === null || typeof next.salonId === "string")) return unavailable();
        if (next.scope !== context.scope || next.viewerId !== context.viewerId || next.workspaceId !== context.workspaceId || next.authenticated !== context.authenticated || next.permissionRevision !== context.permissionRevision || next.salonId !== context.salonId) {
          resetExperienceCaches({ suspend: true, reason: "identity", notify: false });
          setBlocked(true);
          // A document reload also drops Next's retained DOM and router cache.
          window.location.reload();
          return false;
        }
        checked.current = Date.now();
        retryCount.current = 0;
        setConnectionState("idle");
        setValidationRevision(++revision.current);
        if (reloadAfterValidation.current) {
          reloadAfterValidation.current = false;
          // The rejected resource may have changed access outside the grant
          // fingerprint. Wait for its new server render before revealing it.
          window.location.reload();
          return true;
        }
        resumeExperienceResources(context.scope);
        setBlocked(false);
        return true;
      })
      .catch(unavailable)
      .finally(() => {
        if (pending.current === request) pending.current = null;
        if (currentRequest.current === controller) currentRequest.current = null;
      });
    pending.current = request;
    return request;
  }, [context.scope, context.admin, context.authenticated, context.viewerId, context.workspaceId, context.permissionRevision, context.salonId]);

  useLayoutEffect(() => { runValidation.current = validate; }, [validate]);

  const retryConnection = useCallback(() => {
    invalidateValidation();
    return validate(true);
  }, [invalidateValidation, validate]);

  useLayoutEffect(() => {
    alive.current = true;
    // Only the first mount follows a fresh server render. An Activity reveal
    // must validate again instead of treating retained server props as fresh.
    if (!initialized.current) { checked.current = Date.now(); initialized.current = true; }
    else void validate(true);
    const reset = () => {
      invalidateValidation();
      setBlocked(true);
      void validate(true);
    };
    const resume = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (!pending.current) { retryCount.current = 0; }
      void validate();
    };
    window.addEventListener("reylumi:experience-reset", reset);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    const mutation = () => { invalidateValidation(); void validate(true); };
    window.addEventListener("reylumi:experience-mutation", mutation);
    const accessChanged = () => {
      invalidateValidation();
      setBlocked(true);
      reloadAfterValidation.current = true;
      void validate(true);
    };
    window.addEventListener("reylumi:experience-access-changed", accessChanged);
    document.addEventListener("visibilitychange", resume);
    return () => {
      // The retained provider is already gated when its Activity is revealed.
      if (context.authenticated) setBlocked(true);
      alive.current = false;
      invalidateValidation();
      window.removeEventListener("reylumi:experience-reset", reset);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("reylumi:experience-mutation", mutation);
      window.removeEventListener("reylumi:experience-access-changed", accessChanged);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [context.authenticated, validate, invalidateValidation]);

  const checkedAt = useCallback(() => checked.current, []);
  const getValidationRevision = useCallback(() => revision.current, []);
  const value = useMemo(() => ({ context, validate, checkedAt, validationRevision, getValidationRevision, connectionState, retryConnection }), [context, validate, checkedAt, validationRevision, getValidationRevision, connectionState, retryConnection]);
  return <ScopeContext value={value}>
    {blocked && (connectionState === "waiting" || connectionState === "failed") ? <div className="mx-auto flex min-h-48 max-w-lg flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <p role="status" className="text-sm text-zinc-600"><WorkspaceText text={connectionState === "waiting" ? "Reconnecting…" : "Please check your connection and try again."} /></p>
      <button type="button" onClick={() => { void retryConnection(); }} className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white"><WorkspaceText text="Try again" /></button>
    </div> : blocked ? <PageLoadingSkeleton /> : null}
    <Activity mode={blocked ? "hidden" : "visible"}>{children}</Activity>
  </ScopeContext>;
}

export function useExperienceScope() { return useContext(ScopeContext); }
