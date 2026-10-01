import { NextResponse } from "next/server";

// No session or business data: only verifies the application server is reachable.
export function GET() {
  return NextResponse.json({ available: true }, { headers: { "Cache-Control": "no-store" } });
}
