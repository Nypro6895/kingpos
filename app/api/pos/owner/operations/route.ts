import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import { after, NextRequest, NextResponse } from "next/server";
import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null,{status:403});
  const context = await getCurrentBusinessContext();
  if (!context.user || !context.currentSalon || !isSalonManageContext(context)) return new NextResponse(null,{status:401});
  const text = await request.text(); if (text.length>128000) return new NextResponse(null,{status:413});
  let input; try { input=JSON.parse(text); } catch { return new NextResponse(null,{status:400}); }
  if (input.kind!=="receipt" || input.scope!==`owner:${context.currentSalon.id}:${context.user.id}` || !/^[a-f0-9-]{36}$/i.test(input.id??"") || !Number.isFinite(Date.parse(input.occurredAt)) || !input.payload || typeof input.payload!=="object") return new NextResponse(null,{status:400});
  const supabase=await createAuthenticatedSupabaseServerClient();
  if (!supabase) return new NextResponse(null,{status:503});
  const {data,error}=await supabase.rpc("replay_pos_owner_operation",{p_salon:context.currentSalon.id,p_operation_id:input.id,p_occurred_at:input.occurredAt,p_payload:input.payload});
  if (error) return NextResponse.json(error.code==="P0001" ? {kind:"blocked",message:error.message,rejected:true} : {kind:"retry"});
  // Also notify clients which predate the database workspace broadcasts.
  after(() => broadcastPosStaffChange(context.currentSalon!.id, "pos"));
  return NextResponse.json({kind:"ok",data},{headers:{"Cache-Control":"no-store"}});
}
