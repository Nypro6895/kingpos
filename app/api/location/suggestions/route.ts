import { suggestAddresses } from "@/lib/location/address-suggestions";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    if (Number(request.headers.get("content-length")) > 1024) throw new Error("Invalid request");
    const raw = await request.text();
    if (raw.length > 1024) throw new Error("Invalid request");
    const body = JSON.parse(raw);
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (query.length < 3) return Response.json({ suggestions: [], available: true }, { headers });
    if (query.length > 200 || !["address", "area"].includes(body.mode)) throw new Error("Invalid request");
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    const result = await suggestAddresses({ query, mode: body.mode, country: typeof body.country === "string" ? body.country : undefined });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ suggestions: [], available: false }, { status: 400, headers });
  }
}
