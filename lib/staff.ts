import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { CreateStaffInput, Staff } from "@/types/staff";

export const STAFF_SELECT =
  "id, organization_id, salon_id, user_id, display_name, first_name, last_name, phone, email, job_title, is_active, created_at, updated_at";

export const STAFF_PERMISSIONS = {
  view: "staff.view",
  manage: "staff.manage",
} as const;

function requireCurrentOrganizationAndSalon(context: CurrentBusinessContext) {
  if (!context.currentOrganization) {
    throw new Error("Create an organization before managing staff.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    organization: context.currentOrganization,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonStaff() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, staff: [] };
  }

  await requirePermission(STAFF_PERMISSIONS.view, context);

  const { salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("salon_id", salon.id)
    .order("created_at", { ascending: false })
    .returns<Staff[]>();

  if (error) {
    console.error("Supabase load staff failed", {
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

  return { context, staff: data ?? [] };
}

export async function createStaff(input: CreateStaffInput) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to create staff.");
  }

  await requirePermission(STAFF_PERMISSIONS.manage, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const displayName = input.display_name.trim();

  if (!displayName) {
    throw new Error("Display Name is required.");
  }

  const { data, error } = await supabase
    .from("staff")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      display_name: displayName,
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone,
      email: input.email,
      job_title: input.job_title,
      is_active: input.is_active ?? true,
    })
    .select(STAFF_SELECT)
    .single<Staff>();

  if (error) {
    console.error("Supabase create staff failed", {
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

  return data;
}
