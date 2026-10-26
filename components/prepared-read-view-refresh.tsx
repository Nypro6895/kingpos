"use client";

import { useEffect, useLayoutEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { readExperienceOfflineBootGrant } from "@/lib/experience-offline-client";
import { getExperienceOfflinePath } from "@/lib/experience-offline-policy";
import { recordExperienceTrace, type ExperienceTraceTrigger } from "@/lib/experience-trace";

const REFRESH_INTERVAL = 30_000;
const READ_VIEWS = new Set(["/my-bookings", "/explore/favorites", "/more/saved-post", "/more/following"]);

/** These routes read on the server; refreshing never submits their controls. */
export function isPreparedReadViewPath(href: string): boolean {
  const path = getExperienceOfflinePath(href, location.origin);
  if (!path) return false;
  const pathname = path.split("?")[0];
  return READ_VIEWS.has(pathname) || /^\/activity\/receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname);
}

function editing() {
  const element = document.activeElement;
  return element instanceof HTMLElement && (element.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
}

/** Merge fresh read-only RSC into an already usable view after online authority. */
export function PreparedReadViewRefresh({ scope, validate }: {
  scope: string;
  validate: (force?: boolean, background?: boolean, trigger?: ExperienceTraceTrigger) => Promise<boolean>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refreshPending = useRef(false);
  const attempts = useRef(new Map<string, number>());
  const mounted = useRef(false);
  useLayoutEffect(() => { refreshPending.current = refreshing; }, [refreshing]);

  useEffect(() => {
    let active = true, running = false;
    const path = () => location.pathname + location.search;
    const key = (href: string) => JSON.stringify([scope, href]);
    const initialPath = path();
    const cachedBoot = !mounted.current && Boolean(readExperienceOfflineBootGrant(scope).grant);
    mounted.current = true;
    // A newly rendered server view is already current. A prepared boot needs a
    // fresh read, while ordinary initial focus must not duplicate the SSR read.
    if (!cachedBoot && !attempts.current.has(key(initialPath))) attempts.current.set(key(initialPath), Date.now());

    const refresh = (trigger: ExperienceTraceTrigger = "unknown") => {
      const href = path();
      if (!active || running || refreshPending.current || !navigator.onLine || document.visibilityState !== "visible"
        || location.pathname !== pathname || !isPreparedReadViewPath(href) || editing()) {
        recordExperienceTrace("auth.skip", { source: "web", area: "other", trigger, offline: !navigator.onLine });
        return;
      }
      const now = Date.now(), identity = key(href);
      if (now - (attempts.current.get(identity) ?? 0) < REFRESH_INTERVAL) { recordExperienceTrace("cache.hit", { source: "web", area: "other", trigger, fresh: true }); return; }
      attempts.current.set(identity, now);
      if (attempts.current.size > 16) attempts.current.delete(attempts.current.keys().next().value!);
      running = true;
      let freshlyValidated = false;
      const authorized = (event: Event) => {
        if ((event as CustomEvent<{ scope?: string }>).detail?.scope === scope) freshlyValidated = true;
      };
      window.addEventListener("reylumi:experience-online-authorized", authorized);
      // validate may allow a bounded offline lease after a failed GET. Only its
      // fresh matching online-authorized event permits a server view refresh.
      void validate(true, true, trigger).then(valid => {
        if (valid && freshlyValidated && active && navigator.onLine && document.visibilityState === "visible"
          && path() === href && location.pathname === pathname && !editing()) {
          recordExperienceTrace("cache.refresh", { source: "web", area: "other", trigger, fresh: true });
          startTransition(() => router.refresh());
        }
      }).catch(() => {}).finally(() => {
        running = false;
        window.removeEventListener("reylumi:experience-online-authorized", authorized);
      });
    };
    const visible = () => { if (document.visibilityState === "visible") refresh("visible"); };
    const focus = () => refresh("focus"), online = () => refresh("online"), foreground = () => refresh("foreground");
    window.addEventListener("focus", focus);
    window.addEventListener("online", online);
    window.addEventListener("reylumi:foreground", foreground);
    document.addEventListener("visibilitychange", visible);
    if (cachedBoot) refresh("mount");
    return () => {
      active = false;
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", online);
      window.removeEventListener("reylumi:foreground", foreground);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pathname, scope, validate, router]);

  return null;
}
