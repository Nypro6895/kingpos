import { NextResponse } from "next/server";
import { getPortableCheckInData } from "@/app/pos/portable/actions";
export async function GET(request: Request) {
  try { const data=await getPortableCheckInData(); const ids=new URL(request.url).searchParams.get("ids")?.split(",").slice(0,100); return NextResponse.json({...data,staff:ids?data.staff.filter(row=>ids.includes(row.id)):data.staff}, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Unable to refresh staff" }, { status: 503 }); }
}
