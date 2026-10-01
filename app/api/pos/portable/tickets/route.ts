import { NextResponse } from "next/server";
import { getPortableTicketData } from "@/app/pos/portable/actions";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  try {
    const data = await getPortableTicketData(date ?? undefined);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load tickets" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
