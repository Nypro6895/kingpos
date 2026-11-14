import {NextRequest} from "next/server";
import {cookies} from "next/headers";
import {createAuthenticatedSupabaseServerClient,createSupabaseServerClient} from "@/lib/supabase/server";
import {getCurrentBusinessContext} from "@/lib/current-context";

const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","x-reylumi-experience-change":"none"};
export async function POST(request:NextRequest){
  const origin=request.headers.get("origin");
  if(origin&&origin!==request.nextUrl.origin||!request.headers.get("content-type")?.startsWith("application/json"))return Response.json({error:"Invalid request origin."},{status:403,headers});
  try{
    const raw=await request.text();if(raw.length>1024)throw new Error("Invalid gift receipt request.");
    const {ticketId,saleId}=JSON.parse(raw);const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(typeof ticketId!=="string"||typeof saleId!=="string"||!uuid.test(ticketId)||!uuid.test(saleId))throw new Error("Invalid gift receipt request.");
    const jar=await cookies(),key=jar.get("kingpos-portable-pos-key-id")?.value,signature=jar.get("kingpos-portable-pos-session")?.value;
    if(key&&signature&&jar.get("kingpos-portable-local-lock")?.value==="1")throw new Error("Unlock the POS to open this gift card.");
    const auth=await createAuthenticatedSupabaseServerClient(),anon=createSupabaseServerClient(),db=auth??anon;
    if(!db)throw new Error("Gift cards are temporarily unavailable.");
    let salon:string|undefined;
    if(key&&signature&&jar.get("kingpos-portable-local-lock")?.value!=="1"&&anon){
      const validated=await anon.rpc("get_pos_portable_access_context",{p_key_id:key,p_session_signature:signature});
      const row=Array.isArray(validated.data)?validated.data[0]:validated.data;salon=row?.salon_id;
    }
    if(!salon){const context=await getCurrentBusinessContext();salon=context.currentSalon?.id;}
    if(!salon)throw new Error("Select an active salon POS.");
    const result=await db.rpc("gift_card_ticket_delivery",{p_salon:salon,p_ticket:ticketId,p_sale:saleId,p_key:key||null,p_signature:signature||null});
    if(result.error)throw new Error(result.error.message);
    return Response.json(result.data,{headers});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Unable to open this gift card."},{status:400,headers});}
}
