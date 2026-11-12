export type TaxProfile = {
  user_id: string;
  display_name: string;
  contact_email: string;
  phone: string;
  company_name: string;
};
export type TaxRun = {
  id: string;
  period_start: string;
  period_end: string;
  version: number;
  status: string;
  cycle_type: string;
};
export type TaxStatus =
  | "pending"
  | "reviewed"
  | "needs_information"
  | "complete";
export type TaxLine = {
  reported_wage: number;
  mixed_settings?: boolean;
  tip_method?: string | null;
  bonus_method?: string | null;
  id: string;
  run_id: string;
  staff_id: string;
  name: string;
  legal_name: string | null;
  reported_gross: number;
  tax: number;
  actual_check: number;
  wage_check_net: number;
  cash_reported: number | null;
  tip: number | null;
  bonus: number | null;
  tax_rate: number | null;
  work_status: TaxStatus;
  work_version: number;
};
export type TaxDocument = {
  salon_name?: string;
  staff_name?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  id: string;
  salon_id: string;
  staff_id: string | null;
  recipient_user_id: string | null;
  payroll_run_id: string | null;
  kind: "paystub" | "employee" | "business" | "tax" | "receipt";
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  version: number;
  supersedes_id: string | null;
  uploaded_by: string;
  uploaded_role: string;
  created_at: string;
  archived_at: string | null;
  owner_deleted_at: string | null;
};
export type TaxMessage = {
  id: string;
  staff_id: string | null;
  payroll_run_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  document_id: string | null;
  created_at: string;
};
export type TaxReceipt = {
  id: string;
  category: "service_fee" | "tax_receipt" | "business_expense";
  description: string;
  amount_cents: number;
  currency: string;
  receipt_date: string;
  status: "needs_review" | "received" | "paid";
  document_id: string | null;
  archived_at: string | null;
  created_at: string;
};
export type TaxEvent = {
  id: string;
  actor_name: string;
  action: string;
  subject_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};
export type TaxWorkspaceData = {
  people?: { id: string; name: string; legal_name?: string | null }[];
  salon: {
    id: string;
    name: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    address_line1: string | null;
  };
  runs: TaxRun[];
  lines: TaxLine[];
  documents: TaxDocument[];
  messages: TaxMessage[];
  receipts: TaxReceipt[];
  events: TaxEvent[];
};
export type TaxWorkspaceMode = "tax" | "owner" | "staff";
