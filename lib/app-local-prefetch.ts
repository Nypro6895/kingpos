"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { AppLocalContext } from "./app-local-host";
import { prefetchAppLocalResource } from "./app-local-resource";
import { appLocalPrefetchPlan, appLocalTodayPrefetchJobs, type AppLocalPrefetchJob } from "./app-local-prefetch-plan";
import { readPriorityScheduler } from "./read-priority-scheduler";

type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
function connection() { return (navigator as Navigator & { connection?: Connection }).connection; }
export function canPrefetchAppLocalReads() {
  const network = connection();
  return navigator.onLine !== false && document.visibilityState !== "hidden" && !network?.saveData && !/^(?:slow-)?2g$/.test(network?.effectiveType ?? "");
}
const identityOf = (value: AppLocalContext | null) => value ? JSON.stringify([
  value.context.scope, value.context.viewerId, value.context.permissionRevision,
  value.grant?.generation, value.grant?.grantRevision, value.offlineState,
]) : "";
const jobKey = (job: AppLocalPrefetchJob) => JSON.stringify([job.name, job.args]);

/** Prepare DTOs, never hidden page trees or commands. Resource cells/cache are
 * shared with the actual page, so selecting a queued page promotes its read.
 * The queue lasts for the accepted identity, not for a route or lease renewal.
 * Only two reads for unvisited routes may run speculatively. Selected routes
 * remain eligible after that budget; previously visited offline DTOs stay intact.
 */
export function useAppLocalPrefetch(context: AppLocalContext | null, path: string) {
  const current = useRef({ context, path });
  const wake = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => { current.current = { context, path }; }, [context, path]);
  const identity = identityOf(context);
  useEffect(() => { readPriorityScheduler.setActiveRoute(path); wake.current?.(); }, [path]);
  useEffect(() => {
    const value = current.current.context;
    const scope = value?.context.scope;
    readPriorityScheduler.setActiveScope(scope);
    if (!value || !scope) return;
    let active = true, working = false, denied = false, hiddenReads = 0;
    const controller = new AbortController(), done = new Set<string>(), pending = new Map<string, AppLocalPrefetchJob>();
    const append = (jobs: AppLocalPrefetchJob[]) => { for (const job of jobs) if (!done.has(jobKey(job))) pending.set(jobKey(job), job); };
    append(appLocalPrefetchPlan(value, current.current.path));
    const matches = (job: AppLocalPrefetchJob) => job.path.split("?")[0] === current.current.path.split("?")[0];
    const run = async () => {
      if (working || !active || denied || !canPrefetchAppLocalReads()) return;
      working = true;
      try {
        while (active && pending.size && canPrefetchAppLocalReads()) {
          const latest = current.current.context;
          if (!latest || identityOf(latest) !== identity || !appLocalPrefetchPlan(latest, current.current.path).length) return;
          const job = [...pending.values()].filter(job => matches(job) || hiddenReads < 2)
            .sort((a, b) => Number(matches(b)) - Number(matches(a)) || a.rank - b.rank)[0];
          if (!job) break;
          if (!matches(job)) hiddenReads++;
          pending.delete(jobKey(job)); done.add(jobKey(job));
          const data = await prefetchAppLocalResource(scope, job.name, job.args, {
            route: job.path, priority: 80 + job.rank, signal: controller.signal,
          });
          if (!active) return;
          if (job.name === "page.owner-today" && job.args.phase === "shell" && data) append(appLocalTodayPrefetchJobs(latest, data));
        }
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError" || [401, 403, 409].includes((error as { status?: number })?.status ?? 0)) {
          denied = true; pending.clear(); controller.abort();
        }
        // Foreground UI owns retry/error presentation. Speculation must never
        // create an unhandled rejection or grant authority after a failed read.
      } finally { working = false; }
    };
    const lifecycle = () => {
      readPriorityScheduler.setPaused(denied || !canPrefetchAppLocalReads());
      const latest = current.current.context;
      if (!active || denied || !latest || identityOf(latest) !== identity) return;
      append(appLocalPrefetchPlan(latest, current.current.path));
      void run();
    };
    const workspaceStart = () => {
      // Workspace commands use their own fresh authority transport. They do
      // not enter the read queue, so explicitly stop old-workspace speculation
      // before their preflight. A newly admitted identity owns the next queue.
      denied = true; pending.clear(); controller.abort();
      readPriorityScheduler.setPaused(true);
    };
    wake.current = lifecycle;
    // Give the foreground page its first frame and initial read effects first.
    // All foreground reads also outrank speculative work in the shared queue.
    const timer = setTimeout(lifecycle, 150);
    const network = connection();
    document.addEventListener("visibilitychange", lifecycle);
    window.addEventListener("online", lifecycle); window.addEventListener("offline", lifecycle);
    window.addEventListener("reylumi:foreground", lifecycle); network?.addEventListener("change", lifecycle);
    window.addEventListener("reylumi:app-local-workspace-start", workspaceStart);
    readPriorityScheduler.setPaused(!canPrefetchAppLocalReads());
    return () => {
      active = false; controller.abort(); clearTimeout(timer);
      if (wake.current === lifecycle) wake.current = undefined;
      // This effect owns only its preload consumer. A same-scope admission
      // renewal must not cancel the current page's foreground read. Actual
      // scope changes are fenced by setActiveScope and resource resets.
      document.removeEventListener("visibilitychange", lifecycle);
      window.removeEventListener("online", lifecycle); window.removeEventListener("offline", lifecycle);
      window.removeEventListener("reylumi:foreground", lifecycle); network?.removeEventListener("change", lifecycle);
      window.removeEventListener("reylumi:app-local-workspace-start", workspaceStart);
    };
  }, [identity]);
}
