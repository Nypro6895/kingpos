import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { Customer } from "@/types/customer";

export const CUSTOMER_SELECT =
  "id, location_id, name, phone, email, notes, status, created_at, updated_at";

export const CUSTOMER_PERMISSIONS = {
  view: "customers.view",
  manage: "customers.manage",
} as const;

function requireCurrentSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open customers from a Manage Salon workspace.");
  }

  if (!context.currentSalon) {
    throw new Error("Choose a current Salon before managing customers.");
  }

  return context.currentSalon;
}

export async function getCurrentSalonCustomers(search?: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, customers: [] };
  }

  await requirePermission(CUSTOMER_PERMISSIONS.view, context);

  const salon = requireCurrentSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const trimmedSearch = search?.trim();
  let query = supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("location_id", salon.id)
    .order("created_at", { ascending: false });

  if (trimmedSearch) {
    const escapedSearch = trimmedSearch.replaceAll("%", "\\%").replaceAll("_", "\\_");
    query = query.or(`name.ilike.%${escapedSearch}%,phone.ilike.%${escapedSearch}%`);
  }

  const { data, error } = await query.returns<Customer[]>();

  if (error) {
    console.error("Supabase load customers failed", {
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

  return { context, customers: data ?? [] };
}

export async function getCurrentSalonCustomer(customerId: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, customer: null };
  }

  await requirePermission(CUSTOMER_PERMISSIONS.view, context);

  const salon = requireCurrentSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("id", customerId)
    .eq("location_id", salon.id)
    .maybeSingle<Customer>();

  if (error) {
    console.error("Supabase load customer failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      customerId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  return { context, customer: data ?? null };
}
