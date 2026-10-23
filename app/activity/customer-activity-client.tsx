"use client";

import type { CustomerActivityData } from "@/lib/customer-activity";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import { useExperienceResource } from "@/lib/use-experience-resource";
import { PageLoadingSkeleton } from "@/components/loading-feedback";
import { CustomerActivityView } from "./customer-activity-view";

export type CustomerActivityResource = { kind: "activity"; result: CustomerActivityData };

export function CustomerActivityClient({ scope, initialSnapshot }: { scope: string; initialSnapshot: LiveResourceSnapshot<CustomerActivityResource> }) {
  const endpoint = "/api/experience/customer?kind=activity";
  const { available, data } = useExperienceResource({
    scope, key: endpoint, initialData: initialSnapshot,
    initialUpdatedAt: Date.parse(initialSnapshot.updatedAt), initialEtag: `"${initialSnapshot.revision}"`,
    tags: ["booking", "tickets"], freshForMs: 15000, retainForMs: 30 * 60 * 1000,
    persistence: { domain: "customer-activity", endpoint, retainForMs: 24 * 60 * 60 * 1000 },
    fetcher: fetchLiveExperienceResource<CustomerActivityResource>(endpoint, scope),
  });
  if (!available || !data) return <PageLoadingSkeleton />;
  return <CustomerActivityView activity={data.data.result} />;
}
