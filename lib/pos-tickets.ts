import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { POS_PAYMENT_SELECT } from "@/lib/pos-payments";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getTodayDate } from "@/lib/staff-workdays";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { Customer } from "@/types/customer";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { PosTicketStaffEarningWithStaff } from "@/types/pos-ticket-staff-earning";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";
import type {
  StaffWorkdayStatus,
  StaffWorkdayWithStaff,
} from "@/types/staff-workday";

export const POS_TICKET_SELECT =
  "id, organization_id, salon_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at";

export const POS_TICKET_ITEM_SELECT =
  "id, organization_id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, is_removed, removed_at, removed_by, removal_reason, created_at, updated_at";

export const POS_TICKET_AUDIT_LOG_SELECT =
  "id, organization_id, salon_id, ticket_id, action, note, created_by, created_at, created_by_user:users(id, display_name, email)";

export const POS_TICKET_WITH_RELATIONS_SELECT = `${POS_TICKET_SELECT}, audit_logs:pos_ticket_audit_logs(${POS_TICKET_AUDIT_LOG_SELECT}), customer:customers(id, name, phone, email), payments:pos_payments(${POS_PAYMENT_SELECT}), ticket_items:pos_ticket_items(${POS_TICKET_ITEM_SELECT}, service:services(id, name, category, base_price, duration_minutes), assigned_staff:staff(id, display_name, job_title), turn_parts:pos_ticket_item_turn_parts(id, amount, turn_type, turn_index))`;

const POS_TICKET_STAFF_EARNING_SELECT =
  "id, organization_id, salon_id, ticket_id, staff_id, work_date, service_total, tip_amount, big_turn_count, small_turn_count, first_big_turn_sequence, last_big_turn_sequence, first_small_turn_sequence, last_small_turn_sequence, commission_amount, bonus_amount, deduction_amount, total_earning, calculation_version, locked_at, payroll_batch_id, created_at, updated_at";

export const POS_TICKET_PERMISSIONS = {
  void: "tickets.void",
  view: "tickets.view",
  manage: "tickets.manage",
} as const;

export const POS_TICKET_CUSTOMER_OPTION_SELECT =
  "id, location_id, name, phone, email, notes, status, created_at, updated_at";

export const POS_TICKET_SERVICE_OPTION_SELECT =
  "id, organization_id, salon_id, name, category, base_price, duration_minutes, description, is_active, created_at, updated_at";

export const POS_TICKET_STAFF_OPTION_SELECT =
  "id, organization_id, salon_id, user_id, display_name, first_name, last_name, phone, email, job_title, is_active, created_at, updated_at";

export type PosTicketStaffOption = Staff & {
  today_status: StaffWorkdayStatus | "not_checked_in";
};

function requireCurrentOrganizationAndSalon(context: CurrentBusinessContext) {
  if (!context.currentOrganization) {
    throw new Error("Create an organization before managing POS tickets.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    organization: context.currentOrganization,
    salon: context.currentSalon,
  };
}

export type PosTicketListFilters = {
  openedFrom?: string;
  openedTo?: string;
};

async function loadStaffEarningsForTickets(input: {
  organizationId: string;
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
    .eq("organization_id", input.organizationId)
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
      organizationId: input.organizationId,
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
      .eq("organization_id", input.organizationId)
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
        organizationId: input.organizationId,
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
  organizationId: string;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
  tickets: PosTicketWithRelations[];
}) {
  const earningsByTicketId = await loadStaffEarningsForTickets({
    organizationId: input.organizationId,
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

export async function getCurrentSalonPosTickets(filters: PosTicketListFilters = {}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, tickets: [] };
  }

  await requirePermission(POS_TICKET_PERMISSIONS.view, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
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
      organizationId: context.currentOrganization?.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  const tickets = await attachStaffEarningsToTickets({
    organizationId: organization.id,
    salonId: salon.id,
    supabase,
    tickets: data ?? [],
  });

  return { context, tickets };
}

export async function getCurrentSalonPosTicket(ticketId: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, ticket: null };
  }

  await requirePermission(POS_TICKET_PERMISSIONS.view, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
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
      organizationId: context.currentOrganization?.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  if (!data) {
    return { context, ticket: null };
  }

  const [ticket] = await attachStaffEarningsToTickets({
    organizationId: organization.id,
    salonId: salon.id,
    supabase,
    tickets: [data],
  });

  return { context, ticket };
}

export async function getCurrentSalonPosTicketOptions(
  context: CurrentBusinessContext,
) {
  const canUseOptions =
    (await hasPermission(POS_TICKET_PERMISSIONS.manage, context)) ||
    (await hasPermission(POS_TICKET_PERMISSIONS.void, context));

  if (!canUseOptions) {
    throw new Error("Missing required permission: tickets.manage or tickets.void");
  }

  const { salon } = requireCurrentOrganizationAndSalon(context);
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
      .eq("organization_id", context.currentOrganization?.id)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .returns<Staff[]>(),
    supabase
      .from("staff_workdays")
      .select("id, organization_id, salon_id, staff_id, work_date, status, check_in_at, check_out_at, created_at, updated_at, staff:staff(id, display_name, job_title)")
      .eq("organization_id", context.currentOrganization?.id)
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
      organizationId: context.currentOrganization?.id,
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
      organizationId: context.currentOrganization?.id,
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
      organizationId: context.currentOrganization?.id,
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
      organizationId: context.currentOrganization?.id,
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
