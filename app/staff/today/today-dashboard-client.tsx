"use client";

import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import type { TodayDashboard } from "@/lib/today-dashboard";
import { TodayProgressiveClient } from "./today-progressive-client";
import {FinancialInputHistoryPanel} from "@/app/payroll/financial-input-history-panel";

export function TodayDashboardClient({ initialSnapshot, scope, salonId, requestedDate, isOwner }: {
  initialSnapshot: LiveResourceSnapshot<TodayDashboard>; scope: string; salonId: string; requestedDate?: string; isOwner: boolean;
}) {
  return <><TodayProgressiveClient initialDashboard={initialSnapshot.data} scope={scope} salonId={salonId} requestedDate={requestedDate} isOwner={isOwner} /><div className="mx-auto w-full max-w-7xl px-4 sm:px-6"><FinancialInputHistoryPanel salonId={salonId} scope={scope} title="Ticket input history"/></div></>;
}
