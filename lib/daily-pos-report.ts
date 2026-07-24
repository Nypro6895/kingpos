import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getTodayDate } from "@/lib/staff-workdays";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  DailyClosingAdjustmentTotals,
  DailyClosingCorrectionField,
  DailyClosingCorrectionRequest,
  DailyClosingFinancialAdjustment,
  DailyClosingLockInfo,
  DailyClosingSnapshotTotals,
  DailyPosClosingInputs,
  DailyPosReport,
  DailyPosReportMetadata,
  DailyPosReportStaffRow,
  DailyPosReportTotals,
  DailyPosReconciliationStatus,
  PosDailyClosing,
} from "@/types/pos-daily-closing";
import type { PosPaymentMethod } from "@/types/pos-payment";
import type {
  PosTicketDiscountType,
  PosTicketStatus,
  PosTicketTipType,
} from "@/types/pos-ticket";

export const DAILY_POS_REPORT_PERMISSIONS = {
  applyCorrection: "payroll.manage",
  edit: "payroll.manage",
  requestCorrection: "reports.view",
  view: "reports.view",
} as const;

export const FINANCIAL_CORRECTION_PERMISSIONS = {
  apply: "financial_corrections.apply",
  request: "financial_corrections.request",
} as const;

export const POS_DAILY_CLOSING_SELECT =
  "id, salon_id, report_date, cash_amount, credit_card_amount, other_amount, note, status, closed_at, closed_by, approved_at, approved_by, locked_at, locked_by, lock_type, lock_reason, note_snapshot, staff_earned_snapshot, tip_snapshot, discount_snapshot, gift_card_snapshot, expected_total_snapshot, actual_total_snapshot, difference_snapshot, cash_amount_snapshot, credit_card_amount_snapshot, other_amount_snapshot, ticket_count_snapshot, finalized_ticket_count_snapshot, snapshot_created_at, created_by, updated_by, created_at, updated_at";

const FINANCIAL_DATE_LOCKED_MESSAGE =
  "This business date is locked. Please submit a correction request.";
const TICKET_DATE_LOCKED_MESSAGE =
  "This ticket belongs to a locked business date. Submit a financial correction request instead.";
const MONEY_MAX_CENTS = 999_999_999_999;
const LOCKED_DAILY_CLOSING_STATUSES = new Set([
  "auto_locked",
  "locked",
  "approved",
  "payroll_locked",
]);
const DAILY_CLOSING_CORRECTION_FIELDS = new Set<DailyClosingCorrectionField>([
  "cash_amount",
  "credit_card_amount",
  "other_amount",
  "note",
]);

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type ReportAuthContext = {
  context: CurrentBusinessContext;
  Account: NonNullable<CurrentBusinessContext["currentAccount"]>;
  salon: NonNullable<CurrentBusinessContext["currentSalon"]>;
  supabase: SupabaseServerClient;
  user: NonNullable<CurrentBusinessContext["user"]>;
};

type ReportTicketItemTurnPart = {
  amount: number;
  staff_id: string | null;
  turn_index: number;
  turn_type: "large" | "small";
};

type ReportTicketItem = {
  assigned_staff: { display_name: string; id: string } | null;
  assigned_staff_id: string | null;
  id: string;
  is_removed?: boolean;
  line_total: number;
  quantity: number;
  turn_parts?: ReportTicketItemTurnPart[] | null;
};

type ReportTicketPayment = {
  amount: number;
  payment_method: PosPaymentMethod;
};

type ReportTicketRow = {
  discount_type: PosTicketDiscountType;
  discount_value: number;
  id: string;
  opened_at: string;
  payments?: ReportTicketPayment[] | null;
  status: PosTicketStatus;
  tax_rate: number;
  ticket_items?: ReportTicketItem[] | null;
  tip_type: PosTicketTipType;
  tip_value: number;
};

type StaffEarningRow = {
  big_turn_count: number;
  service_total: number;
  small_turn_count: number;
  staff: { display_name: string; id: string } | null;
  staff_id: string;
  tip_amount: number;
};

type DailyReportCore = {
  allTickets: ReportTicketRow[];
  closing: PosDailyClosing | null;
  closingInputs: DailyPosClosingInputs;
  finalizedTickets: ReportTicketRow[];
  metadata: DailyPosReportMetadata;
  reportDate: string;
  staffRows: DailyPosReportStaffRow[];
  totals: DailyPosReportTotals;
};

type FinancialCorrectionRequestRow = {
  admin_note: string | null;
  approved_at: string | null;
  approved_by: string | null;
  business_date: string;
  correction_type: string;
  id: string;
  money_delta: number;
  old_value_json: unknown;
  reason: string;
  requested_at: string;
  requested_by: string;
  requested_value_json: unknown;
  status: DailyClosingCorrectionRequest["status"];
};

type FinancialAdjustmentRow = {
  actual_total_delta: number;
  cash_delta: number;
  correction_request_id: string | null;
  created_at: string;
  created_by: string;
  credit_card_delta: number;
  discount_delta: number;
  expected_total_delta: number;
  gift_card_delta: number;
  id: string;
  note: string | null;
  other_delta: number;
  service_delta: number;
  tip_delta: number;
  turn_delta: number;
};

export type SaveDailyPosClosingInput = {
  cashAmount: string;
  creditCardAmount: string;
  note?: string | null;
  otherAmount: string;
  reportDate: string;
};

export type DailyClosingCorrectionInput = {
  adminNote?: string | null;
  applyImmediately?: boolean;
  field: DailyClosingCorrectionField;
  reason: string;
  reportDate: string;
  requestedValue: string;
};

export type ApplyDailyClosingCorrectionInput = {
  adminNote?: string | null;
  correctionRequestId: string;
};

export type DailyClosingEffectiveTotalsResult = {
  adjustmentTotals: DailyClosingAdjustmentTotals;
  appliedAdjustmentCount: number;
  closingId: string | null;
  closingInputs: DailyPosClosingInputs;
  lock: DailyClosingLockInfo;
  pendingCorrectionCount: number;
  snapshotTotals: DailyClosingSnapshotTotals | null;
  totals: DailyPosReportTotals;
};

export type PayrollReadyDailyFinancial = {
  adjustmentTotals: DailyClosingAdjustmentTotals;
  closingStatus: string;
  effectiveActualTotal: number;
  effectiveCashAmount: number;
  effectiveCreditCardAmount: number;
  effectiveDifference: number;
  effectiveExpectedTotal: number;
  effectiveOtherAmount: number;
  pendingCorrectionCount: number;
  reportDate: string;
  snapshotTotals: DailyClosingSnapshotTotals | null;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return Number.NaN;
  }

  return Math.round(numeric * 100);
}

function fromCents(value: number) {
  return roundMoney(value / 100);
}

function sumCents(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function numeric(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function isDateInputValue(value: string | undefined | null) {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));
}

function parseLocalDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error("Invalid report date.");
  }

  const [, year, month, day] = match;

  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const zonedTimeAsUtc = Date.UTC(
    getPart("year"),
    getPart("month") - 1,
    getPart("day"),
    getPart("hour"),
    getPart("minute"),
    getPart("second"),
    date.getUTCMilliseconds(),
  );

  return zonedTimeAsUtc - date.getTime();
}

function getUtcInstantForLocalDateTime(
  dateString: string,
  timeZone: string,
  hour: number,
) {
  const parts = parseLocalDateParts(dateString);
  const localTimeAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
  const offset = getTimeZoneOffsetMs(new Date(localTimeAsUtc), timeZone);
  const firstPass = localTimeAsUtc - offset;
  const verifiedOffset = getTimeZoneOffsetMs(new Date(firstPass), timeZone);

  return new Date(localTimeAsUtc - verifiedOffset);
}

function getNextLocalDateString(dateString: string) {
  const parts = parseLocalDateParts(dateString);

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
    .toISOString()
    .slice(0, 10);
}

export function getUtcBoundsForLocalDate(dateString: string, timeZone: string) {
  const start = getUtcInstantForLocalDateTime(dateString, timeZone, 0);
  const nextStart = getUtcInstantForLocalDateTime(
    getNextLocalDateString(dateString),
    timeZone,
    0,
  );

  return {
    openedFrom: start.toISOString(),
    openedTo: new Date(nextStart.getTime() - 1).toISOString(),
  };
}

