import type { Staff } from "@/types/staff";

export const PAYROLL_CYCLE_TYPES = [
  "monthly",
  "semi_monthly",
  "biweekly",
  "custom",
] as const;
export const PAYROLL_RUN_STATUSES = [
  "draft",
  "locked",
  "printed",
  "paid",
  "needs_review",
] as const;
export const STAFF_PAY_TYPES = ["commission", "fixed"] as const;
export const PAYROLL_PAYOUT_METHODS = ["check", "cash"] as const;
export const TIP_ALLOCATION_METHODS = [
  "prorated",
  "manual",
  "staff_earning",
  "none",
] as const;

export type PayrollCycleType = (typeof PAYROLL_CYCLE_TYPES)[number];
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];
export type StaffPayType = (typeof STAFF_PAY_TYPES)[number];
export type PayrollPayoutMethod = (typeof PAYROLL_PAYOUT_METHODS)[number];
export type TipAllocationMethod = (typeof TIP_ALLOCATION_METHODS)[number];

export type PayrollPeriodPreset =
  | "previous_month"
  | "current_month"
  | "semi_monthly_first"
  | "semi_monthly_second"
  | "previous_pay_period"
  | "current_pay_period"
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
  salon_id: string;
  updated_at: string;
};

export type StaffPayrollSetting = {
  apply_tax_to_fixed_pay: boolean;
  bonus_payout_method: PayrollPayoutMethod;
  cash_to_tax_company: boolean;
  check_rate: number;
  commission_rate: number;
  created_at: string;
  effective_from: string;
  effective_to: string | null;
  fixed_pay_amount: number;
  id: string;
  legal_name: string | null;
  pay_type: StaffPayType;
  salon_id: string;
  staff_id: string;
  tax_bonus: boolean;
  tax_company_enabled: boolean;
  tax_rate: number;
  tax_tips: boolean;
  tip_payout_method: PayrollPayoutMethod;
  updated_at: string;
};

export type PayrollPeriodStaffInput = {
  bonus_amount: number;
  check_number: string | null;
  created_at: string;
  cycle_type: PayrollCycleType;
  id: string;
  note: string | null;
  period_end: string;
  period_start: string;
  salon_id: string;
  staff_id: string;
  updated_at: string;
  updated_by: string | null;
};

export type PayrollPeriodStaffInputHistory = {
  change_type: "input_update" | "correction_request";
  created_at: string;
  created_by: string | null;
  cycle_type: PayrollCycleType;
  field_changes: Record<string, { current: unknown; previous: unknown }>;
  id: string;
  new_value_json: Record<string, unknown>;
  payroll_run_id: string | null;
  period_end: string;
  period_staff_input_id: string | null;
  period_start: string;
  previous_value_json: Record<string, unknown>;
  salon_id: string;
  staff_id: string;
};

export type PayrollRun = {
  correction_snapshot: unknown;
  created_at: string;
  cycle_type: PayrollCycleType;
  generated_at: string;
  id: string;
  locked_at: string | null;
  locked_by: string | null;
  paid_at: string | null;
  paid_by: string | null;
  period_end: string;
  period_start: string;
  printed_at: string | null;
  printed_by: string | null;
  salon_id: string;
  settings_snapshot: unknown;
  status: PayrollRunStatus;
  updated_at: string;
  version: number;
};

export type PayrollStatement = PayrollRun;

export type PayrollStaffLine = {
  base_cash_amount: number;
  base_check_amount: number;
  bonus_amount: number;
  bonus_cash_amount: number;
  bonus_check_amount: number;
  bonus_payout_method_snapshot: PayrollPayoutMethod;
  cash_amount: number;
  cash_to_tax_company_snapshot: boolean;
  check_gross: number;
  check_net: number;
  check_number: string | null;
  check_rate_used: number;
  commission_rate_used: number;
  created_at: string;
  earned_amount: number;
  final_staff_income: number;
  final_cash_amount: number;
  final_check_amount: number;
  fixed_pay_amount_used: number;
  gross_sales: number;
  id: string;
  is_mixed_rate: boolean;
  note: string | null;
  pay_type_used: StaffPayType;
  payroll_run_id: string;
  period_staff_input_snapshot: unknown;
  salon_id: string;
  settings_used_snapshot: unknown;
  shop_share: number;
  staff_commission_gross: number;
  staff_display_name_snapshot: string;
  staff_id: string;
  staff_legal_name_snapshot: string | null;
  tax_bonus_snapshot: boolean;
  tax_company_reported_wage_gross: number;
  tax_company_taxable_gross: number;
  tax_company_enabled_snapshot: boolean;
  tax_company_cash_amount: number;
  tax_company_check_amount: number;
  tax_rate_used: number;
  tax_tips_snapshot: boolean;
  tax_withheld: number;
  tip_allocation_method: TipAllocationMethod;
  tip_amount: number;
  tip_cash_amount: number;
  tip_check_amount: number;
  tip_payout_method_snapshot: PayrollPayoutMethod;
  updated_at: string;
};

