import { isSameOriginMutation } from "@/lib/request-origin";
import { confirmBookingDepositTest } from "@/lib/booking-deposit";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, message: "Invalid request." }, { status: 403 });
  try {
    const raw = await request.text(); if (raw.length > 1024) throw new Error("Invalid test checkout.");
    const body = JSON.parse(raw); const result = await confirmBookingDepositTest(typeof body.token === "string" ? body.token : "");
    if (result.ok) { revalidatePath("/bookings"); revalidatePath("/my-bookings"); revalidatePath("/notifications"); }
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ ok: false, message: error instanceof Error ? error.message : "Test booking could not be submitted." }, { status: 400 }); }
}
