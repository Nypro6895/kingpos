"use server";

import {
  normalizeBookingEmail,
  normalizeBookingPhone,
} from "@/lib/booking-domain/customer-identity";
import { CUSTOMER_PERMISSIONS, CUSTOMER_SELECT } from "@/lib/customers";
import {
  getCurrentBusinessContext,
  getRouteForInvalidSalonContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { Customer, CustomerStatus } from "@/types/customer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readRequiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readOptionalString(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);
  return value || null;
}

function readStatus(formData: FormData): CustomerStatus {
  return readRequiredString(formData, "status") === "inactive" ? "inactive" : "active";
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function requireCustomerMutationContext(errorPath: string) {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!isSalonManageContext(context)) {
    redirect(getRouteForInvalidSalonContext(context));
  }

  if (!context.currentOrganization || !context.currentMembership) {
    redirectWithError(errorPath, "Create an organization before managing customers.");
  }

  if (!context.currentSalon) {
    redirectWithError(errorPath, "Choose a current Salon before managing customers.");
  }

  const user = context.user;
  const salon = context.currentSalon;

  try {
    await requirePermission(CUSTOMER_PERMISSIONS.manage, context);
  } catch {
    redirectWithError(errorPath, "You do not have permission to manage customers.");
  }

  return { supabase, context, user, salon };
}

export async function createCustomer(formData: FormData) {
  const { supabase, context, user, salon } = await requireCustomerMutationContext(
    "/customers/new",
  );
  const name = readRequiredString(formData, "name");

  if (!name) {
    redirectWithError("/customers/new", "Customer name is required.");
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({
      location_id: salon.id,
      name,
      phone: normalizeBookingPhone(readOptionalString(formData, "phone")),
      email: normalizeBookingEmail(readOptionalString(formData, "email")),
      notes: readOptionalString(formData, "notes"),
      staff_notes: readOptionalString(formData, "staff_notes"),
      internal_notes: readOptionalString(formData, "internal_notes"),
      source: "manual",
      status: "active",
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select(CUSTOMER_SELECT)
    .single<Customer>();

  if (error) {
    console.error("Supabase create customer failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError("/customers/new", error.message);
  }

  revalidatePath("/customers");
  redirect(`/customers/${data.id}`);
}

export async function updateCustomer(formData: FormData) {
  const customerId = readRequiredString(formData, "customer_id");
  const editPath = customerId ? `/customers/${customerId}/edit` : "/customers";
  const { supabase, context, user, salon } =
    await requireCustomerMutationContext(editPath);
  const name = readRequiredString(formData, "name");

  if (!customerId) {
    redirectWithError("/customers", "Customer id is required.");
  }

  if (!name) {
    redirectWithError(editPath, "Customer name is required.");
  }

  const { error } = await supabase
    .from("customers")
    .update({
      name,
      phone: normalizeBookingPhone(readOptionalString(formData, "phone")),
      email: normalizeBookingEmail(readOptionalString(formData, "email")),
      notes: readOptionalString(formData, "notes"),
      staff_notes: readOptionalString(formData, "staff_notes"),
      internal_notes: readOptionalString(formData, "internal_notes"),
      status: readStatus(formData),
      updated_by_user_id: user.id,
    })
    .eq("id", customerId)
    .eq("location_id", salon.id);

  if (error) {
    console.error("Supabase update customer failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      customerId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(editPath, error.message);
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}
