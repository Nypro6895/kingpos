import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { POS_DESK_DEFAULTS } from "@/lib/pos-desk";
import { getTurnType } from "@/lib/pos-desk-amounts";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { PosTicketDiscountType, PosTicketTipType } from "@/types/pos-ticket";
import type { PosTicketStaffEarning } from "@/types/pos-ticket-staff-earning";

export const STAFF_EARNING_CALCULATION_VERSION = 1;
export const SMALL_TURN_THRESHOLD = POS_DESK_DEFAULTS.largeTurnThreshold;

type RawTurnPart = {
  amount: number;
  id: string;
  turn_index: number;
  turn_type: "large" | "small";
};

type RawTicketItem = {
  assigned_staff_id: string | null;
  created_at: string;
  id: string;
  is_removed?: boolean;
  line_total: number;
  quantity: number;
  turn_parts?: RawTurnPart[] | null;
  unit_price: number;
};

type RawTicket = {
  discount_type: PosTicketDiscountType;
  discount_value: number;
  id: string;
  opened_at: string;
  organization_id: string;
  salon_id: string;
  staff_earnings?: PosTicketStaffEarning[] | null;
  tax_rate: number;
  ticket_items?: RawTicketItem[] | null;
  ticket_sequence: number;
  tip_type: PosTicketTipType;
  tip_value: number;
};

type CalculatedStaffEarning = Omit<
  PosTicketStaffEarning,
  "created_at" | "id" | "locked_at" | "payroll_batch_id" | "updated_at"
>;

type StaffAccumulator = {
  bigTurnCount: number;
  firstBigTurnSequence: number | null;
  firstSmallTurnSequence: number | null;
  lastBigTurnSequence: number | null;
  lastSmallTurnSequence: number | null;
  serviceTotal: number;
  smallTurnCount: number;
  staffId: string;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(value: number | string) {
  const numeric = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numeric)) {
    return Number.NaN;
  }

  return Math.round(numeric * 100);
}

function fromCents(value: number) {
  return roundMoney(value / 100);
}

function formatDateInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return value.slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function parseLocalDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error("Invalid staff earning work date.");
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

