"use client";

import { PageLoadingSkeleton } from "@/components/loading-feedback";
import type { StaffAppointmentsSearchParams } from "@/lib/staff-appointments";
import type { StaffScheduleResource } from "@/lib/staff-read-view";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import { useStaffReadResource } from "@/lib/use-staff-read-resource";
import { StaffScheduleView } from "./staff-schedule-view";

export function StaffScheduleClient({ scope, initialSnapshot, params }: { scope: string; initialSnapshot: LiveResourceSnapshot<StaffScheduleResource>; params: StaffAppointmentsSearchParams }) {
  const query = new URLSearchParams({ kind: "schedule", staffId: initialSnapshot.data.staffId });
  for (const key of ["range", "status", "bookingId", "date", "quickId", "view"] as const) {
    const value = params[key]; const first = Array.isArray(value) ? value[0] : value;
    if (first) query.set(key, first);
  }
  const { available, data } = useStaffReadResource(scope, initialSnapshot, query);
  if (!available || !data) return <PageLoadingSkeleton />;
  return <StaffScheduleView data={data.data.result} params={params} salonId={data.data.salonId} />;
}
