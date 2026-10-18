"use client";

import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import { useExperienceResource } from "@/lib/use-experience-resource";
import { useLiveExperienceRefresh } from "@/lib/use-live-experience-refresh";
import type { StaffScheduleResource, StaffWorkdayResource } from "@/lib/staff-read-view";
import type { PosResource } from "@/lib/pos-workspace-sync";

const resources: readonly PosResource[] = ["staff", "booking", "tickets", "settings", "catalog"];
export function useStaffReadResource<T extends StaffScheduleResource | StaffWorkdayResource>(scope: string, initialSnapshot: LiveResourceSnapshot<T>, params: URLSearchParams) {
  const endpoint = `/api/experience/staff?${params}`;
  const result = useExperienceResource({
    scope, key: endpoint, initialData: initialSnapshot,
    initialUpdatedAt: Date.parse(initialSnapshot.updatedAt), initialEtag: `"${initialSnapshot.revision}"`,
    tags: resources, freshForMs: 10000, retainForMs: 30 * 60 * 1000, enabled: Boolean(initialSnapshot.data.staffId),
    persistence: { domain: `staff-${initialSnapshot.data.kind}`, endpoint, params: { staffId: initialSnapshot.data.staffId, query: params.toString() }, retainForMs: 24 * 60 * 60 * 1000 },
    fetcher: fetchLiveExperienceResource<T>(endpoint, scope),
  });
  useLiveExperienceRefresh(initialSnapshot.data.salonId, resources, result.refresh, result.available && Boolean(initialSnapshot.data.staffId), { automaticRefresh: result.ensureFresh });
  return result;
}
