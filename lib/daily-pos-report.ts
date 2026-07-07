import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getTodayDate } from "@/lib/staff-workdays";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  DailyPosClosingInputs,
  DailyPosReport,
  DailyPosReportStaffRow,
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
  edit: "payroll.manage",
  view: "reports.view",
} as const;

export const POS_DAILY_CLOSING_SELECT =
  "id, organization_id, salon_id, report_date, cash_amount, credit_card_amount, other_amount, note, status, closed_at, closed_by, approved_at, approved_by, created_by, updated_by, created_at, updated_at";

const MONEY_MAX_CENTS = 999_999_999_999;

type ReportTicketItemTurnPart = {
  amount: number;
  staff_id: string | null;
  turn_index: number;
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

export type SaveDailyPosClosingInput = {
  cashAmount: string;
  creditCardAmount: string;
  note?: string | null;
  otherAmount: string;
  reportDate: string;
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

export function getDefaultReportDate(context: CurrentBusinessContext) {
  return getTodayDate(context.user?.timezone);
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
    cashAmount: Number(closing?.cash_amount ?? 0),
    closedAt: closing?.closed_at ?? null,
    creditCardAmount: Number(closing?.credit_card_amount ?? 0),
    note: closing?.note ?? null,
    otherAmount: Number(closing?.other_amount ?? 0),
    status: closing?.status ?? "draft",
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
    { name: string; serviceCents: number; tipCents: number; turns: number }
  >();

  for (const earning of earnings) {
    const existing = rowsByStaffId.get(earning.staff_id) ?? {
      name: getStaffName(earning.staff_id, earning.staff?.display_name),
      serviceCents: 0,
      tipCents: 0,
      turns: 0,
    };

    existing.serviceCents += toCents(earning.service_total);
    existing.tipCents += toCents(earning.tip_amount);
    existing.turns +=
      Number(earning.big_turn_count ?? 0) +
      Number(earning.small_turn_count ?? 0);
    rowsByStaffId.set(earning.staff_id, existing);
  }

  return Array.from(rowsByStaffId.entries())
    .map(([staffId, row]) => ({
      staffId,
      staffName: row.name,
      tipAmount: fromCents(row.tipCents),
      totalEarned: fromCents(row.serviceCents),
      totalTurns: row.turns,
    }))
    .sort((left, right) => left.staffName.localeCompare(right.staffName));
}

function buildStaffRowsFromTickets(
  tickets: ReportTicketRow[],
): DailyPosReportStaffRow[] {
  const rowsByStaffId = new Map<
    string,
    { name: string; serviceCents: number; turns: number }
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
            name: getStaffName(staffId, item.assigned_staff?.display_name),
            serviceCents: 0,
            turns: 0,
          };

          existing.serviceCents += toCents(part.amount);
          existing.turns += 1;
          rowsByStaffId.set(staffId, existing);
        }

        continue;
      }

      if (!item.assigned_staff_id) {
        continue;
      }

      const existing = rowsByStaffId.get(item.assigned_staff_id) ?? {
        name: getStaffName(
          item.assigned_staff_id,
          item.assigned_staff?.display_name,
        ),
        serviceCents: 0,
        turns: 0,
      };

      existing.serviceCents += getItemServiceTotalCents(item);
      existing.turns += Math.max(1, Math.round(Number(item.quantity) || 1));
      rowsByStaffId.set(item.assigned_staff_id, existing);
    }
  }

  return Array.from(rowsByStaffId.entries())
    .map(([staffId, row]) => ({
      staffId,
      staffName: row.name,
      tipAmount: 0,
      totalEarned: fromCents(row.serviceCents),
      totalTurns: row.turns,
    }))
    .sort((left, right) => left.staffName.localeCompare(right.staffName));
}

async function requireReportContext(
  permissionCode: string,
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("You must be logged in to view reports.");
  }

  if (!resolvedContext.currentOrganization) {
    throw new Error("Create an organization before viewing reports.");
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
    organization: resolvedContext.currentOrganization,
    salon: resolvedContext.currentSalon,
    supabase,
    user: resolvedContext.user,
  };
}

export async function canEditDailyPosClosing(context: CurrentBusinessContext) {
  return hasPermission(DAILY_POS_REPORT_PERMISSIONS.edit, context);
}

export async function getDailyPosReport(
  reportDateInput: string,
  context?: CurrentBusinessContext,
): Promise<DailyPosReport> {
  const { organization, salon, supabase, user } = await requireReportContext(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );
  const reportDate = isDateInputValue(reportDateInput)
    ? reportDateInput
    : getTodayDate(user.timezone);
  const bounds = getUtcBoundsForLocalDate(reportDate, user.timezone);

  const [{ data: closing, error: closingError }, { data: tickets, error: ticketsError }] =
    await Promise.all([
      supabase
        .from("pos_daily_closings")
        .select(POS_DAILY_CLOSING_SELECT)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id)
        .eq("report_date", reportDate)
        .maybeSingle<PosDailyClosing>(),
      supabase
        .from("pos_tickets")
        .select(
          "id, opened_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, payments:pos_payments(payment_method, amount), ticket_items:pos_ticket_items(id, assigned_staff_id, quantity, line_total, is_removed, assigned_staff:staff(id, display_name), turn_parts:pos_ticket_item_turn_parts(amount, staff_id, turn_index))",
        )
        .eq("organization_id", organization.id)
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
      organizationId: organization.id,
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
      organizationId: organization.id,
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
      .eq("organization_id", organization.id)
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
        organizationId: organization.id,
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
    closingInputs,
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

async function updateDailyPosClosing(input: {
  cashAmountCents: number;
  closingId: string;
  creditCardAmountCents: number;
  note: string | null;
  organizationId: string;
  otherAmountCents: number;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
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
    .eq("organization_id", input.organizationId)
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

  const { organization, salon, supabase, user } = await requireReportContext(
    DAILY_POS_REPORT_PERMISSIONS.edit,
  );
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
    .eq("organization_id", organization.id)
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
        organizationId: organization.id,
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
      organization_id: organization.id,
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
        .eq("organization_id", organization.id)
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
          organizationId: organization.id,
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