export function getCurrentBusinessDate(context: CurrentBusinessContext) {
  return getTodayDate(context.user?.timezone);
}

export function getDefaultReportDate(context: CurrentBusinessContext) {
  return getCurrentBusinessDate(context);
}

export function normalizeReportDate(
  reportDate: string | null | undefined,
  context: CurrentBusinessContext,
) {
  return isDateInputValue(reportDate)
    ? reportDate!
    : getDefaultReportDate(context);
}

function parseCurrencyToCents(value: string, label: string) {
  const normalized = value.trim().replaceAll(",", "").replace(/^\$/, "");

  if (!normalized) {
    return 0;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} must be a valid non-negative money amount.`);
  }

  const cents = toCents(normalized);

  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error(`${label} must be a valid non-negative money amount.`);
  }

  if (cents > MONEY_MAX_CENTS) {
    throw new Error(`${label} is too large.`);
  }

  return cents;
}

function getClosingInputs(
  closing: PosDailyClosing | null | undefined,
): DailyPosClosingInputs {
  return {
    approvedAt: closing?.approved_at ?? null,
    cashAmount: numeric(closing?.cash_amount),
    closedAt: closing?.closed_at ?? null,
    creditCardAmount: numeric(closing?.credit_card_amount),
    note: closing?.note ?? null,
    otherAmount: numeric(closing?.other_amount),
    status: closing?.status ?? "draft",
  };
}

function getClosingInputsFromEffectiveValues(input: {
  approvedAt?: string | null;
  cashAmount: number;
  closedAt?: string | null;
  creditCardAmount: number;
  note: string | null;
  otherAmount: number;
  status: DailyPosClosingInputs["status"];
}): DailyPosClosingInputs {
  return {
    approvedAt: input.approvedAt ?? null,
    cashAmount: roundMoney(input.cashAmount),
    closedAt: input.closedAt ?? null,
    creditCardAmount: roundMoney(input.creditCardAmount),
    note: input.note,
    otherAmount: roundMoney(input.otherAmount),
    status: input.status,
  };
}

function getReconciliationStatus(
  differenceCents: number,
): DailyPosReconciliationStatus {
  if (Math.abs(differenceCents) < 1) {
    return "balanced";
  }

  return differenceCents < 0 ? "short" : "over";
}

function getActualTotalCents(closingInputs: DailyPosClosingInputs) {
  return sumCents([
    toCents(closingInputs.cashAmount),
    toCents(closingInputs.creditCardAmount),
    toCents(closingInputs.otherAmount),
  ]);
}

function getActiveItems(ticket: ReportTicketRow) {
  return (ticket.ticket_items ?? []).filter((item) => !item.is_removed);
}

function getItemServiceTotalCents(item: ReportTicketItem) {
  const parts = item.turn_parts ?? [];

  if (parts.length > 0) {
    return sumCents(parts.map((part) => toCents(part.amount)));
  }

  return toCents(item.line_total);
}

function calculateTicketSummaryCents(tickets: ReportTicketRow[]) {
  let totalDiscountCents = 0;
  let totalGiftCardPaymentCents = 0;
  let totalTaxCents = 0;
  let totalTipCents = 0;

  for (const ticket of tickets) {
    const activeItems = getActiveItems(ticket);
    const totals = calculateTicketTotals({
      discountType: ticket.discount_type,
      discountValue: Number(ticket.discount_value),
      items: activeItems.map((item) => ({
        line_total: fromCents(getItemServiceTotalCents(item)),
      })),
      taxRate: Number(ticket.tax_rate),
      tipType: ticket.tip_type,
      tipValue: Number(ticket.tip_value),
    });

    totalDiscountCents += toCents(totals.discount_amount);
    totalTaxCents += toCents(totals.tax_amount);
    totalTipCents += toCents(totals.tip_amount);
    totalGiftCardPaymentCents += sumCents(
      (ticket.payments ?? [])
        .filter((payment) => payment.payment_method === "gift_card")
        .map((payment) => toCents(payment.amount)),
    );
  }

  return {
    totalDiscountCents,
    totalGiftCardPaymentCents,
    totalTaxCents,
    totalTipCents,
  };
}

function getStaffName(staffId: string, name: string | null | undefined) {
  return name?.trim() || `Staff ${staffId.slice(0, 8)}`;
}

function buildStaffRowsFromEarnings(
  earnings: StaffEarningRow[],
): DailyPosReportStaffRow[] {
  const rowsByStaffId = new Map<
    string,
    {
      bigTurns: number;
      name: string;
      serviceCents: number;
      smallTurns: number;
      tipCents: number;
    }
  >();

  for (const earning of earnings) {
    const existing = rowsByStaffId.get(earning.staff_id) ?? {
      bigTurns: 0,
      name: getStaffName(earning.staff_id, earning.staff?.display_name),
      serviceCents: 0,
      smallTurns: 0,
      tipCents: 0,
    };

    existing.serviceCents += toCents(earning.service_total);
    existing.tipCents += toCents(earning.tip_amount);
    existing.bigTurns += Number(earning.big_turn_count ?? 0);
    existing.smallTurns += Number(earning.small_turn_count ?? 0);
    rowsByStaffId.set(earning.staff_id, existing);
  }

  return Array.from(rowsByStaffId.entries())
    .map(([staffId, row]) => ({
      bigTurnCount: row.bigTurns,
      smallTurnCount: row.smallTurns,
      staffId,
      staffName: row.name,
      tipAmount: fromCents(row.tipCents),
      totalEarned: fromCents(row.serviceCents),
      totalTurns: row.bigTurns + row.smallTurns,
    }))
    .sort((left, right) => left.staffName.localeCompare(right.staffName));
}

function buildStaffRowsFromTickets(
  tickets: ReportTicketRow[],
): DailyPosReportStaffRow[] {
  const rowsByStaffId = new Map<
    string,
    {
      bigTurns: number;
      name: string;
      serviceCents: number;
      smallTurns: number;
    }
  >();

  for (const ticket of tickets) {
    for (const item of getActiveItems(ticket)) {
      const turnParts = item.turn_parts ?? [];

      if (turnParts.length > 0) {
        for (const part of turnParts) {
          const staffId = part.staff_id ?? item.assigned_staff_id;

          if (!staffId) {
            continue;
          }

          const existing = rowsByStaffId.get(staffId) ?? {
            bigTurns: 0,
            name: getStaffName(staffId, item.assigned_staff?.display_name),
            serviceCents: 0,
            smallTurns: 0,
          };

          existing.serviceCents += toCents(part.amount);

          if (part.turn_type === "large") {
            existing.bigTurns += 1;
          } else {
            existing.smallTurns += 1;
          }

          rowsByStaffId.set(staffId, existing);
        }

        continue;
      }

      if (!item.assigned_staff_id) {
        continue;
      }

      const existing = rowsByStaffId.get(item.assigned_staff_id) ?? {
        bigTurns: 0,
        name: getStaffName(
          item.assigned_staff_id,
          item.assigned_staff?.display_name,
        ),
        serviceCents: 0,
        smallTurns: 0,
      };
      const turns = Math.max(1, Math.round(Number(item.quantity) || 1));
      const itemTotalCents = getItemServiceTotalCents(item);

      existing.serviceCents += itemTotalCents;

      if (fromCents(itemTotalCents) >= 25) {
        existing.bigTurns += turns;
      } else {
        existing.smallTurns += turns;
      }

      rowsByStaffId.set(item.assigned_staff_id, existing);
    }
  }

  return Array.from(rowsByStaffId.entries())
    .map(([staffId, row]) => ({
      bigTurnCount: row.bigTurns,
      smallTurnCount: row.smallTurns,
      staffId,
      staffName: row.name,
      tipAmount: 0,
      totalEarned: fromCents(row.serviceCents),
      totalTurns: row.bigTurns + row.smallTurns,
    }))
    .sort((left, right) => left.staffName.localeCompare(right.staffName));
}

async function requireReportContext(
  permissionCode: string,
  context?: CurrentBusinessContext,
): Promise<ReportAuthContext> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("You must be logged in to view reports.");
  }

  if (!isSalonManageContext(resolvedContext)) {
    throw new Error("Open reports from a Business workspace.");
  }

  if (!resolvedContext.currentAccount) {
    throw new Error("Choose a salon workspace before viewing reports.");
  }

  if (!resolvedContext.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  await requirePermission(permissionCode, resolvedContext);

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  return {
    context: resolvedContext,
    Account: resolvedContext.currentAccount,
    salon: resolvedContext.currentSalon,
    supabase,
    user: resolvedContext.user,
  };
}

async function requireFinancialContext(context?: CurrentBusinessContext) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("You must be logged in.");
  }

  if (!isSalonManageContext(resolvedContext)) {
    throw new Error("Open financial records from a Business workspace.");
  }

  if (!resolvedContext.currentAccount) {
    throw new Error("Choose a salon workspace before managing financial records.");
  }

  if (!resolvedContext.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  return {
    context: resolvedContext,
    Account: resolvedContext.currentAccount,
    salon: resolvedContext.currentSalon,
    supabase,
    user: resolvedContext.user,
  };
}

export async function canEditDailyPosClosing(context: CurrentBusinessContext) {
  return hasPermission(DAILY_POS_REPORT_PERMISSIONS.edit, context);
}

export async function canApplyFinancialCorrections(
  context: CurrentBusinessContext,
) {
  return (
    (await hasPermission(DAILY_POS_REPORT_PERMISSIONS.applyCorrection, context)) ||
    (await hasPermission(FINANCIAL_CORRECTION_PERMISSIONS.apply, context))
  );
}

export async function canRequestFinancialCorrections(
  context: CurrentBusinessContext,
) {
  return (
    (await hasPermission(DAILY_POS_REPORT_PERMISSIONS.requestCorrection, context)) ||
    (await hasPermission(FINANCIAL_CORRECTION_PERMISSIONS.request, context))
  );
}

async function loadLiveDailyPosReport(
  reportDate: string,
  auth: ReportAuthContext,
): Promise<DailyReportCore> {
  const { Account, salon, supabase, user } = auth;
  const bounds = getUtcBoundsForLocalDate(reportDate, user.timezone);

  const [{ data: closing, error: closingError }, { data: tickets, error: ticketsError }] =
    await Promise.all([
      supabase
        .from("pos_daily_closings")
        .select(POS_DAILY_CLOSING_SELECT)
        .eq("salon_id", salon.id)
        .eq("report_date", reportDate)
        .maybeSingle<PosDailyClosing>(),
      supabase
        .from("pos_tickets")
        .select(
          "id, opened_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, payments:pos_payments(payment_method, amount), ticket_items:pos_ticket_items(id, assigned_staff_id, quantity, line_total, is_removed, assigned_staff:staff!pos_ticket_items_assigned_staff_id_fkey(id, display_name), turn_parts:pos_ticket_item_turn_parts(amount, staff_id, turn_index, turn_type))",
        )
        .eq("salon_id", salon.id)
        .gte("opened_at", bounds.openedFrom)
        .lte("opened_at", bounds.openedTo)
        .order("opened_at", { ascending: true })
        .returns<ReportTicketRow[]>(),
    ]);

  if (closingError) {
    console.error("Supabase load daily POS closing failed", {
      code: closingError.code,
      details: closingError.details,
      hint: closingError.hint,
      message: closingError.message,
      accountId: Account.id,
      reportDate,
      salonId: salon.id,
      userId: user.id,
    });
    throw new Error(closingError.message);
  }

  if (ticketsError) {
    console.error("Supabase load daily POS report tickets failed", {
      code: ticketsError.code,
      details: ticketsError.details,
      hint: ticketsError.hint,
      message: ticketsError.message,
      accountId: Account.id,
      reportDate,
      salonId: salon.id,
      userId: user.id,
    });
    throw new Error(ticketsError.message);
  }

  const allTickets = tickets ?? [];
  const finalizedTickets = allTickets.filter((ticket) => ticket.status === "closed");
  const finalizedTicketIds = finalizedTickets.map((ticket) => ticket.id);
  let staffRows: DailyPosReportStaffRow[] = [];

  if (finalizedTicketIds.length > 0) {
    const { data: earnings, error: earningsError } = await supabase
      .from("pos_ticket_staff_earnings")
      .select(
        "staff_id, service_total, tip_amount, big_turn_count, small_turn_count, staff:staff(id, display_name)",
      )
      .eq("salon_id", salon.id)
      .eq("work_date", reportDate)
      .in("ticket_id", finalizedTicketIds)
      .returns<StaffEarningRow[]>();

    if (earningsError) {
      console.error("Supabase load daily POS staff earnings failed", {
        code: earningsError.code,
        details: earningsError.details,
        hint: earningsError.hint,
        message: earningsError.message,
        accountId: Account.id,
        reportDate,
        salonId: salon.id,
        userId: user.id,
      });
      throw new Error(earningsError.message);
    }

    staffRows =
      (earnings ?? []).length > 0
        ? buildStaffRowsFromEarnings(earnings ?? [])
        : buildStaffRowsFromTickets(finalizedTickets);
  }

  const closingInputs = getClosingInputs(closing);
  const actualTotalCents = getActualTotalCents(closingInputs);
  const {
    totalDiscountCents,
    totalGiftCardPaymentCents,
    totalTaxCents,
    totalTipCents,
  } = calculateTicketSummaryCents(finalizedTickets);
  const totalStaffEarnedCents = sumCents(
    staffRows.map((row) => toCents(row.totalEarned)),
  );
  const totalGiftCardCents = 0;
  const expectedTotalCents =
    totalStaffEarnedCents +
    totalTipCents -
    totalDiscountCents -
    totalGiftCardCents;
  const differenceCents = actualTotalCents - expectedTotalCents;

  return {
    allTickets,
    closing: closing ?? null,
    closingInputs,
    finalizedTickets,
    metadata: {
      excludedOpenTicketCount: allTickets.filter((ticket) => ticket.status === "open")
        .length,
      excludedVoidedTicketCount: allTickets.filter(
        (ticket) =>
          ticket.status === "voided" || ticket.status === "cancelled",
      ).length,
      finalizedTicketCount: finalizedTickets.length,
      ticketCount: allTickets.length,
    },
    reportDate,
    staffRows,
    totals: {
      actualTotal: fromCents(actualTotalCents),
      difference: fromCents(differenceCents),
      expectedTotal: fromCents(expectedTotalCents),
      giftCardPaymentTotal: fromCents(totalGiftCardPaymentCents),
      reconciliationStatus: getReconciliationStatus(differenceCents),
      totalDiscount: fromCents(totalDiscountCents),
      totalGiftCard: fromCents(totalGiftCardCents),
      totalStaffEarned: fromCents(totalStaffEarnedCents),
      totalTax: fromCents(totalTaxCents),
      totalTip: fromCents(totalTipCents),
    },
  };
}

function getLockInfo(
  reportDate: string,
  context: CurrentBusinessContext,
  closing: PosDailyClosing | null,
  liveTotalsDifferFromSnapshot = false,
): DailyClosingLockInfo {
  const currentBusinessDate = getCurrentBusinessDate(context);
  const status = closing?.status ?? "draft";
  const isPastDate = reportDate < currentBusinessDate;

  return {
    currentBusinessDate,
    isLocked:
      isPastDate ||
      Boolean(closing?.locked_at) ||
      LOCKED_DAILY_CLOSING_STATUSES.has(status),
    isPastDate,
    liveTotalsDifferFromSnapshot,
    lockedAt: closing?.locked_at ?? null,
    lockReason: closing?.lock_reason ?? null,
    lockType: closing?.lock_type ?? null,
    status,
  };
}

function getSnapshotTotalsFromClosing(
  closing: PosDailyClosing | null,
): DailyClosingSnapshotTotals | null {
  if (!closing?.snapshot_created_at) {
    return null;
  }

  const cashAmount = numeric(closing.cash_amount_snapshot);
  const creditCardAmount = numeric(closing.credit_card_amount_snapshot);
  const otherAmount = numeric(closing.other_amount_snapshot);
  const actualTotal =
    closing.actual_total_snapshot === null
      ? roundMoney(cashAmount + creditCardAmount + otherAmount)
      : numeric(closing.actual_total_snapshot);
  const expectedTotal = numeric(closing.expected_total_snapshot);

  return {
    actualTotal,
    cashAmount,
    creditCardAmount,
    difference:
      closing.difference_snapshot === null
        ? roundMoney(actualTotal - expectedTotal)
        : numeric(closing.difference_snapshot),
    discount: numeric(closing.discount_snapshot),
    expectedTotal,
    finalizedTicketCount: Number(closing.finalized_ticket_count_snapshot ?? 0),
    giftCard: numeric(closing.gift_card_snapshot),
    note: closing.note_snapshot ?? null,
    otherAmount,
    staffEarned: numeric(closing.staff_earned_snapshot),
    ticketCount: Number(closing.ticket_count_snapshot ?? 0),
    tip: numeric(closing.tip_snapshot),
  };
}

function buildSnapshotTotalsFromCore(core: DailyReportCore): DailyClosingSnapshotTotals {
  return {
    actualTotal: core.totals.actualTotal,
    cashAmount: core.closingInputs.cashAmount,
    creditCardAmount: core.closingInputs.creditCardAmount,
    difference: core.totals.difference,
    discount: core.totals.totalDiscount,
    expectedTotal: core.totals.expectedTotal,
    finalizedTicketCount: core.metadata.finalizedTicketCount,
    giftCard: core.totals.totalGiftCard,
    note: core.closingInputs.note,
    otherAmount: core.closingInputs.otherAmount,
    staffEarned: core.totals.totalStaffEarned,
    ticketCount: core.metadata.ticketCount,
    tip: core.totals.totalTip,
  };
}

function snapshotDiffersFromLive(
  snapshot: DailyClosingSnapshotTotals | null,
  core: DailyReportCore,
) {
  if (!snapshot) {
    return false;
  }

  return (
    toCents(snapshot.expectedTotal) !== toCents(core.totals.expectedTotal) ||
    toCents(snapshot.staffEarned) !== toCents(core.totals.totalStaffEarned) ||
    toCents(snapshot.tip) !== toCents(core.totals.totalTip) ||
    toCents(snapshot.discount) !== toCents(core.totals.totalDiscount) ||
    snapshot.finalizedTicketCount !== core.metadata.finalizedTicketCount ||
    snapshot.ticketCount !== core.metadata.ticketCount
  );
}

async function insertStaffSnapshotRows(
  auth: ReportAuthContext,
  closing: PosDailyClosing,
  staffRows: DailyPosReportStaffRow[],
) {
  if (staffRows.length === 0) {
    return;
  }

  const { salon, supabase } = auth;
  const rows = staffRows.map((row) => ({
    big_turn_count_snapshot: row.bigTurnCount,
    closing_id: closing.id,
    report_date: closing.report_date,
    salon_id: salon.id,
    small_turn_count_snapshot: row.smallTurnCount,
    staff_id: row.staffId,
    staff_name_snapshot: row.staffName,
    tip_snapshot: row.tipAmount,
    total_earned_snapshot: row.totalEarned,
    total_turns_snapshot: row.totalTurns,
  }));
  const { error } = await supabase
    .from("pos_daily_closing_staff_snapshots")
    .upsert(rows, {
      ignoreDuplicates: true,
      onConflict: "closing_id,staff_id",
    });

  if (error) {
    throw new Error(error.message);
  }
}

async function loadStaffAdjustmentTotals(
  auth: ReportAuthContext,
  reportDate: string,
) {
  const { salon, supabase } = auth;
  const { data, error } = await supabase
    .from("pos_financial_adjustments")
    .select("staff_id, service_delta, tip_delta, turn_delta")
    .eq("salon_id", salon.id)
    .eq("business_date", reportDate)
    .not("staff_id", "is", null)
    .returns<
      Array<{
        service_delta: number;
        staff_id: string | null;
        tip_delta: number;
        turn_delta: number;
      }>
    >();

  if (error) {
    throw new Error(error.message);
  }

  const totalsByStaffId = new Map<
    string,
    { serviceDelta: number; tipDelta: number; turnDelta: number }
  >();

  for (const row of data ?? []) {
    if (!row.staff_id) {
      continue;
    }

    const existing = totalsByStaffId.get(row.staff_id) ?? {
      serviceDelta: 0,
      tipDelta: 0,
      turnDelta: 0,
    };

    existing.serviceDelta += numeric(row.service_delta);
    existing.tipDelta += numeric(row.tip_delta);
    existing.turnDelta += numeric(row.turn_delta);
    totalsByStaffId.set(row.staff_id, existing);
  }

  return totalsByStaffId;
}

async function loadStaffNames(auth: ReportAuthContext, staffIds: string[]) {
  const ids = Array.from(new Set(staffIds.filter(Boolean)));

  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await auth.supabase
    .from("staff")
    .select("id, display_name")
    .eq("salon_id", auth.salon.id)
    .in("id", ids)
    .returns<Array<{ display_name: string; id: string }>>();

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((row) => [row.id, row.display_name]));
}

async function loadStaffSnapshotRows(
  auth: ReportAuthContext,
  closingId: string | null,
  reportDate: string,
) {
  const { salon, supabase } = auth;
  const adjustmentTotals = await loadStaffAdjustmentTotals(auth, reportDate);
  const snapshotRows = closingId
    ? await supabase
        .from("pos_daily_closing_staff_snapshots")
        .select(
          "id, staff_id, staff_name_snapshot, total_earned_snapshot, tip_snapshot, big_turn_count_snapshot, small_turn_count_snapshot, total_turns_snapshot",
        )
        .eq("salon_id", salon.id)
        .eq("closing_id", closingId)
        .order("staff_name_snapshot", { ascending: true })
        .returns<
          Array<{
            big_turn_count_snapshot: number;
            id: string;
            small_turn_count_snapshot: number;
            staff_id: string | null;
            staff_name_snapshot: string;
            tip_snapshot: number;
            total_earned_snapshot: number;
            total_turns_snapshot: number;
          }>
        >()
    : { data: [], error: null };

  if (snapshotRows.error) {
    throw new Error(snapshotRows.error.message);
  }

  const rows = (snapshotRows.data ?? []).map<DailyPosReportStaffRow>((row) => {
    const staffId = row.staff_id ?? row.id;
    const adjustment = row.staff_id
      ? adjustmentTotals.get(row.staff_id)
      : undefined;

    if (row.staff_id) {
      adjustmentTotals.delete(row.staff_id);
    }

    return {
      bigTurnCount: numeric(row.big_turn_count_snapshot),
      smallTurnCount: numeric(row.small_turn_count_snapshot),
      staffId,
      staffName: row.staff_name_snapshot,
      tipAmount: roundMoney(
        numeric(row.tip_snapshot) + (adjustment?.tipDelta ?? 0),
      ),
      totalEarned: roundMoney(
        numeric(row.total_earned_snapshot) + (adjustment?.serviceDelta ?? 0),
      ),
      totalTurns: roundMoney(
        numeric(row.total_turns_snapshot) + (adjustment?.turnDelta ?? 0),
      ),
    };
  });

  if (adjustmentTotals.size === 0) {
    return rows;
  }

  const staffNames = await loadStaffNames(auth, Array.from(adjustmentTotals.keys()));

  for (const [staffId, adjustment] of adjustmentTotals.entries()) {
    rows.push({
      bigTurnCount: 0,
      smallTurnCount: 0,
      staffId,
      staffName: staffNames.get(staffId) ?? `Staff ${staffId.slice(0, 8)}`,
      tipAmount: roundMoney(adjustment.tipDelta),
      totalEarned: roundMoney(adjustment.serviceDelta),
      totalTurns: roundMoney(adjustment.turnDelta),
    });
  }

  return rows.sort((left, right) => left.staffName.localeCompare(right.staffName));
}

async function ensureDailyClosingSnapshotFromCore(
  auth: ReportAuthContext,
  core: DailyReportCore,
) {
  const currentBusinessDate = getCurrentBusinessDate(auth.context);

  if (core.reportDate >= currentBusinessDate) {
    return core.closing;
  }

  if (
    core.closing?.snapshot_created_at ||
    core.closing?.locked_at ||
    LOCKED_DAILY_CLOSING_STATUSES.has(core.closing?.status ?? "draft")
  ) {
    return core.closing;
  }

  const { salon, supabase, user } = auth;
  const now = new Date().toISOString();
  const snapshot = buildSnapshotTotalsFromCore(core);
  const baseRow = {
    actual_total_snapshot: snapshot.actualTotal,
    cash_amount_snapshot: snapshot.cashAmount,
    credit_card_amount_snapshot: snapshot.creditCardAmount,
    difference_snapshot: snapshot.difference,
    discount_snapshot: snapshot.discount,
    expected_total_snapshot: snapshot.expectedTotal,
    finalized_ticket_count_snapshot: snapshot.finalizedTicketCount,
    gift_card_snapshot: snapshot.giftCard,
    lock_reason: "Past business date locked after midnight.",
    lock_type: "auto",
    locked_at: now,
    locked_by: null,
    note_snapshot: snapshot.note,
    other_amount_snapshot: snapshot.otherAmount,
    snapshot_created_at: now,
    staff_earned_snapshot: snapshot.staffEarned,
    status: "auto_locked" as const,
    ticket_count_snapshot: snapshot.ticketCount,
    tip_snapshot: snapshot.tip,
    updated_by: user.id,
  };
  let closing: PosDailyClosing;

  if (core.closing) {
    const { data, error } = await supabase
      .from("pos_daily_closings")
      .update(baseRow)
      .eq("id", core.closing.id)
      .eq("salon_id", salon.id)
      .is("snapshot_created_at", null)
      .select(POS_DAILY_CLOSING_SELECT)
      .maybeSingle<PosDailyClosing>();

    if (error) {
      throw new Error(error.message);
    }

    closing = data ?? {
      ...core.closing,
      ...baseRow,
    };
  } else {
    const { data, error } = await supabase
      .from("pos_daily_closings")
      .insert({
        ...baseRow,
        cash_amount: snapshot.cashAmount,
        created_by: user.id,
        credit_card_amount: snapshot.creditCardAmount,
        note: snapshot.note,
        other_amount: snapshot.otherAmount,
        report_date: core.reportDate,
        salon_id: salon.id,
      })
      .select(POS_DAILY_CLOSING_SELECT)
      .single<PosDailyClosing>();

    if (error) {
      if (error.code !== "23505") {
        throw new Error(error.message);
      }

      const { data: conflicted, error: conflictError } = await supabase
        .from("pos_daily_closings")
        .select(POS_DAILY_CLOSING_SELECT)
        .eq("salon_id", salon.id)
        .eq("report_date", core.reportDate)
        .single<PosDailyClosing>();

      if (conflictError) {
        throw new Error(conflictError.message);
      }

      closing = conflicted;
    } else {
      closing = data;
    }
  }

  await insertStaffSnapshotRows(auth, closing, core.staffRows);

  return closing;
}

export async function ensureDailyClosingSnapshot(
  reportDateInput: string,
  context?: CurrentBusinessContext,
) {
  if (!isDateInputValue(reportDateInput)) {
    throw new Error("Report date is required.");
  }

  const auth = await requireReportContext(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );
  const core = await loadLiveDailyPosReport(reportDateInput, auth);

  return ensureDailyClosingSnapshotFromCore(auth, core);
}

function getEmptyAdjustmentTotals(): DailyClosingAdjustmentTotals {
  return {
    actualTotalDelta: 0,
    cashDelta: 0,
    creditCardDelta: 0,
    discountDelta: 0,
    expectedTotalDelta: 0,
    giftCardDelta: 0,
    otherDelta: 0,
    serviceDelta: 0,
    tipDelta: 0,
    turnDelta: 0,
  };
}

function getAdjustmentTotals(
  adjustments: FinancialAdjustmentRow[],
): DailyClosingAdjustmentTotals {
  const totals = getEmptyAdjustmentTotals();

  for (const adjustment of adjustments) {
    totals.actualTotalDelta += numeric(adjustment.actual_total_delta);
    totals.cashDelta += numeric(adjustment.cash_delta);
    totals.creditCardDelta += numeric(adjustment.credit_card_delta);
    totals.discountDelta += numeric(adjustment.discount_delta);
    totals.expectedTotalDelta += numeric(adjustment.expected_total_delta);
    totals.giftCardDelta += numeric(adjustment.gift_card_delta);
    totals.otherDelta += numeric(adjustment.other_delta);
    totals.serviceDelta += numeric(adjustment.service_delta);
    totals.tipDelta += numeric(adjustment.tip_delta);
    totals.turnDelta += numeric(adjustment.turn_delta);
  }

  return {
    actualTotalDelta: roundMoney(totals.actualTotalDelta),
    cashDelta: roundMoney(totals.cashDelta),
    creditCardDelta: roundMoney(totals.creditCardDelta),
    discountDelta: roundMoney(totals.discountDelta),
    expectedTotalDelta: roundMoney(totals.expectedTotalDelta),
    giftCardDelta: roundMoney(totals.giftCardDelta),
    otherDelta: roundMoney(totals.otherDelta),
    serviceDelta: roundMoney(totals.serviceDelta),
    tipDelta: roundMoney(totals.tipDelta),
    turnDelta: roundMoney(totals.turnDelta),
  };
}

async function loadDailyClosingCorrectionRows(
  auth: ReportAuthContext,
  reportDate: string,
) {
  const { salon, supabase } = auth;
  const [requestsResult, adjustmentsResult] = await Promise.all([
    supabase
      .from("pos_financial_correction_requests")
      .select(
        "id, business_date, correction_type, old_value_json, requested_value_json, money_delta, reason, status, requested_by, requested_at, approved_by, approved_at, admin_note",
      )
      .eq("salon_id", salon.id)
      .eq("business_date", reportDate)
      .order("created_at", { ascending: false })
      .returns<FinancialCorrectionRequestRow[]>(),
    supabase
      .from("pos_financial_adjustments")
      .select(
        "id, correction_request_id, cash_delta, credit_card_delta, other_delta, service_delta, tip_delta, discount_delta, gift_card_delta, expected_total_delta, actual_total_delta, turn_delta, note, created_by, created_at",
      )
      .eq("salon_id", salon.id)
      .eq("business_date", reportDate)
      .order("created_at", { ascending: false })
      .returns<FinancialAdjustmentRow[]>(),
  ]);

  if (requestsResult.error) {
    throw new Error(requestsResult.error.message);
  }

  if (adjustmentsResult.error) {
    throw new Error(adjustmentsResult.error.message);
  }

  return {
    adjustments: adjustmentsResult.data ?? [],
    requests: requestsResult.data ?? [],
  };
}

async function loadUserLabels(auth: ReportAuthContext, userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));

  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await auth.supabase
    .from("users")
    .select("id, display_name, email")
    .in("id", ids)
    .returns<Array<{ display_name: string | null; email: string | null; id: string }>>();

  if (error) {
    throw new Error(error.message);
  }

  return new Map(
    (data ?? []).map((user) => [
      user.id,
      user.display_name ?? user.email ?? user.id,
    ]),
  );
}

async function decorateDailyClosingCorrections(
  auth: ReportAuthContext,
  rows: {
    adjustments: FinancialAdjustmentRow[];
    requests: FinancialCorrectionRequestRow[];
  },
) {
  const userLabels = await loadUserLabels(auth, [
    ...rows.requests.map((request) => request.requested_by),
    ...rows.requests
      .map((request) => request.approved_by)
      .filter((id): id is string => Boolean(id)),
    ...rows.adjustments.map((adjustment) => adjustment.created_by),
  ]);

  return {
    adjustments: rows.adjustments.map<DailyClosingFinancialAdjustment>(
      (adjustment) => ({
        actualTotalDelta: numeric(adjustment.actual_total_delta),
        cashDelta: numeric(adjustment.cash_delta),
        correctionRequestId: adjustment.correction_request_id,
        createdAt: adjustment.created_at,
        createdBy: adjustment.created_by,
        createdByName: userLabels.get(adjustment.created_by) ?? null,
        creditCardDelta: numeric(adjustment.credit_card_delta),
        expectedTotalDelta: numeric(adjustment.expected_total_delta),
        id: adjustment.id,
        note: adjustment.note,
        otherDelta: numeric(adjustment.other_delta),
      }),
    ),
    requests: rows.requests.map<DailyClosingCorrectionRequest>((request) => ({
      adminNote: request.admin_note,
      approvedAt: request.approved_at,
      approvedBy: request.approved_by,
      approvedByName: request.approved_by
        ? userLabels.get(request.approved_by) ?? null
        : null,
      businessDate: request.business_date,
      correctionType: request.correction_type,
      id: request.id,
      moneyDelta: numeric(request.money_delta),
      oldValue: request.old_value_json,
      reason: request.reason,
      requestedAt: request.requested_at,
      requestedBy: request.requested_by,
      requestedByName: userLabels.get(request.requested_by) ?? null,
      requestedValue: request.requested_value_json,
      status: request.status,
    })),
  };
}

function readJsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readCorrectionJsonValue(value: unknown) {
  return readJsonRecord(value)?.value;
}

function getEffectiveNote(
  requests: FinancialCorrectionRequestRow[],
  snapshotNote: string | null,
) {
  const appliedNoteRequest = [...requests]
    .filter(
      (request) =>
        request.status === "applied" && request.correction_type === "note",
    )
    .sort((left, right) => right.requested_at.localeCompare(left.requested_at))[0];

  if (!appliedNoteRequest) {
    return snapshotNote;
  }

  const requestedValue = readCorrectionJsonValue(
    appliedNoteRequest.requested_value_json,
  );

  return typeof requestedValue === "string" ? requestedValue : null;
}

function buildTotalsFromEffectiveValues(input: {
  actualTotal: number;
  adjustmentTotals: DailyClosingAdjustmentTotals;
  core: DailyReportCore;
  difference: number;
  expectedTotal: number;
  snapshot: DailyClosingSnapshotTotals;
}) {
  const actualTotalCents = toCents(input.actualTotal);
  const expectedTotalCents = toCents(input.expectedTotal);

  return {
    actualTotal: roundMoney(input.actualTotal),
    difference: roundMoney(input.difference),
    expectedTotal: roundMoney(input.expectedTotal),
    giftCardPaymentTotal: input.core.totals.giftCardPaymentTotal,
    reconciliationStatus: getReconciliationStatus(
      actualTotalCents - expectedTotalCents,
    ),
    totalDiscount: roundMoney(
      input.snapshot.discount + input.adjustmentTotals.discountDelta,
    ),
    totalGiftCard: roundMoney(
      input.snapshot.giftCard + input.adjustmentTotals.giftCardDelta,
    ),
    totalStaffEarned: roundMoney(
      input.snapshot.staffEarned + input.adjustmentTotals.serviceDelta,
    ),
    totalTax: input.core.totals.totalTax,
    totalTip: roundMoney(input.snapshot.tip + input.adjustmentTotals.tipDelta),
  } satisfies DailyPosReportTotals;
}

function buildEffectiveTotalsResult(input: {
  adjustmentRows: FinancialAdjustmentRow[];
  closing: PosDailyClosing | null;
  core: DailyReportCore;
  lock: DailyClosingLockInfo;
  requestRows: FinancialCorrectionRequestRow[];
}): DailyClosingEffectiveTotalsResult {
  const pendingCorrectionCount = input.requestRows.filter(
    (request) => request.status === "pending",
  ).length;
  const adjustmentTotals = getAdjustmentTotals(input.adjustmentRows);

  if (!input.lock.isLocked) {
    return {
      adjustmentTotals,
      appliedAdjustmentCount: input.adjustmentRows.length,
      closingId: input.closing?.id ?? null,
      closingInputs: input.core.closingInputs,
      lock: input.lock,
      pendingCorrectionCount,
      snapshotTotals: getSnapshotTotalsFromClosing(input.closing),
      totals: input.core.totals,
    };
  }

  const snapshot =
    getSnapshotTotalsFromClosing(input.closing) ??
    buildSnapshotTotalsFromCore(input.core);
  const effectiveCash = snapshot.cashAmount + adjustmentTotals.cashDelta;
  const effectiveCreditCard =
    snapshot.creditCardAmount + adjustmentTotals.creditCardDelta;
  const effectiveOther = snapshot.otherAmount + adjustmentTotals.otherDelta;
  const effectiveActual =
    snapshot.actualTotal + adjustmentTotals.actualTotalDelta;
  const effectiveExpected =
    snapshot.expectedTotal + adjustmentTotals.expectedTotalDelta;
  const effectiveDifference = effectiveActual - effectiveExpected;
  const effectiveNote = getEffectiveNote(input.requestRows, snapshot.note);

  return {
    adjustmentTotals,
    appliedAdjustmentCount: input.adjustmentRows.length,
    closingId: input.closing?.id ?? null,
    closingInputs: getClosingInputsFromEffectiveValues({
      approvedAt: input.closing?.approved_at ?? null,
      cashAmount: effectiveCash,
      closedAt: input.closing?.closed_at ?? null,
      creditCardAmount: effectiveCreditCard,
      note: effectiveNote,
      otherAmount: effectiveOther,
      status: input.closing?.status ?? "auto_locked",
    }),
    lock: input.lock,
    pendingCorrectionCount,
    snapshotTotals: snapshot,
    totals: buildTotalsFromEffectiveValues({
      actualTotal: effectiveActual,
      adjustmentTotals,
      core: input.core,
      difference: effectiveDifference,
      expectedTotal: effectiveExpected,
      snapshot,
    }),
  };
}

export async function getDailyClosingCorrections(
  reportDateInput: string,
  context?: CurrentBusinessContext,
) {
  if (!isDateInputValue(reportDateInput)) {
    throw new Error("Report date is required.");
  }

  const auth = await requireReportContext(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );
  const rows = await loadDailyClosingCorrectionRows(auth, reportDateInput);

  return decorateDailyClosingCorrections(auth, rows);
}

export async function getDailyClosingEffectiveTotals(
  reportDateInput: string,
  context?: CurrentBusinessContext,
): Promise<DailyClosingEffectiveTotalsResult> {
  if (!isDateInputValue(reportDateInput)) {
    throw new Error("Report date is required.");
  }

  const auth = await requireReportContext(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );
  const core = await loadLiveDailyPosReport(reportDateInput, auth);
  const ensuredClosing = await ensureDailyClosingSnapshotFromCore(auth, core);
  const snapshot = getSnapshotTotalsFromClosing(ensuredClosing);
  const rows = await loadDailyClosingCorrectionRows(auth, reportDateInput);
  const lock = getLockInfo(
    reportDateInput,
    auth.context,
    ensuredClosing,
    snapshotDiffersFromLive(snapshot, core),
  );

  return buildEffectiveTotalsResult({
    adjustmentRows: rows.adjustments,
    closing: ensuredClosing,
    core,
    lock,
    requestRows: rows.requests,
  });
}

export async function isDailyClosingLocked(
  reportDateInput: string,
  context?: CurrentBusinessContext,
) {
  if (!isDateInputValue(reportDateInput)) {
    throw new Error("Report date is required.");
  }

  const auth = await requireFinancialContext(context);
  const { data: closing, error } = await auth.supabase
    .from("pos_daily_closings")
    .select(POS_DAILY_CLOSING_SELECT)
    .eq("salon_id", auth.salon.id)
    .eq("report_date", reportDateInput)
    .maybeSingle<PosDailyClosing>();

  if (error) {
    throw new Error(error.message);
  }

  return getLockInfo(reportDateInput, auth.context, closing ?? null).isLocked;
}

export async function assertFinancialDateMutable(
  reportDateInput: string,
  context?: CurrentBusinessContext,
  options: {
    lockedMessage?: string;
    requireEditPermission?: boolean;
    tryCreateSnapshot?: boolean;
  } = {},
) {
  if (!isDateInputValue(reportDateInput)) {
    throw new Error("Report date is required.");
  }

  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("You must be logged in.");
  }

  if (!isSalonManageContext(resolvedContext)) {
    throw new Error("Open financial records from a Business workspace.");
  }

  if (!resolvedContext.currentAccount) {
    throw new Error("Choose a salon workspace before managing financial records.");
  }

  if (!resolvedContext.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  if (options.requireEditPermission ?? true) {
    await requirePermission(DAILY_POS_REPORT_PERMISSIONS.edit, resolvedContext);
  }

  const locked = await isDailyClosingLocked(reportDateInput, resolvedContext);

  if (!locked) {
    return;
  }

  if (options.tryCreateSnapshot ?? true) {
    try {
      await ensureDailyClosingSnapshot(reportDateInput, resolvedContext);
    } catch (error) {
      console.error("Unable to create daily closing snapshot while blocking edit", {
        error: error instanceof Error ? error.message : "Unknown error",
        reportDate: reportDateInput,
        userId: resolvedContext.user.id,
      });
    }
  }

  throw new Error(options.lockedMessage ?? FINANCIAL_DATE_LOCKED_MESSAGE);
}

function getTicketBusinessDate(openedAt: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(openedAt));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return openedAt.slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

export async function assertTicketFinancialDateMutable(
  ticketId: string,
  context?: CurrentBusinessContext,
) {
  if (!ticketId) {
    throw new Error("POS Ticket is required.");
  }

  const auth = await requireFinancialContext(context);
  const { data: ticket, error } = await auth.supabase
    .from("pos_tickets")
    .select("id, opened_at")
    .eq("id", ticketId)
    .eq("salon_id", auth.salon.id)
    .maybeSingle<{ id: string; opened_at: string }>();

  if (error) {
    throw new Error(error.message);
  }

  if (!ticket) {
    throw new Error("POS Ticket is required.");
  }

  const businessDate = getTicketBusinessDate(ticket.opened_at, auth.user.timezone);

  await assertFinancialDateMutable(businessDate, auth.context, {
    lockedMessage: TICKET_DATE_LOCKED_MESSAGE,
    requireEditPermission: false,
    tryCreateSnapshot: false,
  });
}

export async function getDailyPosReport(
  reportDateInput: string,
  context?: CurrentBusinessContext,
): Promise<DailyPosReport> {
  const auth = await requireReportContext(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );
  const reportDate = isDateInputValue(reportDateInput)
    ? reportDateInput
    : getTodayDate(auth.user.timezone);
  const core = await loadLiveDailyPosReport(reportDate, auth);
  const ensuredClosing = await ensureDailyClosingSnapshotFromCore(auth, core);
  const correctionRows = await loadDailyClosingCorrectionRows(auth, reportDate);
  const snapshot = getSnapshotTotalsFromClosing(ensuredClosing);
  const lock = getLockInfo(
    reportDate,
    auth.context,
    ensuredClosing,
    snapshotDiffersFromLive(snapshot, core),
  );
  const effective = buildEffectiveTotalsResult({
    adjustmentRows: correctionRows.adjustments,
    closing: ensuredClosing,
    core,
    lock,
    requestRows: correctionRows.requests,
  });
  const corrections = await decorateDailyClosingCorrections(auth, correctionRows);
  const staffSnapshotRows = lock.isLocked
    ? await loadStaffSnapshotRows(auth, ensuredClosing?.id ?? null, reportDate)
    : [];

  return {
    adjustmentTotals: effective.adjustmentTotals,
    closingInputs: effective.closingInputs,
    corrections,
    lock,
    metadata: lock.isLocked && effective.snapshotTotals
      ? {
          ...core.metadata,
          finalizedTicketCount: effective.snapshotTotals.finalizedTicketCount,
          ticketCount: effective.snapshotTotals.ticketCount,
        }
      : core.metadata,
    pendingCorrectionCount: effective.pendingCorrectionCount,
    reportDate,
    snapshotTotals: effective.snapshotTotals,
    staffRows: staffSnapshotRows.length > 0 ? staffSnapshotRows : core.staffRows,
    totals: effective.totals,
  };
}

async function updateDailyPosClosing(input: {
  cashAmountCents: number;
  closingId: string;
  creditCardAmountCents: number;
  note: string | null;
  accountId: string;
  otherAmountCents: number;
  salonId: string;
  supabase: SupabaseServerClient;
  userId: string;
}) {
  const { data, error } = await input.supabase
    .from("pos_daily_closings")
    .update({
      cash_amount: fromCents(input.cashAmountCents),
      credit_card_amount: fromCents(input.creditCardAmountCents),
      note: input.note,
      other_amount: fromCents(input.otherAmountCents),
      updated_by: input.userId,
    })
    .eq("id", input.closingId)
    .eq("salon_id", input.salonId)
    .select(POS_DAILY_CLOSING_SELECT)
    .single<PosDailyClosing>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function upsertDailyPosClosing(input: SaveDailyPosClosingInput) {
  if (!isDateInputValue(input.reportDate)) {
    throw new Error("Report date is required.");
  }

  const { context, Account, salon, supabase, user } =
    await requireReportContext(DAILY_POS_REPORT_PERMISSIONS.edit);

  await assertFinancialDateMutable(input.reportDate, context, {
    requireEditPermission: false,
  });

  const cashAmountCents = parseCurrencyToCents(input.cashAmount, "Cash");
  const creditCardAmountCents = parseCurrencyToCents(
    input.creditCardAmount,
    "Credit Card",
  );
  const otherAmountCents = parseCurrencyToCents(input.otherAmount, "Other");
  const note = input.note?.trim() ? input.note.trim() : null;
  const { data: existing, error: existingError } = await supabase
    .from("pos_daily_closings")
    .select("id")
    .eq("salon_id", salon.id)
    .eq("report_date", input.reportDate)
    .maybeSingle<{ id: string }>();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    return getClosingInputs(
      await updateDailyPosClosing({
        cashAmountCents,
        closingId: existing.id,
        creditCardAmountCents,
        note,
        accountId: Account.id,
        otherAmountCents,
        salonId: salon.id,
        supabase,
        userId: user.id,
      }),
    );
  }

  const { data, error } = await supabase
    .from("pos_daily_closings")
    .insert({
      cash_amount: fromCents(cashAmountCents),
      created_by: user.id,
      credit_card_amount: fromCents(creditCardAmountCents),
      note,
      other_amount: fromCents(otherAmountCents),
      report_date: input.reportDate,
      salon_id: salon.id,
      status: "draft",
      updated_by: user.id,
    })
    .select(POS_DAILY_CLOSING_SELECT)
    .single<PosDailyClosing>();

  if (error) {
    if (error.code === "23505") {
      const { data: conflictedClosing, error: conflictedError } = await supabase
        .from("pos_daily_closings")
        .select("id")
        .eq("salon_id", salon.id)
        .eq("report_date", input.reportDate)
        .single<{ id: string }>();

      if (conflictedError) {
        throw new Error(conflictedError.message);
      }

      return getClosingInputs(
        await updateDailyPosClosing({
          cashAmountCents,
          closingId: conflictedClosing.id,
          creditCardAmountCents,
          note,
          accountId: Account.id,
          otherAmountCents,
          salonId: salon.id,
          supabase,
          userId: user.id,
        }),
      );
    }

    throw new Error(error.message);
  }

  return getClosingInputs(data);
}

function assertCorrectionField(field: string): asserts field is DailyClosingCorrectionField {
  if (!DAILY_CLOSING_CORRECTION_FIELDS.has(field as DailyClosingCorrectionField)) {
    throw new Error("Correction field is not supported.");
  }
}

function parseRequestedCorrectionValue(
  field: DailyClosingCorrectionField,
  requestedValue: string,
) {
  if (field === "note") {
    return requestedValue.trim() || null;
  }

  return fromCents(parseCurrencyToCents(requestedValue, "Requested value"));
}

function getEffectiveFieldValue(
  field: DailyClosingCorrectionField,
  effective: DailyClosingEffectiveTotalsResult,
) {
  switch (field) {
    case "cash_amount":
      return effective.closingInputs.cashAmount;
    case "credit_card_amount":
      return effective.closingInputs.creditCardAmount;
    case "other_amount":
      return effective.closingInputs.otherAmount;
    case "note":
      return effective.closingInputs.note;
  }
}

function getAdjustmentPayloadForCorrection(input: {
  effective: DailyClosingEffectiveTotalsResult;
  field: DailyClosingCorrectionField;
  requestedValue: number | string | null;
}) {
  const payload = {
    actual_total_delta: 0,
    cash_delta: 0,
    credit_card_delta: 0,
    expected_total_delta: 0,
    note: null as string | null,
    other_delta: 0,
  };

  if (input.field === "note") {
    payload.note =
      typeof input.requestedValue === "string" ? input.requestedValue : null;
    return payload;
  }

  const requestedAmount = Number(input.requestedValue);
  const currentAmount = Number(getEffectiveFieldValue(input.field, input.effective));
  const delta = roundMoney(requestedAmount - currentAmount);

  if (input.field === "cash_amount") {
    payload.cash_delta = delta;
  }

  if (input.field === "credit_card_amount") {
    payload.credit_card_delta = delta;
  }

  if (input.field === "other_amount") {
    payload.other_delta = delta;
  }

  payload.actual_total_delta = delta;

  return payload;
}

function getMoneyDeltaForCorrection(input: {
  effective: DailyClosingEffectiveTotalsResult;
  field: DailyClosingCorrectionField;
  requestedValue: number | string | null;
}) {
  if (input.field === "note") {
    return 0;
  }

  return roundMoney(
    Number(input.requestedValue) -
      Number(getEffectiveFieldValue(input.field, input.effective)),
  );
}

export async function createDailyClosingCorrectionRequest(
  input: DailyClosingCorrectionInput,
  context?: CurrentBusinessContext,
) {
  if (!isDateInputValue(input.reportDate)) {
    throw new Error("Report date is required.");
  }

  assertCorrectionField(input.field);

  const reason = input.reason.trim();

  if (!reason) {
    throw new Error("Correction reason is required.");
  }

  const auth = await requireReportContext(
    DAILY_POS_REPORT_PERMISSIONS.requestCorrection,
    context,
  );
  await ensureDailyClosingSnapshot(input.reportDate, auth.context);
  const effective = await getDailyClosingEffectiveTotals(input.reportDate, auth.context);

  if (!effective.lock.isLocked) {
    throw new Error("Corrections are only available for locked business dates.");
  }

  const requestedValue = parseRequestedCorrectionValue(
    input.field,
    input.requestedValue,
  );
  const oldValue = getEffectiveFieldValue(input.field, effective);
  const moneyDelta = getMoneyDeltaForCorrection({
    effective,
    field: input.field,
    requestedValue,
  });
  const { data, error } = await auth.supabase
    .from("pos_financial_correction_requests")
    .insert({
      business_date: input.reportDate,
      correction_type: input.field,
      money_delta: moneyDelta,
      old_value_json: {
        field: input.field,
        value: oldValue,
      },
      account_id: auth.Account.id,
      reason,
      requested_by: auth.user.id,
      requested_value_json: {
        field: input.field,
        value: requestedValue,
      },
      salon_id: auth.salon.id,
      status: "pending",
      target_id: effective.closingId,
      target_type: "daily_closing",
    })
    .select(
      "id, business_date, correction_type, old_value_json, requested_value_json, money_delta, reason, status, requested_by, requested_at, approved_by, approved_at, admin_note",
    )
    .single<FinancialCorrectionRequestRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function applyDailyClosingCorrection(
  input: ApplyDailyClosingCorrectionInput,
  context?: CurrentBusinessContext,
) {
  if (!input.correctionRequestId) {
    throw new Error("Correction request is required.");
  }

  const auth = await requireReportContext(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );

  if (!(await canApplyFinancialCorrections(auth.context))) {
    throw new Error("You do not have permission to apply financial corrections.");
  }
  const { data: request, error: requestError } = await auth.supabase
    .from("pos_financial_correction_requests")
    .select(
      "id, business_date, correction_type, old_value_json, requested_value_json, money_delta, reason, status, requested_by, requested_at, approved_by, approved_at, admin_note",
    )
    .eq("id", input.correctionRequestId)
    .eq("salon_id", auth.salon.id)
    .maybeSingle<FinancialCorrectionRequestRow>();

  if (requestError) {
    throw new Error(requestError.message);
  }

  if (!request) {
    throw new Error("Correction request is required.");
  }

  if (request.status !== "pending" && request.status !== "approved") {
    throw new Error("Only pending or approved corrections can be applied.");
  }

  assertCorrectionField(request.correction_type);

  const effective = await getDailyClosingEffectiveTotals(
    request.business_date,
    auth.context,
  );

  if (!effective.lock.isLocked) {
    throw new Error("Corrections are only available for locked business dates.");
  }

  const requestedValue = readCorrectionJsonValue(request.requested_value_json);
  const normalizedRequestedValue =
    request.correction_type === "note"
      ? typeof requestedValue === "string"
        ? requestedValue
        : null
      : Number(requestedValue);

  if (
    request.correction_type !== "note" &&
    (!Number.isFinite(normalizedRequestedValue) ||
      Number(normalizedRequestedValue) < 0)
  ) {
    throw new Error("Requested correction value is invalid.");
  }

  const adjustmentPayload = getAdjustmentPayloadForCorrection({
    effective,
    field: request.correction_type,
    requestedValue: normalizedRequestedValue,
  });
  const moneyDelta = getMoneyDeltaForCorrection({
    effective,
    field: request.correction_type,
    requestedValue: normalizedRequestedValue,
  });
  const now = new Date().toISOString();
  const { error: adjustmentError } = await auth.supabase
    .from("pos_financial_adjustments")
    .insert({
      ...adjustmentPayload,
      business_date: request.business_date,
      correction_request_id: request.id,
      created_by: auth.user.id,
      salon_id: auth.salon.id,
      target_id: effective.closingId,
      target_type: "daily_closing",
    });

  if (adjustmentError) {
    throw new Error(adjustmentError.message);
  }

  const { data, error } = await auth.supabase
    .from("pos_financial_correction_requests")
    .update({
      admin_note: input.adminNote?.trim() || request.admin_note,
      applied_at: now,
      approved_at: request.approved_at ?? now,
      approved_by: request.approved_by ?? auth.user.id,
      money_delta: moneyDelta,
      status: "applied",
    })
    .eq("id", request.id)
    .eq("salon_id", auth.salon.id)
    .select(
      "id, business_date, correction_type, old_value_json, requested_value_json, money_delta, reason, status, requested_by, requested_at, approved_by, approved_at, admin_note",
    )
    .single<FinancialCorrectionRequestRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function submitDailyClosingCorrection(
  input: DailyClosingCorrectionInput,
  context?: CurrentBusinessContext,
) {
  const request = await createDailyClosingCorrectionRequest(input, context);

  if (!input.applyImmediately) {
    return request;
  }

  return applyDailyClosingCorrection(
    {
      adminNote: input.adminNote,
      correctionRequestId: request.id,
    },
    context,
  );
}

export async function getPayrollReadyDailyFinancials(
  startDate: string,
  endDate: string,
  context?: CurrentBusinessContext,
): Promise<PayrollReadyDailyFinancial[]> {
  if (!isDateInputValue(startDate) || !isDateInputValue(endDate)) {
    throw new Error("Start and end dates are required.");
  }

  if (startDate > endDate) {
    throw new Error("Start date must be before end date.");
  }

  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const rows: PayrollReadyDailyFinancial[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const effective = await getDailyClosingEffectiveTotals(cursor, resolvedContext);

    rows.push({
      adjustmentTotals: effective.adjustmentTotals,
      closingStatus: effective.lock.status,
      effectiveActualTotal: effective.totals.actualTotal,
      effectiveCashAmount: effective.closingInputs.cashAmount,
      effectiveCreditCardAmount: effective.closingInputs.creditCardAmount,
      effectiveDifference: effective.totals.difference,
      effectiveExpectedTotal: effective.totals.expectedTotal,
      effectiveOtherAmount: effective.closingInputs.otherAmount,
      pendingCorrectionCount: effective.pendingCorrectionCount,
      reportDate: cursor,
      snapshotTotals: effective.snapshotTotals,
    });

    cursor = getNextLocalDateString(cursor);
  }

  return rows;
}
