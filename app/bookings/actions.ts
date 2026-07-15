"use server";

import { BOOKING_PERMISSIONS, BOOKING_SELECT } from "@/lib/bookings";
import {
  getCurrentBusinessContext,
  getRouteForInvalidSalonContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { BookingStatus } from "@/types/booking";
import { BOOKING_STATUSES } from "@/types/booking";
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

function redirectWithError(message: string, editId?: string): never {
  const params = new URLSearchParams({ error: message });

  if (editId) {
    params.set("edit", editId);
  }

  redirect(`/bookings?${params.toString()}`);
}

function readStatus(formData: FormData): BookingStatus {
  const status = readRequiredString(formData, "status");

  if (BOOKING_STATUSES.includes(status as BookingStatus)) {
    return status as BookingStatus;
  }

  return "scheduled";
}

function readDateTime(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);

  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

async function requireBookingMutationContext(editId?: string) {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!isSalonManageContext(context)) {
    redirect(getRouteForInvalidSalonContext(context));
  }

  if (!context.currentOrganization) {
    redirectWithError("Create an organization before managing bookings.", editId);
  }

  if (!context.currentSalon) {
    redirectWithError("Please select a salon first.", editId);
  }

  try {
    await requirePermission(BOOKING_PERMISSIONS.manage, context);
  } catch {
    redirectWithError("You do not have permission to manage bookings.", editId);
  }

  return {
    supabase,
    context,
    organization: context.currentOrganization,
    salon: context.currentSalon,
    user: context.user,
  };
}

async function validateBookingRelationships({
  customerId,
  staffId,
  editId,
}: {
  customerId: string;
  staffId: string | null;
  editId?: string;
}) {
  const { supabase, salon } = await requireBookingMutationContext(editId);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("location_id", salon.id)
    .maybeSingle<{ id: string }>();

  if (customerError || !customer) {
    redirectWithError("Customer is required.", editId);
  }

  if (!staffId) {
    return;
  }

  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("id")
    .eq("id", staffId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string }>();

  if (staffError || !staff) {
    redirectWithError("Assigned Staff must belong to the current salon.", editId);
  }
}

function validateBookingInput(formData: FormData, editId?: string) {
  const customerId = readRequiredString(formData, "customer_id");
  const staffId = readOptionalString(formData, "staff_id");
  const startAt = readDateTime(formData, "start_at");
  const endAt = readDateTime(formData, "end_at");

  if (!customerId) {
    redirectWithError("Customer is required.", editId);
  }

  if (!startAt) {
    redirectWithError("start_at is required.", editId);
  }

  if (!endAt) {
    redirectWithError("end_at is required.", editId);
  }

  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    redirectWithError("end_at must be later than start_at.", editId);
  }

  return {
    customerId,
    staffId,
    startAt,
    endAt,
    notes: readOptionalString(formData, "notes"),
    status: readStatus(formData),
  };
}

export async function createBooking(formData: FormData) {
  const { supabase, context, organization, salon, user } =
    await requireBookingMutationContext();
  const input = validateBookingInput(formData);

  await validateBookingRelationships({
    customerId: input.customerId,
    staffId: input.staffId,
  });

  const { error } = await supabase
    .from("bookings")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      customer_id: input.customerId,
      staff_id: input.staffId,
      start_at: input.startAt,
      end_at: input.endAt,
      notes: input.notes,
      status: "scheduled",
    })
    .select(BOOKING_SELECT)
    .single();

  if (error) {
    console.error("Supabase create booking failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message);
  }

  revalidatePath("/bookings");
  redirect("/bookings");
}

export async function updateBooking(formData: FormData) {
  const bookingId = readRequiredString(formData, "booking_id");

  if (!bookingId) {
    redirectWithError("Booking id is required.");
  }

  const { supabase, context, salon, user } =
    await requireBookingMutationContext(bookingId);
  const input = validateBookingInput(formData, bookingId);

  await validateBookingRelationships({
    customerId: input.customerId,
    staffId: input.staffId,
    editId: bookingId,
  });

  const { error } = await supabase
    .from("bookings")
    .update({
      customer_id: input.customerId,
      staff_id: input.staffId,
      start_at: input.startAt,
      end_at: input.endAt,
      notes: input.notes,
      status: input.status,
    })
    .eq("id", bookingId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update booking failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      bookingId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, bookingId);
  }

  revalidatePath("/bookings");
  redirect("/bookings");
}

export async function cancelBooking(formData: FormData) {
  const bookingId = readRequiredString(formData, "booking_id");

  if (!bookingId) {
    redirectWithError("Booking id is required.");
  }

  const { supabase, context, salon, user } =
    await requireBookingMutationContext(bookingId);

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase cancel booking failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      bookingId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, bookingId);
  }

  revalidatePath("/bookings");
  redirect("/bookings");
}
