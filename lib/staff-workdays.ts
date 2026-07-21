import "server-only";

import {
  getCurrentBusinessContext,
  getCurrentStaffBusinessContext,
} from "@/lib/current-context";
import {
  CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE,
  CURRENT_STAFF_NOT_FOUND_MESSAGE,
  resolveStaffAccountForSalon,
  STAFF_ACCOUNT_SELECT,
} from "@/lib/staff-account";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { Staff } from "@/types/staff";
import type {
  StaffWorkdayStatus,
  StaffWorkdayWithStaff,
} from "@/types/staff-workday";

export const STAFF_WORKDAY_SELECT =
  "id, organization_id, salon_id, staff_id, work_date, status, check_in_at, check_out_at, created_at, updated_at, staff:staff(id, display_name, job_title)";

export const STAFF_WORKDAY_STATUS_LABELS = {
  break: "On break",
  checked_in: "Checked in",
  checked_out: "Checked out",
  not_checked_in: "Not checked in",
  unavailable: "Unavailable",
  working: "Working",
} as const;

export type StaffWithTodayWorkday = Staff & {
  today_workday: StaffWorkdayWithStaff | null;
  today_status: StaffWorkdayStatus | "not_checked_in";
};

export type StaffDailyActivitySummary = {
  assignedServiceAmount: number;
  assignedServices: number;
  bigTurns: number;
  completedServices: number;
  smallTurns: number;
  tipAmount: number;
  totalEarning: number;
};

type StaffResolutionOptions = {
  allowEmailFallback?: boolean;
};

export type StaffAssignedWorkServiceLine = {
  id: string;
  createdAt: string | null;
  lineTotal: number;
  quantity: number;
  serviceName: string;
  unitPrice: number;
};

export type StaffAssignedWorkTicket = {
  id: string;
  bigTurns: number;
  closedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  firstActivityAt: string | null;
  hasEarning: boolean;
  openedAt: string | null;
  serviceTotal: number;
  services: StaffAssignedWorkServiceLine[];
  smallTurns: number;
  status: string | null;
  ticketNumber: string | null;
  tipAmount: number;
  totalEarning: number;
  totalTurns: number;
};

const STAFF_DAILY_COUNTED_TICKET_STATUSES = ["open", "closed"] as const;

function isCountedDailyTicketStatus(status: string | null | undefined) {
  return STAFF_DAILY_COUNTED_TICKET_STATUSES.includes(
    status as (typeof STAFF_DAILY_COUNTED_TICKET_STATUSES)[number],
  );
}

function numberValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function getTicketSortTime(ticket: StaffAssignedWorkTicket) {
  return ticket.openedAt ?? ticket.firstActivityAt ?? ticket.closedAt ?? "";
}

