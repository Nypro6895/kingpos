"use server";

import {
  normalizeBookingEmail,
  normalizeBookingPhone,
} from "@/lib/booking-domain/customer-identity";
import { CUSTOMER_PERMISSIONS } from "@/lib/customers";
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

function readStringList(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function readStatus(formData: FormData): CustomerStatus {
  return readRequiredString(formData, "status") === "inactive" ? "inactive" : "active";
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

  if (!context.currentAccount || !context.currentMembership) {
    redirectWithError(errorPath, "Choose a salon workspace before managing customers.");
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

  const { data, error } = await supabase.rpc("create_salon_customer_identity", {
    p_salon: salon.id, p_input: Object.fromEntries(["name", "phone", "email", "notes", "staff_notes", "internal_notes", "existing_customer_id", "create_separate"].map(key => [key, readOptionalString(formData, key)])),
  });

  if (error) {
    console.error("Supabase create customer failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithError("/customers/new", error.message);
  }

  revalidatePath("/customers");
  redirect(`/customers/${data}`);
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
  if (readOptionalString(formData, "phone") && !normalizeBookingPhone(readOptionalString(formData, "phone"))) {
    redirectWithError(editPath, "Enter a full phone number or leave phone blank.");
  }

  const { data: updatedCustomer, error } = await supabase
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
    .eq("location_id", salon.id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("Supabase update customer failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      customerId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithError(editPath, error.message);
  }

  if (!updatedCustomer) redirectWithError(editPath, "This customer was merged or changed. Reload the profile before editing.");

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}

export async function mergeDuplicateCustomers(formData: FormData) {
  const targetCustomerId = readRequiredString(formData, "target_customer_id");
  const sourceCustomerIds = uniqueStrings(
    readStringList(formData, "source_customer_id"),
  ).filter((customerId) => customerId !== targetCustomerId);
  const errorPath = targetCustomerId ? `/customers/${targetCustomerId}` : "/customers";
  const { supabase, salon } = await requireCustomerMutationContext(errorPath);

  if (!targetCustomerId) {
    redirectWithError("/customers", "Choose the customer record to keep.");
  }

  if (sourceCustomerIds.length === 0) {
    redirectWithError(errorPath, "Choose at least one duplicate to merge.");
  }

  const mergeAll = readRequiredString(formData, "merge_mode") === "all";
  const { data, error } = await supabase.rpc(
    mergeAll ? "merge_customer_suggestions" : "merge_customer_records",
    { p_salon: salon.id, p_target: targetCustomerId, p_sources: sourceCustomerIds,
      ...(mergeAll ? {} : { p_reason: "manual" }) },
  );
  if (error) redirectWithError(errorPath, error.message);
  for (const path of ["/customers", "/bookings", "/pos-tickets", "/pos", "/pos/portable", "/staff/today", "/activity", "/beauty", ...[targetCustomerId, ...sourceCustomerIds].map(id => `/customers/${id}`)]) revalidatePath(path);
  const merged = Number(data?.merged ?? 0);
  const skipped = Array.isArray(data?.skipped) ? data.skipped.length : 0;
  redirect(`/customers/${targetCustomerId}?merged=${merged}&skipped=${skipped}`);
}

export async function searchCustomerMatches(input: { name: string; phone: string; email?: string }) {
  const { supabase, salon } = await requireCustomerMutationContext("/customers");
  const { data, error } = await supabase.rpc("find_customer_identity_matches", {
    p_salon: salon.id, p_name: input.name.slice(0,100), p_phone: input.phone.slice(0,30), p_email: input.email?.slice(0,200) ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Customer & { match: { automatic: boolean; score: number; reason: string } }>;
}

export async function searchCustomersForMerge(input: { name: string; phone: string; targetId: string }) {
  const { supabase, salon } = await requireCustomerMutationContext("/customers");
  const query = (input.phone.trim() || input.name.trim()).slice(0, 150);
  if (query.length < 2) return [];
  const { data, error } = await supabase.rpc("search_salon_customers", {
    p_salon_id: salon.id, p_query: query, p_limit: 20, p_offset: 0, p_status: null,
  });
  if (error) throw new Error(error.message);
  const customers = ((data ?? []) as Customer[]).filter(customer => customer.id !== input.targetId);
  if (!customers.length) return [];
  const { data: plan, error: planError } = await supabase.rpc("customer_merge_plan", {
    p_salon: salon.id, p_target: input.targetId, p_sources: customers.map(customer => customer.id),
  });
  if (planError) throw new Error(planError.message);
  const blocked = new Map((plan as Array<{ id: string; blockedReason: string | null }>).map(item => [item.id, item.blockedReason]));
  return customers.map(customer => ({ ...customer, mergeBlockedReason: blocked.get(customer.id), match: { automatic: false, score: 0, reason: "Review identity before merging" } }));
}

export async function consolidateCustomers() {
  const { supabase, salon } = await requireCustomerMutationContext("/customers");
  const { data, error } = await supabase.rpc("consolidate_customer_identities", { p_salon: salon.id });
  if (error) redirectWithError("/customers", error.message);
  for (const path of ["/customers", "/bookings", "/pos", "/pos/portable", "/pos-tickets", "/activity", "/beauty"]) revalidatePath(path);
  redirect(`/customers?merged=${Number(data ?? 0)}`);
}

export async function automaticallyConsolidateCustomers() {
  const { supabase, salon } = await requireCustomerMutationContext("/customers");
  const { data, error } = await supabase.rpc("consolidate_customer_identities", { p_salon: salon.id });
  if (error) return { merged: 0, error: "Automatic customer merge could not finish. Please retry." };
  const merged = Number(data ?? 0);
  if (merged > 0) {
    for (const path of ["/customers", "/bookings", "/pos", "/pos/portable", "/pos-tickets", "/staff/today", "/activity", "/beauty"]) revalidatePath(path);
  }
  return { merged, error: null };
}
