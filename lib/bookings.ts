import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { BookingWithRelations } from "@/types/booking";
import type { Customer } from "@/types/customer";
import type { Staff } from "@/types/staff";

export const BOOKING_SELECT =
  "id, organization_id, salon_id, customer_id, staff_id, start_at, end_at, notes, status, created_at, updated_at";

export const BOOKING_WITH_RELATIONS_SELECT = `${BOOKING_SELECT}, customer:customers(id, name, phone, email), staff:staff(id, display_name)`;

export const BOOKING_PERMISSIONS = {
  view: "booking.view",
  manage: "booking.manage",
} as const;

export const BOOKING_CUSTOMER_OPTION_SELECT = "id, location_id, name, phone, email, notes, status, created_at, updated_at";
export const BOOKING_STAFF_OPTION_SELECT =
  "id, organization_id, salon_id, user_id, display_name, first_name, last_name, phone, email, job_title, is_active, created_at, updated_at";

function requireCurrentOrganizationAndSalon(context: CurrentBusinessContext) {
  if (!context.currentOrganization) {
    throw new Error("Create an organization before managing bookings.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    organization: context.currentOrganization,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonBookings() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, bookings: [] };
  }

  await requirePermission(BOOKING_PERMISSIONS.view, context);

  const { salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_WITH_RELATIONS_SELECT)
    .eq("salon_id", salon.id)
    .order("start_at", { ascending: true })
    .returns<BookingWithRelations[]>();

  if (error) {
    console.error("Supabase load bookings failed", {
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

  return { context, bookings: data ?? [] };
}

export async function getCurrentSalonBookingOptions(context: CurrentBusinessContext) {
  await requirePermission(BOOKING_PERMISSIONS.manage, context);

  const { salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [customersResult, staffResult] = await Promise.all([
    supabase
      .from("customers")
      .select(BOOKING_CUSTOMER_OPTION_SELECT)
      .eq("location_id", salon.id)
      .eq("status", "active")
      .order("name", { ascending: true })
      .returns<Customer[]>(),
    supabase
      .from("staff")
      .select(BOOKING_STAFF_OPTION_SELECT)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .returns<Staff[]>(),
  ]);

  if (customersResult.error) {
    console.error("Supabase load booking customers failed", {
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

  if (staffResult.error) {
    console.error("Supabase load booking staff failed", {
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

  return {
    customers: customersResult.data ?? [],
    staff: staffResult.data ?? [],
  };
}
