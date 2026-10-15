"use client";

import { Activity, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getExperienceRoutePolicy } from "@/lib/experience-route-policies";
import { useExperienceScope } from "@/components/experience-scope";
import { PageLoadingSkeleton } from "@/components/loading-feedback";

const RESOURCE_VIEWS = new Set(["/market", "/notifications", "/staff/today", "/staff/my-work", "/bookings", "/reports"]);

/** Activity cleans effects when hidden; keep browsing state but reset action flows. */
export function ExperiencePageBoundary({ children, admin = false, renderRevision = "" }: { children: ReactNode; admin?: boolean; renderRevision?: string }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const href = pathname + (query ? `?${query}` : "");
  const policy = getExperienceRoutePolicy(href);
  const scope = useExperienceScope();
  const contextScope = scope?.context.scope;
  const authenticated = scope?.context.authenticated;
  const validate = scope?.validate;
  const checkedAt = scope?.checkedAt;
  const getValidationRevision = scope?.getValidationRevision;
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const lastShown = useRef(0);
  const [activation, setActivation] = useState(0);
  const [checkingAuthRevision, setCheckingAuthRevision] = useState<number | null>(null);
  const [waitingRevision, setWaitingRevision] = useState<string | null>(null);
  const checkingAuth = checkingAuthRevision !== null && (scope?.validationRevision ?? 0) <= checkingAuthRevision;
  const checking = checkingAuth || waitingRevision === renderRevision;
  const revision = useRef(renderRevision);
  useLayoutEffect(() => { revision.current = renderRevision; }, [renderRevision]);

  useLayoutEffect(() => {
    const returning = shown.current;
    shown.current = true;
    const elapsed = Date.now() - lastShown.current;
    lastShown.current = Date.now();
    const root = container.current;
    let active = true;
    // Admin has its own grant provider/boundary. POS owns its operational state.
    const delegated = policy.family === "pos" || (policy.family === "admin" && !admin);
    if (returning && !delegated) {
      if (policy.resetOnHide) {
        // Activity reveal must hide stale action data before the browser paints.
        setWaitingRevision(revision.current);
        router.refresh();
      } else {
        const protectedView = policy.requiresAuth || Boolean(authenticated);
        const mustValidate = protectedView && checkedAt && Date.now() - checkedAt() >= 30_000;
        // Synchronous hiding prevents an unvalidated retained private view flashing.
        if (mustValidate) setCheckingAuthRevision(getValidationRevision?.() ?? 0);
        const reconcile = async () => {
          if (protectedView && validate && !(await validate())) return;
          if (!active) return;
          setCheckingAuthRevision(null);
          const resourceView = RESOURCE_VIEWS.has(pathname);
          if (!resourceView && policy.revalidateOnShow && elapsed >= policy.refreshAfterMs) router.refresh();
        };
        void reconcile();
      }
    }
    return () => {
      active = false;
      for (const media of root?.querySelectorAll<HTMLMediaElement>("video,audio") ?? []) media.pause();
      for (const dialog of root?.querySelectorAll<HTMLDialogElement>("dialog[open]") ?? []) dialog.close();
      if (!delegated && policy.resetOnHide) setActivation(value => value + 1);
    };
  // Hidden Activity routes clean this effect and restart it on the next reveal.
  // Query/path changes also represent a new view, not an old pending command.
  }, [href, pathname, admin, contextScope, authenticated, validate, checkedAt, getValidationRevision, router,
    policy.family, policy.resetOnHide, policy.requiresAuth, policy.revalidateOnShow, policy.refreshAfterMs]);

  return <div ref={container} className="contents" data-experience-view="" data-experience-family={policy.family} key={contextScope ?? "public"}>
    {checking ? <PageLoadingSkeleton /> : null}
    <Activity mode={checking ? "hidden" : "visible"}><div className="contents" key={activation}>{children}</div></Activity>
  </div>;
}
