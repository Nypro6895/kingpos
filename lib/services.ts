import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { CreateServiceInput, Service } from "@/types/service";

export const SERVICE_SELECT =
  "id, organization_id, salon_id, name, category, base_price, duration_minutes, description, is_active, created_at, updated_at";

export const SERVICE_PERMISSIONS = {
  view: "services.view",
  manage: "services.manage",
} as const;

function requireCurrentOrganizationAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open services from a Manage Salon workspace.");
  }

  if (!context.currentOrganization) {
    throw new Error("Create an organization before managing services.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    organization: context.currentOrganization,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonServices() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, services: [] };
  }

  await requirePermission(SERVICE_PERMISSIONS.view, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("services")
    .select(SERVICE_SELECT)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .order("created_at", { ascending: false })
    .returns<Service[]>();

  if (error) {
    console.error("Supabase load services failed", {
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

  return { context, services: data ?? [] };
}

export async function createService(input: CreateServiceInput) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to create services.");
  }

  await requirePermission(SERVICE_PERMISSIONS.manage, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const name = input.name.trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  if (input.base_price < 0) {
    throw new Error("Base Price must be greater than or equal to 0.");
  }

  if (input.duration_minutes <= 0) {
    throw new Error("Duration must be greater than 0.");
  }

  const { data, error } = await supabase
    .from("services")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      name,
      category: input.category,
      base_price: input.base_price,
      duration_minutes: input.duration_minutes,
      description: input.description,
      is_active: input.is_active ?? true,
    })
    .select(SERVICE_SELECT)
    .single<Service>();

  if (error) {
    console.error("Supabase create service failed", {
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
