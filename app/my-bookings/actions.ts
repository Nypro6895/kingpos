"use server";

import {
  claimGuestBooking,
  loadCustomerRescheduleSlots,
  requestCancelCustomerBooking,
  requestRescheduleCustomerBooking,
} from "@/lib/customer-bookings";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function resultParams(result: { code?: string; message: string; ok: boolean }) {
  const params = new URLSearchParams();
  params.set(result.ok ? "message" : "error", result.message);

  if (result.code) {
    params.set("code", result.code);
  }

  return params.toString();
}

function detailResultHref(
  bookingId: string,
  result: { code?: string; message: string; ok: boolean },
) {
  return `/my-bookings/${bookingId}?${resultParams(result)}`;
}

function parseDateTimeInput(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export async function loadCustomerRescheduleSlotsAction(input: {
  bookingId: string;
  date?: string | null;
}) {
  return loadCustomerRescheduleSlots(input);
}

export async function cancelCustomerBookingAction(input: {
  bookingId: string;
  reason?: string | null;
}) {
  const bookingId = input.bookingId.trim();

  if (!isUuid(bookingId)) {
    return {
      code: "not_found",
      message: "Booking was not found.",
      ok: false,
    };
  }

  const result = await requestCancelCustomerBooking({
    bookingId,
    reason: input.reason,
  });

  revalidatePath("/my-bookings");
  revalidatePath(`/my-bookings/${bookingId}`);

  return result;
}

export async function rescheduleCustomerBookingAction(input: {
  bookingId: string;
  startAt?: string | null;
}) {
  const bookingId = input.bookingId.trim();

  if (!isUuid(bookingId)) {
    return {
      code: "not_found",
      message: "Booking was not found.",
      ok: false,
    };
  }

  const result = await requestRescheduleCustomerBooking({
    bookingId,
    startAt: input.startAt,
  });
  const targetBookingId = result.bookingId ?? bookingId;

  revalidatePath("/my-bookings");
  revalidatePath(`/my-bookings/${targetBookingId}`);

  return result;
}

export async function cancelCustomerBookingFormAction(formData: FormData) {
  const bookingId = readString(formData, "booking_id");

  if (!isUuid(bookingId)) {
    redirect("/my-bookings?error=Booking%20was%20not%20found.");
  }

  const result = await requestCancelCustomerBooking({
    bookingId,
    reason: readString(formData, "reason"),
  });

  revalidatePath("/my-bookings");
  revalidatePath(`/my-bookings/${bookingId}`);
  redirect(detailResultHref(bookingId, result));
}

export async function rescheduleCustomerBookingFormAction(formData: FormData) {
  const bookingId = readString(formData, "booking_id");

  if (!isUuid(bookingId)) {
    redirect("/my-bookings?error=Booking%20was%20not%20found.");
  }

  const result = await requestRescheduleCustomerBooking({
    bookingId,
    startAt: parseDateTimeInput(readString(formData, "start_at")),
  });
  const targetBookingId = result.bookingId ?? bookingId;

  revalidatePath("/my-bookings");
  revalidatePath(`/my-bookings/${targetBookingId}`);
  redirect(detailResultHref(targetBookingId, result));
}

export async function claimGuestBookingFormAction(formData: FormData) {
  const token = readString(formData, "token");
  const result = await claimGuestBooking({ token });

  revalidatePath("/my-bookings");

  if (result.ok && result.bookingId) {
    revalidatePath(`/my-bookings/${result.bookingId}`);
    redirect(detailResultHref(result.bookingId, result));
  }

  redirect(`/my-bookings?${resultParams(result)}`);
}
