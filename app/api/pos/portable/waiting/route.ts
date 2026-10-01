import { NextResponse } from "next/server";
import { portableGetWaitingQueue } from "@/app/pos/portable/actions";
export async function GET() {
  const result = await portableGetWaitingQueue();
  return NextResponse.json(result, { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
