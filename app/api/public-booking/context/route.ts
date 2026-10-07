import { getPublicBookingPageData, type PublicBookingSearchParams } from "@/lib/public-booking";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const salonId = url.searchParams.get("salonId") ?? "";
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(salonId)) return Response.json({ message: "Invalid salon." }, { status: 400, headers });
  const params: PublicBookingSearchParams = {};
  for (const key of ["inspiration", "lookId", "serviceId", "staffId", "date", "startAt", "source"] as const) {
    const value = url.searchParams.get(key);
    if (value && value.length <= 200) params[key] = value;
  }
  const started = performance.now();
  try { return Response.json(await getPublicBookingPageData(salonId, params, { deferAvailability: !params.startAt, resolveKnownAvailability: Boolean(params.inspiration || params.lookId || (params.serviceId && params.staffId)) }), { headers: { ...headers, "Server-Timing": `context;dur=${(performance.now() - started).toFixed(1)}` } }); }
  catch { return Response.json({ message: "Times could not be loaded. Please try again." }, { status: 503, headers }); }
}
