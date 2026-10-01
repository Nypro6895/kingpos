import { NextRequest, NextResponse } from "next/server";
import { portableSyncDraftOperation } from "@/app/pos/portable/actions";

export async function POST(request: NextRequest) {
  // Cookie authentication requires an explicit same-origin check on this route.
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ kind: "blocked", message: "Invalid request origin." }, { status: 403 });
  }
  const text = await request.text();
  if (text.length > 128_000) return new NextResponse(null, { status: 413 });
  let input;
  try { input = JSON.parse(text); } catch { return new NextResponse(null, { status: 400 }); }
  const payload = input?.payload;
  if (!input || typeof input.token !== "string" || input.token.length > 256 ||
      !/^[0-9a-f-]{36}$/i.test(input.id ?? "") ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 ||
      !payload || !Array.isArray(payload.staffLines) || payload.staffLines.length > 200 ||
      !["subtotal", "tip", "total", "discount", "tax", "totalBeforeTip"].every(
        (key) => typeof payload[key] === "number" && Number.isFinite(payload[key]) && payload[key] >= 0
      )) return new NextResponse(null, { status: 400 });
  const result = await portableSyncDraftOperation(input);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