export function getTodayDate(timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function requireCurrentOrganizationAndSalon(context: CurrentBusinessContext) {
  if (!context.currentOrganization) {
    throw new Error("Create an organization before using My Work Today.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    organization: context.currentOrganization,
    salon: context.currentSalon,
  };
}

export async function getCurrentStaffForSalon(
  context: CurrentBusinessContext,
  options: StaffResolutionOptions = {},
) {
  if (!context.user) {
    throw new Error("You must be logged in to use My Work Today.");
  }

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const resolution = await resolveStaffAccountForSalon({
    context,
    supabase,
  });

  if (resolution.status === "found") {
    return resolution.staff;
  }

  if (resolution.status === "multiple") {
    console.error("Multiple current staff account matches found", {
      source: resolution.source,
      staffIds: resolution.matches.map((member) => member.id),
      salonId: salon.id,
      organizationId: organization.id,
      userId: context.user.id,
    });
    throw new Error(CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE);
  }

  if ((options.allowEmailFallback ?? true) && context.user.email) {
    // Legacy compatibility only. This predates explicit account links and runs
    // after account_user_id and legacy auth-id lookup both fail.
    const { data, error } = await supabase
      .from("staff")
      .select(STAFF_ACCOUNT_SELECT)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .ilike("email", context.user.email)
      .limit(2)
      .returns<Staff[]>();

    if (error) {
      console.error("Supabase load email current staff profile failed", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        salonId: salon.id,
        organizationId: organization.id,
        userId: context.user.id,
      });
      throw new Error(error.message);
    }

    if ((data ?? []).length > 1) {
      console.error("Multiple legacy email staff matches found", {
        staffIds: (data ?? []).map((member) => member.id),
        salonId: salon.id,
        organizationId: organization.id,
        userId: context.user.id,
      });
      throw new Error(CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE);
    }

    const staff = data?.[0] ?? null;

    if (staff) {
      return staff;
    }
  }

  throw new Error(CURRENT_STAFF_NOT_FOUND_MESSAGE);
}

export async function getTodaysStaffWorkday(
  context?: CurrentBusinessContext,
  options: StaffResolutionOptions = {},
) {
  const resolvedContext = context ?? (await getCurrentStaffBusinessContext());
  const today = getTodayDate(resolvedContext.user?.timezone);

  if (!resolvedContext.user) {
    return { context: resolvedContext, staff: null, today, workday: null };
  }

  if (!resolvedContext.currentOrganization || !resolvedContext.currentSalon) {
    return { context: resolvedContext, staff: null, today, workday: null };
  }

  const { salon } = requireCurrentOrganizationAndSalon(resolvedContext);
  let staff: Staff;

  try {
    staff = await getCurrentStaffForSalon(resolvedContext, options);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === CURRENT_STAFF_NOT_FOUND_MESSAGE
    ) {
      return { context: resolvedContext, staff: null, today, workday: null };
    }

    throw error;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: workday, error } = await supabase
    .from("staff_workdays")
    .select(STAFF_WORKDAY_SELECT)
    .eq("staff_id", staff.id)
    .eq("salon_id", salon.id)
    .eq("work_date", today)
    .maybeSingle<StaffWorkdayWithStaff>();

  if (error) {
    console.error("Supabase load today's staff workday failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      staffId: staff.id,
      salonId: salon.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(error.message);
  }

  return {
    context: resolvedContext,
    staff,
    today,
    workday,
  };
}

export async function getCurrentSalonStaffTodayBoard(
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const today = getTodayDate(resolvedContext.user?.timezone);

  if (!resolvedContext.user) {
    return { context: resolvedContext, staff: [], today };
  }

  const { organization, salon } = requireCurrentOrganizationAndSalon(resolvedContext);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [staffResult, workdaysResult] = await Promise.all([
    supabase
      .from("staff")
      .select(STAFF_ACCOUNT_SELECT)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .returns<Staff[]>(),
    supabase
      .from("staff_workdays")
      .select(STAFF_WORKDAY_SELECT)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .eq("work_date", today)
      .returns<StaffWorkdayWithStaff[]>(),
  ]);

  if (staffResult.error) {
    console.error("Supabase load staff today board staff failed", {
      code: staffResult.error.code,
      message: staffResult.error.message,
      details: staffResult.error.details,
      hint: staffResult.error.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(staffResult.error.message);
  }

  if (workdaysResult.error) {
    console.error("Supabase load staff today board workdays failed", {
      code: workdaysResult.error.code,
      message: workdaysResult.error.message,
      details: workdaysResult.error.details,
      hint: workdaysResult.error.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(workdaysResult.error.message);
  }

  const workdayByStaffId = new Map(
    (workdaysResult.data ?? []).map((workday) => [workday.staff_id, workday]),
  );
  const staff = (staffResult.data ?? []).map<StaffWithTodayWorkday>((member) => {
    const todayWorkday = workdayByStaffId.get(member.id) ?? null;

    return {
      ...member,
      today_status: todayWorkday?.status ?? "not_checked_in",
      today_workday: todayWorkday,
    };
  });

  return { context: resolvedContext, staff, today };
}

export async function getCurrentSalonStaffActivitySummaries(
  staffIds: string[],
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const summaryByStaffId = new Map<string, StaffDailyActivitySummary>();

  for (const staffId of staffIds) {
    summaryByStaffId.set(staffId, {
      assignedServiceAmount: 0,
      assignedServices: 0,
      bigTurns: 0,
      completedServices: 0,
      smallTurns: 0,
      tipAmount: 0,
      totalEarning: 0,
    });
  }

  if (staffIds.length === 0 || !resolvedContext.user) {
    return summaryByStaffId;
  }

  const { organization, salon } = requireCurrentOrganizationAndSalon(resolvedContext);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const today = getTodayDate(resolvedContext.user.timezone);
  const { data, error } = await supabase
    .from("pos_ticket_staff_earnings")
    .select(
      "staff_id, service_total, tip_amount, total_earning, big_turn_count, small_turn_count, ticket:pos_tickets!inner(status)",
    )
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("work_date", today)
    .in("staff_id", staffIds)
    .in("ticket.status", [...STAFF_DAILY_COUNTED_TICKET_STATUSES])
    .returns<
      Array<{
        big_turn_count: number;
        service_total: number;
        small_turn_count: number;
        staff_id: string;
        ticket: { status: string } | null;
        tip_amount: number;
        total_earning: number;
      }>
    >();

  if (error) {
    console.error("Supabase load staff activity summaries failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(error.message);
  }

  for (const earning of data ?? []) {
    const summary = summaryByStaffId.get(earning.staff_id);

    if (!summary) {
      continue;
    }

    const bigTurns = numberValue(earning.big_turn_count);
    const smallTurns = numberValue(earning.small_turn_count);
    const turnCount = bigTurns + smallTurns;
    summary.assignedServices += turnCount;
    summary.completedServices += turnCount;
    summary.assignedServiceAmount += numberValue(earning.service_total);
    summary.bigTurns += bigTurns;
    summary.smallTurns += smallTurns;
    summary.tipAmount += numberValue(earning.tip_amount);
    summary.totalEarning += numberValue(earning.total_earning);
  }

  return summaryByStaffId;
}

export async function getCurrentStaffAssignedWork(
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentStaffBusinessContext());
  const today = getTodayDate(resolvedContext.user?.timezone);

  if (!resolvedContext.user) {
    return {
      context: resolvedContext,
      excludedTicketCount: 0,
      staff: null,
      today,
      workTickets: [],
    };
  }

  if (!resolvedContext.currentOrganization || !resolvedContext.currentSalon) {
    return {
      context: resolvedContext,
      excludedTicketCount: 0,
      staff: null,
      today,
      workTickets: [],
    };
  }

  const { organization, salon } = requireCurrentOrganizationAndSalon(resolvedContext);
  let staff: Staff;

  try {
    staff = await getCurrentStaffForSalon(resolvedContext, {
      allowEmailFallback: false,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === CURRENT_STAFF_NOT_FOUND_MESSAGE
    ) {
      return {
        context: resolvedContext,
        excludedTicketCount: 0,
        staff: null,
        today,
        workTickets: [],
      };
    }

    throw error;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const dayStart = `${today}T00:00:00`;
  const dayEnd = `${today}T23:59:59.999`;
  const { data: earningRows, error: earningsError } = await supabase
    .from("pos_ticket_staff_earnings")
    .select(
      "id, ticket_id, staff_id, service_total, tip_amount, total_earning, big_turn_count, small_turn_count, ticket:pos_tickets!inner(id, ticket_number, status, opened_at, closed_at, customer:customers(id, name, phone, email))",
    )
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("staff_id", staff.id)
    .eq("work_date", today)
    .returns<
      Array<{
        id: string;
        big_turn_count: number;
        service_total: number;
        small_turn_count: number;
        staff_id: string;
        ticket_id: string;
        ticket: {
          id: string;
          ticket_number: string | null;
          status: string | null;
          opened_at: string | null;
          closed_at: string | null;
          customer: {
            id: string;
            email: string | null;
            name: string | null;
            phone: string | null;
          } | null;
        } | null;
        tip_amount: number;
        total_earning: number;
      }>
    >();

  if (earningsError) {
    console.error("Supabase load current staff earnings failed", {
      code: earningsError.code,
      message: earningsError.message,
      details: earningsError.details,
      hint: earningsError.hint,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(earningsError.message);
  }

  const { data: todaysItemRows, error: todaysItemsError } = await supabase
    .from("pos_ticket_items")
    .select(
      "id, pos_ticket_id, assigned_staff_id, unit_price, line_total, quantity, created_at, service:services(id, name), ticket:pos_tickets!inner(id, ticket_number, status, opened_at, closed_at, customer:customers(id, name, phone, email))",
    )
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("assigned_staff_id", staff.id)
    .eq("is_removed", false)
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd)
    .returns<
      Array<{
        id: string;
        assigned_staff_id: string | null;
        created_at: string;
        line_total: number;
        pos_ticket_id: string;
        quantity: number;
        service: { id: string; name: string } | null;
        unit_price: number;
        ticket: {
          id: string;
          ticket_number: string | null;
          status: string | null;
          opened_at: string | null;
          closed_at: string | null;
          customer: {
            id: string;
            email: string | null;
            name: string | null;
            phone: string | null;
          } | null;
        } | null;
      }>
    >();

  if (todaysItemsError) {
    console.error("Supabase load current staff assigned work items failed", {
      code: todaysItemsError.code,
      message: todaysItemsError.message,
      details: todaysItemsError.details,
      hint: todaysItemsError.hint,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(todaysItemsError.message);
  }

  const ticketIds = new Set<string>();

  for (const earning of earningRows ?? []) {
    if (earning.ticket_id) {
      ticketIds.add(earning.ticket_id);
    }
  }

  for (const item of todaysItemRows ?? []) {
    if (item.pos_ticket_id) {
      ticketIds.add(item.pos_ticket_id);
    }
  }

  const { data: itemRows, error: itemsError } =
    ticketIds.size > 0
      ? await supabase
          .from("pos_ticket_items")
          .select(
            "id, pos_ticket_id, assigned_staff_id, unit_price, line_total, quantity, created_at, service:services(id, name), ticket:pos_tickets!inner(id, ticket_number, status, opened_at, closed_at, customer:customers(id, name, phone, email))",
          )
          .eq("organization_id", organization.id)
          .eq("salon_id", salon.id)
          .eq("assigned_staff_id", staff.id)
          .eq("is_removed", false)
          .in("pos_ticket_id", [...ticketIds])
          .order("created_at", { ascending: true })
          .returns<
            Array<{
              id: string;
              assigned_staff_id: string | null;
              created_at: string;
              line_total: number;
              pos_ticket_id: string;
              quantity: number;
              service: { id: string; name: string } | null;
              unit_price: number;
              ticket: {
                id: string;
                ticket_number: string | null;
                status: string | null;
                opened_at: string | null;
                closed_at: string | null;
                customer: {
                  id: string;
                  email: string | null;
                  name: string | null;
                  phone: string | null;
                } | null;
              } | null;
            }>
          >()
      : { data: [], error: null };

  if (itemsError) {
    console.error("Supabase load current staff ticket service lines failed", {
      code: itemsError.code,
      message: itemsError.message,
      details: itemsError.details,
      hint: itemsError.hint,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(itemsError.message);
  }

  const excludedTicketIds = new Set<string>();
  const ticketById = new Map<string, StaffAssignedWorkTicket>();

  function upsertTicket(ticket: {
    id: string;
    ticket_number: string | null;
    status: string | null;
    opened_at: string | null;
    closed_at: string | null;
    customer: {
      email: string | null;
      name: string | null;
      phone: string | null;
    } | null;
  }) {
    if (!isCountedDailyTicketStatus(ticket.status)) {
      excludedTicketIds.add(ticket.id);
      return null;
    }

    const existingTicket = ticketById.get(ticket.id);

    if (existingTicket) {
      return existingTicket;
    }

    const customerName =
      normalizeText(ticket.customer?.name) ??
      normalizeText(ticket.customer?.phone) ??
      normalizeText(ticket.customer?.email);
    const workTicket: StaffAssignedWorkTicket = {
      id: ticket.id,
      bigTurns: 0,
      closedAt: ticket.closed_at,
      customerName,
      customerPhone: normalizeText(ticket.customer?.phone),
      firstActivityAt: ticket.opened_at ?? ticket.closed_at,
      hasEarning: false,
      openedAt: ticket.opened_at,
      serviceTotal: 0,
      services: [],
      smallTurns: 0,
      status: ticket.status,
      ticketNumber: ticket.ticket_number,
      tipAmount: 0,
      totalEarning: 0,
      totalTurns: 0,
    };

    ticketById.set(ticket.id, workTicket);
    return workTicket;
  }

  for (const earning of earningRows ?? []) {
    if (!earning.ticket) {
      continue;
    }

    const ticket = upsertTicket(earning.ticket);

    if (!ticket) {
      continue;
    }

    const bigTurns = numberValue(earning.big_turn_count);
    const smallTurns = numberValue(earning.small_turn_count);
    ticket.hasEarning = true;
    ticket.serviceTotal += numberValue(earning.service_total);
    ticket.tipAmount += numberValue(earning.tip_amount);
    ticket.totalEarning += numberValue(earning.total_earning);
    ticket.bigTurns += bigTurns;
    ticket.smallTurns += smallTurns;
    ticket.totalTurns += bigTurns + smallTurns;
  }

  for (const item of itemRows ?? []) {
    if (!item.ticket) {
      continue;
    }

    const ticket = upsertTicket(item.ticket);

    if (!ticket) {
      continue;
    }

    const itemCreatedAt = item.created_at ?? null;
    const currentFirstActivity = ticket.firstActivityAt
      ? new Date(ticket.firstActivityAt).getTime()
      : Number.POSITIVE_INFINITY;
    const itemActivity = itemCreatedAt
      ? new Date(itemCreatedAt).getTime()
      : Number.POSITIVE_INFINITY;

    if (itemActivity < currentFirstActivity) {
      ticket.firstActivityAt = itemCreatedAt;
    }

    const lineTotal = numberValue(item.line_total);

    ticket.services.push({
      id: item.id,
      createdAt: itemCreatedAt,
      lineTotal,
      quantity: numberValue(item.quantity),
      serviceName: normalizeText(item.service?.name) ?? "Unknown service",
      unitPrice: numberValue(item.unit_price),
    });

    if (!ticket.hasEarning) {
      ticket.serviceTotal += lineTotal;
    }
  }

  const workTickets = [...ticketById.values()]
    .map((ticket) => ({
      ...ticket,
      services: [...ticket.services].sort((left, right) =>
        (left.createdAt ?? "").localeCompare(right.createdAt ?? ""),
      ),
    }))
    .sort((left, right) =>
      getTicketSortTime(left).localeCompare(getTicketSortTime(right)),
    );

  return {
    context: resolvedContext,
    excludedTicketCount: excludedTicketIds.size,
    staff,
    today,
    workTickets,
  };
}
