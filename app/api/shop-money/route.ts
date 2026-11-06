import {NextRequest} from "next/server";
import {getCurrentBusinessContext,isOwnerMembership} from "@/lib/current-context";
import {createAuthenticatedSupabaseServerClient} from "@/lib/supabase/server";
export async function POST(request:NextRequest){
 const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
 if(request.headers.get("origin")&&request.headers.get("origin")!==request.nextUrl.origin)return Response.json({error:"Invalid origin"},{status:403,headers});
 if(!request.headers.get("content-type")?.startsWith("application/json"))return Response.json({error:"JSON required"},{status:400,headers});
 try{
  const raw=await request.text();if(raw.length>12000)throw Error("Request too large");
  const body=JSON.parse(raw);const [context,db]=await Promise.all([getCurrentBusinessContext(),createAuthenticatedSupabaseServerClient()]);
  if(!context.currentSalon||!isOwnerMembership(context.currentMembership)||!db) return Response.json({error:"Owner access required"},{status:403,headers});
  if(body.op==='context'){const date=await db.rpc('get_salon_business_date',{p_salon_id:context.currentSalon.id});if(date.error)throw Error(date.error.message);return Response.json({salonId:context.currentSalon.id,today:date.data},{headers});}
  if(body.salonId!==context.currentSalon.id)return Response.json({error:"Selected salon changed. Reopen this page."},{status:409,headers});
  const result=body.op==='read'?await db.rpc('shop_money_read',{p_salon:body.salonId,p_start:body.start,p_end:body.end}):await db.rpc('shop_money_write',{p_salon:body.salonId,p_op:body.op,p_args:body.args});
  if(result.error)throw Error(result.error.message);
  return Response.json(result.data,{headers});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Unable to save"},{status:400,headers});}
}

/** Live read, separate from commands so native cancellation never implies an uncertain write. */
export async function GET(request:NextRequest){
 const params=request.nextUrl.searchParams;
 if([...params].some(([key])=>!['op','salonId','start','end'].includes(key)||params.getAll(key).length!==1)||params.has('op')&&params.get('op')!=='context')return Response.json({error:'Invalid query'},{status:400,headers:{'Cache-Control':'no-store'}});
 const body=params.get('op')==='context'?{op:'context'}:{op:'read',salonId:params.get('salonId'),start:params.get('start'),end:params.get('end')};
 const headers=new Headers(request.headers);headers.set('Content-Type','application/json');
 return POST(new NextRequest(request.nextUrl,{method:'POST',headers,body:JSON.stringify(body)}));
}
