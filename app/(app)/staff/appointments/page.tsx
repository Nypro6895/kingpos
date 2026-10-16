import { withExperiencePage } from "@/components/experience-page";
import { StaffScheduleClient } from "@/app/staff/appointments/staff-schedule-client";
import { getCurrentStaffAppointments, type StaffAppointmentsSearchParams } from "@/lib/staff-appointments";
import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot } from "@/lib/experience-live-resource-server";
import { redirect } from "next/navigation";
async function StaffAppointmentsPage({ searchParams }: { searchParams?: Promise<StaffAppointmentsSearchParams> }) {
  const params = (await searchParams) ?? {};
  const { context, ...data } = await getCurrentStaffAppointments(params);
  if (!context.user) redirect("/login?next=/staff/appointments");
  const salonId = context.currentStaffSalon?.id ?? context.salonId ?? "";
  return <StaffScheduleClient scope={getExperienceContext(context).scope} params={params} initialSnapshot={createLiveResourceSnapshot({ kind: "schedule" as const, salonId, staffId: data.staff?.id ?? "", result: data })} />;
}
export default withExperiencePage(StaffAppointmentsPage);
