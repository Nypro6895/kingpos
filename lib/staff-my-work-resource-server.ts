import "server-only";

import { getExperienceContext } from "@/lib/experience-context";
import { getCurrentStaffAnalysisPortalData, getCurrentStaffPayrollPortalData } from "@/lib/payroll";
import { canReuseStaffPortalReadIdentity, getStaffPortalIdentity, revalidateStaffPortalReadIdentity } from "@/lib/staff-portal-identity";
import type { ReadRequestTiming, ReadStage } from "@/lib/read-request-timing";
import { getStaffProfileAvatarUrl, getStaffProfileDisplayName } from "@/lib/staff-profile";
import { getCurrentStaffAssignedWork, getTodaysStaffWorkday, STAFF_WORKDAY_STATUS_LABELS } from "@/lib/staff-workdays";
import { staffMyWorkActiveTab, staffMyWorkStringParam, type StaffMyWorkSearchParams, type StaffMyWorkResource } from "./staff-my-work-experience";

export async function loadStaffMyWorkResource(
  identity: Awaited<ReturnType<typeof getStaffPortalIdentity>>,
  params: StaffMyWorkSearchParams,
  timing?: ReadRequestTiming,
): Promise<StaffMyWorkResource> {
  const { context, staff, supabase } = identity;
  if (!context.user || !context.currentSalon || !staff || !supabase) throw new Error("Staff Daily unavailable");
  const readIdentity = canReuseStaffPortalReadIdentity(identity, context) ? identity : undefined;
  const salonId = context.currentSalon.id;
  const measure = <T>(stage: ReadStage, read: () => Promise<T>) => timing?.measure(stage, read) ?? read();
  const activeTab = staffMyWorkActiveTab(params.tab);
  const input = { payPeriodStart: staffMyWorkStringParam(params.payPeriodStart) };
  const selectedData = activeTab === "payroll" ? measure("staff_pay_tab", () => getCurrentStaffPayrollPortalData(input))
    : activeTab === "analysis" ? measure("staff_pay_tab", () => getCurrentStaffAnalysisPortalData(input)) : Promise.resolve(null);
  // The selected pay tab loads alongside Daily. A tab error must not erase the
  // independently loaded Daily view; background callers retain a complete tab.
  const selectedResult = selectedData.catch(error => { console.error("Staff pay tab load failed", error); return null; });
  const assignedWork = measure("staff_assigned", () => getCurrentStaffAssignedWork(context, { readIdentity }));
  // Salon-only reads can start now. Attendance still needs the authoritative
  // snapshot date, which may differ from the preliminary business clock date.
  const [work, attendance, timezone, history, tabData] = await Promise.all([
    assignedWork,
    assignedWork.then(({ today }) => measure("staff_attendance", () => getTodaysStaffWorkday(context, { allowEmailFallback: false, workDate: today, readIdentity }))),
    measure("staff_timezone", async () => await supabase.rpc("get_salon_business_timezone", { p_salon_id: salonId })),
    measure("staff_greeting", async () => await supabase.rpc("get_my_staff_greeting_context", { p_salon_id: salonId }).then(result => result.error ? null : result.data, () => null)),
    selectedResult,
  ]);
  const { excludedTicketCount, today, workTickets } = work;
  if (timezone.error || typeof timezone.data !== "string") throw new Error("Salon timezone unavailable");
  if (tabData && (tabData.staff?.id !== staff.id || getExperienceContext(tabData.context).scope !== getExperienceContext(context).scope)) {
    throw new Error("Staff pay tab identity could not be verified");
  }
  if (readIdentity) await measure("staff_revalidate", () => revalidateStaffPortalReadIdentity(readIdentity));
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
