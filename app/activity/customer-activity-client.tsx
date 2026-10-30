"use client";

import type { CustomerActivityData } from "@/lib/customer-activity";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import { useExperienceResource } from "@/lib/use-experience-resource";
import { CustomerActivityView } from "./customer-activity-view";
import { CustomerJourneyLoading, type CustomerJourneyProps } from "./customer-journey";

export type CustomerActivityResource = { kind: "activity"; result: CustomerActivityData };

export function CustomerActivityClient({ scope, initialSnapshot, ...view }: Omit<CustomerJourneyProps,"activity"|"onRefresh"> & { scope: string; initialSnapshot: LiveResourceSnapshot<CustomerActivityResource> }) {
  const endpoint = "/api/experience/customer?kind=activity";
  const { available, data, refresh, refreshing, error } = useExperienceResource({
    scope, key: endpoint, initialData: initialSnapshot,
    initialUpdatedAt: Date.parse(initialSnapshot.updatedAt), initialEtag: `"${initialSnapshot.revision}"`,
    tags: ["booking", "tickets"], freshForMs: 15000, retainForMs: 30 * 60 * 1000,
    persistence: { domain: "customer-activity", endpoint, retainForMs: 24 * 60 * 60 * 1000 },
    fetcher: fetchLiveExperienceResource<CustomerActivityResource>(endpoint, scope),
  });
  if (!available || !data) return <CustomerJourneyLoading failed={error?"Please try loading your appointments again.":undefined} onRetry={()=>void refresh()}/>;
  return <CustomerActivityView key={`${scope}:${view.initialTab}:${view.initialSelectedBookingId??""}`} {...view} error={view.error || (error?"Could not refresh. Showing the last loaded records.":undefined)} refreshing={refreshing} activity={data.data.result} onRefresh={async()=>{await refresh();}} />;
}
