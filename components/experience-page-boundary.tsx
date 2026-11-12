"use client";

import { Activity, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getExperienceRoutePolicy } from "@/lib/experience-route-policies";
import { useExperienceScope } from "@/components/experience-scope";
import { PageLoadingSkeleton } from "@/components/loading-feedback";

const RESOURCE_VIEWS = new Set(["/market", "/notifications", "/staff/today", "/staff/my-work", "/staff/appointments", "/staff/workday", "/activity", "/bookings", "/reports"]);

/** Activity cleans effects when hidden; keep browsing state but reset action flows. */
export function ExperiencePageBoundary({ children, admin = false, renderRevision = "" }: { children: ReactNode; admin?: boolean; renderRevision?: string }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const href = pathname + (query ? `?${query}` : "");
  const policy = getExperienceRoutePolicy(href);
  // Settings sections are local History API navigation. Each section owns its
  // reader and sensitive sections discard their forms when hidden. Refreshing
  // the whole RSC tree for each section races that local navigation.
  const lifecycleHref = pathname === "/settings" ? pathname : href;
  const lifecyclePolicy = pathname === "/settings" ? getExperienceRoutePolicy(pathname) : policy;
  const scope = useExperienceScope();
  const contextScope = scope?.context.scope;
  const authenticated = scope?.context.authenticated;
  const validate = scope?.validate;
  const checkedAt = scope?.checkedAt;
  const getValidationRevision = scope?.getValidationRevision;
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const renderedAt = useRef(0);
  const refreshPending = useRef(false);
  const refreshGeneration = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [failedRevision, setFailedRevision] = useState<string | null>(null);
  const refreshFailed = failedRevision === renderRevision;
  const [activation, setActivation] = useState(0);
  const [checkingAuthRevision, setCheckingAuthRevision] = useState<number | null>(null);
  const [waitingRevision, setWaitingRevision] = useState<string | null>(null);
  const checkingAuth = checkingAuthRevision !== null && (scope?.validationRevision ?? 0) <= checkingAuthRevision;
  const checking = checkingAuth || waitingRevision === renderRevision;
  const revision = useRef(renderRevision);
  const cancelRefresh = useCallback(() => {
    refreshGeneration.current++;
    refreshPending.current = false;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
  }, []);
  useLayoutEffect(() => {
    // Activity re-runs layout effects on reveal. Only a NEW server render may
    // renew data age or acknowledge an unfinished refresh.
    if (!renderedAt.current || revision.current !== renderRevision) {
      revision.current = renderRevision;
      renderedAt.current = Date.now();
      cancelRefresh();
    }
  }, [renderRevision, cancelRefresh]);

  useLayoutEffect(() => () => {
    // A local Settings section change must abandon an unfinished page reveal
    // refresh, without treating that section change as another page reveal.
    cancelRefresh();
    setWaitingRevision(null);
    setFailedRevision(null);
  }, [href, contextScope, cancelRefresh]);

  const refreshServerView = useCallback(() => {
    if (refreshPending.current || !navigator.onLine) { if (!navigator.onLine) setFailedRevision(revision.current); return; }
    refreshPending.current = true;
    const generation = ++refreshGeneration.current;
    const requestedRevision = revision.current;
    setFailedRevision(null);
    router.refresh();
    refreshTimer.current = setTimeout(() => {
      if (generation !== refreshGeneration.current) return;
      refreshPending.current = false;
      refreshTimer.current = null;
      setFailedRevision(requestedRevision);
    }, 12_000);
  }, [router]);

  useLayoutEffect(() => {
    const returning = shown.current;
    shown.current = true;
    const elapsed = Date.now() - renderedAt.current;
    const root = container.current;
    let active = true;
    // Admin has its own grant provider/boundary. POS owns its operational state.
    const delegated = lifecyclePolicy.family === "pos" || (lifecyclePolicy.family === "admin" && !admin);
    if (returning && !delegated) {
      if (lifecyclePolicy.resetOnHide) {
        // Activity reveal must hide stale action data before the browser paints.
        setWaitingRevision(revision.current);
        refreshServerView();
      } else {
        const protectedView = lifecyclePolicy.requiresAuth || Boolean(authenticated);
        const mustValidate = protectedView && checkedAt && Date.now() - checkedAt() >= 30_000;
        // Synchronous hiding prevents an unvalidated retained private view flashing.
        if (mustValidate) setCheckingAuthRevision(getValidationRevision?.() ?? 0);
        const reconcile = async () => {
          if (protectedView && validate && !(await validate())) return;
          if (!active) return;
          setCheckingAuthRevision(null);
          const resourceView = RESOURCE_VIEWS.has(pathname);
          if (!resourceView && lifecyclePolicy.revalidateOnShow && elapsed >= lifecyclePolicy.refreshAfterMs) refreshServerView();
        };
        void reconcile();
      }
    }
    return () => {
      active = false;
      // Next may abandon a refresh when navigation/Activity takes priority.
      // Its timer must never report a failure on a later navigation attempt.
      cancelRefresh();
      setWaitingRevision(null);
      setFailedRevision(null);
      for (const media of root?.querySelectorAll<HTMLMediaElement>("video,audio") ?? []) media.pause();
      for (const dialog of root?.querySelectorAll<HTMLDialogElement>("dialog[open]") ?? []) dialog.close();
      if (!delegated && lifecyclePolicy.resetOnHide) setActivation(value => value + 1);
    };
  // Hidden Activity routes clean this effect and restart it on the next reveal.
  // Query/path changes also represent a new view, not an old pending command.
  }, [lifecycleHref, pathname, admin, contextScope, authenticated, validate, checkedAt, getValidationRevision, router,
    lifecyclePolicy.family, lifecyclePolicy.resetOnHide, lifecyclePolicy.requiresAuth, lifecyclePolicy.revalidateOnShow, lifecyclePolicy.refreshAfterMs, refreshServerView, cancelRefresh]);

  return <div ref={container} className="contents" data-experience-view="" data-experience-family={policy.family} key={contextScope ?? "public"}>
    {refreshFailed ? <div role="status" className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3 text-sm">
      <span>The page could not update. Check your connection and try again.</span>
      <button type="button" className="min-h-11 shrink-0 underline" onClick={refreshServerView}>Try again</button>
    </div> : checking ? <PageLoadingSkeleton /> : null}
    <Activity mode={checking ? "hidden" : "visible"}><div className="contents" key={activation}>{children}</div></Activity>
  </div>;
}