export type PayrollStaffDailyTotal = {
  business_date: string;
  check_rate_used: number | null;
  commission_rate_used: number | null;
  correction_delta: number;
  created_at: string;
  fixed_pay_amount_used: number | null;
  gross_sales: number;
  id: string;
  note: string | null;
  pay_type_used: StaffPayType | null;
  payroll_run_id: string;
  salon_id: string;
  settings_used_snapshot: unknown;
  staff_id: string;
  tax_rate_used: number | null;
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
  payroll_run_id: string;
  salon_id: string;
  size_bytes: number | null;
  staff_id: string;
  updated_at: string;
  uploaded_by: string | null;
  view_url?: string | null;
};

export type PayrollCorrectionListItem = {
  businessDate: string;
  changedById: string | null;
  correctionDate: string;
  correctionRequestId: string | null;
  delta: number | null;
  id: string;
  changedByName: string | null;
  note: string | null;
  newValue: string | null;
  oldValue: string | null;
  rawNewValue: string | null;
  rawOldValue: string | null;
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
  totalTaxCompanyAmount: number;
  totalTaxCompanyCashAmount: number;
  totalTaxCompanyCheckAmount: number;
  totalTaxCompanyReportedWageGross: number;
  totalTaxCompanyTaxableGross: number;
  totalTip: number;
};

export type PayrollStaffLineWithDailyTotals = PayrollStaffLine & {
  dailyTotals: PayrollStaffDailyTotal[];
  input: PayrollPeriodStaffInput | null;
  inputHistory?: PayrollPeriodStaffInputHistory[];
  paystub: PayrollPaystub | null;
};

export type PayrollStatementSnapshot = {
  lines: PayrollStaffLineWithDailyTotals[];
  paystubs: PayrollPaystub[];
  run: PayrollStatement;
  shopDailyRows: PayrollShopDailyRow[];
  shopSummary: PayrollShopSummary | null;
  summary: PayrollSummary;
};

export type PayrollLiveSnapshot = {
  corrections: PayrollCorrectionListItem[];
  lines: PayrollStaffLineWithDailyTotals[];
  periodInputs: PayrollPeriodStaffInput[];
  shopDailyRows: PayrollShopDailyRow[];
  shopSummary: PayrollShopSummary;
  summary: PayrollSummary;
};

export type PayrollDifferenceValue = {
  current: number;
  previous: number;
  delta: number;
};

export type PayrollStaffDifference = {
  staffId: string;
  staffName: string;
  differences: Record<string, PayrollDifferenceValue>;
};

export type PayrollActionDifferenceChange = {
  field: string;
  label: string;
  current: number | null;
  currentText?: string | null;
  previous: number | null;
  previousText?: string | null;
  delta: number | null;
  valueType: "money" | "status" | "text";
};

export type PayrollActionDifferenceKind =
  | "cash_changed"
  | "check_changed"
  | "paystub_missing"
  | "paystub_outdated"
  | "staff_added"
  | "staff_removed"
  | "tax_changed";

export type PayrollActionDifference = {
  action: string;
  changes: PayrollActionDifferenceChange[];
  kind: PayrollActionDifferenceKind;
  priority: number;
  staffId: string;
  staffName: string;
  title: string;
};

export type PayrollStatementDifference = {
  actionItems: PayrollActionDifference[];
  changed: boolean;
  staffDifferences: PayrollStaffDifference[];
  summaryDifferences: Record<string, PayrollDifferenceValue>;
};

export type PayrollStatusKind =
  | "live"
  | "printed"
  | "changed_since_print"
  | "paid";

export type PayrollStatusView = {
  kind: PayrollStatusKind;
  label: string;
  statementVersion: number | null;
};

export type StaffPayrollSettingWithStaff = {
  history: StaffPayrollSetting[];
  setting: StaffPayrollSetting | null;
  staff: Staff;
  staffProfileAvatarUrl: string | null;
  staffProfileDisplayName: string;
};

export type PayrollPeriodOption = {
  endDate: string;
  label: string;
  startDate: string;
  value: string;
};

export type PayrollShopDailyRow = {
  actualIncome: number | null;
  businessDate: string;
  cashAmount: number | null;
  corrections: PayrollCorrectionListItem[];
  creditCardAmount: number | null;
  difference: number | null;
  manualInputIncome: number | null;
  otherAmount: number | null;
  overShortStatus: "balanced" | "short" | "over" | "no_closing_input";
  posIncome: number;
  shopShare: number;
  shopNetIncome: number | null;
  staffCommissionPay: number;
  staffNetPay: number;
  staffObligation: number;
  staffProduction: number;
  taxWithheld: number;
  tipsPaid: number;
  tips: number;
};

export type PayrollShopSummary = {
  cashAmount: number | null;
  correctionCount: number;
  creditCardAmount: number | null;
  manualInputIncome: number | null;
  otherAmount: number | null;
  overShortTotal: number | null;
  posIncome: number;
  shopShare: number;
  shopNetIncome: number | null;
  staffCommissionPay: number;
  staffNetPay: number;
  totalStaffObligation: number;
  staffProduction: number;
  taxWithheld: number;
  tipsPaid: number;
  tips: number;
  totalActualIncome: number | null;
};

export type PayrollServiceAnalyticsRow = {
  count: number;
  revenue: number;
  serviceId: string;
  serviceName: string;
  ticketCount: number;
};

export type PayrollServiceAnalytics = {
  rows: PayrollServiceAnalyticsRow[];
  ticketCount: number;
};
