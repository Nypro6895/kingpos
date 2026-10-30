import {getRequestBusinessContext} from "@/lib/request-business-context";
import {isSalonManageContext,isSalonStaffContext} from "@/lib/current-context";
import {createAuthenticatedSupabaseServerClient} from "@/lib/supabase/server";
import {resolveStaffAccountForSalon} from "@/lib/staff-account";
import {hasPermission} from "@/lib/permissions";
import {getContextBusinessDate,getContextBusinessTimezone} from "@/lib/salon-business-clock";
import {getUtcBoundsForLocalDate} from "@/lib/daily-pos-report";
import {loadFinancialInputHistory,type FinancialHistorySurface} from "@/lib/financial-input-history";
import {runWithReadContext} from "@/lib/read-context-scope";
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T12:00:00Z"))&&new Date(value+"T12:00:00Z").toISOString().slice(0,10)===value;
export async function GET(request:Request){return runWithReadContext(async()=>{
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
 try{
  const args=new URL(request.url).searchParams,surface=args.get("surface")??"today";
  if(!["today","reports","payroll"].includes(surface))return reply({error:"Invalid history view."},400);
  const context=await getRequestBusinessContext();if(!context.user)return reply({error:"Sign in required."},401);
  if(!context.currentSalon||args.get("salonId")&&args.get("salonId")!==context.currentSalon.id)return reply({error:"The salon changed. Reload this view."},403);
  const client=await createAuthenticatedSupabaseServerClient();if(!client)return reply({error:"Please sign in again."},401);
  let staffId:string|undefined;
  if(isSalonStaffContext(context)){
   if(surface==="reports")return reply({error:"Report access required."},403);
   const result=await resolveStaffAccountForSalon({context,supabase:client});
   if(result.status!=="found"||!result.staff)return reply({error:"A unique Staff profile is required."},403);
   staffId=result.staff.id;
  }else{
   if(!isSalonManageContext(context))return reply({error:"Salon access required."},403);
   const allowed=surface==="reports"?await hasPermission("reports.view",context):surface==="payroll"?(await hasPermission("payroll.view",context)||await hasPermission("payroll.manage",context)):(await hasPermission("tickets.view",context)||await hasPermission("reports.view",context));
   if(!allowed)return reply({error:"History access required."},403);
  }
  const today=await getContextBusinessDate(context),start=args.get("start")??args.get("date")??today,end=args.get("end")??args.get("date")??start;
  if(!validDate(start)||!validDate(end)||start>end)return reply({error:"Invalid history dates."},400);
  const bounds=surface==="today"&&!args.has("date")?getUtcBoundsForLocalDate(today,await getContextBusinessTimezone(context)):null;
  const rows=await loadFinancialInputHistory(client,context.currentSalon.id,start,end,{staffId,surface:surface as FinancialHistorySurface,
   ...(bounds?{createdFrom:bounds.openedFrom,createdTo:new Date(Date.parse(bounds.openedTo)+1).toISOString()}:{})});
  return reply({rows});
 }catch{return reply({error:"Input history could not be loaded. Please retry."},503);}
});}
