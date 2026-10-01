import { NextRequest, NextResponse } from "next/server";
import { replayPortableOperation } from "@/app/pos/portable/actions";
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null,{status:403});
  const text = await request.text();
  if (text.length > 128000) return new NextResponse(null,{status:413});
  let input;
  try { input = JSON.parse(text); } catch { return new NextResponse(null,{status:400}); }
  if (!input || !["receipt","attendance","booking","visit"].includes(input.kind) || typeof input.scope !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(input.id ?? "") || !Number.isFinite(Date.parse(input.occurredAt)) ||
      !input.payload || typeof input.payload !== "object") return new NextResponse(null,{status:400});
  return NextResponse.json(await replayPortableOperation(input),{headers:{"Cache-Control":"no-store"}});
}
