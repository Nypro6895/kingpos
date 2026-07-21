"use server";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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

  const payload = data as { code?: string; message?: string; ok?: boolean } | null;

  if (!payload?.ok) {
    console.error("Start staff appointment line rejected", {
      code: payload?.code,
      message: payload?.message,
    });
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

  const payload = data as { code?: string; message?: string; ok?: boolean } | null;

  if (!payload?.ok) {
    console.error("Complete staff appointment line rejected", {
      code: payload?.code,
      message: payload?.message,
    });
    return;
  }

  revalidatePath("/staff/appointments");
  revalidatePath("/bookings");
}
