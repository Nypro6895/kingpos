import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { POS_PAYMENT_SELECT } from "@/lib/pos-payments";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getTodayDate } from "@/lib/staff-workdays";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { Customer } from "@/types/customer";
import type { BookingStatus } from "@/types/booking";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { PosTicketStaffEarningWithStaff } from "@/types/pos-ticket-staff-earning";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";
import type { KingUser } from "@/types/user";
import type {
  StaffWorkdayStatus,
  StaffWorkdayWithStaff,
} from "@/types/staff-workday";

export const POS_TICKET_SELECT =
  "id, salon_id, source_booking_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at";

export const POS_TICKET_ITEM_SELECT =
  "id, salon_id, pos_ticket_id, service_id, assigned_staff_id, performed_by_staff_id, source_booking_id, source_booking_line_id, source_kind, service_name_snapshot, service_category_snapshot, booked_unit_price_snapshot, quantity, unit_price, line_total, notes, is_removed, removed_at, removed_by, removal_reason, created_at, updated_at";

export const POS_TICKET_AUDIT_LOG_SELECT =
  "id, salon_id, ticket_id, action, note, created_by, created_at, created_by_user:users(id, display_name, email)";

export const POS_TICKET_WITH_RELATIONS_SELECT = `${POS_TICKET_SELECT}, audit_logs:pos_ticket_audit_logs(${POS_TICKET_AUDIT_LOG_SELECT}), customer:customers(id, name, phone, email), payments:pos_payments(${POS_PAYMENT_SELECT}), ticket_items:pos_ticket_items(${POS_TICKET_ITEM_SELECT}, service:services(id, name, category, base_price, duration_minutes), assigned_staff:staff!pos_ticket_items_assigned_staff_id_fkey(id, display_name, job_title), performed_staff:staff!pos_ticket_items_performed_by_staff_id_fkey(id, display_name, job_title), turn_parts:pos_ticket_item_turn_parts(id, ticket_id, ticket_item_id, staff_id, amount, turn_type, turn_index, work_date, created_at))`;

const POS_TICKET_STAFF_EARNING_SELECT =
  "id, salon_id, ticket_id, staff_id, work_date, service_total, tip_amount, tip_is_manual, manual_tip_amount, big_turn_count, small_turn_count, first_big_turn_sequence, last_big_turn_sequence, first_small_turn_sequence, last_small_turn_sequence, commission_amount, bonus_amount, deduction_amount, total_earning, calculation_version, locked_at, payroll_batch_id, created_at, updated_at";

const POS_TICKET_TURN_PART_SELECT =
  "id, ticket_id, ticket_item_id, staff_id, amount, turn_type, turn_index, work_date, created_at";

type PosTicketTurnPartRow = {
  amount: number;
  created_at: string;
  id: string;
  staff_id: string;
  ticket_id: string;
  ticket_item_id: string;
  turn_index: number;
  turn_type: "large" | "small";
  work_date: string;
};

type PosTicketItemTurnPart = PosTicketTurnPartRow;

type PosTicketAdjustmentRow = {
  action: "item_corrected" | "item_removed" | "item_replaced";
  after_snapshot: unknown;
  before_snapshot: unknown;
  created_at: string;
  created_by: string;
  id: string;
  reason: string;
  ticket_id: string;
};

type SourceBookingRow = {
  end_at: string;
  id: string;
  start_at: string;
  status: BookingStatus;
};

const DAILY_WORK_LOG_BIG_TURN_THRESHOLD = 25;

export const POS_TICKET_PERMISSIONS = {
  void: "tickets.void",
  view: "tickets.view",
  manage: "tickets.manage",
} as const;

export const POS_TICKET_CUSTOMER_OPTION_SELECT =
  "id, location_id, customer_user_id, name, phone, email, notes, staff_notes, internal_notes, source, status, created_by_user_id, updated_by_user_id, created_at, updated_at";

export const POS_TICKET_SERVICE_OPTION_SELECT =
  "id, salon_id, name, category, base_price, duration_minutes, description, is_active, online_booking_enabled, created_at, updated_at";

