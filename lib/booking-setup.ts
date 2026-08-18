import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { getSalonOnlineBookingStatus } from "@/lib/booking-status";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { SERVICE_SELECT } from "@/lib/services";
import { STAFF_SELECT } from "@/lib/staff";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  BookingSettings,
  StaffAvailabilityRule,
  StaffServiceAssignment,
  StaffTimeBlock,
} from "@/types/booking";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

export const BOOKING_SETUP_PERMISSIONS = {
  bookingManage: "booking.manage",
  bookingView: "booking.view",
  servicesManage: "services.manage",
  servicesView: "services.view",
  staffManage: "staff.manage",
  staffView: "staff.view",
} as const;

export type BookingSetupReasonCode =
  | "booking_disabled"
  | "no_assigned_services"
  | "no_working_hours"
  | "online_booking_disabled"
  | "staff_inactive";

export type StaffBookingReadiness = {
  assignedServiceCount: number;
  onlineAssignedServiceCount: number;
  ready: boolean;
  reasons: Array<{
    code: BookingSetupReasonCode;
    cta: "assign_services" | "booking_settings" | "staff_profile" | "staff_hours";
    label: string;
  }>;
  staffId: string;
  upcomingBlockCount: number;
  workingRuleCount: number;
};

export type BookingSetupPermissions = {
  canManageAssignments: boolean;
  canManageAvailability: boolean;
  canManageBooking: boolean;
  canManageServices: boolean;
  canManageStaff: boolean;
  canViewAssignments: boolean;
};

export type BookingSetupData = {
  assignments: StaffServiceAssignment[];
  availabilityRules: StaffAvailabilityRule[];
  permissions: BookingSetupPermissions;
  readinessByStaffId: Record<string, StaffBookingReadiness>;
  salonId: string;
  services: Service[];
  staff: Staff[];
  timeBlocks: StaffTimeBlock[];
  timezone: string;
};

const BOOKING_SETTINGS_TIMEZONE_SELECT =
  "timezone_iana, booking_enabled, online_booking_visible, guest_booking_enabled";

function requireCurrentAccountAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open booking setup from a Business workspace.");
  }

  if (!context.currentAccount || !context.currentSalon) {
    throw new Error("Choose a salon workspace before managing booking setup.");
  }

  return {
    Account: context.currentAccount,
    salon: context.currentSalon,
  };
}

