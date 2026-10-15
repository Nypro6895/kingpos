import type { StaffAnalysisPortalData, StaffPayrollPortalData } from "@/lib/payroll";
import type { StaffGreetingHistory } from "@/lib/staff-greeting";
import type { StaffAssignedWorkTicket } from "@/lib/staff-workdays";
import type { Staff } from "@/types/staff";

export type StaffPortalTab = "daily" | "payroll" | "analysis";
export type StaffMyWorkSearchParams = {
  cycleType?: string | string[]; end?: string | string[]; error?: string | string[];
  month?: string | string[]; payPeriodStart?: string | string[]; profile?: string | string[];
  preset?: string | string[]; segment?: string | string[]; start?: string | string[]; tab?: string | string[];
};

export type StaffPayrollView = Pick<StaffPayrollPortalData,
  "settings" | "dailyRows" | "line" | "paystub" | "period" | "periodOptions" | "status"
> & { latestStatement: { run: { paid_at: string | null } } | null };
export type StaffAnalysisView = Pick<StaffAnalysisPortalData, "period" | "periodOptions" | "workPerformance" | "comparison">;

export type StaffMyWorkResource = {
  salonId: string;
  staff: Staff;
  today: string;
  workTickets: StaffAssignedWorkTicket[];
  excludedTicketCount: number;
  workStatus: string;
  workStatusLabel: string;
  salonTimezone: string;
  greetingHistory: StaffGreetingHistory | null;
  staffDisplayName: string;
  staffAvatarUrl: string | null;
  payrollData: StaffPayrollView | null;
  analysisData: StaffAnalysisView | null;
  generatedAt: string;
};

export function staffMyWorkStringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function staffMyWorkActiveTab(tab: string | string[] | undefined): StaffPortalTab {
  const value = staffMyWorkStringParam(tab);
  return value === "payroll" || value === "analysis" ? value : "daily";
}