export const POS_TICKET_STAFF_OPTION_SELECT =
  "id, salon_id, user_id, account_user_id, display_name, first_name, last_name, phone, email, address_line1, address_line2, city, state, postal_code, job_title, pos_enabled, public_profile_photo_path, public_bio, public_profile_visible, owner_public_enabled, staff_public_consent_status, online_booking_enabled, profile_display_order, salon_profile_content_posting_enabled, specialties, is_active, created_at, updated_at";

export type PosTicketStaffOption = Staff & {
  today_status: StaffWorkdayStatus | "not_checked_in";
};

function requireCurrentAccountAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open POS tickets from a Business workspace.");
  }

  if (!context.currentAccount) {
    throw new Error("Choose a salon workspace before managing POS tickets.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    Account: context.currentAccount,
    salon: context.currentSalon,
  };
}

export type PosTicketListFilters = {
  openedFrom?: string;
  openedTo?: string;
};

async function loadStaffEarningsForTickets(input: {
  accountId: string;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
  ticketIds: string[];
}) {
  if (input.ticketIds.length === 0) {
    return new Map<string, PosTicketStaffEarningWithStaff[]>();
  }

  const { data: earnings, error: earningsError } = await input.supabase
    .from("pos_ticket_staff_earnings")
    .select(POS_TICKET_STAFF_EARNING_SELECT)
    .eq("salon_id", input.salonId)
    .in("ticket_id", input.ticketIds)
    .returns<Array<Omit<PosTicketStaffEarningWithStaff, "staff">>>();

  if (earningsError) {
    console.error("Supabase load POS ticket staff earnings failed", {
      code: earningsError.code,
      message: earningsError.message,
      details: earningsError.details,
      hint: earningsError.hint,
      salonId: input.salonId,
      accountId: input.accountId,
      ticketIds: input.ticketIds,
    });
    throw new Error(earningsError.message);
  }

  const staffIds = Array.from(
    new Set((earnings ?? []).map((earning) => earning.staff_id)),
  );
  const staffById = new Map<
    string,
    Pick<Staff, "id" | "display_name" | "job_title">
  >();

  if (staffIds.length > 0) {
    const { data: staffRows, error: staffError } = await input.supabase
      .from("staff")
      .select("id, display_name, job_title")
      .eq("salon_id", input.salonId)
      .in("id", staffIds)
      .returns<Array<Pick<Staff, "id" | "display_name" | "job_title">>>();

    if (staffError) {
      console.error("Supabase load POS ticket staff earning staff failed", {
        code: staffError.code,
        message: staffError.message,
        details: staffError.details,
        hint: staffError.hint,
        salonId: input.salonId,
        accountId: input.accountId,
        staffIds,
      });
      throw new Error(staffError.message);
    }

    for (const staff of staffRows ?? []) {
      staffById.set(staff.id, staff);
    }
  }

  const earningsByTicketId = new Map<string, PosTicketStaffEarningWithStaff[]>();

  for (const earning of earnings ?? []) {
    const row: PosTicketStaffEarningWithStaff = {
      ...earning,
      staff: staffById.get(earning.staff_id) ?? null,
    };

    earningsByTicketId.set(row.ticket_id, [
      ...(earningsByTicketId.get(row.ticket_id) ?? []),
      row,
    ]);
  }

  return earningsByTicketId;
}

async function attachStaffEarningsToTickets(input: {
  accountId: string;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
  tickets: PosTicketWithRelations[];
}) {
  const earningsByTicketId = await loadStaffEarningsForTickets({
    accountId: input.accountId,
    salonId: input.salonId,
    supabase: input.supabase,
    ticketIds: input.tickets.map((ticket) => ticket.id),
  });

  return input.tickets.map((ticket) => ({
    ...ticket,
    staff_earnings: earningsByTicketId.get(ticket.id) ?? [],
    ticket_items: (ticket.ticket_items ?? []).filter((item) => !item.is_removed),
  }));
}

