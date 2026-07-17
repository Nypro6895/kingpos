"use server";

import {
  cancelGuestBooking,
  createPublicBooking,
  loadGuestManageSlots,
  loadPublicBookingSlots,
  rescheduleGuestBooking,
  type PublicBookingActionResult,
  type PublicBookingCreateInput,
  type PublicBookingSlot,
  type PublicBookingSlotRequest,
} from "@/lib/public-booking";
import { revalidatePath } from "next/cache";

export async function loadPublicBookingSlotsAction(input: {
  salonId: string;
  selection: PublicBookingSlotRequest;
}): Promise<PublicBookingSlot[]> {
  return loadPublicBookingSlots(input);
}

export async function createPublicBookingAction(
  input: PublicBookingCreateInput,
): Promise<PublicBookingActionResult> {
  const result = await createPublicBooking(input);

  if (result.ok) {
    revalidatePath(`/book/${input.salonId}`);
  }

  return result;
}

export async function loadGuestManageSlotsAction(input: {
  date?: string | null;
  token: string;
}): Promise<PublicBookingSlot[]> {
  return loadGuestManageSlots(input);
}

export async function rescheduleGuestBookingAction(input: {
  startAt?: string | null;
  token: string;
}): Promise<PublicBookingActionResult> {
  const result = await rescheduleGuestBooking(input);

  if (result.ok) {
    revalidatePath(`/booking/manage/${input.token}`);
  }

  return result;
}

export async function cancelGuestBookingAction(input: {
  reason?: string | null;
  token: string;
}): Promise<PublicBookingActionResult> {
  const result = await cancelGuestBooking(input);

  if (result.ok) {
    revalidatePath(`/booking/manage/${input.token}`);
  }

  return result;
}