async function hasAnyPermission(
  context: CurrentBusinessContext,
  permissions: string[],
) {
  const results = await Promise.all(
    permissions.map((permission) => hasPermission(permission, context)),
  );

  return results.some(Boolean);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function activeAssignmentsForStaff(input: {
  assignments: StaffServiceAssignment[];
  servicesById: Map<string, Service>;
  staffId: string;
}) {
  return input.assignments.filter((assignment) => {
    const service = input.servicesById.get(assignment.service_id);

    return (
      assignment.staff_id === input.staffId &&
      assignment.is_active &&
      assignment.online_bookable &&
      service?.is_active === true &&
      service.online_booking_enabled === true
    );
  });
}

function activeWorkingRulesForStaff(input: {
  rules: StaffAvailabilityRule[];
  staffId: string;
}) {
  return input.rules.filter(
    (rule) =>
      rule.is_active &&
      rule.rule_type === "working" &&
      (!rule.staff_id || rule.staff_id === input.staffId),
  );
}

function activeUpcomingBlocksForStaff(input: {
  blocks: StaffTimeBlock[];
  staffId: string;
}) {
  const nowMs = Date.now();

  return input.blocks.filter(
    (block) =>
      block.is_active !== false &&
      (!block.staff_id || block.staff_id === input.staffId) &&
      new Date(block.ends_at).getTime() >= nowMs,
  );
}

export function getStaffBookingReadiness(input: {
  assignments: StaffServiceAssignment[];
  availabilityRules: StaffAvailabilityRule[];
  bookingEnabled: boolean;
  services: Service[];
  staff: Staff;
  timeBlocks: StaffTimeBlock[];
}): StaffBookingReadiness {
  const servicesById = new Map(input.services.map((service) => [service.id, service]));
  const assignedServices = activeAssignmentsForStaff({
    assignments: input.assignments,
    servicesById,
    staffId: input.staff.id,
  });
  const workingRules = activeWorkingRulesForStaff({
    rules: input.availabilityRules,
    staffId: input.staff.id,
  });
  const upcomingBlocks = activeUpcomingBlocksForStaff({
    blocks: input.timeBlocks,
    staffId: input.staff.id,
  });
  const reasons: StaffBookingReadiness["reasons"] = [];

  if (!input.bookingEnabled) {
    reasons.push({
      code: "booking_disabled",
      cta: "booking_settings",
      label: "Online booking is disabled",
    });
  }

  if (!input.staff.is_active) {
    reasons.push({
      code: "staff_inactive",
      cta: "staff_profile",
      label: "Staff inactive",
    });
  }

  if (!input.staff.online_booking_enabled) {
    reasons.push({
      code: "online_booking_disabled",
      cta: "staff_profile",
      label: "Online booking disabled",
    });
  }

  if (assignedServices.length === 0) {
    reasons.push({
      code: "no_assigned_services",
      cta: "assign_services",
      label: "No assigned services",
    });
  }

  if (workingRules.length === 0) {
    reasons.push({
      code: "no_working_hours",
      cta: "staff_hours",
      label: "No working hours",
    });
  }

  return {
    assignedServiceCount: input.assignments.filter(
      (assignment) => assignment.staff_id === input.staff.id && assignment.is_active,
    ).length,
    onlineAssignedServiceCount: assignedServices.length,
    ready: reasons.length === 0,
    reasons,
    staffId: input.staff.id,
    upcomingBlockCount: upcomingBlocks.length,
    workingRuleCount: workingRules.length,
  };
}

export async function getCurrentSalonBookingSetup(
  context?: CurrentBusinessContext,
): Promise<BookingSetupData> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("Sign in before viewing booking setup.");
  }

  const canViewAssignments = await hasAnyPermission(resolvedContext, [
    BOOKING_SETUP_PERMISSIONS.bookingView,
    BOOKING_SETUP_PERMISSIONS.bookingManage,
    BOOKING_SETUP_PERMISSIONS.staffView,
    BOOKING_SETUP_PERMISSIONS.servicesView,
  ]);

  if (!canViewAssignments) {
    await requirePermission(BOOKING_SETUP_PERMISSIONS.bookingView, resolvedContext);
  }

  const { Account, salon } = requireCurrentAccountAndSalon(resolvedContext);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [
    canManageBooking,
    canManageStaff,
    canManageServices,
  ] = await Promise.all([
    hasPermission(BOOKING_SETUP_PERMISSIONS.bookingManage, resolvedContext),
    hasPermission(BOOKING_SETUP_PERMISSIONS.staffManage, resolvedContext),
    hasPermission(BOOKING_SETUP_PERMISSIONS.servicesManage, resolvedContext),
  ]);
  const permissions = {
    canManageAssignments: canManageServices,
    canManageAvailability: canManageBooking || canManageStaff,
    canManageBooking,
    canManageServices,
    canManageStaff,
    canViewAssignments,
  } satisfies BookingSetupPermissions;
  const now = new Date();
  const rangeEnd = addDays(now, 120).toISOString();
  const [
    staffResult,
    servicesResult,
    assignmentsResult,
    availabilityResult,
    blocksResult,
    settingsResult,
  ] = await Promise.all([
    supabase
      .from("staff")
      .select(STAFF_SELECT)
      .eq("salon_id", salon.id)
      .order("display_name", { ascending: true })
      .returns<Staff[]>(),
    supabase
      .from("services")
      .select(SERVICE_SELECT)
      .eq("salon_id", salon.id)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .returns<Service[]>(),
    supabase
      .from("staff_service_assignments")
      .select("*")
      .eq("salon_id", salon.id)
      .returns<StaffServiceAssignment[]>(),
    supabase
      .from("staff_availability_rules")
      .select("*")
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .returns<StaffAvailabilityRule[]>(),
    supabase
      .from("staff_time_blocks")
      .select("*")
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .gte("ends_at", now.toISOString())
      .lt("starts_at", rangeEnd)
      .order("starts_at", { ascending: true })
      .returns<StaffTimeBlock[]>(),
    supabase
      .from("booking_settings")
      .select(BOOKING_SETTINGS_TIMEZONE_SELECT)
      .eq("salon_id", salon.id)
      .maybeSingle<
        Pick<
          BookingSettings,
          | "booking_enabled"
          | "guest_booking_enabled"
          | "online_booking_visible"
          | "timezone_iana"
        >
      >(),
  ]);

  const firstError =
    staffResult.error ??
    servicesResult.error ??
    assignmentsResult.error ??
    availabilityResult.error ??
    blocksResult.error ??
    settingsResult.error;

  if (firstError) {
    console.error("Supabase load booking setup failed", {
      code: firstError.code,
      details: firstError.details,
      hint: firstError.hint,
      message: firstError.message,
      accountId: Account.id,
      salonId: salon.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(firstError.message);
  }

  const staff = staffResult.data ?? [];
  const services = servicesResult.data ?? [];
  const assignments = assignmentsResult.data ?? [];
  const availabilityRules = availabilityResult.data ?? [];
  const timeBlocks = blocksResult.data ?? [];
  const salonBookingStatus = getSalonOnlineBookingStatus(settingsResult.data);
  const readinessByStaffId = Object.fromEntries(
    staff.map((member) => [
      member.id,
      getStaffBookingReadiness({
        assignments,
        availabilityRules,
        bookingEnabled: salonBookingStatus.onlineBookingOpen,
        services,
        staff: member,
        timeBlocks,
      }),
    ]),
  );

  return {
    assignments,
    availabilityRules,
    permissions,
    readinessByStaffId,
    salonId: salon.id,
    services,
    staff,
    timeBlocks,
    timezone: settingsResult.data?.timezone_iana || "America/Chicago",
  };
}
