import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";

import { StaffWorkdayClient } from "@/app/staff/workday/staff-workday-client";
import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot } from "@/lib/experience-live-resource-server";
import {
  getCurrentSalonStaffActivitySummaries,
  getTodaysStaffWorkday,
} from "@/lib/staff-workdays";
import { redirect } from "next/navigation";

type StaffWorkdayPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="content-surface border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 rounded-none border-y shadow-none">
        <WorkspaceText text="Please select a salon first." />
      </p>
    </main>
  );
}

async function StaffWorkdayPage({
  searchParams,
}: StaffWorkdayPageProps) {
  const { error } = await searchParams;
  const { context, staff, today, workday } = await getTodaysStaffWorkday();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

  if (!staff) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="content-surface border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600 rounded-none border-y shadow-none">
          <WorkspaceText text="No active staff profile is linked to your account for this salon." />
        </p>
      </main>
    );
  }

  const activityByStaffId = await getCurrentSalonStaffActivitySummaries([staff.id], context);
  return <StaffWorkdayClient scope={getExperienceContext(context).scope} error={error} initialSnapshot={createLiveResourceSnapshot({
    kind: "workday" as const, salonId: context.currentSalon.id, staffId: staff.id,
    result: { today, salonName: context.currentSalon.name, activity: activityByStaffId.get(staff.id) ?? null,
      workday: workday ? { id: workday.id, status: workday.status, checkInAt: workday.check_in_at, checkOutAt: workday.check_out_at } : null },
  })} />;
}
export default withExperiencePage(StaffWorkdayPage);
