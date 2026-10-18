"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppLocalResource } from "@/lib/app-local-resource";
import { experienceResourceCache } from "@/lib/experience-resource-cache";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import type { PosResource } from "@/lib/pos-workspace-sync";
import type { TodayDashboard } from "@/lib/today-dashboard";
import { getTodayDashboardSections, mergeTodayDashboardSection, type TodayDashboardSection } from "@/lib/today-dashboard-sections";
import { useExperienceResource } from "@/lib/use-experience-resource";
import { useLiveExperienceRefresh } from "@/lib/use-live-experience-refresh";
import { TodayDashboardView } from "./today-dashboard-view";

const tags: Record<TodayDashboardSection, readonly PosResource[]> = {
  staff: ["staff", "settings"], bookings: ["booking", "catalog", "settings"],
  waiting: ["waiting", "booking"], financials: ["tickets", "report", "staff", "settings"],
  extras: ["settings", "catalog"],
};
const titles: Record<TodayDashboardSection, string> = { staff: "Team", bookings: "Appointments", waiting: "Waiting", financials: "Performance", extras: "Quick access and notifications" };
type PageData = { dashboard: TodayDashboard; isOwner: boolean };
type ReaderProps = { scope: string; salonId: string; date: string; currentDate: string; section: TodayDashboardSection; accept: (section: TodayDashboardSection, dashboard: TodayDashboard) => void; deny: () => void };

function ReadFailure({ section, error, retry, refreshing }: { section: TodayDashboardSection; error: unknown; retry: () => unknown; refreshing: boolean }) {
  if (!error || refreshing) return null;
  return <div role="status" data-today-retry={section} className="flex items-center justify-between gap-3 border-y border-zinc-200 bg-white px-4 py-3 text-sm">
    <span>{titles[section]} could not update. Please try again.</span>
    <button type="button" className="shrink-0 rounded-lg border px-3 py-2" onClick={() => void retry()}>Try again</button>
  </div>;
}

function WebSectionReader({ scope, salonId, date, currentDate, section, accept, deny }: ReaderProps) {
  const endpoint = `/api/experience/today?${new URLSearchParams({ date, phase: section })}`;
  const key = `today-section:${date}:${currentDate}:${section}`;
  const resource = useExperienceResource<LiveResourceSnapshot<TodayDashboard> | undefined>({
    scope, key, tags: tags[section], initialData: undefined, initialUpdatedAt: 0,
    freshForMs: 10000, retainForMs: 30 * 60 * 1000,
    persistence: { domain: "owner-today", params: { date, phase: section }, retainForMs: 24 * 60 * 60 * 1000 },
    fetcher: ({ signal, etag, cached }) => fetchLiveExperienceResource<TodayDashboard>(endpoint, scope)({ signal, etag, cached }),
  });
  const forceRefresh = resource.refresh;
  const refresh = useCallback(async () => {
    // A mutation can arrive during the hook's initial automatic read. Join it,
    // then reconcile once more so an earlier read cannot consume the change.
    const pending = experienceResourceCache.isLoading({ scope, key });
    await forceRefresh();
    if (pending) await forceRefresh();
  }, [scope, key, forceRefresh]);
  useLiveExperienceRefresh(salonId, tags[section], refresh, resource.available, { automaticRefresh: resource.ensureFresh });
  useEffect(() => { if (resource.data) accept(section, resource.data.data); }, [accept, section, resource.data]);
  useEffect(() => { if (!resource.available) deny(); }, [deny, resource.available]);
  return <ReadFailure section={section} error={resource.error} retry={resource.refresh} refreshing={resource.refreshing} />;
}

function NativeSectionReader({ scope, date, section, accept, deny }: ReaderProps) {
  const state = useAppLocalResource<PageData>(scope, "page.owner-today", { date, phase: section });
  useEffect(() => { if (state.data) accept(section, state.data.dashboard); }, [accept, section, state.data]);
  useEffect(() => { if (!state.available || state.accessDenied) deny(); }, [deny, state.available, state.accessDenied]);
  return <ReadFailure section={section} error={state.error} retry={state.refresh} refreshing={state.refreshing} />;
}

