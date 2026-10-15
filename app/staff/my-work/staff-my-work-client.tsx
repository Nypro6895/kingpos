"use client";

import { PageLoadingSkeleton } from "@/components/loading-feedback";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import type { PosResource } from "@/lib/pos-workspace-sync";
import { staffMyWorkActiveTab, staffMyWorkStringParam, type StaffMyWorkResource, type StaffMyWorkSearchParams } from "@/lib/staff-my-work-experience";
import { useExperienceResource } from "@/lib/use-experience-resource";
import { useLiveExperienceRefresh } from "@/lib/use-live-experience-refresh";
import { StaffMyWorkView } from "./staff-my-work-view";

const resources: readonly PosResource[] = ["staff", "tickets", "settings", "report", "catalog"];

export function StaffMyWorkClient({ initialSnapshot, scope, params }: {
  initialSnapshot: LiveResourceSnapshot<StaffMyWorkResource>; scope: string; params: StaffMyWorkSearchParams;
}) {
  const query = new URLSearchParams({ tab: staffMyWorkActiveTab(params.tab), staffId: initialSnapshot.data.staff.id });
  const period = staffMyWorkStringParam(params.payPeriodStart);
  if (period) query.set("payPeriodStart", period);
  const endpoint = `/api/experience/my-work?${query}`;
  const { data, available, refresh } = useExperienceResource({
    scope, key: endpoint, tags: resources, initialData: initialSnapshot,
    initialUpdatedAt: Date.parse(initialSnapshot.updatedAt), initialEtag: `"${initialSnapshot.revision}"`,
    freshForMs: 10000, retainForMs: 5 * 60 * 1000,
    fetcher: fetchLiveExperienceResource<StaffMyWorkResource>(endpoint, scope),
  });
  useLiveExperienceRefresh(initialSnapshot.data.salonId, resources, refresh, available);
  if (!available || !data) return <PageLoadingSkeleton />;
  return <StaffMyWorkView resource={data.data} params={params} />;
}