async function loadAdjustmentsForTickets(input: {
  accountId: string;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
  ticketIds: string[];
}) {
  if (input.ticketIds.length === 0) {
    return new Map<string, NonNullable<PosTicketWithRelations["adjustments"]>>();
  }

  const { data: adjustments, error } = await input.supabase
    .from("pos_ticket_adjustments")
    .select("id, ticket_id, action, reason, before_snapshot, after_snapshot, created_by, created_at")
    .eq("salon_id", input.salonId)
    .in("ticket_id", input.ticketIds)
    .order("created_at", { ascending: false })
    .returns<PosTicketAdjustmentRow[]>();

  if (error) {
    console.error("Supabase load POS ticket adjustments failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: input.salonId,
      accountId: input.accountId,
      ticketIds: input.ticketIds,
    });
    throw new Error(error.message);
  }

  const userIds = Array.from(
    new Set((adjustments ?? []).map((adjustment) => adjustment.created_by)),
  );
  const usersById = new Map<string, Pick<KingUser, "id" | "display_name" | "email">>();

  if (userIds.length > 0) {
    const { data: users, error: usersError } = await input.supabase
      .from("users")
      .select("id, display_name, email")
      .in("id", userIds)
      .returns<Array<Pick<KingUser, "id" | "display_name" | "email">>>();

    if (usersError) {
      console.error("Supabase load POS ticket adjustment users failed", {
        code: usersError.code,
        message: usersError.message,
        details: usersError.details,
        hint: usersError.hint,
        salonId: input.salonId,
        accountId: input.accountId,
        userIds,
      });
      throw new Error(usersError.message);
    }

    for (const user of users ?? []) {
      usersById.set(user.id, user);
    }
  }

  const adjustmentsByTicketId = new Map<
    string,
    NonNullable<PosTicketWithRelations["adjustments"]>
  >();

  for (const adjustment of adjustments ?? []) {
    adjustmentsByTicketId.set(adjustment.ticket_id, [
      ...(adjustmentsByTicketId.get(adjustment.ticket_id) ?? []),
      {
        ...adjustment,
        created_by_user: usersById.get(adjustment.created_by) ?? null,
      },
    ]);
  }

  return adjustmentsByTicketId;
}

async function attachAdjustmentsToTickets(input: {
  accountId: string;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
  tickets: PosTicketWithRelations[];
}) {
  const adjustmentsByTicketId = await loadAdjustmentsForTickets({
    accountId: input.accountId,
    salonId: input.salonId,
    supabase: input.supabase,
    ticketIds: input.tickets.map((ticket) => ticket.id),
  });

  return input.tickets.map((ticket) => ({
    ...ticket,
    adjustments: adjustmentsByTicketId.get(ticket.id) ?? [],
  }));
}

