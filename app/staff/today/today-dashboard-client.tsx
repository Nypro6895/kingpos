"use client";

import { PageLoadingSkeleton } from "@/components/loading-feedback";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import type { PosResource } from "@/lib/pos-workspace-sync";
import type { TodayDashboard } from "@/lib/today-dashboard";
import { useExperienceResource } from "@/lib/use-experience-resource";
import { useLiveExperienceRefresh } from "@/lib/use-live-experience-refresh";
import { TodayDashboardView } from "./today-dashboard-view";

const resources: readonly PosResource[] = ["staff", "tickets", "booking", "report", "waiting", "settings", "catalog"];

export function TodayDashboardClient({ initialSnapshot, scope, salonId, requestedDate, isOwner }: {
  initialSnapshot: LiveResourceSnapshot<TodayDashboard>; scope: string; salonId: string; requestedDate?: string; isOwner: boolean;
}) {
  const query = new URLSearchParams();
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) query.set("date", requestedDate);
  const endpoint = `/api/experience/today${query.size ? `?${query}` : ""}`;
  const resourceKey = `today:${initialSnapshot.data.date}:${initialSnapshot.data.dayView.currentDate}:${endpoint}`;
  const { data, available, refresh, error, refreshing } = useExperienceResource({
    scope, key: resourceKey, tags: resources, initialData: initialSnapshot,
    // A partial first frame must never replace a retained complete dashboard.
    initialUpdatedAt: initialSnapshot.data.pendingSections?.details ? 0 : Date.parse(initialSnapshot.updatedAt), initialEtag: `"${initialSnapshot.revision}"`,
    freshForMs: 10000, retainForMs: 30 * 60 * 1000, enabled: !initialSnapshot.data.noAccess,
    persistence: { domain: "owner-today", endpoint, params: { date: initialSnapshot.data.date }, retainForMs: 24 * 60 * 60 * 1000 },
    fetcher: fetchLiveExperienceResource<TodayDashboard>(endpoint, scope),
  });
  useLiveExperienceRefresh(salonId, resources, refresh, available && !initialSnapshot.data.noAccess);
  if (!available || !data) return <PageLoadingSkeleton />;
  return <TodayDashboardView dashboard={data.data} isOwner={isOwner} retry={data.data.pendingSections?.details && error && !refreshing ? () => { void refresh(); } : undefined} />;
}
