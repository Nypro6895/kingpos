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

function firstValue<T>(values: T[]) {
  return values.find((value) => Boolean(value)) ?? null;
}

function mergeNotes(primary: string | null, values: Array<string | null>) {
  const uniqueNotes = uniqueStrings([primary, ...values]).filter(
    (note, index, all) => all.indexOf(note) === index,
  );

  return uniqueNotes.length > 0 ? uniqueNotes.join("\n\nMerged duplicate note:\n") : null;
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
      accountId: context.currentAccount?.id,
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
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithError(editPath, error.message);
  }

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
  const { supabase, user, salon } = await requireCustomerMutationContext(errorPath);

  if (!targetCustomerId) {
    redirectWithError("/customers", "Choose the customer record to keep.");
  }

  if (sourceCustomerIds.length === 0) {
    redirectWithError(errorPath, "Choose at least one duplicate to merge.");
  }

  const allCustomerIds = [targetCustomerId, ...sourceCustomerIds];
  const { data: selectedCustomers, error: selectedError } = await supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("location_id", salon.id)
    .in("id", allCustomerIds)
    .returns<Customer[]>();

  if (selectedError) {
    redirectWithError(errorPath, selectedError.message);
  }

  const targetCustomer = (selectedCustomers ?? []).find(
    (customer) => customer.id === targetCustomerId,
  );
  const sourceCustomers = (selectedCustomers ?? []).filter((customer) =>
    sourceCustomerIds.includes(customer.id),
  );

  if (!targetCustomer || sourceCustomers.length !== sourceCustomerIds.length) {
    redirectWithError(errorPath, "Only customers from the current salon can be merged.");
  }

  const linkedUserIds = uniqueStrings(
    [targetCustomer, ...sourceCustomers].map((customer) => customer.customer_user_id),
  );

  if (linkedUserIds.length > 1) {
    redirectWithError(
      errorPath,
      "These customers are linked to different personal accounts and cannot be merged safely.",
    );
  }

  const mergedCustomerUserId = linkedUserIds[0] ?? null;
  const mergedStatus =
    [targetCustomer, ...sourceCustomers].some((customer) => customer.status === "active")
      ? "active"
      : "inactive";
  const targetUpdate = {
    customer_user_id: mergedCustomerUserId,
    email: targetCustomer.email ?? firstValue(sourceCustomers.map((customer) => customer.email)),
    internal_notes: mergeNotes(
      targetCustomer.internal_notes,
      sourceCustomers.map((customer) => customer.internal_notes),
    ),
    notes: mergeNotes(
      targetCustomer.notes,
      sourceCustomers.map((customer) => customer.notes),
    ),
    phone: targetCustomer.phone ?? firstValue(sourceCustomers.map((customer) => customer.phone)),
    staff_notes: mergeNotes(
      targetCustomer.staff_notes,
      sourceCustomers.map((customer) => customer.staff_notes),
    ),
    status: mergedStatus,
    updated_by_user_id: user.id,
  };

  const { error: targetUpdateError } = await supabase
    .from("customers")
    .update(targetUpdate)
    .eq("id", targetCustomerId)
    .eq("location_id", salon.id);

  if (targetUpdateError) {
    redirectWithError(errorPath, targetUpdateError.message);
  }

  const bookingUpdate: Record<string, string | null> = {
    customer_id: targetCustomerId,
    customer_user_id: mergedCustomerUserId,
    updated_by_user_id: user.id,
  };
  const { error: bookingsError } = await supabase
    .from("bookings")
    .update(bookingUpdate)
    .eq("salon_id", salon.id)
    .in("customer_id", sourceCustomerIds);

  if (bookingsError) {
    redirectWithError(errorPath, bookingsError.message);
  }

  const { error: ticketsError } = await supabase
    .from("pos_tickets")
    .update({ customer_id: targetCustomerId })
    .eq("salon_id", salon.id)
    .in("customer_id", sourceCustomerIds);

  if (ticketsError) {
    redirectWithError(errorPath, ticketsError.message);
  }

  const { error: sessionsError } = await supabase
    .from("pos_desk_sessions")
    .update({ customer_id: targetCustomerId })
    .eq("salon_id", salon.id)
    .in("customer_id", sourceCustomerIds);

  if (sessionsError) {
    redirectWithError(errorPath, sessionsError.message);
  }

  const { error: deleteError } = await supabase
    .from("customers")
    .delete()
    .eq("location_id", salon.id)
    .in("id", sourceCustomerIds);

  if (deleteError) {
    redirectWithError(errorPath, deleteError.message);
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${targetCustomerId}`);
  revalidatePath("/bookings");
  revalidatePath("/pos-tickets");
  redirect(`/customers/${targetCustomerId}?merged=${sourceCustomerIds.length}`);
}
