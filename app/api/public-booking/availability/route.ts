import { loadPublicBookingAvailabilityHints, loadPublicBookingSlots, type PublicBookingSlotRequest, type PublicBookingAvailabilityScope } from "@/lib/public-booking";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function ids(value: unknown) { return value === undefined || Array.isArray(value) && value.length <= 80 && value.every(id => typeof id === "string" && (id === "" || uuid.test(id))); }
function selection(value: unknown): value is PublicBookingSlotRequest {
  if (!record(value)) return false;
  if (value.findEarliest !== undefined && typeof value.findEarliest !== "boolean") return false;
  if (value.date != null && (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date))) return false;
  if (value.staffMode != null && !["any", "specific", "split"].includes(String(value.staffMode))) return false;
  if ([value.serviceId, value.staffId].some(id => id != null && (typeof id !== "string" || id !== "" && !uuid.test(id)))) return false;
  if (![value.serviceIds, value.lineStaffIds, value.addOnServiceIds].every(ids)) return false;
  return value.addOnSelections === undefined || Array.isArray(value.addOnSelections) && value.addOnSelections.length <= 6 && value.addOnSelections.every(item => record(item) && typeof item.serviceId === "string" && uuid.test(item.serviceId) && typeof item.parentServiceId === "string" && uuid.test(item.parentServiceId));
}

// Read-only availability uses normal HTTP so hint requests cannot queue ahead of slot reads or booking submission.
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 32768) return Response.json({ error: "Request too large." }, { status: 413, headers });
    const body: unknown = JSON.parse(raw);
    if (!record(body) || typeof body.salonId !== "string" || !uuid.test(body.salonId) || !selection(body.selection)) return Response.json({ error: "Invalid selection." }, { status: 400, headers });
    if (body.kind === "slots") return Response.json(await loadPublicBookingSlots({ salonId: body.salonId, selection: body.selection }), { headers });
    if (body.kind !== "hints" || !Array.isArray(body.scopes) || body.scopes.length > 80) return Response.json({ error: "Invalid scopes." }, { status: 400, headers });
    const scopes: PublicBookingAvailabilityScope[] = [];
    for (const item of body.scopes) {
      if (!record(item) || typeof item.key !== "string" || item.key.length > 200) return Response.json({ error: "Invalid scope." }, { status: 400, headers });
      const key = item.key;
      if (!selection(item)) return Response.json({ error: "Invalid scope." }, { status: 400, headers });
      scopes.push({ key, staffMode: item.staffMode as PublicBookingAvailabilityScope["staffMode"], staffId: item.staffId as string | undefined, lineStaffIds: item.lineStaffIds as string[] | undefined });
    }
    return Response.json(await loadPublicBookingAvailabilityHints({ salonId: body.salonId, selection: body.selection, scopes }), { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid request." }, { status: 400, headers });
    return Response.json({ error: "Availability could not be loaded." }, { status: 503, headers });
  }
}