async function attachSourceBookingsToTickets(input: {
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
  tickets: PosTicketWithRelations[];
}) {
  const bookingIds = Array.from(
    new Set(
      input.tickets
        .map((ticket) => ticket.source_booking_id)
        .filter((bookingId): bookingId is string => Boolean(bookingId)),
    ),
  );

  if (bookingIds.length === 0) {
    return input.tickets.map((ticket) => ({ ...ticket, source_booking: null }));
  }

  const { data, error } = await input.supabase
    .from("bookings")
    .select("id, start_at, end_at, status")
    .eq("salon_id", input.salonId)
    .in("id", bookingIds)
    .returns<SourceBookingRow[]>();

  if (error) {
    console.error("Supabase load POS source bookings failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      bookingIds,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  const bookingsById = new Map((data ?? []).map((booking) => [booking.id, booking]));

  return input.tickets.map((ticket) => ({
    ...ticket,
    source_booking: ticket.source_booking_id
      ? (bookingsById.get(ticket.source_booking_id) ?? null)
      : null,
  }));
}

async function attachTurnPartsToTickets(input: {
  accountId: string;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
  tickets: PosTicketWithRelations[];
}) {
  const itemIds = input.tickets.flatMap((ticket) =>
    (ticket.ticket_items ?? [])
      .filter((item) => !item.is_removed)
      .map((item) => item.id),
  );

  if (itemIds.length === 0) {
    return input.tickets.map((ticket) => ({
      ...ticket,
      ticket_items: (ticket.ticket_items ?? []).filter((item) => !item.is_removed),
    }));
  }

  const { data: parts, error } = await input.supabase
    .from("pos_ticket_item_turn_parts")
    .select(POS_TICKET_TURN_PART_SELECT)
    .eq("salon_id", input.salonId)
    .in("ticket_item_id", itemIds)
    .returns<PosTicketTurnPartRow[]>();

  if (error) {
    console.error("Supabase load POS ticket turn parts failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: input.salonId,
      accountId: input.accountId,
      itemIds,
    });
    throw new Error(error.message);
  }

  const partsByItemId = new Map<string, PosTicketTurnPartRow[]>();

  for (const part of parts ?? []) {
    partsByItemId.set(part.ticket_item_id, [
      ...(partsByItemId.get(part.ticket_item_id) ?? []),
      part,
    ]);
  }

  return input.tickets.map((ticket) => ({
    ...ticket,
    ticket_items: (ticket.ticket_items ?? [])
      .filter((item) => !item.is_removed)
      .map((item) => {
        const loadedParts = partsByItemId.get(item.id);
        const nestedParts = item.turn_parts ?? [];
        const sourceParts = [...(loadedParts ?? nestedParts)];
        const turnParts = sourceParts.sort(
          (left, right) =>
            left.turn_index - right.turn_index ||
            new Date(left.created_at ?? item.created_at).getTime() -
              new Date(right.created_at ?? item.created_at).getTime() ||
            left.id.localeCompare(right.id),
        ).map<PosTicketItemTurnPart>((part) => ({
          amount: part.amount,
          created_at: part.created_at ?? item.created_at,
          id: part.id,
          staff_id: part.staff_id ?? item.assigned_staff_id ?? "",
          ticket_id: part.ticket_id ?? item.pos_ticket_id,
          ticket_item_id: part.ticket_item_id ?? item.id,
          turn_index: part.turn_index,
          turn_type: part.turn_type,
          work_date: part.work_date ?? ticket.opened_at.slice(0, 10),
        }));

        if (turnParts.length === 0 && item.line_total > 0) {
          console.warn("POS ticket item is missing turn parts; using line_total fallback.", {
            itemId: item.id,
            lineTotal: item.line_total,
            ticketId: ticket.id,
          });
        }

        return {
          ...item,
          turn_parts: (turnParts.length > 0
            ? turnParts
            : [
                {
                  amount: item.line_total,
                  created_at: item.created_at,
                  id: `${item.id}:fallback`,
                  staff_id: item.assigned_staff_id ?? "",
                  ticket_id: item.pos_ticket_id,
                  ticket_item_id: item.id,
                  turn_index: 1,
                  turn_type: item.line_total >= 25 ? "large" : "small",
                  work_date: ticket.opened_at.slice(0, 10),
                },
              ]) satisfies PosTicketItemTurnPart[],
        };
      }),
  }));
}

function getTurnPartType(part: { amount: number; turn_type: "large" | "small" }) {
  return part.turn_type === "large" ||
    part.amount >= DAILY_WORK_LOG_BIG_TURN_THRESHOLD
    ? "big"
    : "small";
}

function getTicketWorkDate(ticket: PosTicketWithRelations) {
  const firstPart = ticket.ticket_items
    ?.flatMap((item) => item.turn_parts ?? [])
    .find((part) => part.work_date);

  return firstPart?.work_date ?? ticket.opened_at.slice(0, 10);
}

function attachRunningTurnsToTickets(tickets: PosTicketWithRelations[]) {
  const counters = new Map<string, { big: number; small: number }>();
  const runningTurnsByItemId = new Map<string, { big: number | null; small: number | null }>();

  const chronologicalTickets = [...tickets].sort(
    (left, right) =>
      getTicketWorkDate(left).localeCompare(getTicketWorkDate(right)) ||
      new Date(left.opened_at).getTime() - new Date(right.opened_at).getTime() ||
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
      left.ticket_sequence - right.ticket_sequence ||
      left.id.localeCompare(right.id),
  );

  for (const ticket of chronologicalTickets) {
    const workDate = getTicketWorkDate(ticket);
    const items = [...(ticket.ticket_items ?? [])].sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
        left.id.localeCompare(right.id),
    );

    for (const item of items) {
      if (!item.assigned_staff_id) {
        runningTurnsByItemId.set(item.id, { big: null, small: null });
        continue;
      }

      const staffCounterKey = `${workDate}:${item.assigned_staff_id}`;
      const current = counters.get(staffCounterKey) ?? { big: 0, small: 0 };
      const parts = [...(item.turn_parts ?? [])].sort(
        (left, right) =>
          left.turn_index - right.turn_index ||
          (left.created_at ?? "").localeCompare(right.created_at ?? "") ||
          left.id.localeCompare(right.id),
      );

      for (const part of parts) {
        const turnType = getTurnPartType(part);
        current[turnType] += 1;
      }

      counters.set(staffCounterKey, current);
      runningTurnsByItemId.set(item.id, {
        big: current.big > 0 ? current.big : null,
        small: current.small > 0 ? current.small : null,
      });
    }
  }

  return tickets.map((ticket) => ({
    ...ticket,
    ticket_items: (ticket.ticket_items ?? []).map((item) => ({
      ...item,
      running_turns: runningTurnsByItemId.get(item.id) ?? {
        big: null,
        small: null,
      },
    })),
  }));
}

