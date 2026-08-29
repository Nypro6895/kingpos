"use server";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

type RpcActionPayload = { code?: string; message?: string; ok?: boolean } | null;

function readRpcPayload(data: unknown) {
  return data as RpcActionPayload;
}

function logRejected(action: string, payload: RpcActionPayload) {
  console.error(`${action} rejected`, {
    code: payload?.code,
    message: payload?.message,
  });
}

export async function startStaffAppointmentLineAction(formData: FormData) {
  const lineId = readString(formData, "booking_line_id");
  const note = readString(formData, "service_note");

  if (!lineId) {
    return;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { data, error } = await supabase.rpc("start_assigned_booking_line", {
    p_booking_line_id: lineId,
    p_service_note: note || null,
  });

  if (error) {
    console.error("Start staff appointment line failed", { message: error.message });
    return;
  }

  const payload = readRpcPayload(data);

  if (!payload?.ok) {
    logRejected("Start staff appointment line", payload);
    return;
  }

  revalidatePath("/staff/appointments");
  revalidatePath("/bookings");
}

export async function completeStaffAppointmentLineAction(formData: FormData) {
  const lineId = readString(formData, "booking_line_id");
  const note = readString(formData, "service_note");

  if (!lineId) {
    return;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { data, error } = await supabase.rpc("complete_assigned_booking_line", {
    p_booking_line_id: lineId,
    p_service_note: note || null,
  });

  if (error) {
    console.error("Complete staff appointment line failed", { message: error.message });
    return;
  }

  const payload = readRpcPayload(data);

  if (!payload?.ok) {
    logRejected("Complete staff appointment line", payload);
    return;
  }

  revalidatePath("/staff/appointments");
  revalidatePath("/bookings");
}

export async function confirmStaffBookingAction(formData: FormData) {
  const bookingId = readString(formData, "booking_id");

  if (!bookingId) {
    return;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { data, error } = await supabase.rpc("confirm_assigned_booking", {
    p_booking_id: bookingId,
  });

  if (error) {
    console.error("Confirm staff booking failed", { message: error.message });
    return;
  }

  const payload = readRpcPayload(data);

  if (!payload?.ok) {
    logRejected("Confirm staff booking", payload);
    return;
  }

  revalidatePath("/", "layout");
  revalidatePath("/staff/appointments");
  revalidatePath("/bookings");
  revalidatePath("/my-bookings");
  revalidatePath(`/my-bookings/${bookingId}`);
  revalidatePath("/notifications");
}
