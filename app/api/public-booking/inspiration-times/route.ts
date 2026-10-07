import { loadPublicContentBookingOptions } from "@/lib/content-booking";
import { loadPublicBookingAvailabilityHints, type PublicBookingAvailabilityScope } from "@/lib/public-booking";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const raw = await request.text();
    if (raw.length > 5000) return Response.json([], { status: 400, headers });
    const input = JSON.parse(raw) as {salonId:string; contentIds:string[]};
    if (!input || !uuid.test(input.salonId ?? "") || !Array.isArray(input.contentIds) || input.contentIds.length > 12 || input.contentIds.some(id => typeof id !== "string" || !uuid.test(id))) return Response.json([], { status: 400, headers });
    const wanted = new Set(input.contentIds);
    const options = await loadPublicContentBookingOptions([input.salonId]);
    const scopes: PublicBookingAvailabilityScope[] = options.filter(option => wanted.has(option.contentId) && option.bookingEnabled && option.bookingCtaEnabled && option.readinessState === "quick_ready" && option.primaryServiceId && option.creditedStaffId && option.additionalServices.every(service => service.eligible) && option.addOns.every(service => service.eligible && service.parentServiceId)).map(option => ({
      key: option.contentId,
      serviceIds: [option.primaryServiceId!, ...option.additionalServices.filter(service => service.eligible).map(service => service.serviceId)],
      addOnSelections: option.addOns.filter(service => service.eligible && service.parentServiceId).map(service => ({ parentServiceId: service.parentServiceId!, serviceId: service.serviceId })),
      staffId: option.creditedStaffId,
      staffMode: "specific",
    }));
    return Response.json(scopes.length ? await loadPublicBookingAvailabilityHints({salonId:input.salonId,scopes,selection:{}}) : [], {headers});
  } catch { return Response.json([], { status: 503, headers }); }
}
