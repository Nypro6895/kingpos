import "server-only";

import { getExperienceContext } from "@/lib/experience-context";
import { getCurrentStaffAnalysisPortalData, getCurrentStaffPayrollPortalData } from "@/lib/payroll";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { getStaffProfileAvatarUrl, getStaffProfileDisplayName } from "@/lib/staff-profile";
import { getCurrentStaffAssignedWork, getTodaysStaffWorkday, STAFF_WORKDAY_STATUS_LABELS } from "@/lib/staff-workdays";
import { staffMyWorkActiveTab, staffMyWorkStringParam, type StaffMyWorkSearchParams, type StaffMyWorkResource } from "./staff-my-work-experience";

export async function loadStaffMyWorkResource(
  identity: Awaited<ReturnType<typeof getStaffPortalIdentity>>,
  params: StaffMyWorkSearchParams,
): Promise<StaffMyWorkResource> {
  const { context, staff, supabase } = identity;
  if (!context.user || !context.currentSalon || !staff || !supabase) throw new Error("Staff Daily unavailable");
  const activeTab = staffMyWorkActiveTab(params.tab);
  const input = { payPeriodStart: staffMyWorkStringParam(params.payPeriodStart) };
  const selectedData = activeTab === "payroll" ? getCurrentStaffPayrollPortalData(input)
    : activeTab === "analysis" ? getCurrentStaffAnalysisPortalData(input) : Promise.resolve(null);
  // The selected pay tab loads alongside Daily. A tab error must not erase the
  // independently loaded Daily view; background callers retain a complete tab.
  const selectedResult = selectedData.catch(error => { console.error("Staff pay tab load failed", error); return null; });
  const { excludedTicketCount, today, workTickets } = await getCurrentStaffAssignedWork(context);
  const [attendance, timezone, history, tabData] = await Promise.all([
    getTodaysStaffWorkday(context, { allowEmailFallback: false, workDate: today }),
    supabase.rpc("get_salon_business_timezone", { p_salon_id: context.currentSalon.id }),
    supabase.rpc("get_my_staff_greeting_context", { p_salon_id: context.currentSalon.id }).then(result => result.error ? null : result.data, () => null),
    selectedResult,
  ]);
  if (timezone.error || typeof timezone.data !== "string") throw new Error("Salon timezone unavailable");
  if (tabData && (tabData.staff?.id !== staff.id || getExperienceContext(tabData.context).scope !== getExperienceContext(context).scope)) {
    throw new Error("Staff pay tab identity could not be verified");
  }
  const payroll = activeTab === "payroll" ? tabData as Awaited<ReturnType<typeof getCurrentStaffPayrollPortalData>> | null : null;
  const analysis = activeTab === "analysis" ? tabData as Awaited<ReturnType<typeof getCurrentStaffAnalysisPortalData>> | null : null;
  const workStatus = attendance.workday?.status ?? "not_checked_in";
  return {
    salonId: context.currentSalon.id, staff, today, workTickets, excludedTicketCount,
    workStatus, workStatusLabel: STAFF_WORKDAY_STATUS_LABELS[workStatus],
    salonTimezone: timezone.data, greetingHistory: history,
    staffDisplayName: getStaffProfileDisplayName(staff, context.user),
    staffAvatarUrl: getStaffProfileAvatarUrl({ accountAvatarUrl: context.user.avatar_url, staffProfilePhotoPath: staff.public_profile_photo_path }),
    payrollData: payroll ? {
      settings: payroll.settings, dailyRows: payroll.dailyRows, line: payroll.line, paystub: payroll.paystub,
      period: payroll.period, periodOptions: payroll.periodOptions, status: payroll.status,
      latestStatement: payroll.latestStatement ? { run: { paid_at: payroll.latestStatement.run.paid_at } } : null,
    } : null,
    analysisData: analysis ? { period: analysis.period, periodOptions: analysis.periodOptions, workPerformance: analysis.workPerformance, comparison: analysis.comparison } : null,
    generatedAt: new Date().toISOString(),
  };
}
