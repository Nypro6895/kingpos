import { createPublicBooking, type PublicBookingCreateInput } from "@/lib/public-booking";
import { revalidatePath } from "next/cache";

const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  const started = performance.now();
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  let sameOrigin = false;
  try { sameOrigin = Boolean(origin && new URL(origin).host === host); } catch { /* Reject malformed origins. */ }
  if (!sameOrigin) return Response.json({ ok: false, message: "Invalid request." }, { status: 403, headers });
  try {
    const raw = await request.text();
    if (raw.length > 32768) return Response.json({ ok: false, message: "Request too large." }, { status: 413, headers });
    const input = JSON.parse(raw) as PublicBookingCreateInput;
    if (input?.expectedAccountId != null && (typeof input.expectedAccountId !== "string" || !uuid.test(input.expectedAccountId))) throw new SyntaxError();
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.salonId !== "string" || !uuid.test(input.salonId)) throw new SyntaxError();
    for (const value of [input.customerEmail, input.customerFirstName, input.customerLastName, input.customerPhone, input.honeypot, input.idempotencyKey, input.inspirationId, input.lookId, input.publicNotes, input.serviceId, input.staffId, input.startAt, input.date, input.source, input.sourceReferenceType, input.staffMode]) {
      if (value != null && (typeof value !== "string" || value.length > 4000)) throw new SyntaxError();
    }
    for (const values of [input.serviceIds, input.lineStaffIds, input.addOnServiceIds]) {
      if (values != null && (!Array.isArray(values) || values.length > 80 || values.some(value => typeof value !== "string" || value.length > 100))) throw new SyntaxError();
    }
    if (input.addOnSelections != null && (!Array.isArray(input.addOnSelections) || input.addOnSelections.length > 6 || input.addOnSelections.some(item => !item || typeof item.parentServiceId !== "string" || !uuid.test(item.parentServiceId) || typeof item.serviceId !== "string" || !uuid.test(item.serviceId)))) throw new SyntaxError();
    const result = await createPublicBooking(input);
    if (result.ok) {
      for (const path of [`/book/${input.salonId}`, "/bookings", "/my-bookings", "/notifications"]) revalidatePath(path);
      if (result.bookingId) revalidatePath(`/my-bookings/${result.bookingId}`);
    }
    return Response.json(result, { headers: { ...headers, "Server-Timing": `booking;dur=${(performance.now() - started).toFixed(1)}` } });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof SyntaxError ? "Invalid request." : "Booking could not be submitted. Please try again." }, { status: error instanceof SyntaxError ? 400 : 503, headers });
  }
}
