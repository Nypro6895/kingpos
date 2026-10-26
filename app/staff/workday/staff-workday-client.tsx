"use client";

import { PageLoadingSkeleton } from "@/components/loading-feedback";
import type { StaffWorkdayResource } from "@/lib/staff-read-view";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import { useStaffReadResource } from "@/lib/use-staff-read-resource";
import { StaffWorkdayView } from "./staff-workday-view";

export function StaffWorkdayClient({ scope, initialSnapshot, error }: { scope: string; initialSnapshot: LiveResourceSnapshot<StaffWorkdayResource>; error?: string }) {
  const { available, data } = useStaffReadResource(scope, initialSnapshot, new URLSearchParams({ kind: "workday", staffId: initialSnapshot.data.staffId, date: initialSnapshot.data.result.today }));
  if (!available || !data) return <PageLoadingSkeleton />;
  return <StaffWorkdayView data={data.data.result} error={error} />;
}
