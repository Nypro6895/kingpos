"use client";

import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import type { TodayDashboard } from "@/lib/today-dashboard";
import { TodayProgressiveClient } from "./today-progressive-client";

export function TodayDashboardClient({ initialSnapshot, scope, salonId, requestedDate, isOwner }: {
  initialSnapshot: LiveResourceSnapshot<TodayDashboard>; scope: string; salonId: string; requestedDate?: string; isOwner: boolean;
}) {
  return <TodayProgressiveClient initialDashboard={initialSnapshot.data} scope={scope} salonId={salonId} requestedDate={requestedDate} isOwner={isOwner} />;
}