function TodaySections({ initialDashboard, scope, salonId, isOwner, native = false }: { initialDashboard: TodayDashboard; scope: string; salonId: string; isOwner: boolean; native?: boolean }) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [blocked, setBlocked] = useState(false);
  const [clockChanged, setClockChanged] = useState(false);
  const deny = useCallback(() => setBlocked(true), []);
  const accept = useCallback((section: TodayDashboardSection, next: TodayDashboard) => {
    const olderThanShell = Date.parse(next.generatedAt) < Date.parse(initialDashboard.generatedAt);
    if (next.noAccess || JSON.stringify(next.permissions) !== JSON.stringify(initialDashboard.permissions)) {
      // A prior authorized snapshot can predate the shell's permission set.
      // Ignore it; a newly validated permission change withdraws the view.
      if (!olderThanShell) deny();
      return;
    }
    if (next.date !== initialDashboard.date || next.timezone !== initialDashboard.timezone || next.dayView.currentDate !== initialDashboard.dayView.currentDate || next.dayView.isCurrentDate !== initialDashboard.dayView.isCurrentDate) {
      // Persisted historical reads legitimately predate today's business clock.
      // Never merge those fields or mistake their age for revoked access.
      if (!olderThanShell) setClockChanged(true);
      return;
    }
    if (!olderThanShell) setClockChanged(false);
    setDashboard(previous => mergeTodayDashboardSection(previous, next, section));
  }, [initialDashboard.permissions, initialDashboard.timezone, initialDashboard.date, initialDashboard.dayView.currentDate, initialDashboard.dayView.isCurrentDate, initialDashboard.generatedAt, deny]);
  useEffect(() => {
    const block = (event?: Event) => {
      const eventScope = (event as CustomEvent<{ scope?: string }> | undefined)?.detail?.scope;
      if (!eventScope || eventScope === scope) setBlocked(true);
    };
    const names = ["reylumi:experience-reset", "reylumi:offline-clear", "reylumi:offline-grant-invalidated", "reylumi:experience-access-changed", "reylumi:app-local-access-changed"];
    const nativeReset = (event: Event) => { if ((event as CustomEvent<{ reason?: string }>).detail?.reason !== "context") block(); };
    names.forEach(name => window.addEventListener(name, block));
    window.addEventListener("reylumi:app-local-reset", nativeReset);
    const stop = native ? () => {} : experienceResourceCache.subscribe({ scope, key: `today-section:${dashboard.date}:${dashboard.dayView.currentDate}:staff` }, event => { if (event === "reset" || !experienceResourceCache.isAvailable({ scope, key: "today" })) block(); });
    return () => { names.forEach(name => window.removeEventListener(name, block)); window.removeEventListener("reylumi:app-local-reset", nativeReset); stop(); };
  }, [scope, dashboard.date, dashboard.dayView.currentDate, native]);
  if (blocked) return <main className="p-6" role="status"><p>Your workspace access must be checked again.</p><a href="/staff/today">Open Today</a></main>;
  const Reader = native ? NativeSectionReader : WebSectionReader;
  return <>
    {getTodayDashboardSections(initialDashboard).map(section => <Reader key={section} scope={scope} salonId={salonId} date={dashboard.date} currentDate={dashboard.dayView.currentDate} section={section} accept={accept} deny={deny} />)}
    {clockChanged && <p role="status" data-today-clock-refresh className="px-4 py-3 text-sm">The business day or time zone has changed. <a href="/staff/today" className="underline">Open Today</a> to refresh.</p>}
    <TodayDashboardView dashboard={dashboard} isOwner={isOwner} />
  </>;
}

export function TodayProgressiveClient(props: { initialDashboard: TodayDashboard; scope: string; salonId: string; requestedDate?: string; isOwner: boolean; native?: boolean }) {
  const identity = `${props.scope}:${props.initialDashboard.date}:${props.initialDashboard.dayView.currentDate}:${props.initialDashboard.timezone}:${props.initialDashboard.salonName}:${JSON.stringify(props.initialDashboard.permissions)}:${props.initialDashboard.noAccess}`;
  return <TodaySections key={identity} {...props} />;
}

/** Native uses the existing named-read bridge and its signed argument policy. */
export function AppLocalTodayClient({ scope, requestedDate }: { scope: string; requestedDate?: string }) {
  const args = useMemo(() => ({ ...(requestedDate ? { date: requestedDate } : {}), phase: "shell" }), [requestedDate]);
  const state = useAppLocalResource<PageData>(scope, "page.owner-today", args);
  if (!state.data) return <main className="mx-auto grid max-w-5xl gap-4 p-6"><h1 className="text-2xl font-semibold">Today</h1>
    {state.error || !state.loading && !state.refreshing ? <div role="status"><p>{state.error ?? "Connect to load Today."}</p><button type="button" onClick={() => void state.refresh()}>Try again</button></div> : <p role="status">Opening…</p>}
  </main>;
  return <TodayProgressiveClient initialDashboard={state.data.dashboard} scope={scope} salonId="" isOwner={state.data.isOwner} native />;
}