export async function getCurrentSalonPosTickets(filters: PosTicketListFilters = {}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, tickets: [] };
  }

  await requirePermission(POS_TICKET_PERMISSIONS.view, context);

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  let query = supabase
    .from("pos_tickets")
    .select(POS_TICKET_WITH_RELATIONS_SELECT)
    .eq("salon_id", salon.id);

  if (filters.openedFrom) {
    query = query.gte("opened_at", filters.openedFrom);
  }

  if (filters.openedTo) {
    query = query.lte("opened_at", filters.openedTo);
  }

  const { data, error } = await query
    .order("opened_at", { ascending: false })
    .order("created_at", {
      ascending: true,
      referencedTable: "pos_ticket_items",
    })
    .order("created_at", {
      ascending: false,
      referencedTable: "pos_payments",
    })
    .order("created_at", {
      ascending: false,
      referencedTable: "pos_ticket_audit_logs",
    })
    .returns<PosTicketWithRelations[]>();

  if (error) {
    console.error("Supabase load POS tickets failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  const ticketsWithParts = await attachTurnPartsToTickets({
    accountId: Account.id,
    salonId: salon.id,
    supabase,
    tickets: data ?? [],
  });
  const ticketsWithRunningTurns = attachRunningTurnsToTickets(ticketsWithParts);
  const ticketsWithEarnings = await attachStaffEarningsToTickets({
    accountId: Account.id,
    salonId: salon.id,
    supabase,
    tickets: ticketsWithRunningTurns,
  });
  const tickets = await attachAdjustmentsToTickets({
    accountId: Account.id,
    salonId: salon.id,
    supabase,
    tickets: ticketsWithEarnings,
  });
  const ticketsWithSourceBookings = await attachSourceBookingsToTickets({
    salonId: salon.id,
    supabase,
    tickets,
  });

  return { context, tickets: ticketsWithSourceBookings };
}

export async function getCurrentSalonPosTicket(ticketId: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, ticket: null };
  }

  await requirePermission(POS_TICKET_PERMISSIONS.view, context);

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("pos_tickets")
    .select(POS_TICKET_WITH_RELATIONS_SELECT)
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .order("created_at", {
      ascending: false,
      referencedTable: "pos_ticket_audit_logs",
    })
    .maybeSingle<PosTicketWithRelations>();

  if (error) {
    console.error("Supabase load POS ticket failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  if (!data) {
    return { context, ticket: null };
  }

  const [ticketWithParts] = await attachTurnPartsToTickets({
    accountId: Account.id,
    salonId: salon.id,
    supabase,
    tickets: [data],
  });
  const [ticketWithRunningTurns] = attachRunningTurnsToTickets([ticketWithParts]);
  const [ticketWithEarnings] = await attachStaffEarningsToTickets({
    accountId: Account.id,
    salonId: salon.id,
    supabase,
    tickets: [ticketWithRunningTurns],
  });
  const [ticket] = await attachAdjustmentsToTickets({
    accountId: Account.id,
    salonId: salon.id,
    supabase,
    tickets: [ticketWithEarnings],
  });
  const [ticketWithSourceBooking] = await attachSourceBookingsToTickets({
    salonId: salon.id,
    supabase,
    tickets: [ticket],
  });

  return { context, ticket: ticketWithSourceBooking };
}

