export const POS_DAILY_CLOSING_STATUSES = [
  "auto_locked",
  "draft",
  "closed",
  "approved",
  "locked",
  "needs_review",
  "payroll_locked",
  "reopened",
] as const;

export type PosDailyClosingStatus =
  (typeof POS_DAILY_CLOSING_STATUSES)[number];

export type PosDailyClosing = {
  approved_at: string | null;
  approved_by: string | null;
  actual_total_snapshot: number | null;
  cash_amount: number;
  cash_amount_snapshot: number | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  created_by: string;
  credit_card_amount: number;
  credit_card_amount_snapshot: number | null;
  difference_snapshot: number | null;
  discount_snapshot: number | null;
  expected_total_snapshot: number | null;
  finalized_ticket_count_snapshot: number | null;
  gift_card_snapshot: number | null;
  id: string;
  lock_reason: string | null;
  lock_type: string | null;
  locked_at: string | null;
  locked_by: string | null;
  note: string | null;
  note_snapshot: string | null;
  organization_id: string;
  other_amount: number;
  other_amount_snapshot: number | null;
  report_date: string;
  salon_id: string;
  snapshot_created_at: string | null;
  staff_earned_snapshot: number | null;
  status: PosDailyClosingStatus;
  ticket_count_snapshot: number | null;
  tip_snapshot: number | null;
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
  bigTurnCount: number;
  smallTurnCount: number;
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

export type DailyClosingSnapshotTotals = {
  actualTotal: number;
  cashAmount: number;
  creditCardAmount: number;
  difference: number;
  discount: number;
  expectedTotal: number;
  finalizedTicketCount: number;
  giftCard: number;
  note: string | null;
  otherAmount: number;
  staffEarned: number;
  ticketCount: number;
  tip: number;
};

export type DailyClosingAdjustmentTotals = {
  actualTotalDelta: number;
  cashDelta: number;
  creditCardDelta: number;
  discountDelta: number;
  expectedTotalDelta: number;
  giftCardDelta: number;
  otherDelta: number;
  serviceDelta: number;
  tipDelta: number;
  turnDelta: number;
};

export type DailyClosingLockInfo = {
  currentBusinessDate: string;
  isLocked: boolean;
  isPastDate: boolean;
  liveTotalsDifferFromSnapshot: boolean;
  lockedAt: string | null;
  lockReason: string | null;
  lockType: string | null;
  status: PosDailyClosingStatus;
};

export type DailyClosingCorrectionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied";

export type DailyClosingCorrectionField =
  | "cash_amount"
  | "credit_card_amount"
  | "other_amount"
  | "note";

export type DailyClosingCorrectionRequest = {
  adminNote: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  businessDate: string;
  correctionType: string;
  id: string;
  moneyDelta: number;
  oldValue: unknown;
  reason: string;
  requestedAt: string;
  requestedBy: string;
  requestedByName: string | null;
  requestedValue: unknown;
  status: DailyClosingCorrectionStatus;
};

export type DailyClosingFinancialAdjustment = {
  actualTotalDelta: number;
  cashDelta: number;
  correctionRequestId: string | null;
  createdAt: string;
  createdBy: string;
  createdByName: string | null;
  creditCardDelta: number;
  expectedTotalDelta: number;
  id: string;
  note: string | null;
  otherDelta: number;
};

export type DailyPosReport = {
  adjustmentTotals: DailyClosingAdjustmentTotals;
  closingInputs: DailyPosClosingInputs;
  corrections: {
    adjustments: DailyClosingFinancialAdjustment[];
    requests: DailyClosingCorrectionRequest[];
  };
  lock: DailyClosingLockInfo;
  metadata: DailyPosReportMetadata;
  pendingCorrectionCount: number;
  reportDate: string;
  snapshotTotals: DailyClosingSnapshotTotals | null;
  staffRows: DailyPosReportStaffRow[];
  totals: DailyPosReportTotals;
};
