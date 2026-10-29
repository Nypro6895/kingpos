export const STUB_FIELDS = ["check", "cash", "tip", "bonus", "gross"] as const;
export type StubField = (typeof STUB_FIELDS)[number];
export type StubOptions = {
  same: boolean;
  payee: StubField[];
  salon: StubField[];
};
export type BankDetails = {
  name: string;
  city: string;
  routing: string;
  account: string;
  fractional: string;
};
export type CheckSettings = {
  issuer: string;
  address: string;
  useSalon: boolean;
  bankName: string;
  last4: string;
  nextNumber: number;
  version: number;
  stock: "preprinted" | "blank";
  offsetX: number;
  offsetY: number;
  stubs: StubOptions;
};
export type CheckSnapshot = {
  payee: string;
  amountCents: number;
  memo: string;
  date: string;
  issuer: string;
  address: string;
  bankEncrypted: string;
  stock: "preprinted" | "blank";
  stubs: StubOptions;
  payroll?: {
    check: number;
    cash: number;
    tip: number;
    bonus: number;
    gross: number;
    period: string;
  };
  source?: {
    kind?: "live" | "saved";
    calculatedAt?: string;
    existingCheckNumber?: string | null;
    lineId: string;
    runId: string;
    version: number;
    updatedAt: string;
    staffId: string;
    periodStart: string;
    periodEnd: string;
  };
};
export type CheckRecord = {
  id: string;
  number: number;
  snapshot: CheckSnapshot;
  status: "issued" | "void";
  created_at: string;
  void_reason: string | null;
  delivery_count: number;
};
export type PayrollCheckLine = {
  id: string;
  payroll_run_id: string;
  staff_id: string;
  staff_display_name_snapshot: string;
  staff_legal_name_snapshot: string | null;
  final_check_amount: number;
  final_cash_amount: number;
  tip_amount: number;
  bonus_amount: number;
  gross_sales: number;
  updated_at: string;
  check_number: string | null;
};
export type PayrollCheckRun = {
  id: string;
  period_start: string;
  period_end: string;
  version: number;
  status: string;
  updated_at: string;
};
export const DEFAULT_STUBS: StubOptions = { same: true, payee: [], salon: [] };
