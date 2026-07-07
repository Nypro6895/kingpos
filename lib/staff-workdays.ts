import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
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
  break: "On Break",
  checked_in: "Checked In",
  checked_out: "Checked Out",
  not_checked_in: "Not Checked In",
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

export async function getCurrentStaffForSalon(context: CurrentBusinessContext) {
  if (!context.user) {
    throw new Error("You must be logged in to use My Work Today.");
  }

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const baseQuery = supabase
    .from("staff")
    .select("id, organization_id, salon_id, user_id, display_name, first_name, last_name, phone, email, job_title, is_active, created_at, updated_at")
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("is_active", true);

  let staff: Staff | null = null;

  if (context.user.auth_user_id) {
    const { data, error } = await baseQuery
      .eq("user_id", context.user.auth_user_id)
      .maybeSingle<Staff>();

    if (error) {
      console.error("Supabase load linked current staff profile failed", {
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

    staff = data;
  }

  if (!staff && context.user.email) {
    const { data, error } = await supabase
      .from("staff")
      .select("id, organization_id, salon_id, user_id, display_name, first_name, last_name, phone, email, job_title, is_active, created_at, updated_at")
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .ilike("email", context.user.email)
      .maybeSingle<Staff>();

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

    staff = data;
  }

  if (!staff) {
    throw new Error("No active staff profile is linked to your account for this salon.");
  }

  return staff;
}

export async function getTodaysStaffWorkday(context?: CurrentBusinessContext) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
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
    staff = await getCurrentStaffForSalon(resolvedContext);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "No active staff profile is linked to your account for this salon."
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
      .select("id, organization_id, salon_id, user_id, display_name, first_name, last_name, phone, email, job_title, is_active, created_at, updated_at")
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
    .select("staff_id, service_total, tip_amount, total_earning, big_turn_count, small_turn_count")
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("work_date", today)
    .in("staff_id", staffIds)
    .returns<
      Array<{
        big_turn_count: number;
        service_total: number;
        small_turn_count: number;
        staff_id: string;
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

    const turnCount = earning.big_turn_count + earning.small_turn_count;
    summary.assignedServices += turnCount;
    summary.completedServices += turnCount;
    summary.assignedServiceAmount += earning.service_total;
    summary.bigTurns += earning.big_turn_count;
    summary.smallTurns += earning.small_turn_count;
    summary.tipAmount += earning.tip_amount;
    summary.totalEarning += earning.total_earning;
  }

  return summaryByStaffId;
}

export async function getCurrentStaffAssignedWork(
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const today = getTodayDate(resolvedContext.user?.timezone);

  if (!resolvedContext.user) {
    return { context: resolvedContext, staff: null, today, workItems: [] };
  }

  const { organization, salon } = requireCurrentOrganizationAndSalon(resolvedContext);
  let staff: Staff;

  try {
    staff = await getCurrentStaffForSalon(resolvedContext);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "No active staff profile is linked to your account for this salon."
    ) {
      return { context: resolvedContext, staff: null, today, workItems: [] };
    }

    throw error;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const dayStart = `${today}T00:00:00`;
  const dayEnd = `${today}T23:59:59.999`;
  const { data, error } = await supabase
    .from("pos_ticket_items")
    .select("id, assigned_staff_id, unit_price, line_total, quantity, created_at, service:services(id, name), ticket:pos_tickets!inner(id, ticket_number, status, opened_at, closed_at, customer:customers(id, name, phone, email))")
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("assigned_staff_id", staff.id)
    .eq("is_removed", false)
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd)
    .order("created_at", { ascending: true })
    .returns<
      Array<{
        id: string;
        assigned_staff_id: string | null;
        unit_price: number;
        line_total: number;
        quantity: number;
        created_at: string;
        service: { id: string; name: string } | null;
        ticket: {
          id: string;
          ticket_number: string;
          status: string;
          opened_at: string;
          closed_at: string | null;
          customer: { id: string; name: string; phone: string | null; email: string | null } | null;
        } | null;
      }>
    >();

  if (error) {
    console.error("Supabase load current staff assigned work failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      staffId: staff.id,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(error.message);
  }

  return { context: resolvedContext, staff, today, workItems: data ?? [] };
}