export async function getCurrentSalonPosTicketOptions(
  context: CurrentBusinessContext,
) {
  const canUseOptions =
    (await hasPermission(POS_TICKET_PERMISSIONS.manage, context)) ||
    (await hasPermission(POS_TICKET_PERMISSIONS.void, context)) ||
    (await hasPermission("payroll.manage", context)) ||
    (await hasPermission("financial_corrections.request", context)) ||
    (await hasPermission("financial_corrections.apply", context));

  if (!canUseOptions) {
    throw new Error(
      "Missing required permission: tickets.manage, tickets.void, payroll.manage, financial_corrections.request, or financial_corrections.apply",
    );
  }

  const { salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const today = getTodayDate(context.user?.timezone);
  const [customersResult, servicesResult, staffResult, workdaysResult] =
    await Promise.all([
    supabase
      .from("customers")
      .select(POS_TICKET_CUSTOMER_OPTION_SELECT)
      .eq("location_id", salon.id)
      .eq("status", "active")
      .order("name", { ascending: true })
      .returns<Customer[]>(),
    supabase
      .from("services")
      .select(POS_TICKET_SERVICE_OPTION_SELECT)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .returns<Service[]>(),
    supabase
      .from("staff")
      .select(POS_TICKET_STAFF_OPTION_SELECT)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .eq("pos_enabled", true)
      .order("display_name", { ascending: true })
      .returns<Staff[]>(),
    supabase
      .from("staff_workdays")
      .select("id, salon_id, staff_id, work_date, status, check_in_at, check_out_at, created_at, updated_at, staff:staff(id, display_name, job_title)")
      .eq("salon_id", salon.id)
      .eq("work_date", today)
      .returns<StaffWorkdayWithStaff[]>(),
  ]);

  if (customersResult.error) {
    console.error("Supabase load POS ticket customers failed", {
      code: customersResult.error.code,
      message: customersResult.error.message,
      details: customersResult.error.details,
      hint: customersResult.error.hint,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: context.user?.id,
    });
    throw new Error(customersResult.error.message);
  }

  if (servicesResult.error) {
    console.error("Supabase load POS ticket services failed", {
      code: servicesResult.error.code,
      message: servicesResult.error.message,
      details: servicesResult.error.details,
      hint: servicesResult.error.hint,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: context.user?.id,
    });
    throw new Error(servicesResult.error.message);
  }

  if (staffResult.error) {
    console.error("Supabase load POS ticket staff failed", {
      code: staffResult.error.code,
      message: staffResult.error.message,
      details: staffResult.error.details,
      hint: staffResult.error.hint,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: context.user?.id,
    });
    throw new Error(staffResult.error.message);
  }

  if (workdaysResult.error) {
    console.error("Supabase load POS ticket staff workdays failed", {
      code: workdaysResult.error.code,
      message: workdaysResult.error.message,
      details: workdaysResult.error.details,
      hint: workdaysResult.error.hint,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: context.user?.id,
    });
    throw new Error(workdaysResult.error.message);
  }

  const workdayStatusByStaffId = new Map(
    (workdaysResult.data ?? []).map((workday) => [workday.staff_id, workday.status]),
  );

  return {
    customers: customersResult.data ?? [],
    services: servicesResult.data ?? [],
    staff: (staffResult.data ?? []).map<PosTicketStaffOption>((member) => ({
      ...member,
      today_status: workdayStatusByStaffId.get(member.id) ?? "not_checked_in",
    })),
  };
}
