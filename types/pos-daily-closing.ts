export const POS_DAILY_CLOSING_STATUSES = [
  "draft",
  "closed",
  "approved",
  "reopened",
] as const;

export type PosDailyClosingStatus =
  (typeof POS_DAILY_CLOSING_STATUSES)[number];

export type PosDailyClosing = {
  approved_at: string | null;
  approved_by: string | null;
  cash_amount: number;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  created_by: string;
  credit_card_amount: number;
  id: string;
  note: string | null;
  organization_id: string;
  other_amount: number;
  report_date: string;
  salon_id: string;
  status: PosDailyClosingStatus;
  updated_at: string;
  updated_by: string | null;
};

export type DailyPosClosingInputs = {
  approvedAt: string | null;
  cashAmount: number;
  closedAt: string | null;
  creditCardAmount: number;
  note: string | null;
  otherAmount: number;
  status: PosDailyClosingStatus;
};

export type DailyPosReconciliationStatus = "balanced" | "short" | "over";

export type DailyPosReportTotals = {
  actualTotal: number;
  difference: number;
  expectedTotal: number;
  giftCardPaymentTotal: number;
  reconciliationStatus: DailyPosReconciliationStatus;
  totalDiscount: number;
  totalGiftCard: number;
  totalStaffEarned: number;
  totalTax: number;
  totalTip: number;
};

export type DailyPosReportStaffRow = {
  staffId: string;
  staffName: string;
  tipAmount: number;
  totalEarned: number;
  totalTurns: number;
};

export type DailyPosReportMetadata = {
  excludedOpenTicketCount: number;
  excludedVoidedTicketCount: number;
  finalizedTicketCount: number;
  ticketCount: number;
};

export type DailyPosReport = {
  closingInputs: DailyPosClosingInputs;
  metadata: DailyPosReportMetadata;
  reportDate: string;
  staffRows: DailyPosReportStaffRow[];
  totals: DailyPosReportTotals;
};