function getUtcBoundsForLocalDate(dateString: string, timeZone: string) {
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

function getExistingKey(ticketId: string, staffId: string) {
  return `${ticketId}:${staffId}`;
}

function sortTicketItems(items: RawTicketItem[]) {
  return [...items].sort(
    (left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
      left.id.localeCompare(right.id),
  );
}

function getItemTurnTypes(item: RawTicketItem) {
  const turnParts = [...(item.turn_parts ?? [])].sort(
    (left, right) => left.turn_index - right.turn_index || left.id.localeCompare(right.id),
  );

  if (turnParts.length > 0) {
    return turnParts.map((part) => part.turn_type);
  }

  const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
  const unitAmount =
    item.unit_price > 0 ? item.unit_price : item.line_total / quantity;
  const turnType = getTurnType(unitAmount, SMALL_TURN_THRESHOLD);

  return Array.from({ length: quantity }, () => turnType);
}

function getItemServiceTotal(item: RawTicketItem) {
  const turnParts = item.turn_parts ?? [];

  if (turnParts.length > 0) {
    return fromCents(
      turnParts.reduce((total, part) => total + toCents(part.amount), 0),
    );
  }

  return item.line_total;
}

function getOrCreateAccumulator(
  accumulators: Map<string, StaffAccumulator>,
  staffId: string,
) {
  const existing = accumulators.get(staffId);

  if (existing) {
    return existing;
  }

  const created: StaffAccumulator = {
    bigTurnCount: 0,
    firstBigTurnSequence: null,
    firstSmallTurnSequence: null,
    lastBigTurnSequence: null,
    lastSmallTurnSequence: null,
    serviceTotal: 0,
    smallTurnCount: 0,
    staffId,
  };

  accumulators.set(staffId, created);
  return created;
}

function allocateTips(
  accumulators: StaffAccumulator[],
  ticketTipAmount: number,
  existingEarnings: PosTicketStaffEarning[],
) {
  const tipsByStaffId = new Map<string, number>();
  const manualTipCentsByStaffId = new Map<string, number>();
  const serviceTotalCents = accumulators.reduce(
    (total, staff) => total + toCents(staff.serviceTotal),
    0,
  );
  const tipCents = toCents(ticketTipAmount);
  const accumulatorByStaffId = new Map(
    accumulators.map((staff) => [staff.staffId, staff]),
  );

  if (!Number.isFinite(tipCents)) {
    throw new Error("Ticket tip must be a valid money amount.");
  }

  for (const earning of existingEarnings) {
    if (!earning.tip_is_manual || !accumulatorByStaffId.has(earning.staff_id)) {
      continue;
    }

    manualTipCentsByStaffId.set(
      earning.staff_id,
      Math.max(0, toCents(earning.manual_tip_amount ?? earning.tip_amount ?? 0)),
    );
  }

  const manualTipCents = Array.from(manualTipCentsByStaffId.values()).reduce(
    (total, tipCentsForStaff) => total + tipCentsForStaff,
    0,
  );

  if (manualTipCents > tipCents) {
    throw new Error("Manual staff tips cannot exceed the ticket tip.");
  }

  for (const staff of accumulators) {
    if (manualTipCentsByStaffId.has(staff.staffId)) {
      tipsByStaffId.set(
        staff.staffId,
        fromCents(manualTipCentsByStaffId.get(staff.staffId) ?? 0),
      );
    }
  }

  if (serviceTotalCents <= 0 || tipCents <= 0) {
    for (const staff of accumulators) {
      tipsByStaffId.set(staff.staffId, tipsByStaffId.get(staff.staffId) ?? 0);
    }

    return tipsByStaffId;
  }

  const nonManualAccumulators = accumulators.filter(
    (staff) => !manualTipCentsByStaffId.has(staff.staffId),
  );
  const remainingTipCents = tipCents - manualTipCents;
  const nonManualServiceTotalCents = nonManualAccumulators.reduce(
    (total, staff) => total + toCents(staff.serviceTotal),
    0,
  );

  if (nonManualAccumulators.length === 0) {
    if (remainingTipCents !== 0) {
      throw new Error("Manual staff tips must equal the ticket tip when all staff tips are manual.");
    }

    return tipsByStaffId;
  }

  if (remainingTipCents <= 0 || nonManualServiceTotalCents <= 0) {
    for (const staff of nonManualAccumulators) {
      tipsByStaffId.set(staff.staffId, 0);
    }

    return tipsByStaffId;
  }

  for (const staff of nonManualAccumulators) {
    tipsByStaffId.set(
      staff.staffId,
      fromCents(
        Math.round(
          (remainingTipCents * toCents(staff.serviceTotal)) /
            nonManualServiceTotalCents,
        ),
      ),
    );
  }

  const allocatedNonManualCents = nonManualAccumulators.reduce(
    (total, staff) => total + toCents(tipsByStaffId.get(staff.staffId) ?? 0),
    0,
  );
  const remainderCents = remainingTipCents - allocatedNonManualCents;

  if (remainderCents !== 0) {
    const remainderStaff = [...nonManualAccumulators].sort(
      (left, right) =>
        toCents(right.serviceTotal) - toCents(left.serviceTotal) ||
        left.staffId.localeCompare(right.staffId),
    )[0];

    if (remainderStaff) {
      tipsByStaffId.set(
        remainderStaff.staffId,
        fromCents(toCents(tipsByStaffId.get(remainderStaff.staffId) ?? 0) + remainderCents),
      );
    }
  }

  const allocatedCents = Array.from(tipsByStaffId.values()).reduce(
    (total, tip) => total + toCents(tip),
    0,
  );

  if (allocatedCents !== tipCents) {
    throw new Error("Unable to allocate staff tips to match ticket tip.");
  }

  return tipsByStaffId;
}

function calculateRowsForTickets(tickets: RawTicket[], workDate: string) {
  const rows: CalculatedStaffEarning[] = [];
  const sequenceByStaffId = new Map<string, { big: number; small: number }>();

  const sortedTickets = [...tickets].sort(
    (left, right) =>
      new Date(left.opened_at).getTime() - new Date(right.opened_at).getTime() ||
      left.ticket_sequence - right.ticket_sequence,
  );

  for (const ticket of sortedTickets) {
    const accumulators = new Map<string, StaffAccumulator>();

    for (const item of sortTicketItems(ticket.ticket_items ?? [])) {
      if (!item.assigned_staff_id) {
        continue;
      }

      const accumulator = getOrCreateAccumulator(
        accumulators,
        item.assigned_staff_id,
      );
      accumulator.serviceTotal = roundMoney(
        accumulator.serviceTotal + getItemServiceTotal(item),
      );

      for (const turnType of getItemTurnTypes(item)) {
        const sequence = sequenceByStaffId.get(item.assigned_staff_id) ?? {
          big: 0,
          small: 0,
        };

        if (turnType === "large") {
          sequence.big += 1;
          accumulator.bigTurnCount += 1;
          accumulator.firstBigTurnSequence ??= sequence.big;
          accumulator.lastBigTurnSequence = sequence.big;
        } else {
          sequence.small += 1;
          accumulator.smallTurnCount += 1;
          accumulator.firstSmallTurnSequence ??= sequence.small;
          accumulator.lastSmallTurnSequence = sequence.small;
        }

        sequenceByStaffId.set(item.assigned_staff_id, sequence);
      }
    }

    const staffAccumulators = Array.from(accumulators.values()).sort((left, right) =>
      left.staffId.localeCompare(right.staffId),
    );
    const ticketTotals = calculateTicketTotals({
      discountType: ticket.discount_type,
      discountValue: ticket.discount_value,
      items: (ticket.ticket_items ?? []).map((item) => ({
        line_total: getItemServiceTotal(item),
      })),
      taxRate: ticket.tax_rate,
      tipType: ticket.tip_type,
      tipValue: ticket.tip_value,
    });
    const existingEarnings = ticket.staff_earnings ?? [];
    const existingEarningByStaffId = new Map(
      existingEarnings.map((earning) => [earning.staff_id, earning]),
    );
    const tipsByStaffId = allocateTips(
      staffAccumulators,
      ticketTotals.tip_amount,
      existingEarnings,
    );

    for (const staff of staffAccumulators) {
      const existingEarning = existingEarningByStaffId.get(staff.staffId);
      const tipIsManual = existingEarning?.tip_is_manual ?? false;
      const tipAmount = tipsByStaffId.get(staff.staffId) ?? 0;
      const commissionAmount = 0;
      const bonusAmount = 0;
      const deductionAmount = 0;

      rows.push({
        big_turn_count: staff.bigTurnCount,
        bonus_amount: bonusAmount,
        calculation_version: STAFF_EARNING_CALCULATION_VERSION,
        commission_amount: commissionAmount,
        deduction_amount: deductionAmount,
        first_big_turn_sequence: staff.firstBigTurnSequence,
        first_small_turn_sequence: staff.firstSmallTurnSequence,
        last_big_turn_sequence: staff.lastBigTurnSequence,
        last_small_turn_sequence: staff.lastSmallTurnSequence,
        manual_tip_amount: tipIsManual
          ? roundMoney(existingEarning?.manual_tip_amount ?? tipAmount)
          : null,
        organization_id: ticket.organization_id,
        salon_id: ticket.salon_id,
        service_total: staff.serviceTotal,
        small_turn_count: staff.smallTurnCount,
        staff_id: staff.staffId,
        ticket_id: ticket.id,
        tip_amount: tipAmount,
        tip_is_manual: tipIsManual,
        total_earning: roundMoney(
          staff.serviceTotal +
            tipAmount +
            commissionAmount +
            bonusAmount -
            deductionAmount,
        ),
        work_date: workDate,
      });
    }
  }

  return rows;
}

async function requireEarningContext() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to calculate staff earnings.");
  }

  if (!context.currentOrganization || !context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  const canRecalculate =
    (await hasPermission(POS_TICKET_PERMISSIONS.manage, context)) ||
    (await hasPermission(POS_TICKET_PERMISSIONS.void, context));

  if (!canRecalculate) {
    throw new Error("Missing required permission: tickets.manage or tickets.void");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  return {
    context,
    organization: context.currentOrganization,
    salon: context.currentSalon,
    supabase,
    timeZone: context.user.timezone,
  };
}

async function loadTicketsForDate(input: {
  organizationId: string;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
  timeZone: string;
  workDate: string;
}) {
  const bounds = getUtcBoundsForLocalDate(input.workDate, input.timeZone);
  const { data, error } = await input.supabase
    .from("pos_tickets")
    .select(
      "id, organization_id, salon_id, ticket_sequence, opened_at, discount_type, discount_value, tax_rate, tip_type, tip_value, ticket_items:pos_ticket_items(id, assigned_staff_id, quantity, unit_price, line_total, is_removed, created_at, turn_parts:pos_ticket_item_turn_parts(id, amount, turn_type, turn_index))",
    )
    .eq("organization_id", input.organizationId)
    .eq("salon_id", input.salonId)
    .gte("opened_at", bounds.openedFrom)
    .lte("opened_at", bounds.openedTo)
    .order("opened_at", { ascending: true })
    .order("created_at", {
      ascending: true,
      referencedTable: "pos_ticket_items",
    })
    .returns<RawTicket[]>();

  if (error) {
    throw new Error(error.message);
  }

  const tickets = data ?? [];
  const ticketIds = tickets.map((ticket) => ticket.id);

  if (ticketIds.length === 0) {
    return tickets;
  }

  const { data: staffEarnings, error: staffEarningsError } = await input.supabase
    .from("pos_ticket_staff_earnings")
    .select(
      "id, organization_id, salon_id, ticket_id, staff_id, work_date, service_total, tip_amount, tip_is_manual, manual_tip_amount, big_turn_count, small_turn_count, first_big_turn_sequence, last_big_turn_sequence, first_small_turn_sequence, last_small_turn_sequence, commission_amount, bonus_amount, deduction_amount, total_earning, calculation_version, locked_at, payroll_batch_id, created_at, updated_at",
    )
    .eq("organization_id", input.organizationId)
    .eq("salon_id", input.salonId)
    .in("ticket_id", ticketIds)
    .returns<PosTicketStaffEarning[]>();

  if (staffEarningsError) {
    throw new Error(staffEarningsError.message);
  }

  const staffEarningsByTicketId = new Map<string, PosTicketStaffEarning[]>();

  for (const staffEarning of staffEarnings ?? []) {
    staffEarningsByTicketId.set(staffEarning.ticket_id, [
      ...(staffEarningsByTicketId.get(staffEarning.ticket_id) ?? []),
      staffEarning,
    ]);
  }

  return tickets.map((ticket) => ({
    ...ticket,
    staff_earnings: staffEarningsByTicketId.get(ticket.id) ?? [],
    ticket_items: (ticket.ticket_items ?? []).filter((item) => !item.is_removed),
  }));
}

export async function calculateTicketStaffEarnings(ticketId: string) {
  const { organization, salon, supabase, timeZone } = await requireEarningContext();
  const { data: ticket, error } = await supabase
    .from("pos_tickets")
    .select("id, opened_at, salon_id, organization_id")
    .eq("id", ticketId)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      opened_at: string;
      organization_id: string;
      salon_id: string;
    }>();

  if (error) {
    throw new Error(error.message);
  }

  if (!ticket) {
    return [];
  }

  const workDate = formatDateInTimeZone(ticket.opened_at, timeZone);
  const tickets = await loadTicketsForDate({
    organizationId: organization.id,
    salonId: salon.id,
    supabase,
    timeZone,
    workDate,
  });

  return calculateRowsForTickets(tickets, workDate).filter(
    (row) => row.ticket_id === ticketId,
  );
}

export async function recalculateStaffEarningsForDate(
  salonId: string,
  workDate: string,
) {
  const { organization, salon, supabase, timeZone } = await requireEarningContext();

  if (salon.id !== salonId) {
    throw new Error("Staff earnings can only be recalculated for the current salon.");
  }

  const tickets = await loadTicketsForDate({
    organizationId: organization.id,
    salonId,
    supabase,
    timeZone,
    workDate,
  });
  const calculatedRows = calculateRowsForTickets(tickets, workDate);
  const existingRows = tickets.flatMap((ticket) => ticket.staff_earnings ?? []);
  const existingByKey = new Map(
    existingRows.map((row) => [getExistingKey(row.ticket_id, row.staff_id), row]),
  );
  const calculatedKeys = new Set(
    calculatedRows.map((row) => getExistingKey(row.ticket_id, row.staff_id)),
  );
  const unlockedRows = calculatedRows.filter((row) => {
    const existing = existingByKey.get(getExistingKey(row.ticket_id, row.staff_id));
    return !existing?.locked_at;
  });

  if (unlockedRows.length > 0) {
    const { error } = await supabase
      .from("pos_ticket_staff_earnings")
      .upsert(unlockedRows, { onConflict: "ticket_id,staff_id" });

    if (error) {
      throw new Error(error.message);
    }
  }

  const staleRows = existingRows.filter(
    (row) => !row.locked_at && !calculatedKeys.has(getExistingKey(row.ticket_id, row.staff_id)),
  );

  for (const row of staleRows) {
    const { error } = await supabase
      .from("pos_ticket_staff_earnings")
      .update({
        big_turn_count: 0,
        bonus_amount: 0,
        calculation_version: STAFF_EARNING_CALCULATION_VERSION,
        commission_amount: 0,
        deduction_amount: 0,
        first_big_turn_sequence: null,
        first_small_turn_sequence: null,
        last_big_turn_sequence: null,
        last_small_turn_sequence: null,
        manual_tip_amount: null,
        service_total: 0,
        small_turn_count: 0,
        tip_amount: 0,
        tip_is_manual: false,
        total_earning: 0,
      })
      .eq("id", row.id)
      .eq("organization_id", organization.id)
      .eq("salon_id", salonId);

    if (error) {
      throw new Error(error.message);
    }
  }

  return calculatedRows;
}

export async function recalculateTicketStaffEarnings(ticketId: string) {
  const { organization, salon, supabase, timeZone } = await requireEarningContext();
  const { data: ticket, error } = await supabase
    .from("pos_tickets")
    .select("id, opened_at, salon_id, organization_id")
    .eq("id", ticketId)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      opened_at: string;
      organization_id: string;
      salon_id: string;
    }>();

  if (error) {
    throw new Error(error.message);
  }

  if (!ticket) {
    return [];
  }

  const workDate = formatDateInTimeZone(ticket.opened_at, timeZone);
  const rows = await recalculateStaffEarningsForDate(ticket.salon_id, workDate);

  return rows.filter((row) => row.ticket_id === ticketId);
}
