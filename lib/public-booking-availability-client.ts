import type { PublicBookingAvailabilityHint, PublicBookingAvailabilityScope, PublicBookingSlot, PublicBookingSlotRequest } from "@/lib/public-booking";

async function readAvailability<T>(input: { kind: "slots" | "hints"; salonId: string; selection: PublicBookingSlotRequest; scopes?: PublicBookingAvailabilityScope[] }, signal?:AbortSignal): Promise<T> {
  const response = await fetch("/api/public-booking/availability", {
    method: "POST", signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Availability could not be loaded.");
  return response.json() as Promise<T>;
}

export function loadPublicBookingSlotsAction(input: { salonId: string; selection: PublicBookingSlotRequest }, signal?:AbortSignal) {
  return readAvailability<PublicBookingSlot[]>({ ...input, kind: "slots" },signal);
}

export function loadPublicBookingAvailabilityHintsAction(input: { salonId: string; selection: PublicBookingSlotRequest; scopes: PublicBookingAvailabilityScope[] }, signal?:AbortSignal) {
  return readAvailability<PublicBookingAvailabilityHint[]>({ ...input, kind: "hints" },signal);
}
