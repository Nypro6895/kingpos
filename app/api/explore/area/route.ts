import { NextRequest, NextResponse } from "next/server";
import { resolveExploreGpsArea } from "@/lib/location/explore-gps-area";


export async function POST(request: NextRequest) {
  // GPS input and the response are never edge/browser-cache entries.
  const headers = { "Cache-Control": "private, no-store" };
  try {
    if (Number(request.headers.get("content-length")) > 1024) throw new Error("Too large");
    const body = await request.text();
    if (body.length > 1024) throw new Error("Too large");
    const result = await resolveExploreGpsArea(JSON.parse(body), request.signal);
    if (result.errorKind === "cancelled") return new NextResponse(null, { status: 499, headers });
    return NextResponse.json(result, {
      status: result.errorKind === "invalid" ? 400 : result.errorKind === "rate_limited" ? 429 : 200,
      headers,
    });
  } catch {
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    return NextResponse.json({ area: null, error: "Invalid area lookup request.", errorKind: "invalid" }, { status: 400, headers });
  }
}
