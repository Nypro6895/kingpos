import { NextResponse } from "next/server";
import { getPortableOfflineStaffBundle } from "@/app/pos/portable/actions";
export async function GET() {
  try { return NextResponse.json(await getPortableOfflineStaffBundle(),{headers:{"Cache-Control":"no-store"}}); }
  catch { return NextResponse.json({error:"Unable to prepare check-in"},{status:503}); }
}
