import type { PublicBookingCreateInput, PublicBookingActionResult } from "@/lib/public-booking";

export async function createPublicBookingAction(input: PublicBookingCreateInput): Promise<PublicBookingActionResult> {
  const response = await fetch("/api/public-booking/confirm", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Booking could not be submitted.");
  return response.json() as Promise<PublicBookingActionResult>;
}
