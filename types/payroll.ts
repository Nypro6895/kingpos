import type { Staff } from "@/types/staff";

export const PAYROLL_CYCLE_TYPES = ["monthly", "biweekly", "custom"] as const;
export const PAYROLL_RUN_STATUSES = [
  "draft",
  "locked",
  "paid",
  "needs_review",
] as const;
export const STAFF_PAY_TYPES = ["commission", "fixed"] as const;
export const TIP_ALLOCATION_METHODS = [
  "prorated",
  "manual",
  "staff_earning",
  "none",
] as const;

export type PayrollCycleType = (typeof PAYROLL_CYCLE_TYPES)[number];
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];
export type StaffPayType = (typeof STAFF_PAY_TYPES)[number];
export type TipAllocationMethod = (typeof TIP_ALLOCATION_METHODS)[number];

export type PayrollPeriodPreset =
  | "previous_month"
  | "previous_biweekly"
  | "custom";

export type PayrollPeriod = {
  cycleType: PayrollCycleType;
  endDate: string;
  label: string;
  preset: PayrollPeriodPreset;
  startDate: string;
};

export type SalonPayrollSetting = {
  biweekly_anchor_date: string | null;
  created_at: string;
  cycle_type: Exclude<PayrollCycleType, "custom">;
  id: string;
  organization_id: string;
  salon_id: string;
  updated_at: string;
};

export type StaffPayrollSetting = {
  apply_tax_to_fixed_pay: boolean;
  check_rate: number;
  commission_rate: number;
  created_at: string;
  effective_from: string;
  effective_to: string | null;
  fixed_pay_amount: number;
  id: string;
  legal_name: string | null;
  organization_id: string;
  pay_type: StaffPayType;
  salon_id: string;
  staff_id: string;
  tax_company_enabled: boolean;
  tax_rate: number;
  updated_at: string;
};

export type PayrollRun = {
  correction_snapshot: unknown;
  created_at: string;
  cycle_type: PayrollCycleType;
  generated_at: string;
  id: string;
  locked_at: string | null;
  locked_by: string | null;
  organization_id: string;
  paid_at: string | null;
  paid_by: string | null;
  period_end: string;
  period_start: string;
  salon_id: string;
  settings_snapshot: unknown;
  status: PayrollRunStatus;
  updated_at: string;
};

export type PayrollStaffLine = {
  bonus_amount: number;
  cash_amount: number;
  check_gross: number;
  check_net: number;
  check_number: string | null;
  check_rate_used: number;
  commission_rate_used: number;
  created_at: string;
  final_staff_income: number;
  fixed_pay_amount_used: number;
  gross_sales: number;
  id: string;
  note: string | null;
  organization_id: string;
  pay_type_used: StaffPayType;
  payroll_run_id: string;
  salon_id: string;
  shop_share: number;
  staff_commission_gross: number;
  staff_display_name_snapshot: string;
  staff_id: string;
  staff_legal_name_snapshot: string | null;
  tax_company_enabled_snapshot: boolean;
  tax_rate_used: number;
  tax_withheld: number;
  tip_allocation_method: TipAllocationMethod;
  tip_amount: number;
  updated_at: string;
};

export type PayrollStaffDailyTotal = {
  business_date: string;
  correction_delta: number;
  created_at: string;
  gross_sales: number;
  id: string;
  note: string | null;
  organization_id: string;
  payroll_run_id: string;
  salon_id: string;
  staff_id: string;
  tip_amount: number;
  updated_at: string;
};

export type PayrollPaystub = {
  created_at: string;
  file_name: string | null;
  file_url_or_path: string | null;
  id: string;
  mime_type: string | null;
  note: string | null;
  organization_id: string;
  payroll_run_id: string;
  salon_id: string;
  size_bytes: number | null;
  staff_id: string;
  updated_at: string;
  uploaded_by: string | null;
};

export type PayrollCorrectionListItem = {
  businessDate: string;
  correctionDate: string;
  delta: number | null;
  id: string;
  source: "financial_request" | "financial_adjustment" | "ticket_adjustment";
  staffId: string | null;
  staffName: string | null;
  status: string;
  ticketId: string | null;
  ticketNumber: string | null;
  type: string;
};

export type PayrollSummary = {
  correctionAfterLockdayCount: number;
  missingPaystubCount: number;
  totalBonus: number;
  totalCashPayout: number;
  totalCheckGross: number;
  totalCheckNet: number;
  totalFinalStaffIncome: number;
  totalPosIncome: number;
  totalShopShare: number;
  totalStaffCommissionPayout: number;
  totalStaffGrossProduction: number;
  totalTaxWithheld: number;
  totalTip: number;
};

export type PayrollStaffLineWithDailyTotals = PayrollStaffLine & {
  dailyTotals: PayrollStaffDailyTotal[];
  paystub: PayrollPaystub | null;
};

export type StaffPayrollSettingWithStaff = {
  setting: StaffPayrollSetting | null;
  staff: Staff;
};
